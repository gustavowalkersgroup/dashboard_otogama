# Dashboard de Métricas · Otogama

Dashboard web que mostra o valor gerado pela automação de WhatsApp + IA operada pela
NexTags para a clínica Otogama: consultas marcadas pela IA, lembretes enviados,
confirmações de pacientes, trabalho poupado da equipe e saúde da API da clínica.

**Stack:** Next.js (App Router) + TypeScript + Tailwind · Recharts · Neon Postgres
(`@neondatabase/serverless`) · deploy na Vercel.

## Arquitetura

```
fontes (n8n / NexTags) ──POST /api/eventos (x-api-key)──▶ Next.js na Vercel ──▶ Neon Postgres
                                                          /  (dashboard, senha + cookie)
                                                          \
                        n8n ◀──POST webhook (x-api-key)──  ações do painel
```

- Para **ler**, o dashboard só consome o próprio banco. Ele **nunca** chama a API da
  clínica (Konsist) no request path — dados chegam por sincronização assíncrona via n8n.
- Para **agir** (hoje: reenviar lembrete), ele chama um webhook do **n8n** e nada mais.
  Quem fala com Konsist e NexTags é sempre o n8n, que já tem as credenciais, os
  `flow_id` e o template da mensagem. É isso que garante que o lembrete reenviado à
  mão seja idêntico ao que o disparo automático mandaria.
- Tabela única `eventos` (event store append-only) com `tenant_id` em tudo desde o
  dia 1 (valor fixo `otogama` no v1) para viabilizar multi-tenant depois.
- Timezone: armazenamos UTC (`timestamptz`), exibimos em horário de Brasília.

O contrato da API de ingestão, com exemplos de curl por tipo de evento, está em
[`INTEGRACAO.md`](./INTEGRACAO.md).

## Setup

### 1. Banco (Neon)

