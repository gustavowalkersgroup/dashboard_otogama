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
- **Health check (sem auth):** `GET {BASE_URL}/api/eventos/health` — use no
  monitor do n8n para vigiar o próprio dashboard. Ele checa o **event store**,
  não só se o processo respira:

  | resposta | `store` | o que fazer |
  | --- | --- | --- |
  | `200 {"ok":true,"store":"ok"}` | `ok` | nada |
  | `503` | `sem_database_url` | variável ausente ou vazia no deployment |
  | `503` | `tabela_ausente` | `POST /api/eventos/init` |
  | `503` | `sem_conexao` | Neon fora ou credencial recusada — `motivo` traz o erro |

  O 503 é de propósito: o nó HTTP do n8n falha e o alerta sai sozinho. Um health
  check que responde 200 com o banco quebrado é pior que nenhum — foi ele que
  deixou a ingestão morta de 25 a 30/08 sem ninguém perceber.

- **Criar o event store (auth por `x-api-key` ou sessão):**
  `POST {BASE_URL}/api/eventos/init` → `{"ok":true,"comandos":4,"tabela":"criada"}`.
  Aplica o DDL do repositório; é todo `IF NOT EXISTS`, então não apaga nada e
  chamar duas vezes é o mesmo que chamar uma. Use depois de trocar a
  `DATABASE_URL` — veja `db/RECUPERACAO.md`.

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
| `INGEST_API_KEY`/`SESSION_SECRET` ausente no deployment | `500` com o nome da variável |
| Falha ao gravar no banco | `500 {"erro":"falha ao gravar evento: <motivo do Postgres>"}` |

O `500` de gravação devolve o motivo cru do Postgres, raspado de credencial e
cortado em 300 caracteres. Isso existe porque em 30/08/2026 a ingestão passou dias
devolvendo só "falha ao gravar evento": os workflows registravam `falhas: 118` a
cada hora, `motivos` dizia apenas isso, e descobrir se a tabela havia sumido ou se
era falha de conexão exigia ler log da Vercel — que ninguém lê a tempo. O motivo no
corpo aparece direto no `Resumo` de qualquer workflow e nas execuções do n8n.

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

### 2. `confirmacao` — webhook de confirmação (4 desfechos)

`payload.resultado`: `"ok"` (gravou na Konsist) | `"ja_confirmado"` | `"erro_api"` (a
Konsist não respondeu) | `"sem_paciente"` (a chave não tem paciente correspondente).

**`erro_api` é diferente de falha.** Quando a Konsist está fora, o paciente
confirmou de verdade — o que faltou foi gravar. O n8n guarda essa confirmação
numa fila (Data Table `Otogama Confirmacoes Pendentes`), o workflow *Monitor API
Konsist* retenta a cada 15 minutos enquanto a API responde, e desiste depois de
5 tentativas marcando `falha_definitiva`. O paciente recebe uma mensagem
dizendo que a confirmação foi recebida e será sincronizada.

Manter os dois separados importa porque eles pedem ações opostas: `sem_paciente`
é problema de cadastro e alguém precisa olhar a chave; `erro_api` normalmente se
resolve sozinho e olhar seria desperdício. Até 25/08/2026 os dois chegavam como
`sem_paciente`, e a tela contava queda de API como paciente não localizado.

Quando a fila desiste, o resultado final é `"falha_definitiva"`: ninguém mais vai
tentar, o paciente acha que confirmou, e alguém precisa gravar na mão no sistema
da clínica. É o único desfecho desta tela que exige ação humana obrigatória — o
`Monitor API Konsist` alerta no Discord quando acontece.

Os desfechos na tela são contados pelo **último resultado de cada chave**, não
por evento: quando a fila drena, o `Monitor API Konsist` posta o `confirmacao` de
novo com `payload.origem = "fila_reprocessada"` e o resultado final (`ok`,
`ja_confirmado` ou `falha_definitiva`), e a chave sai sozinha da coluna de presas.
O payload desse reprocessamento também traz `tentativas` e `http`.

