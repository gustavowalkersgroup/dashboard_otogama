# Recuperação do event store

Runbook do incidente de 25–30/08/2026 e da ordem exata das operações para
recolocar o dashboard de pé. Serve para qualquer repetição: os passos 3 a 6 são
os mesmos sempre que a tabela `eventos` desaparecer ou a `DATABASE_URL` mudar.

## 1. O que aconteceu

A `DATABASE_URL` do dashboard apontava para o database `neondb` da branch
`br-purple-sun-ac4scpk2` (main) do projeto Neon `neon-fulvous-pocket` — **a mesma
branch e o mesmo database de um app de marketplace**, com 24 tabelas de
Prisma/NextAuth. Uma migração desse app derrubou a tabela `eventos` entre 25 e
30/08. A ingestão passou a responder `500 relation "eventos" does not exist` e o
dashboard, "Não foi possível carregar os dados".

Duas coisas transformaram um acidente em cinco dias de silêncio:

- **Ninguém observava o event store.** O `GET /api/eventos/health` respondia
  `200 {"ok":true}` sem tocar no banco: media se o processo respirava, não se
  havia onde gravar. Corrigido — hoje ele checa a tabela e responde **503** com
  `store` e `motivo`.
- **`history_retention_seconds` era 21600** (6 h), então o restore
  point-in-time do Neon já não alcançava o momento do DROP quando o problema foi
  notado. As outras duas branches do projeto eram previews da Vercel criadas em
  30/08, depois do dano.

**O log de eventos anterior a 30/08 está perdido.** Reconstruível a partir das
fontes: `status_consulta` (o poll relê 21 dias da Konsist), `envio_lembrete` e
`agendamento_ia` (backfills existentes no n8n). Irrecuperável: o histórico de
`confirmacao` — e com ele o "tempo até confirmar" — e o histórico de `api_status`.

## 2. A decisão: projeto Neon próprio

O dashboard passa a ter **projeto Neon próprio**, não só um database separado
dentro do projeto compartilhado. Razões:

- A falha não foi colisão de nome de tabela, foi **migração de outro time
  rodando contra a nossa branch**. Database separado resolve o `DROP TABLE`, mas
  não um reset de branch nem um `DROP DATABASE`.
- `history_retention_seconds`, autoscaling e scale-to-zero são configuração **de
  projeto**. Enquanto for compartilhado, subir a retenção do dashboard mexe no
  app do outro time.
- **Migrar custa zero agora**, e só agora: não há dado para mover. Adiar é
  escolher pagar depois um custo que hoje é gratuito.

Um detalhe que muda o caminho: a organização do Neon é **gerenciada pela
Vercel** (veio do Marketplace). A API do Neon recusa criar projeto ali —
`404 action restricted; reason:"organization is managed by Vercel"`. Projeto
novo se cria **pela Vercel**, em *Storage → Create Database → Neon*, e a
integração injeta as variáveis no projeto sozinha. Pela API do Neon dá para
criar database e role dentro de um projeto que já existe, mas não projeto.

## 3. Criar o projeto

Painel da **Vercel** → *Storage* → **Create Database** → Neon → conectar ao
projeto `dashboard_otogama`. Não pelo console do Neon: veja a restrição no fim
da seção 2.

Feito em 31/08/2026 — é este o banco do dashboard hoje:

| campo | valor |
| --- | --- |
| store (Vercel) | `otogama` |
| projeto Neon | `dawn-union-72555580` |
| região | `us-east-1` (`c-11`) |
| host | `ep-tiny-rain-av6u7yub-pooler.c-11.us-east-1.aws.neon.tech` |
| database | `neondb` |
| role | `neondb_owner` |

Nada mais divide este projeto com o dashboard. Duas coisas para conferir no
console do Neon depois de criar:

- **History retention** — subir para o máximo que o plano permitir (24 h no
  Free). É o que decide se um acidente é reversível.
- **Região.** Está certa. As functions deste projeto rodam em `iad1`
  (us-east-1) — dá para conferir no header `x-vercel-id` de qualquer resposta,
  que em 31/08 vinha `gru1::iad1::…`: `gru1` é só o edge que atendeu, `iad1` é
  onde a function executou. Era o store antigo, em `sa-east-1`, que estava do
  lado errado do continente.

## 4. Trocar a `DATABASE_URL` na Vercel

A integração da Vercel injeta `DATABASE_URL` (e `POSTGRES_*`, `PG*`) ao conectar
o store. Se já existia uma `DATABASE_URL` posta à mão, a integração **não**
sobrescreve, e o deployment continua no banco velho sem reclamar de nada.

**Nunca apague primeiro.** Em 31/08 este runbook dizia "apagar a manual e deixar
a da integração" e isso derrubou a produção: havia só **uma** `DATABASE_URL`, ela
já apontava para o banco novo e funcionava; apagada, o projeto ficou sem variável
de banco nenhuma. A queda só apareceu no deploy seguinte, porque variável só vale
para deployment novo — o deployment em pé continuou funcionando e escondeu o
estrago por vinte minutos.

A ordem segura é **editar, não apagar**:

1. Abrir a `DATABASE_URL` que existe e **colar nela** a connection string
   **pooled** (`-pooler` no host) do projeto novo, em Production, Preview e
   Development. Se não existir nenhuma, criar.