1. Crie um projeto no [Neon](https://neon.tech) na região **AWS São Paulo
   (`aws-sa-east-1`)** — dados de pacientes ficam no Brasil (LGPD).
2. Copie a connection string (com `?sslmode=require`) para `DATABASE_URL`.
3. Aplique o schema:

```bash
npm run db:init
```

### 2. Variáveis de ambiente

```bash
cp .env.example .env.local
```

| Variável | Uso |
|---|---|
| `DATABASE_URL` | connection string do Neon |
| `DASHBOARD_PASSWORD` | senha única de acesso ao dashboard |
| `INGEST_API_KEY` | chave do header `x-api-key` da ingestão |
| `SESSION_SECRET` | assina o cookie de sessão (≥ 32 chars aleatórios) |
| `N8N_REENVIO_URL` | webhook do n8n que executa o reenvio manual de lembrete |
| `N8N_REENVIO_TOKEN` | token que o webhook de reenvio exige no header `x-api-key` |

Gere segredos fortes e **distintos** para cada uma:

```bash
openssl rand -base64 32
```

As opcionais (rate limit, horas até "pendente", minutos da métrica de trabalho
poupado) estão documentadas no `.env.example`.

As duas da tela Lembretes (`N8N_REENVIO_URL` e `N8N_REENVIO_TOKEN`) precisam bater
com o workflow **"Otogama - Reenvio Manual de Lembretes"** no n8n, que guarda o token
e o compara com `trim()` nos dois lados. Sem elas o dashboard sobe normal: só o botão
de reenviar responde 500 dizendo qual variável falta.

A primeira versão tentou economizar essa variável reutilizando o `INGEST_API_KEY` (o
n8n já guarda o mesmo valor na credencial que usa para postar em `/api/eventos`), com
o webhook autenticando pelo header auth do próprio n8n. Não funcionou, e a forma como
não funcionou vale registro: o webhook devolvia `403 Authorization data is wrong!`
enquanto a mesma credencial gravava eventos sem erro. A rota de ingestão apara o valor
que recebe; a comparação do n8n não apara. Um espaço invisível no valor guardado é
portanto invisível na saída e fatal na entrada — e o valor de uma credencial não pode
ser lido nem corrigido pela API do n8n. Daí o token dedicado, comparado dentro do
workflow com `trim()` dos dois lados.

### 2.1 Conferir a configuração sem decorar segredo

`GET /api/login/diagnostico` diz o que **este deployment** enxerga em cada variável:
`configurada`, `tamanho`, `tinhaEspacoSobrando` e `impressao` (8 primeiros hex do
`sha256`). Nunca devolve valor nenhum.

Aceita **sessão** ou a `INGEST_API_KEY` no header `x-api-key`. Estando logado no
dashboard, basta abrir a URL no navegador — a chave existe só para o caso de estar
trancado fora do login, que é justamente quando não há sessão.

Impressões esperadas, para conferir sem precisar dos valores:

| Variável | Impressão esperada | Onde mais o valor vive |
|---|---|---|
| `N8N_REENVIO_TOKEN` | `b67aea35` | dentro do node `Validar Pedido` do workflow de reenvio |
| `INGEST_API_KEY` | — | credencial `Nextags Otogama` no n8n |
| `DASHBOARD_PASSWORD` | — | em nenhum outro lugar |
| `SESSION_SECRET` | — | em nenhum outro lugar |

Impressão de token aleatório longo pode ser publicada aqui sem risco: 8 hex de
`sha256` não voltam a um segredo de 40 caracteres sorteados. **Senha, não** — por isso
`DASHBOARD_PASSWORD` fica de fora desta tabela, ainda que o endpoint reporte a dela.

Para `DATABASE_URL` o endpoint devolve `host` e `banco`, sem usuário nem senha. Serve
para responder "a qual projeto do Neon este deployment está apontando?", que não dá
para descobrir de outro jeito depois que a variável é marcada como sensível na Vercel
— e responde também a versão mais perigosa da pergunta, "produção e staging estão no
mesmo banco?".

### 3. Rodar local

```bash
npm install
npm run db:init   # uma vez
npm run seed      # dados fake realistas p/ desenvolver e demonstrar
npm run dev
```

Abra http://localhost:3000 — entre com a `DASHBOARD_PASSWORD`.

### 4. Deploy na Vercel

1. Importe este repositório na Vercel (framework: Next.js, sem config extra).
2. Configure as 4 variáveis de ambiente em *Settings → Environment Variables*.
3. Deploy. Crie a tabela com
   `curl -X POST https://<app>.vercel.app/api/eventos/init -H "x-api-key: $INGEST_API_KEY"`
   e teste: `GET https://<app>.vercel.app/api/eventos/health` deve responder
   `200 {"ok":true,"store":"ok"}`. Qualquer 503 aí traz em `store` qual é o
   conserto — o runbook está em `db/RECUPERACAO.md`.
4. Atualize a URL de produção nos exemplos do `INTEGRACAO.md` e aponte as fontes.

### 5. Apontar as fontes

Quem alimenta o dashboard (fora deste repo — veja `INTEGRACAO.md`):

| Fonte | Evento |
|---|---|
| n8n · workflows de lembrete D-0 / D-1 / consulta perdida | `envio_lembrete` |
| n8n · webhook de confirmação | `confirmacao` |
| n8n · sync Konsist (poll de pré-agendamentos) | `agendamento_ia`, `desfecho_agendamento` |
| n8n · poll horário na Konsist (agenda/desfecho de consultas) | `status_consulta` |
| n8n · monitor de uptime da API | `api_status` |
| NexTags · External Request no botão "preciso de ajuda" | `precisa_ajuda` |

Todos POSTam em `/api/eventos` com o header `x-api-key`. Os nodes de log devem rodar
**em paralelo** ao fluxo principal (nunca bloquear o envio ao paciente).

## Segurança & LGPD

- Dashboard inteiro atrás de login (verificação no proxy/middleware, não só no
  client); `noindex` em header e metadata; sem página pública.
- Telefones **mascarados por padrão** na UI (`(61) 9••••-••88`), com toggle
  "mostrar" que vale só pela sessão do navegador.
- Nome de paciente nunca vai em URL/query string.
- Banco em `sa-east-1` (São Paulo).
- Rate limit básico na ingestão (default 60 req/min) contra loop acidental de workflow.
- Zero segredos no repositório — `.env.example` só com nomes.

### Rotação de chaves

1. **`INGEST_API_KEY`**: gere a nova, adicione na Vercel (redeploy), atualize o
   header nos nodes do n8n e no External Request do painel NexTags, confirme os
   eventos chegando e descarte a antiga. A API aceita só uma chave por vez — faça a
   troca em janela curta (eventos rejeitados com 401 são reenviados pelos retries
   das fontes).
2. **`DASHBOARD_PASSWORD`**: troque na Vercel e redeploy; sessões já emitidas
   continuam válidas até expirarem (30 dias).
3. **`SESSION_SECRET`**: troque na Vercel e redeploy — **derruba todas as sessões**
   (todo mundo loga de novo). É o jeito de revogar acesso imediato.

## Métricas — como cada número é calculado

O filtro tem duas escalas, que respondem a perguntas diferentes:

- **7 / 30 / 90 dias** — recorta pela data do **evento**: o que a automação fez
  no intervalo (lembretes disparados, confirmações recebidas).
- **Ontem / Hoje / Amanhã** — recorta pela data da **consulta**: como está a
  agenda daquele dia. Por data de evento "amanhã" viria sempre vazio (nada
  acontece no futuro); o que interessa é quem tem consulta amanhã e já
  confirmou. A data da consulta vem de `payload.data_consulta`, então só entram
  no recorte as chaves que algum evento datou — os gráficos de série por dia
  ficam ocultos (um dia só não vira série) e o uptime da API, que não tem chave
  de agendamento, usa a janela do próprio dia.


| Métrica | Cálculo |
|---|---|
| Consultas marcadas pela IA | eventos `agendamento_ia`; status atual vem do último `desfecho_agendamento` da mesma chave |
| Lembretes enviados | mensagens = `COUNT(DISTINCT (telefone, ts))`; agendamentos avisados = `COUNT(*)` |
| Confirmações | `confirmacao` com resultado `ok` ou `ja_confirmado` |
| Taxa de confirmação | chaves avisadas no período que têm confirmação posterior ÷ chaves avisadas |
| Tempo até confirmar | mediana (e média) de `confirmação − envio anterior mais recente`, descartando deltas negativos ou > 72h |
| Trabalho poupado | lembrete enviado = 3 min · confirmação processada = 2 min · agendamento da IA = 8 min (editáveis via env); exibido em horas e em dias úteis de 8h |
| Saúde da API | pares fora→ok de `api_status`; uptime % recortado ao período |
| Taxa de falta (tela Agenda) | desfecho mais recente por chave em `status_consulta`; `Faltou ÷ (Faltou + Realizado)` — `Cancelado` nunca entra no denominador |
| Comparecimento com × sem lembrete (Visão geral) | mesmo desfecho, separado por existência de `envio_lembrete` para a chave; funil Agendado → Confirmado → Compareceu |
| Desfecho por médico (tela Agenda) | desfecho mais recente por chave, agrupado por `payload.medico`, top 12 por volume |
| Comparecimento IA × manual (tela Agendamentos IA) | mesmo desfecho, separado por existência de `agendamento_ia` para a chave |

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | dev server local |
| `npm run build` | build de produção |
| `npm run db:init` | aplica `db/schema.sql` no `DATABASE_URL` |
| `npm run seed` | popula ~45 dias de dados fake (idempotente) |
| `npm run lint` | eslint |

## v2 (fora do escopo atual)

Multi-tenant real (login por cliente), resumo semanal no WhatsApp do gestor,
comparativo mês a mês, export CSV/PDF, relatório formal de SLA da Konsist.

---

por **NexTags** · nextags.com.br