```bash
curl -sS -X POST "$BASE/api/eventos" -H "x-api-key: $KEY" -H "Content-Type: application/json" -d '{
  "tipo": "confirmacao",
  "chave": "575382",
  "telefone": "5561999998888",
  "paciente": "Maria Silva",
  "payload": { "resultado": "ok" }
}'
```

### 3. `precisa_ajuda` — botão de atendimento humano (NexTags, direto, sem n8n)

Body mínimo — a interpolação do NexTags é substituição crua de texto, então **só
campos simples**, nunca texto livre:

```json
{ "tipo": "precisa_ajuda", "chave": "{{agendamento_chave}}", "telefone": "{{phone}}" }
```

`payload.origem` diz **de onde** o paciente pediu atendimento, e é o que separa
"pediu ajuda no fluxo de confirmação" de "perdeu a consulta e pediu ajuda".
Valor **fixo por fluxo** (a coluna "Veio de" do dashboard mostra esse campo):

| Valor | Onde fica o botão |
|---|---|
| `fluxo_confirmacao` | fluxo de lembrete/confirmação (D-0 e D-1) |
| `fluxo_perdida` | fluxo de aviso de consulta perdida |
| `botao_ajuda_painel` | botão avulso do painel NexTags |

No `fluxo_confirmacao`, mande também `payload.lembrete_dia` (`"d0"`/`"d1"`) — ali
o `origem` sozinho não separa os dois, porque D-0 e D-1 compartilham o mesmo fluxo.
Nos demais, **não** use `{{lembrete_dia}}`: é campo persistente do contato e pode
carregar valor velho de um lembrete anterior. Fixe o valor no corpo.

```bash
curl -sS -X POST "$BASE/api/eventos" -H "x-api-key: $KEY" -H "Content-Type: application/json" -d '{
  "tipo": "precisa_ajuda",
  "chave": "575382",
  "telefone": "5561999998888",
  "paciente": "Maria Silva",
  "payload": { "origem": "fluxo_perdida", "tipo_consulta": "consulta" }
}'
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

Implementado pelo workflow n8n **"Otogama - Poll Status Consulta (Agenda)"**.
Diferente dos demais tipos (disparados por ação), este vem de um **poll periódico
na Konsist** (não webhook) — a API da clínica é instável, então em vez de tempo
real, o n8n reconcilia a agenda a cada ~1h e só posta um evento quando a
`situacao` observada de uma consulta **muda** desde o poll anterior (nunca 1
linha por hora por consulta parada no mesmo estado). O estado anterior fica na
Data Table `Otogama Agenda Estado` (`chave` → última `situacao` postada).

`payload.situacao`: `"Agendado"` | `"Confirmado"` | `"Realizado"` | `"Faltou"` | `"Cancelado"`.
`chave` é o id do agendamento na Konsist — mesmo espaço de chave usado em
`envio_lembrete`/`confirmacao`/`agendamento_ia` quando aplicável, o que permite
cruzar "recebeu lembrete" e "foi criado pela IA" com o desfecho real.

**Origem dos dados:** `POST https://otogama.konsistapi.com.br/agendamentos` com
`{ "datai": "YYYY-MM-DD", "dataf": "YYYY-MM-DD" }`. A API recusa (HTTP 400
`Intervalo máximo de 7 dias`) qualquer intervalo maior que 7 dias, então cada
rodada faz **três** chamadas: `-13..-7`, `-6..hoje` e `+1..+7`. Isso cobre 21
dias — o passado para pegar desfecho que a clínica fecha com atraso, o futuro
para alimentar "Pendentes" e o filtro Amanhã.

**Tradução do `agendamento_status` da Konsist** (código de uma letra, verificado
em produção sobre 244 consultas de uma semana já encerrada):

| Konsist | `situacao` | Observado |
| --- | --- | --- |
| `M` | `Realizado` | 163 (67%) |
| `F` | `Faltou` | 42 (17%) |
| `D` | `Cancelado` | 38 (16%) |
| `N` | `Agendado` | só em consulta ainda não encerrada |
| `C` | `Confirmado` | só em consulta ainda não encerrada |
| `A`, `B`, `E` | — | estado transitório do dia; **não vira evento** |

