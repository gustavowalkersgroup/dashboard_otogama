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
```

- O dashboard **só consome** o próprio banco. Ele **nunca** chama a API da clínica
  (Konsist) no request path — dados chegam por sincronização assíncrona via n8n.
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

Gere segredos fortes e **distintos** para cada uma:

```bash
openssl rand -base64 32
```

As opcionais (rate limit, horas até "pendente", minutos da métrica de trabalho
poupado) estão documentadas no `.env.example`.

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
3. Deploy. Teste: `GET https://<app>.vercel.app/api/eventos/health` deve responder
   `200 {"ok":true}`.
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
