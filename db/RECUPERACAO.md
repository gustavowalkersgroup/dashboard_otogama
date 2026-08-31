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

## 3. Criar o projeto

Console do Neon → **New project**:

| campo | valor |
| --- | --- |
| nome | `otogama-dashboard` |
| região | `aws-sa-east-1` (São Paulo — mesma do deployment) |
| database | `otogama` |
| role | `otogama_owner` |
| history retention | o máximo que o plano permitir (24 h no Free) |

## 4. Trocar a `DATABASE_URL` na Vercel

Copiar a connection string **pooled** (`-pooler` no host) do novo projeto e
substituir a `DATABASE_URL` do projeto na Vercel — Production, Preview e
Development. Depois **redeploy**: a Vercel só entrega variável nova para
deployment novo.

Conferir para onde o deployment está apontando, já logado no dashboard:

```
GET /api/login/diagnostico
```

O campo `DATABASE_URL` devolve `host` e `banco` (nunca usuário nem senha). O
`host` tem de ser o do projeto novo, e `banco` tem de ser `otogama`.

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
2. `40Sg7PZFdnpxfi0l` — backfill de `envio_lembrete` desde 04/08. **O nó de
   envio está desabilitado** e tem de continuar assim: é backfill de evento, não
   reenvio de mensagem para paciente.
3. `uUNDzdCLAZcTELFx` — backfill de `agendamento_ia`.

## 8. O que impede a repetição

- Health check honesto (passo 6) — e o Monitor do n8n olhando para ele, com
  alerta no Discord na transição.
- `POST /api/eventos/init`: recriar a tabela não depende mais de alguém ter a
  connection string e um cliente Postgres à mão.
- A ingestão devolve o motivo do Postgres no corpo do 500, em vez de "falhou".
- Projeto Neon próprio: nenhuma migração de terceiro alcança esta tabela.
