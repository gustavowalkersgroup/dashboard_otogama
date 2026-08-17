# Integração — API de ingestão do dashboard Otogama

Guia para instrumentar as fontes (n8n e painel NexTags). Este arquivo é o contrato:
leve-o para a sessão/equipe que administra os workflows.

## Endpoint

```
POST {BASE_URL}/api/eventos
Content-Type: application/json
x-api-key: <INGEST_API_KEY>
```

- **BASE_URL produção:** `https://SEU-APP.vercel.app` *(atualizar após o deploy)*
- **Health check (sem auth):** `GET {BASE_URL}/api/eventos/health` → `200 {"ok":true}`
  — use no monitor do n8n para vigiar o próprio dashboard.

## Corpo do evento

```json
{
  "tipo": "envio_lembrete",
  "chave": "575382,575383",
  "telefone": "5561999998888",
  "paciente": "Maria Silva",
  "ts": "2026-08-17T08:00:12-03:00",
  "payload": { "origem": "d1" }
}
```

| Campo | Obrigatório | Regras |
|---|---|---|
| `tipo` | sim | um de: `envio_lembrete`, `confirmacao`, `precisa_ajuda`, `agendamento_ia`, `desfecho_agendamento`, `api_status` |
| `chave` | não | chave do agendamento na Konsist. Lista separada por vírgula/`;`/espaço é **expandida em N linhas** (uma por chave) |
| `telefone` | não | E.164 sem `+` (ex.: `5561999998888`); não-dígitos são removidos; vazio é aceito |
| `paciente` | não | nome, quando disponível |
| `ts` | não | ISO 8601 **com offset** (`-03:00`, `Z`, …). Ausente → `now()`. Nunca mande hora local sem offset — o servidor n8n é UTC-4 |
| `payload` | não | objeto JSON por tipo (abaixo). Campos extras em qualquer nível são ignorados |

### Respostas

| Situação | Resposta |
|---|---|
| Gravado | `200 {"ok":true,"inseridos":N,"dup":false}` |
| Reenvio (retry) do mesmo evento | `200 {"ok":true,…,"dup":true}` — **nunca é erro**, pode reenviar à vontade |
| `x-api-key` errada/ausente | `401` |
| Body inválido (`tipo` desconhecido, `ts` não-ISO, JSON quebrado) | `400` com o motivo |
| Mais de 60 req/min | `429` (proteção contra loop de workflow) |

### Padrão obrigatório nos workflows n8n

O node HTTP que loga no dashboard roda **em paralelo** ao fluxo principal, com
`onError: continueRegularOutput` — uma falha do dashboard **nunca** pode bloquear o
envio de mensagem ao paciente ou a gravação na Konsist.

## Payloads por tipo + curl de teste

Defina antes: `BASE=https://SEU-APP.vercel.app` e `KEY=<INGEST_API_KEY>`.

### 1. `envio_lembrete` — workflows D-0, D-1 e consulta perdida

`payload.origem`: `"d0"` (lembrete do dia) | `"d1"` (véspera) | `"perdida"`.

```bash
curl -sS -X POST "$BASE/api/eventos" -H "x-api-key: $KEY" -H "Content-Type: application/json" -d '{
  "tipo": "envio_lembrete",
  "chave": "575382,575383",
  "telefone": "5561999998888",
  "paciente": "Maria Silva",
  "ts": "2026-08-17T08:00:12-03:00",
  "payload": { "origem": "d1", "tipo_consulta": "consulta", "medico": "Dr. X",
               "especialidade": "Otorrino", "data_consulta": "18/08/2026", "hora": "09:00 e 10:20" }
}'
```

### 2. `confirmacao` — webhook de confirmação (3 desfechos)

`payload.resultado`: `"ok"` (gravou na Konsist) | `"ja_confirmado"` | `"sem_paciente"` (falha).

```bash
curl -sS -X POST "$BASE/api/eventos" -H "x-api-key: $KEY" -H "Content-Type: application/json" -d '{
  "tipo": "confirmacao",
  "chave": "575382",
  "telefone": "5561999998888",
  "paciente": "Maria Silva",
  "payload": { "resultado": "ok" }
}'
```

### 3. `precisa_ajuda` — External Request do painel NexTags (direto, sem n8n)

Body mínimo — a interpolação do NexTags é substituição crua de texto, então **só
campos simples**, nunca texto livre:

```json
{ "tipo": "precisa_ajuda", "chave": "{{agendamento_chave}}", "telefone": "{{phone}}" }
```

```bash
curl -sS -X POST "$BASE/api/eventos" -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{ "tipo": "precisa_ajuda", "chave": "575382", "telefone": "5561999998888" }'
```

(`ts` ausente → o dashboard usa o horário do recebimento; `paciente` é opcional.)

### 4. `agendamento_ia` — sync Konsist (pré-agendamentos `origem=1`)

```bash
curl -sS -X POST "$BASE/api/eventos" -H "x-api-key: $KEY" -H "Content-Type: application/json" -d '{
  "tipo": "agendamento_ia",
  "chave": "576001",
  "telefone": "5561988887777",
  "paciente": "João Souza",
  "ts": "2026-08-17T10:32:00-03:00",
  "payload": { "protocolo": "P123456", "medico": "Dr. X", "especialidade": "Otorrino",
               "servico": "Consulta", "idstatus": 1, "status": "Em Análise" }
}'
```

### 5. `desfecho_agendamento` — sync Konsist (mudança para idstatus 2/3)

```bash
curl -sS -X POST "$BASE/api/eventos" -H "x-api-key: $KEY" -H "Content-Type: application/json" -d '{
  "tipo": "desfecho_agendamento",
  "chave": "576001",
  "ts": "2026-08-17T14:05:00-03:00",
  "payload": { "protocolo": "P123456", "idstatus": 2, "status": "Agendado" }
}'
```

### 6. `api_status` — monitor de uptime (só em transição de estado)

Queda:

```bash
curl -sS -X POST "$BASE/api/eventos" -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{ "tipo": "api_status", "payload": { "estado": "fora", "detalhe": "HTTP 502 — processo parado" } }'
```

Recuperação (com duração da queda em minutos):

```bash
curl -sS -X POST "$BASE/api/eventos" -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{ "tipo": "api_status", "payload": { "estado": "ok", "detalhe": "HTTP 502 — processo parado", "duracao_min": 42 } }'
```

## Testes de sanidade

```bash
# health (sem auth) → 200
curl -sS "$BASE/api/eventos/health"

# key errada → 401
curl -sS -o /dev/null -w "%{http_code}\n" -X POST "$BASE/api/eventos" \
  -H "x-api-key: errada" -H "Content-Type: application/json" -d '{"tipo":"confirmacao"}'

# tipo inválido → 400
curl -sS -X POST "$BASE/api/eventos" -H "x-api-key: $KEY" \
  -H "Content-Type: application/json" -d '{"tipo":"nao_existe"}'

# reenviar o MESMO evento (mesmo tipo+chave+ts) → 200 com "dup":true
```

## Backfill do histórico de envios

As Data Tables de dedup do n8n guardam `chave, data_consulta, telefone, enviado_em`
desde o início. Para backfill: exportar e POSTar cada linha como `envio_lembrete`
com `ts = enviado_em` (ISO com offset!) e payload mínimo
`{"origem":"d1"}` / `{"origem":"d0"}` / `{"origem":"perdida"}` conforme a tabela de
origem. **Ignorar chaves de teste** (`9990xx`/`9990x` — chaves reais estão na faixa
56xxxx–57xxxx). O dedup do dashboard torna o backfill idempotente — pode rodar mais
de uma vez.