`F` (faltou) é de fato distinto de `D` (desmarcado) — era a dúvida que travava a
métrica de no-show, e a checagem em produção confirmou que a taxa de falta não
fica contaminada por cancelamento legítimo. `A`/`B`/`E` aparecem só em datas
recentes e somem quando o dia fecha; o poll os ignora de propósito, e a consulta
mantém a última `situacao` conhecida até cair num dos cinco estados finais.

**`ts` é a data/hora da consulta, não a do poll.** Assim "Taxa de falta por dia"
mostra o dia em que o paciente faltou, não o dia em que o robô percebeu. Para não
colidir com o índice único `(tenant_id, tipo, chave, ts)` a cada transição, os
**segundos carregam um contador de transições** daquela consulta (`versao` na
Data Table): a primeira observação vai com `:00`, a mudança seguinte com `:01`, e
assim por diante. Uma consulta que vai de `Agendado` a `Realizado` gera duas
linhas no mesmo minuto, com segundos diferentes, e o `DISTINCT ON (chave) ORDER
BY ts DESC` do dashboard fica com a última.

Contador, e não uma ordem fixa por situação, porque consulta volta atrás: quem é
desmarcado e remarcado passa duas vezes por `Confirmado`. Com ordem fixa o
segundo `Confirmado` teria o mesmo `ts` do primeiro, o banco o descartaria como
duplicado e a tela continuaria mostrando `Cancelado` para sempre. O contador dá a
volta em 60 — 60 mudanças de estado na mesma consulta não acontece na prática.

```bash
curl -sS -X POST "$BASE/api/eventos" -H "x-api-key: $KEY" -H "Content-Type: application/json" -d '{
  "tipo": "status_consulta",
  "chave": "575382",
  "ts": "2026-08-18T09:05:00-03:00",
  "payload": { "situacao": "Realizado", "medico": "Dr. X", "especialidade": "Otorrino",
               "servico": "Consulta Otorrino", "data_consulta": "18/08/2026", "hora_consulta": "09:00",
               "codigo_procedimento": "40103439" }
}'
```

**`payload.codigo_procedimento`** (desde 03/09/2026) é o
`agendamento_codigo_procedimento` cru da Konsist, e existe por um motivo só:
separar **exame** de **consulta**. A Konsist não tem esse campo — a distinção
nasceu no disparo de lembretes, porque consulta, exame e encaixe usam templates
diferentes na NexTags, e a regra é `prefixo 40/41/51 ou código PAC = exame`,
`minuto fora da grade de 10 = encaixe`, com **encaixe tendo precedência**.

Guardado cru, e não já classificado, para que a regra viva no dashboard
(`src/lib/atendimento.ts`) e possa mudar sem exigir backfill. Eventos anteriores
a 03/09/2026 não têm o campo; para esses o dashboard cai no tipo que o
`envio_lembrete` anunciou ao paciente, que é o rótulo que ele de fato recebeu.

Como `ts` fica na data da consulta e as janelas incluem 7 dias à frente,
consultas futuras entram nos recortes de 7/30/90 dias como **pendentes** — é
intencional: "na janela olhada, tantas ainda sem desfecho". As taxas de falta e
de comparecimento não são afetadas, porque só contam `Realizado` e `Faltou`.

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

## Sentido inverso: o dashboard chamando o n8n

Tudo acima é o n8n **alimentando** o dashboard. A tela **Lembretes** é a primeira
que anda no sentido contrário: ela dispara uma ação.

O caso que a motivou: a Konsist devolveu HTTP 502 nos dois disparos do D-1
(08:13 e 08:26 do dia 25/08/2026), o workflow não recebeu lista nenhuma e
**nenhum lembrete saiu** — e não sobrou registro de quem deveria ter recebido,
porque foi a lista que faltou. O poll da agenda (§6) cobre esse buraco de lado:
ele varre os próximos 7 dias de hora em hora, então a última leitura que passou
deixou no banco quem tem consulta amanhã. Cruzando com `envio_lembrete` sai
exatamente quem ficou sem aviso.