2. **Redeploy.**
3. Conferir, e só então mexer em variável duplicada, se houver.

Conferir para onde o deployment está apontando — de dentro do dashboard já
logado, ou por fora com a `INGEST_API_KEY` no header `x-api-key`:

```
GET /api/login/diagnostico
```

O campo `DATABASE_URL` devolve `configurada`, `host` e `banco` (nunca usuário nem
senha), e `commit` diz qual deployment respondeu. `configurada: false` é
exatamente o estado de 31/08 13:30: nenhuma variável de banco no projeto.

## 5. Criar a tabela

```
POST /api/eventos/init
x-api-key: <INGEST_API_KEY>
```

Aplica o DDL de `src/lib/schema.ts` — todo `IF NOT EXISTS`, não apaga nada,
chamar duas vezes é o mesmo que chamar uma. Responde
`{"ok":true,"comandos":4,"tabela":"criada"}`.

Alternativa sem HTTP: colar `db/schema.sql` no SQL Editor do Neon, ou
`npm run db:init` com a `DATABASE_URL` no ambiente.

Se for aplicar o DDL por fora, **em sequência**: os quatro comandos dependem um
do outro. No SQL over HTTP do Neon cada requisição é uma transação própria, e em
31/08 mandar as quatro em paralelo (o nó HTTP do n8n dispara até 50 itens de uma
vez) fez os três `CREATE INDEX` correrem na frente do `CREATE TABLE` e
devolverem `42P01 relation "eventos" does not exist`. A rota `/api/eventos/init`
não tem esse problema: ela roda um comando por vez, com `await`.

## 6. Confirmar

```
GET /api/eventos/health   →   200 {"ok":true,"store":"ok"}
```

Enquanto não estiver de pé, o mesmo endpoint diz qual é o conserto:

| `store` | significado | conserto |
| --- | --- | --- |
| `sem_database_url` | variável ausente ou vazia neste deployment | passo 4 |
| `tabela_ausente` | banco responde, tabela não existe | passo 5 |
| `sem_conexao` | Neon inalcançável ou credencial recusada | `motivo` traz o erro do driver |

## 7. Reconstruir o que dá

Na ordem, pelo n8n:

1. `nsU9hXCjYt5T1tnT` — **Poll Status Consulta**. Roda sozinho; relê 21 dias da
   Konsist em três janelas de 7 dias. Repovoa a tela de Agenda. A Data Table de
   estado (`LvK4ttoKzGS2uXPq`) só avança quando o POST volta 2xx, então nada foi
   marcado como enviado durante a queda.
2. `40Sg7PZFdnpxfi0l` — backfill de `envio_lembrete` desde 04/08, a partir das
   Data Tables de dedup (D-0, D-1, consulta perdida).
3. `uUNDzdCLAZcTELFx` — backfill de `agendamento_ia`, a partir da Data Table de
   rastreio.

**Um por vez.** A ingestão tem rate limit de 60 req/min por instância; os dois
backfills somados (30/35s + 20/30s) passam disso, e o poll também escreve. Rodar
em paralelo troca gravação por 429.

Duas coisas nesses dois workflows que já custaram tempo:

- **O nó `Enviar ao Dashboard` vinha desabilitado.** Foi desligado depois da
  primeira rodada, em agosto, para não repetir sem querer. Com ele desligado o
  workflow roda inteiro, o n8n diz "success", e **não grava nada** — o nó
  desabilitado passa a entrada adiante e o `Resumo` conta tudo como falha. Se um
  backfill "rodar" e não aparecer linha, é isso. Não há nó de WhatsApp em
  nenhum dos dois: o único envio é o POST em `/api/eventos`.
- **Os dois tinham corte** (21/08 13:37 e 22/08 00:00), para não duplicar com a
  ingestão ao vivo. O corte foi removido em 31/08, e tinha de ser: o que a
  ingestão gravou entre o corte e 30/08 morreu com o banco antigo, então manter
  o corte deixaria justamente esses dez dias de fora. Duplicar não é risco —
  a tabela nasceu vazia e o índice `eventos_dedup` barra repetição.

O backfill de `agendamento_ia` exigia, antes, apagar as linhas incompletas
(`paciente IS NULL`) para elas não vencerem o `DISTINCT ON (chave) ORDER BY ts
DESC`. Numa tabela recriada vazia esse pré-requisito desaparece.

## 8. O que impede a repetição

- Health check honesto (passo 6), e o workflow **`Otogama - Monitor Event
  Store`** (`TM7xi7RgUSn5vzQM`) olhando para ele de 15 em 15 minutos. Alerta no
  Discord só na **transição** (fora/voltou), com estado na Data Table
  `IadNxjPHdvrCaRnL`, linha `id_monitor = event_store` — a mesma tabela do
  monitor da Konsist, linha separada, para não mexer numa máquina de estado que
  já funciona. O alerta traduz o campo `store` no conserto, em vez de mandar
  quem lê abrir a rota. Discord e não WhatsApp de propósito: isto é problema de
  quem mantém o sistema, não da recepção da clínica.
- `POST /api/eventos/init`: recriar a tabela não depende mais de alguém ter a
  connection string e um cliente Postgres à mão.
- A ingestão devolve o motivo do Postgres no corpo do 500, em vez de "falhou".
- Projeto Neon próprio: nenhuma migração de terceiro alcança esta tabela.
