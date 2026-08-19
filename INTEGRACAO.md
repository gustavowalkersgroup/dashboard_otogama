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
| `tipo` | sim | um de: `envio_lembrete`, `confirmacao`, `precisa_ajuda`, `agendamento_ia`, `desfecho_agendamento`, `api_status`, `status_consulta`, `falha_envio`, `pedido_reagendamento` |
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

### 6. `status_consulta` — poll horário na Konsist (agenda/desfecho)

Diferente dos demais tipos (disparados por ação), este vem de um **poll periódico
via GET direto na Konsist** (não webhook) — a API da clínica é instável, então em
vez de tempo real, o n8n reconcilia a agenda a cada ~1h e só posta um evento
quando a `situacao` observada de uma consulta **muda** desde o poll anterior
(nunca 1 linha por hora por consulta parada no mesmo estado).

`payload.situacao`: `"Agendado"` | `"Confirmado"` | `"Realizado"` | `"Faltou"` | `"Cancelado"`.
`chave` é o id do agendamento na Konsist — mesmo espaço de chave usado em
`envio_lembrete`/`confirmacao`/`agendamento_ia` quando aplicável, o que permite
cruzar "recebeu lembrete" e "foi criado pela IA" com o desfecho real.

```bash
curl -sS -X POST "$BASE/api/eventos" -H "x-api-key: $KEY" -H "Content-Type: application/json" -d '{
  "tipo": "status_consulta",
  "chave": "575382",
  "ts": "2026-08-18T09:05:00-03:00",
  "payload": { "situacao": "Realizado", "medico": "Dr. X", "especialidade": "Otorrino",
               "servico": "Consulta Otorrino", "data_consulta": "18/08/2026", "hora_consulta": "09:00" }
}'
```

**Importante para quem for implementar o poll:** `Faltou` precisa ser um status
**distinto** de `Cancelado` na Konsist — se os dois caírem no mesmo status
genérico de "cancelado", a métrica de no-show no dashboard fica contaminada por
cancelamentos legítimos. Confirmar esse detalhe antes de ligar o poll em produção.

### 7. `api_status` — monitor de uptime (só em transição de estado)

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

### 8. `falha_envio` — WhatsApp não conseguiu entregar o lembrete (NexTags)

Contraparte do `envio_lembrete` quando a mensagem falha na entrega (número
inválido, bloqueado, etc.) — hoje sem visibilidade nenhuma no dashboard.
**Não conta como lembrete enviado** (não entra em `envio_lembrete`); é um evento
próprio, ainda sem tela dedicada — fica registrado para quando fizer sentido
construir uma visão disso.

```bash
curl -sS -X POST "$BASE/api/eventos" -H "x-api-key: $KEY" -H "Content-Type: application/json" -d '{
  "tipo": "falha_envio",
  "chave": "575382",
  "telefone": "5561999998888",
  "paciente": "Maria Silva",
  "payload": { "origem": "d1", "motivo": "numero_invalido" }
}'
```

### 9. `pedido_reagendamento` — paciente clicou em "reagendar" (NexTags)

Registra a **intenção** de remarcar, disparada pelo botão que entrega a conversa
para a IA reagendar. Não é confirmação — pelo contrário: o paciente está dizendo
que *não* vai ao horário atual. Por isso **nunca** deve ir como `confirmacao`
(inflaria a taxa de confirmação com quem não vai comparecer).

O desfecho do pedido é rastreado à parte: se a IA conseguir marcar, o
sub-workflow de agendamento loga um `agendamento_ia` com a **chave nova**. Ter os
dois eventos permite medir a conversão "pediu para remarcar → remarcou de fato",
e enxergar quem pediu e nunca converteu.

`chave` é a do agendamento **antigo** (o que o paciente está abrindo mão).
`payload.origem`: `"d0"` | `"d1"` | `"perdida"` — de qual aviso veio o pedido.

```bash
curl -sS -X POST "$BASE/api/eventos" -H "x-api-key: $KEY" -H "Content-Type: application/json" -d '{
  "tipo": "pedido_reagendamento",
  "chave": "575382",
  "telefone": "5561999998888",
  "paciente": "Maria Silva",
  "payload": { "origem": "d1", "tipo_consulta": "consulta" }
}'
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