**Quem faz o quê.** O dashboard sabe *quem* falta; o n8n sabe *como* mandar. O
dashboard não fala com Konsist nem com NexTags — ele posta a lista de chaves num
webhook do n8n, e o n8n relê a agenda, monta a mensagem com os 24 campos do
template e dispara. É o que garante que o lembrete reenviado à mão seja idêntico
ao do disparo automático.

**Autenticação.** O webhook não usa o header auth do n8n: ele compara o
`x-api-key` recebido com um token guardado no próprio workflow, aparando os dois
lados. A primeira versão reaproveitava a credencial `Nextags Otogama` (a mesma que
o n8n usa para postar em `/api/eventos`) e devolvia `403 Authorization data is
wrong!` enquanto aquela credencial gravava eventos normalmente — a rota de ingestão
apara o valor recebido e a comparação do n8n não apara, então um espaço invisível no
valor guardado passava batido na saída e barrava na entrada. Valor de credencial não
é legível nem corrigível pela API do n8n, e o n8n resolve o próprio domínio para o
loopback (não chama a própria URL), então nem medir dava. Token dedicado resolve as
duas coisas: dá para comparar impressões pelos dois lados e o `trim()` fecha a classe
de bug. O dashboard lê esse token de `N8N_REENVIO_TOKEN` — sem fallback, porque
faltar variável tem que falhar dizendo o nome dela.

**Contrato** (`POST` no webhook, header `x-api-key`):

```json
{ "data": "26/08/2026", "chaves": ["574256", "575832"], "origem": "dashboard" }
```

Resposta imediata, antes de qualquer trabalho:

```json
{ "aceito": true, "total": 2, "erro": null }
```

Códigos: `200` aceito, `401` token errado ou ausente, `400` pedido malformado — data
fora do formato, fora da janela hoje/amanhã, nenhuma chave válida, ou mais de 300.

O webhook responde na hora e só depois trabalha — de propósito. Uma chamada à
Konsist leva ~25s só para falhar, e prender a conexão HTTP do dashboard nisso
transformaria "a Konsist está fora" em "o dashboard travou".

**O que o n8n recusa,** mesmo que o dashboard peça:

- `data` que não seja hoje nem amanhã. O texto da mensagem é escolhido pelo campo
  `lembrete_dia` (`d0`/`d1`), então reenviar para depois de amanhã diria ao
  paciente um dia errado.
- chave que não esteja mais em aberto na agenda. Se a consulta foi cancelada
  durante a queda, ela sai da lista relida e não recebe nada.
- chave que não veio no pedido, ou fora do formato numérico.
- mais de 300 chaves por pedido.

Do outro lado, o `/api/acoes/reenviar-lembretes` reconfere as chaves contra a
lista que ele mesmo calcula antes de repassar: sessão válida não basta para
escolher para quem mandar WhatsApp.

**Rastro.** Cada mensagem reenviada volta como um `envio_lembrete` normal com
`payload.origem = "reenvio_manual"` e `payload.lembrete_dia`, então o reenvio
aparece nas métricas em vez de virar um envio invisível. Se a Konsist estiver
fora, nada é enviado e o alerta cai no Discord.

**Limite conhecido:** o reenvio não escreve nas Data Tables de dedup
(`Otogama Lembrete Consulta Dedup` / `Otogama Lembrete D0 Dedup`). Não causa
mensagem repetida — quando alguém reenvia, a janela do D-0/D-1 daquele dia já
passou — mas dois cliques em sequência, antes de o `envio_lembrete` ser gravado,
mandariam duas vezes. A confirmação na tela existe para isso.

## Testes de sanidade

```bash
# health (sem auth) → 200 e store:"ok"; 503 se o event store estiver fora
curl -sS "$BASE/api/eventos/health"

# criar/garantir a tabela `eventos` (idempotente) → {"ok":true,...}
curl -sS -X POST "$BASE/api/eventos/init" -H "x-api-key: $KEY"

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
