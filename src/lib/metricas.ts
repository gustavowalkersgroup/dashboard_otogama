import { cache } from "react";
import { classificaAtendimento, type TipoAtendimento } from "@/lib/atendimento";
import { sql, TENANT } from "@/lib/db";
import {
  type DiaRelativo,
  ROTULO_DIA,
  dataBRDiaRelativo,
  inicioPeriodo,
  isoDiaRelativo,
  janelaDia,
} from "@/lib/formato";

export const PERIODOS = [7, 30, 90] as const;
export const DIAS_RELATIVOS = ["ontem", "hoje", "amanha"] as const;

export type Periodo = (typeof PERIODOS)[number] | DiaRelativo;

export function ehDiaRelativo(p: Periodo): p is DiaRelativo {
  return typeof p === "string";
}

export function periodoValido(p: string | undefined): Periodo {
  if (p && (DIAS_RELATIVOS as readonly string[]).includes(p)) return p as DiaRelativo;
  const n = Number(p);
  return (PERIODOS as readonly number[]).includes(n) ? (n as (typeof PERIODOS)[number]) : 30;
}

/** Rótulo do recorte para títulos: "hoje", "amanhã", "últimos 30 dias". */
export function rotuloPeriodo(p: Periodo): string {
  if (ehDiaRelativo(p)) return ROTULO_DIA[p].toLowerCase();
  return `últimos ${p} dias`;
}

/**
 * Os dois recortes do dashboard respondem a perguntas diferentes:
 *
 * - 7/30/90 dias: "o que a automação fez nesse intervalo" — recorta por data do
 *   EVENTO (quando o lembrete saiu, quando o paciente confirmou).
 * - hoje/ontem/amanhã: "como está a agenda desse dia" — recorta por data da
 *   CONSULTA. Por data de evento, "amanhã" viria sempre vazio: nada acontece no
 *   futuro. O que interessa é quem tem consulta amanhã e já confirmou.
 *
 * A data da consulta não é coluna: vive em `payload.data_consulta` (DD/MM/YYYY),
 * e só os tipos que a conhecem a preenchem. Então o recorte por dia é resolvido
 * em dois passos — primeiro descobre-se o conjunto de chaves daquele dia, depois
 * cada métrica filtra por ele. `cache` evita repetir essa busca a cada métrica
 * dentro do mesmo render.
 */
type Recorte = {
  desde: Date;
  /** true = recorte por período; nenhum filtro por chave. */
  todos: boolean;
  chaves: string[];
  dia: DiaRelativo | null;
};

const SEM_PISO = new Date(0);

export const recorte = cache(async (p: Periodo): Promise<Recorte> => {
  if (!ehDiaRelativo(p)) {
    return { desde: inicioPeriodo(p), todos: true, chaves: [], dia: null };
  }
  const linhas = await sql()`
    SELECT DISTINCT chave
    FROM eventos
    WHERE tenant_id = ${TENANT}
      AND chave IS NOT NULL
      AND tipo IN ('envio_lembrete', 'status_consulta', 'desfecho_agendamento')
      AND payload->>'data_consulta' ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
      AND to_date(payload->>'data_consulta', 'DD/MM/YYYY') = ${isoDiaRelativo(p)}::date
  `;
  return {
    desde: SEM_PISO,
    todos: false,
    chaves: linhas.map((l) => String(l.chave)),
    dia: p,
  };
});

// alias evita o inline de `process.env.X` do bundler (mesma causa do bug em db.ts)
const env: Record<string, string | undefined> = process.env;

// Constantes da métrica "trabalho poupado" (minutos por evento) — editáveis via env.
export const MINUTOS = {
  lembrete: Number(env.MINUTOS_POR_LEMBRETE ?? 3),
  confirmacao: Number(env.MINUTOS_POR_CONFIRMACAO ?? 2),
  agendamentoIa: Number(env.MINUTOS_POR_AGENDAMENTO_IA ?? 8),
};

// Horas após o envio para um agendamento sem resposta contar como "pendente".
export const PENDENTE_APOS_HORAS = Number(env.PENDENTE_APOS_HORAS ?? 4);

const n = (v: unknown): number => Number(v ?? 0);

// ---------------------------------------------------------------- lembretes

export async function contagemLembretes(dias: Periodo) {
  const r = await recorte(dias);
  const [linha] = await sql()`
    SELECT COUNT(DISTINCT (telefone, ts)) AS mensagens, COUNT(*) AS agendamentos
    FROM eventos
    WHERE tenant_id = ${TENANT} AND tipo = 'envio_lembrete' AND ts >= ${r.desde}
      AND (${r.todos}::bool OR chave = ANY(${r.chaves}::text[]))
  `;
  return { mensagens: n(linha?.mensagens), agendamentos: n(linha?.agendamentos) };
}

// -------------------------------------------------------------- confirmações

/**
 * Os desfechos são contados pelo ESTADO ATUAL de cada agendamento, não por
 * evento. Uma confirmação que pegou a Konsist fora entra como `erro_api`, fica
 * na fila do n8n e volta como `ok` quando a fila drena — contando evento, ela
 * apareceria para sempre nas duas colunas. Contando o último resultado de cada
 * chave, o número se corrige sozinho quando a recuperação acontece.
 *
 * `total` e `mensagens` continuam por evento: alimentam "trabalho poupado", que
 * mede mensagem de WhatsApp tratada, não agendamento.
 */
export async function contagemConfirmacoes(dias: Periodo) {
  const r = await recorte(dias);
  const [linha] = await sql()`
    WITH ultimos AS (
      SELECT DISTINCT ON (chave) payload->>'resultado' AS resultado
      FROM eventos
      WHERE tenant_id = ${TENANT} AND tipo = 'confirmacao'
        AND chave IS NOT NULL AND ts >= ${r.desde}
        AND (${r.todos}::bool OR chave = ANY(${r.chaves}::text[]))
      ORDER BY chave, ts DESC
    ),
    brutos AS (
      SELECT
        COUNT(*) FILTER (WHERE payload->>'resultado' IN ('ok','ja_confirmado')) AS total,
        COUNT(DISTINCT (telefone, ts))
          FILTER (WHERE payload->>'resultado' IN ('ok','ja_confirmado')) AS mensagens
      FROM eventos
      WHERE tenant_id = ${TENANT} AND tipo = 'confirmacao' AND ts >= ${r.desde}
        AND (${r.todos}::bool OR chave = ANY(${r.chaves}::text[]))
    )
    SELECT b.total, b.mensagens,
      (SELECT COUNT(*) FROM ultimos WHERE resultado = 'ok') AS ok,
      (SELECT COUNT(*) FROM ultimos WHERE resultado = 'ja_confirmado') AS ja_confirmado,
      (SELECT COUNT(*) FROM ultimos WHERE resultado = 'erro_api') AS erro_api,
      (SELECT COUNT(*) FROM ultimos WHERE resultado = 'falha_definitiva') AS falha_definitiva,
      (SELECT COUNT(*) FROM ultimos WHERE resultado = 'sem_paciente') AS sem_paciente
    FROM brutos b
  `;
  return {
    total: n(linha?.total),
    mensagens: n(linha?.mensagens),
    ok: n(linha?.ok),
    jaConfirmado: n(linha?.ja_confirmado),
    erroApi: n(linha?.erro_api),
    falhaDefinitiva: n(linha?.falha_definitiva),
    semPaciente: n(linha?.sem_paciente),
  };
}

export type PresaApi = {
  chave: string;
  paciente: string | null;
  telefone: string | null;
  ts: string;
  /** `erro_api`: na fila, ainda retentando. `falha_definitiva`: a fila desistiu. */
  resultado: "erro_api" | "falha_definitiva";
  tentativas: number | null;
};

/**
 * Confirmações que o paciente fez e a Konsist não registrou porque estava fora.
 * O n8n as guarda numa fila e retenta a cada 15min enquanto a API responde.
 *
 * Os dois estados pedem reações opostas, por isso vêm juntos e separados na tela:
 * `erro_api` ainda está sendo retentado e some sozinho quando gravar — olhar é
 * desperdício. `falha_definitiva` é a fila tendo desistido depois de 5 tentativas:
 * ninguém mais vai tentar, o paciente acha que confirmou, e alguém precisa gravar
 * na mão no sistema da clínica.
 */
export async function listaPresasApi(dias: Periodo): Promise<PresaApi[]> {
  const r = await recorte(dias);
  const linhas = await sql()`
    WITH ultimos AS (
      SELECT DISTINCT ON (chave)
        chave, paciente, telefone, ts,
        payload->>'resultado' AS resultado,
        payload->>'tentativas' AS tentativas
      FROM eventos
      WHERE tenant_id = ${TENANT} AND tipo = 'confirmacao'
        AND chave IS NOT NULL AND ts >= ${r.desde}
        AND (${r.todos}::bool OR chave = ANY(${r.chaves}::text[]))
      ORDER BY chave, ts DESC
    )
    SELECT chave, paciente, telefone, ts, resultado, tentativas FROM ultimos
    WHERE resultado IN ('erro_api', 'falha_definitiva')
    ORDER BY ts DESC
    LIMIT 200
  `;
  return linhas.map((l) => ({
    chave: String(l.chave),
    paciente: (l.paciente as string) ?? null,
    telefone: (l.telefone as string) ?? null,
    ts: new Date(l.ts as string).toISOString(),
    resultado: String(l.resultado) as "erro_api" | "falha_definitiva",
    tentativas: l.tentativas == null ? null : n(l.tentativas),
  }));
}

/**
 * Taxa por agendamento: chaves avisadas no período × chaves confirmadas.
 *
 * Conta duas fontes, unidas:
 *
 * 1. **evento `confirmacao`** — o paciente respondeu no WhatsApp. É a fonte
 *    boa: tem timestamp real e atribui a confirmação à automação.
 * 2. **`status_consulta` com `situacao = 'Confirmado'`** — a Konsist diz que o
 *    agendamento está confirmado, sem dizer por quem. É a rede de segurança:
 *    sobrevive à perda do log de eventos, porque o poll relê da Konsist.
 *
 * A segunda existe por causa de 30/08: o log de `confirmacao` foi perdido com o
 * banco antigo e não havia de onde reconstruir — nenhuma Data Table do n8n
 * guarda confirmação bem-sucedida, só as que falharam.
 *
 * Duas sutilezas que parecem bug e não são:
 *
 * - A busca em `status_consulta` pergunta se a chave **passou por** 'Confirmado'
 *   em algum momento, não qual é a situação atual. Quem confirma e depois
 *   comparece vira 'Realizado', e olhar só o estado atual perderia a
 *   confirmação. O log é append-only e guarda as duas linhas.
 * - E não filtra por `ts`, ao contrário da busca em `confirmacao`. O `ts` de
 *   `status_consulta` é a data da CONSULTA (com os segundos codificando o
 *   contador de versão), não o momento da observação — comparar com o ts do
 *   lembrete não significaria nada.
 *
 * O denominador é `julgaveis`, não `avisados`: só entram os agendamentos sobre
 * os quais existe alguma informação — algum `status_consulta` ou algum evento
 * de `confirmacao`. O poll varre 21 dias (−13 a +7), e o card de 30 ou 90 dias
 * conta lembretes bem mais antigos que isso; dividir pelo total de avisados
 * daria uma taxa permanentemente subestimada, que é tão enganosa quanto o zero
 * que ela substitui. Em 31/08, 310 avisados tinham só 4 com status conhecido.
 * `avisados` continua exposto, para a tela poder dizer os dois números.
 */
export async function taxaConfirmacao(dias: Periodo) {
  const r = await recorte(dias);
  const [linha] = await sql()`
    WITH envios AS (
      SELECT chave, MIN(ts) AS primeiro_envio
      FROM eventos
      WHERE tenant_id = ${TENANT} AND tipo = 'envio_lembrete'
        AND ts >= ${r.desde} AND chave IS NOT NULL
        AND (${r.todos}::bool OR chave = ANY(${r.chaves}::text[]))
      GROUP BY chave
    ),
    marcados AS (
      SELECT
        EXISTS (
          SELECT 1 FROM eventos c
          WHERE c.tenant_id = ${TENANT} AND c.tipo = 'confirmacao'
            AND c.chave = e.chave AND c.ts >= e.primeiro_envio
            AND c.payload->>'resultado' IN ('ok','ja_confirmado')
        ) AS por_evento,
        EXISTS (
          SELECT 1 FROM eventos s
          WHERE s.tenant_id = ${TENANT} AND s.tipo = 'status_consulta'
            AND s.chave = e.chave
            AND s.payload->>'situacao' = 'Confirmado'
        ) AS por_situacao,
        EXISTS (
          SELECT 1 FROM eventos s
          WHERE s.tenant_id = ${TENANT} AND s.tipo = 'status_consulta'
            AND s.chave = e.chave
        ) AS tem_status
      FROM envios e
    )
    SELECT
      COUNT(*) AS avisados,
      COUNT(*) FILTER (WHERE tem_status OR por_evento) AS julgaveis,
      COUNT(*) FILTER (WHERE por_evento OR por_situacao) AS confirmados,
      COUNT(*) FILTER (WHERE por_evento) AS por_evento,
      COUNT(*) FILTER (WHERE por_situacao AND NOT por_evento) AS so_situacao
    FROM marcados
  `;
  const avisados = n(linha?.avisados);
  const julgaveis = n(linha?.julgaveis);
  const confirmados = n(linha?.confirmados);
  return {
    avisados,
    /** Avisados sobre os quais existe alguma informação — ver o comentário acima. */
    julgaveis,
    confirmados,
    /** Confirmadas com resposta no WhatsApp registrada. */
    porEvento: n(linha?.por_evento),
    /** Confirmadas só pela situação na Konsist — sem resposta registrada. */
    soSituacao: n(linha?.so_situacao),
    taxa: julgaveis > 0 ? confirmados / julgaveis : null,
  };
}

/** Mediana e média de (confirmação − envio mais recente anterior), descartando <0 ou >72h. */
export async function tempoAteConfirmar(dias: Periodo) {
  const r = await recorte(dias);
  const [linha] = await sql()`
    WITH pares AS (
      SELECT EXTRACT(EPOCH FROM c.ts - e.envio_ts) AS delta_s
      FROM eventos c
      JOIN LATERAL (
        SELECT ts AS envio_ts FROM eventos e2
        WHERE e2.tenant_id = c.tenant_id AND e2.tipo = 'envio_lembrete'
          AND e2.chave = c.chave AND e2.ts <= c.ts
        ORDER BY e2.ts DESC LIMIT 1
      ) e ON true
      WHERE c.tenant_id = ${TENANT} AND c.tipo = 'confirmacao'
        AND c.ts >= ${r.desde} AND c.chave IS NOT NULL
        AND (${r.todos}::bool OR c.chave = ANY(${r.chaves}::text[]))
        AND c.payload->>'resultado' IN ('ok','ja_confirmado')
    )
    SELECT
      percentile_cont(0.5) WITHIN GROUP (ORDER BY delta_s) AS mediana_s,
      AVG(delta_s) AS media_s,
      COUNT(*) AS total
    FROM pares
    WHERE delta_s >= 0 AND delta_s <= 72 * 3600
  `;
  return {
    medianaS: linha?.mediana_s === null ? null : n(linha?.mediana_s),
    mediaS: linha?.media_s === null ? null : n(linha?.media_s),
    total: n(linha?.total),
  };
}

export type Confirmado = {
  chave: string;
  paciente: string | null;
  telefone: string | null;
  resultado: string;
  ts: string;
  deltaS: number | null;
};

/** Primeira confirmação de cada chave no período, com delta desde o envio. */
export async function listaConfirmados(dias: Periodo): Promise<Confirmado[]> {
  const r = await recorte(dias);
  const linhas = await sql()`
    SELECT * FROM (
      SELECT DISTINCT ON (c.chave)
        c.chave, c.paciente, c.telefone, c.ts,
        c.payload->>'resultado' AS resultado,
        EXTRACT(EPOCH FROM c.ts - e.envio_ts) AS delta_s
      FROM eventos c
      LEFT JOIN LATERAL (
        SELECT ts AS envio_ts FROM eventos e2
        WHERE e2.tenant_id = c.tenant_id AND e2.tipo = 'envio_lembrete'
          AND e2.chave = c.chave AND e2.ts <= c.ts
        ORDER BY e2.ts DESC LIMIT 1
      ) e ON true
      WHERE c.tenant_id = ${TENANT} AND c.tipo = 'confirmacao'
        AND c.ts >= ${r.desde} AND c.chave IS NOT NULL
        AND (${r.todos}::bool OR c.chave = ANY(${r.chaves}::text[]))
        AND c.payload->>'resultado' IN ('ok','ja_confirmado')
      ORDER BY c.chave, c.ts ASC
    ) t
    ORDER BY t.ts DESC
    LIMIT 500
  `;
  return linhas.map((l) => {
    const delta = l.delta_s === null ? null : n(l.delta_s);
    return {
      chave: String(l.chave),
      paciente: (l.paciente as string) ?? null,
      telefone: (l.telefone as string) ?? null,
      resultado: String(l.resultado ?? ""),
      ts: new Date(l.ts as string).toISOString(),
      deltaS: delta !== null && delta >= 0 && delta <= 72 * 3600 ? delta : null,
    };
  });
}

export type Pendente = {
  chave: string;
  paciente: string | null;
  telefone: string | null;
  origem: string | null;
  enviadoEm: string;
};

/** Avisados sem confirmação, com pelo menos PENDENTE_APOS_HORAS desde o envio. */
export async function listaPendentes(dias: Periodo): Promise<Pendente[]> {
  const r = await recorte(dias);
  const linhas = await sql()`
    WITH envios AS (
      SELECT DISTINCT ON (chave)
        chave, paciente, telefone, ts, payload->>'origem' AS origem
      FROM eventos
      WHERE tenant_id = ${TENANT} AND tipo = 'envio_lembrete'
        AND ts >= ${r.desde} AND chave IS NOT NULL
        AND (${r.todos}::bool OR chave = ANY(${r.chaves}::text[]))
      ORDER BY chave, ts DESC
    )
    SELECT * FROM envios e
    WHERE e.ts <= now() - make_interval(hours => ${PENDENTE_APOS_HORAS})
      AND NOT EXISTS (
        SELECT 1 FROM eventos c
        WHERE c.tenant_id = ${TENANT} AND c.tipo = 'confirmacao'
          AND c.chave = e.chave
          AND c.payload->>'resultado' IN ('ok','ja_confirmado')
      )
    ORDER BY e.ts DESC
    LIMIT 500
  `;
  return linhas.map((l) => ({
    chave: String(l.chave),
    paciente: (l.paciente as string) ?? null,
    telefone: (l.telefone as string) ?? null,
    origem: (l.origem as string) ?? null,
    enviadoEm: new Date(l.ts as string).toISOString(),
  }));
}

export type PedidoAjuda = {
  chave: string | null;
  paciente: string | null;
  telefone: string | null;
  origem: string | null;
  ts: string;
};

export async function listaPedidosAjuda(dias: Periodo): Promise<PedidoAjuda[]> {
  const r = await recorte(dias);
  const linhas = await sql()`
    SELECT DISTINCT ON (COALESCE(chave, ''), COALESCE(telefone, ''))
      chave, paciente, telefone, ts, payload->>'origem' AS origem
    FROM eventos
    WHERE tenant_id = ${TENANT} AND tipo = 'precisa_ajuda' AND ts >= ${r.desde}
      AND (${r.todos}::bool OR chave = ANY(${r.chaves}::text[]))
    ORDER BY COALESCE(chave, ''), COALESCE(telefone, ''), ts DESC
    LIMIT 200
  `;
  return linhas
    .map((l) => ({
      chave: (l.chave as string) ?? null,
      paciente: (l.paciente as string) ?? null,
      telefone: (l.telefone as string) ?? null,
      origem: (l.origem as string) ?? null,
      ts: new Date(l.ts as string).toISOString(),
    }))
    .sort((a, b) => b.ts.localeCompare(a.ts));
}

// ---------------------------------------------------------- agendamentos IA

export type AgendamentoIa = {
  chave: string;
  paciente: string | null;
  telefone: string | null;
  protocolo: string | null;
  medico: string | null;
  especialidade: string | null;
  servico: string | null;
  statusAtual: string;
  criadoEm: string;
  desfechoEm: string | null;
  /** Data/hora da consulta marcada, vindas do poll da agenda (status_consulta) — só existe
   * depois que o poll observa a consulta real na Konsist; nunca existe para "Recusado". */
  dataConsultaMarcada: string | null;
  horaConsultaMarcada: string | null;
};

export async function listaAgendamentosIa(dias: Periodo): Promise<AgendamentoIa[]> {
  const r = await recorte(dias);
  const linhas = await sql()`
    SELECT * FROM (
      SELECT DISTINCT ON (COALESCE(a.chave, a.id::text))
        a.chave, a.paciente, a.telefone, a.ts,
        a.payload->>'protocolo' AS protocolo,
        a.payload->>'medico' AS medico,
        a.payload->>'especialidade' AS especialidade,
        a.payload->>'servico' AS servico,
        a.payload->>'status' AS status_inicial,
        d.status AS status_desfecho,
        d.ts AS desfecho_ts,
        s.data_consulta,
        s.hora_consulta
      FROM eventos a
      LEFT JOIN LATERAL (
        SELECT d2.payload->>'status' AS status, d2.ts
        FROM eventos d2
        WHERE d2.tenant_id = a.tenant_id AND d2.tipo = 'desfecho_agendamento'
          AND d2.chave = a.chave
        ORDER BY d2.ts DESC LIMIT 1
      ) d ON true
      LEFT JOIN LATERAL (
        SELECT s2.payload->>'data_consulta' AS data_consulta,
               s2.payload->>'hora_consulta' AS hora_consulta
        FROM eventos s2
        WHERE s2.tenant_id = a.tenant_id AND s2.tipo = 'status_consulta'
          AND s2.chave = a.chave
        ORDER BY s2.ts DESC LIMIT 1
      ) s ON true
      WHERE a.tenant_id = ${TENANT} AND a.tipo = 'agendamento_ia'
        AND a.ts >= ${r.desde}
        AND (${r.todos}::bool OR a.chave = ANY(${r.chaves}::text[]))
      ORDER BY COALESCE(a.chave, a.id::text), a.ts DESC
    ) t
    ORDER BY t.ts DESC
    LIMIT 500
  `;
  return linhas.map((l) => ({
    chave: (l.chave as string) ?? "—",
    paciente: (l.paciente as string) ?? null,
    telefone: (l.telefone as string) ?? null,
    protocolo: (l.protocolo as string) ?? null,
    medico: (l.medico as string) ?? null,
    especialidade: (l.especialidade as string) ?? null,
    servico: (l.servico as string) ?? null,
    statusAtual: String(l.status_desfecho ?? l.status_inicial ?? "Em Análise"),
    criadoEm: new Date(l.ts as string).toISOString(),
    desfechoEm: l.desfecho_ts ? new Date(l.desfecho_ts as string).toISOString() : null,
    dataConsultaMarcada: (l.data_consulta as string) ?? null,
    horaConsultaMarcada: (l.hora_consulta as string) ?? null,
  }));
}

export function resumoAgendamentosIa(lista: AgendamentoIa[]) {
  const porStatus = new Map<string, number>();
  for (const a of lista) {
    porStatus.set(a.statusAtual, (porStatus.get(a.statusAtual) ?? 0) + 1);
  }
  return { total: lista.length, porStatus };
}

// ------------------------------------------------------------ série diária

export type PontoDiario = { dia: string; envios: number; confirmacoes: number };

export async function serieDiaria(dias: Periodo): Promise<PontoDiario[]> {
  // Série por dia não faz sentido num recorte de um dia só — daria uma barra.
  // Devolve vazio e a página esconde o gráfico.
  if (ehDiaRelativo(dias)) return [];
  const linhas = await sql()`
    SELECT (ts AT TIME ZONE 'America/Sao_Paulo')::date::text AS dia,
      COUNT(DISTINCT (telefone, ts)) FILTER (WHERE tipo = 'envio_lembrete') AS envios,
      COUNT(*) FILTER (
        WHERE tipo = 'confirmacao' AND payload->>'resultado' IN ('ok','ja_confirmado')
      ) AS confirmacoes
    FROM eventos
    WHERE tenant_id = ${TENANT} AND tipo IN ('envio_lembrete','confirmacao')
      AND ts >= ${inicioPeriodo(dias)}
    GROUP BY 1 ORDER BY 1
  `;
  const porDia = new Map(linhas.map((l) => [String(l.dia), l]));
  // preenche dias sem evento com zero, do início do período até hoje (BRT)
  const serie: PontoDiario[] = [];
  const cursor = inicioPeriodo(dias);
  for (let i = 0; i < dias; i++) {
    const dia = isoDiaBRT(cursor);
    const l = porDia.get(dia);
    serie.push({ dia, envios: n(l?.envios), confirmacoes: n(l?.confirmacoes) });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return serie;
}

function isoDiaBRT(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
}

// --------------------------------------------------------- trabalho poupado

export function trabalhoPoupado(entrada: {
  mensagensLembrete: number;
  mensagensConfirmacao: number;
  agendamentosIa: number;
}) {
  const minutos =
    entrada.mensagensLembrete * MINUTOS.lembrete +
    entrada.mensagensConfirmacao * MINUTOS.confirmacao +
    entrada.agendamentosIa * MINUTOS.agendamentoIa;
  const horas = minutos / 60;
  return { minutos, horas, diasUteis: horas / 8 };
}

// -------------------------------------------------------------- saúde da API

export type Queda = {
  inicio: string;
  fim: string | null; // null = em curso
  duracaoS: number;
  detalhe: string | null;
};

export type SaudeApi = {
  estadoAtual: "ok" | "fora" | "desconhecido";
  desde: string | null;
  detalheAtual: string | null;
  uptimePct: number | null;
  quedas: Queda[];
  tempoForaS: number;
};

export async function saudeApi(dias: Periodo): Promise<SaudeApi> {
  // Uptime é a única métrica que não se recorta por agenda: `api_status` não tem
  // chave de agendamento. Num recorte de dia, o corte natural é a janela do
  // próprio dia — "a API caiu ontem?". Para "amanhã" não há o que medir e o
  // uptime sai nulo, que é a resposta honesta.
  let inicio: Date;
  let fim: Date;
  if (ehDiaRelativo(dias)) {
    ({ inicio, fim } = janelaDia(dias));
  } else {
    inicio = inicioPeriodo(dias);
    fim = new Date(8_640_000_000_000_000);
  }
  const [eventos, [ultimo]] = await Promise.all([
    sql()`
      SELECT ts, payload->>'estado' AS estado, payload->>'detalhe' AS detalhe,
             payload->>'duracao_min' AS duracao_min
      FROM eventos
      WHERE tenant_id = ${TENANT} AND tipo = 'api_status'
        AND ts >= ${inicio} AND ts < ${fim}
      ORDER BY ts ASC
    `,
    sql()`
      SELECT ts, payload->>'estado' AS estado, payload->>'detalhe' AS detalhe
      FROM eventos
      WHERE tenant_id = ${TENANT} AND tipo = 'api_status'
      ORDER BY ts DESC LIMIT 1
    `,
  ]);

  const agora = Date.now();
  const quedas: Queda[] = [];
  let aberta: { inicio: number; detalhe: string | null } | null = null;

  for (const e of eventos) {
    const ts = new Date(e.ts as string).getTime();
    if (e.estado === "fora") {
      if (!aberta) aberta = { inicio: ts, detalhe: (e.detalhe as string) ?? null };
    } else if (e.estado === "ok") {
      const duracaoMin = e.duracao_min === null ? null : Number(e.duracao_min);
      if (aberta) {
        quedas.push({
          inicio: new Date(aberta.inicio).toISOString(),
          fim: new Date(ts).toISOString(),
          duracaoS:
            duracaoMin !== null && !Number.isNaN(duracaoMin)
              ? duracaoMin * 60
              : (ts - aberta.inicio) / 1000,
          detalhe: aberta.detalhe,
        });
        aberta = null;
      } else if (duracaoMin !== null && !Number.isNaN(duracaoMin) && duracaoMin > 0) {
        // recuperação cujo "fora" ficou antes do período — reconstrói pelo duracao_min
        quedas.push({
          inicio: new Date(ts - duracaoMin * 60_000).toISOString(),
          fim: new Date(ts).toISOString(),
          duracaoS: duracaoMin * 60,
          detalhe: (e.detalhe as string) ?? null,
        });
      }
    }
  }
  if (aberta) {
    quedas.push({
      inicio: new Date(aberta.inicio).toISOString(),
      fim: null,
      duracaoS: (agora - aberta.inicio) / 1000,
      detalhe: aberta.detalhe,
    });
  }

  // downtime recortado ao período, para o uptime %
  const inicioMs = inicio.getTime();
  const ateMs = Math.min(agora, fim.getTime());
  const totalMs = ateMs - inicioMs;
  let foraMs = 0;
  for (const q of quedas) {
    const a = Math.max(new Date(q.inicio).getTime(), inicioMs);
    const b = Math.min(q.fim ? new Date(q.fim).getTime() : agora, ateMs);
    if (b > a) foraMs += b - a;
  }

  const estadoAtual =
    ultimo?.estado === "ok" ? "ok" : ultimo?.estado === "fora" ? "fora" : "desconhecido";

  return {
    estadoAtual,
    desde: ultimo ? new Date(ultimo.ts as string).toISOString() : null,
    detalheAtual: (ultimo?.detalhe as string) ?? null,
    uptimePct: totalMs > 0 ? Math.max(0, 1 - foraMs / totalMs) * 100 : null,
    quedas: quedas.reverse(),
    tempoForaS: foraMs / 1000,
  };
}

// ---------------------------------------------------- status das consultas
//
// Alimentado pelo poll horário do n8n na Konsist (tipo "status_consulta"),
// não por webhook — granularidade de ~1h. "Agendado"/"Confirmado" (ainda sem
// desfecho) são tratados como um único grupo "pendente" nas agregações;
// "Cancelado" nunca entra no denominador de no-show (consulta que não chegou
// a acontecer não é a mesma coisa que paciente que não apareceu).
//
// O ts destes eventos é o horário da consulta, não o do poll, então os recortes
// de 7/30/90 dias aqui recortam por dia de consulta — e alcançam os 7 dias à
// frente que o poll também varre, que aparecem como pendentes.

export type TaxaNoShow = {
  realizado: number;
  faltou: number;
  cancelado: number;
  pendente: number;
  /** faltou / (faltou + realizado); null sem nenhum desfecho terminal no período. */
  taxa: number | null;
};

/** Desfecho mais recente de cada consulta (por chave) no período, agregado. */
export async function taxaNoShow(dias: Periodo): Promise<TaxaNoShow> {
  const r = await recorte(dias);
  const [linha] = await sql()`
    WITH ultimos AS (
      SELECT DISTINCT ON (chave) payload->>'situacao' AS situacao
      FROM eventos
      WHERE tenant_id = ${TENANT} AND tipo = 'status_consulta'
        AND chave IS NOT NULL AND ts >= ${r.desde}
        AND (${r.todos}::bool OR chave = ANY(${r.chaves}::text[]))
      ORDER BY chave, ts DESC
    )
    SELECT
      COUNT(*) FILTER (WHERE situacao = 'Realizado') AS realizado,
      COUNT(*) FILTER (WHERE situacao = 'Faltou') AS faltou,
      COUNT(*) FILTER (WHERE situacao = 'Cancelado') AS cancelado,
      COUNT(*) FILTER (WHERE situacao IN ('Agendado', 'Confirmado')) AS pendente
    FROM ultimos
  `;
  const realizado = n(linha?.realizado);
  const faltou = n(linha?.faltou);
  return {
    realizado,
    faltou,
    cancelado: n(linha?.cancelado),
    pendente: n(linha?.pendente),
    taxa: realizado + faltou > 0 ? faltou / (realizado + faltou) : null,
  };
}

export type PontoNoShow = { dia: string; realizado: number; faltou: number; taxa: number | null };

/** Série diária de realizado/faltou pelo dia da consulta (o poll grava o evento
 * com o ts da consulta, não o do momento em que percebeu — ver INTEGRACAO.md §6). */
export async function serieNoShowDiaria(dias: Periodo): Promise<PontoNoShow[]> {
  // Mesmo motivo do serieDiaria: um dia só não vira série.
  if (ehDiaRelativo(dias)) return [];
  const linhas = await sql()`
    SELECT (ts AT TIME ZONE 'America/Sao_Paulo')::date::text AS dia,
      COUNT(*) FILTER (WHERE payload->>'situacao' = 'Realizado') AS realizado,
      COUNT(*) FILTER (WHERE payload->>'situacao' = 'Faltou') AS faltou
    FROM eventos
    WHERE tenant_id = ${TENANT} AND tipo = 'status_consulta' AND ts >= ${inicioPeriodo(dias)}
    GROUP BY 1 ORDER BY 1
  `;
  const porDia = new Map(linhas.map((l) => [String(l.dia), l]));
  const serie: PontoNoShow[] = [];
  const cursor = inicioPeriodo(dias);
  for (let i = 0; i < dias; i++) {
    const dia = isoDiaBRT(cursor);
    const l = porDia.get(dia);
    const realizado = n(l?.realizado);
    const faltou = n(l?.faltou);
    serie.push({
      dia,
      realizado,
      faltou,
      taxa: realizado + faltou > 0 ? faltou / (realizado + faltou) : null,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return serie;
}

export type EstagioFunil = {
  grupo: "com_lembrete" | "sem_lembrete";
  agendado: number;
  confirmado: number;
  compareceu: number;
};

/**
 * Funil Agendado → Confirmado → Compareceu, separado por quem recebeu (ou não)
 * lembrete via WhatsApp. Só consultas com desfecho terminal Realizado/Faltou
 * entram (cancelamentos não fazem parte deste funil).
 */
export async function funilComparecimento(dias: Periodo): Promise<EstagioFunil[]> {
  const r = await recorte(dias);
  const linhas = await sql()`
    WITH ultimos AS (
      SELECT DISTINCT ON (chave) chave, payload->>'situacao' AS situacao
      FROM eventos
      WHERE tenant_id = ${TENANT} AND tipo = 'status_consulta'
        AND chave IS NOT NULL AND ts >= ${r.desde}
        AND (${r.todos}::bool OR chave = ANY(${r.chaves}::text[]))
        AND payload->>'situacao' IN ('Realizado', 'Faltou')
      ORDER BY chave, ts DESC
    ),
    marcado AS (
      SELECT
        situacao,
        EXISTS (
          SELECT 1 FROM eventos e
          WHERE e.tenant_id = ${TENANT} AND e.tipo = 'envio_lembrete' AND e.chave = u.chave
        ) AS com_lembrete,
        EXISTS (
          SELECT 1 FROM eventos c
          WHERE c.tenant_id = ${TENANT} AND c.tipo = 'confirmacao' AND c.chave = u.chave
            AND c.payload->>'resultado' IN ('ok', 'ja_confirmado')
        ) AS confirmado
      FROM ultimos u
    )
    SELECT com_lembrete,
      COUNT(*) AS agendado,
      COUNT(*) FILTER (WHERE confirmado) AS confirmado,
      COUNT(*) FILTER (WHERE situacao = 'Realizado') AS compareceu
    FROM marcado
    GROUP BY com_lembrete
  `;
  const porGrupo = new Map(linhas.map((l) => [Boolean(l.com_lembrete), l]));
  return (["com_lembrete", "sem_lembrete"] as const).map((grupo) => {
    const l = porGrupo.get(grupo === "com_lembrete");
    return {
      grupo,
      agendado: n(l?.agendado),
      confirmado: n(l?.confirmado),
      compareceu: n(l?.compareceu),
    };
  });
}

export type DesfechoMedico = {
  medico: string;
  pendente: number;
  realizado: number;
  faltou: number;
  cancelado: number;
  total: number;
};

/** Desfecho mais recente por médico (top 12 por volume). */
export async function desfechoPorMedico(dias: Periodo): Promise<DesfechoMedico[]> {
  const r = await recorte(dias);
  const linhas = await sql()`
    WITH ultimos AS (
      SELECT DISTINCT ON (chave)
        chave, payload->>'situacao' AS situacao, payload->>'medico' AS medico
      FROM eventos
      WHERE tenant_id = ${TENANT} AND tipo = 'status_consulta'
        AND chave IS NOT NULL AND ts >= ${r.desde}
        AND (${r.todos}::bool OR chave = ANY(${r.chaves}::text[]))
      ORDER BY chave, ts DESC
    )
    SELECT
      COALESCE(medico, 'Não informado') AS medico,
      COUNT(*) FILTER (WHERE situacao IN ('Agendado', 'Confirmado')) AS pendente,
      COUNT(*) FILTER (WHERE situacao = 'Realizado') AS realizado,
      COUNT(*) FILTER (WHERE situacao = 'Faltou') AS faltou,
      COUNT(*) FILTER (WHERE situacao = 'Cancelado') AS cancelado,
      COUNT(*) AS total
    FROM ultimos
    GROUP BY 1
    ORDER BY total DESC
    LIMIT 12
  `;
  return linhas.map((l) => ({
    medico: String(l.medico),
    pendente: n(l.pendente),
    realizado: n(l.realizado),
    faltou: n(l.faltou),
    cancelado: n(l.cancelado),
    total: n(l.total),
  }));
}

export type ComparecimentoGrupo = {
  grupo: "ia" | "humano";
  pendente: number;
  realizado: number;
  faltou: number;
  cancelado: number;
  total: number;
};

/** Desfecho mais recente, separado por pré-agendamento criado pela IA vs manual. */
export async function comparecimentoIaVsHumano(dias: Periodo): Promise<ComparecimentoGrupo[]> {
  const r = await recorte(dias);
  const linhas = await sql()`
    WITH ultimos AS (
      SELECT DISTINCT ON (chave) chave, payload->>'situacao' AS situacao
      FROM eventos
      WHERE tenant_id = ${TENANT} AND tipo = 'status_consulta'
        AND chave IS NOT NULL AND ts >= ${r.desde}
        AND (${r.todos}::bool OR chave = ANY(${r.chaves}::text[]))
      ORDER BY chave, ts DESC
    ),
    marcado AS (
      SELECT
        situacao,
        EXISTS (
          SELECT 1 FROM eventos a
          WHERE a.tenant_id = ${TENANT} AND a.tipo = 'agendamento_ia' AND a.chave = u.chave
        ) AS via_ia
      FROM ultimos u
    )
    SELECT via_ia,
      COUNT(*) FILTER (WHERE situacao IN ('Agendado', 'Confirmado')) AS pendente,
      COUNT(*) FILTER (WHERE situacao = 'Realizado') AS realizado,
      COUNT(*) FILTER (WHERE situacao = 'Faltou') AS faltou,
      COUNT(*) FILTER (WHERE situacao = 'Cancelado') AS cancelado,
      COUNT(*) AS total
    FROM marcado
    GROUP BY via_ia
  `;
  const porGrupo = new Map(linhas.map((l) => [Boolean(l.via_ia), l]));
  return (["ia", "humano"] as const).map((grupo) => {
    const l = porGrupo.get(grupo === "ia");
    return {
      grupo,
      pendente: n(l?.pendente),
      realizado: n(l?.realizado),
      faltou: n(l?.faltou),
      cancelado: n(l?.cancelado),
      total: n(l?.total),
    };
  });
}

// -------------------------------------------------- lembretes que faltaram
//
// Existe porque a Konsist cai. Quando ela não responde às 08:00, o workflow D-1
// não recebe lista nenhuma e nenhum lembrete sai — e, pior, não sobra registro
// de QUEM deveria ter recebido, porque a lista é que faltou.
//
// O poll da agenda resolve isso de lado: ele varre os próximos 7 dias de hora em
// hora, então a última leitura bem-sucedida deixou no banco quem tem consulta
// amanhã. Cruzando isso com `envio_lembrete` sai exatamente a lista de quem
// ficou sem aviso.
//
// Esta lista é um palpite bem informado, não a verdade final: ela vale até a
// última leitura que a Konsist deixou passar. Quem valida é o n8n no reenvio —
// ele relê a agenda na hora e ignora chave que não se encaixa mais (cancelada no
// meio da queda, por exemplo).

export const DIAS_LEMBRETE = ["hoje", "amanha"] as const;
export type DiaLembrete = (typeof DIAS_LEMBRETE)[number];

export function diaLembreteValido(d: string | undefined): DiaLembrete {
  return (DIAS_LEMBRETE as readonly string[]).includes(d ?? "") ? (d as DiaLembrete) : "amanha";
}

export type ConsultaDoDia = {
  chave: string;
  paciente: string | null;
  telefone: string | null;
  medico: string | null;
  especialidade: string | null;
  servico: string | null;
  situacao: string;
  horaConsulta: string | null;
  /** quando o poll observou esta situação — dá para julgar se a lista está velha */
  vistoEm: string | null;
};

export type PainelLembretes = {
  dia: DiaLembrete;
  /** DD/MM/YYYY — o mesmo formato que vai para o n8n no reenvio */
  dataBR: string;
  /** consultas em aberto (Agendado/Confirmado) que já têm envio_lembrete */
  avisadas: number;
  /** consultas em aberto ainda sem nenhum envio_lembrete */
  faltando: ConsultaDoDia[];
  /** canceladas no dia — não entram no reenvio, ficam aqui só como contexto */
  canceladas: number;
  /** já encerradas (Realizado/Faltou) — lembrete não faz mais sentido */
  encerradas: number;
  /** observação mais recente que o poll gravou para este dia; null = poll nunca viu */
  agendaVistaEm: string | null;
};

export async function painelLembretes(dia: DiaLembrete): Promise<PainelLembretes> {
  const dataBR = dataBRDiaRelativo(dia);
  const linhas = await sql()`
    WITH ultimos AS (
      SELECT DISTINCT ON (chave)
        chave, paciente, telefone,
        payload->>'situacao' AS situacao,
        payload->>'medico' AS medico,
        payload->>'especialidade' AS especialidade,
        payload->>'servico' AS servico,
        payload->>'hora_consulta' AS hora_consulta,
        payload->>'visto_em' AS visto_em
      FROM eventos
      WHERE tenant_id = ${TENANT} AND tipo = 'status_consulta'
        AND chave IS NOT NULL AND payload->>'data_consulta' = ${dataBR}
      ORDER BY chave, ts DESC
    )
    SELECT u.*,
      EXISTS (
        SELECT 1 FROM eventos l
        WHERE l.tenant_id = ${TENANT} AND l.tipo = 'envio_lembrete' AND l.chave = u.chave
      ) AS avisada
    FROM ultimos u
    ORDER BY u.hora_consulta NULLS LAST, u.paciente NULLS LAST
  `;

  const EM_ABERTO = new Set(["Agendado", "Confirmado"]);
  let avisadas = 0;
  let canceladas = 0;
  let encerradas = 0;
  let agendaVistaEm: string | null = null;
  const faltando: ConsultaDoDia[] = [];

  for (const l of linhas) {
    const situacao = String(l.situacao ?? "");
    const vistoEm = (l.visto_em as string) ?? null;
    if (vistoEm && (agendaVistaEm === null || vistoEm > agendaVistaEm)) agendaVistaEm = vistoEm;

    if (situacao === "Cancelado") {
      canceladas += 1;
      continue;
    }
    if (!EM_ABERTO.has(situacao)) {
      encerradas += 1;
      continue;
    }
    if (l.avisada) {
      avisadas += 1;
      continue;
    }
    faltando.push({
      chave: String(l.chave),
      paciente: (l.paciente as string) ?? null,
      telefone: (l.telefone as string) ?? null,
      medico: (l.medico as string) ?? null,
      especialidade: (l.especialidade as string) ?? null,
      servico: (l.servico as string) ?? null,
      situacao,
      horaConsulta: (l.hora_consulta as string) ?? null,
      vistoEm,
    });
  }

  return { dia, dataBR, avisadas, faltando, canceladas, encerradas, agendaVistaEm };
}

// ------------------------------------------------------- agenda do dia (tela)

export type ConsultaDetalhada = ConsultaDoDia & {
  codigoProcedimento: string | null;
  tipo: TipoAtendimento;
  avisada: boolean;
  confirmada: boolean;
};

export type AgendaDoDia = {
  dia: DiaRelativo;
  /** DD/MM/YYYY */
  dataBR: string;
  consultas: ConsultaDetalhada[];
  /** observação mais recente do poll para este dia; null = o poll nunca viu */
  agendaVistaEm: string | null;
  /** consultas cujo tipo não deu para determinar por nenhuma das fontes */
  semTipo: number;
};

/**
 * A agenda de um dia com profissional, tipo e situação de cada consulta.
 *
 * **Esta lista não é a agenda da Konsist, é o que o event store viu.** O poll
 * grava `status_consulta` só quando a situação MUDA (veja `Montar Mudancas` no
 * workflow do poll) e o estado anterior mora numa Data Table do n8n que
 * sobreviveu à recriação da tabela `eventos` em 31/08 — então consulta marcada
 * antes disso e estável desde então nunca foi re-emitida e não aparece aqui.
 * Medido em 03/09: a Konsist tinha 16 consultas de Fonoaudiologia naquele dia e
 * o store conhecia 6; para 04/09, 15 contra 14. A diferença encolhe sozinha
 * conforme as situações mudam, e zera de vez se a Data Table de estado for
 * limpa (o poll re-emite tudo na varredura seguinte).
 *
 * Por isso a tela mostra `agendaVistaEm` e o total conhecido em vez de
 * apresentar a lista como completa: foi exatamente uma leitura de "a lista está
 * completa" que fez parecer que a Fonoaudiologia não tinha recebido lembrete.
 *
 * `confirmada` olha o HISTÓRICO, não a situação atual: quem confirmou e depois
 * foi atendido está em `Realizado`, e comparar só o estado atual perderia a
 * confirmação. Mesma razão e mesma forma de `taxaConfirmacao`.
 */
export async function agendaDoDia(dia: DiaRelativo): Promise<AgendaDoDia> {
  const dataBR = dataBRDiaRelativo(dia);
  const linhas = await sql()`
    WITH ultimos AS (
      SELECT DISTINCT ON (chave)
        chave, paciente, telefone,
        payload->>'situacao' AS situacao,
        payload->>'medico' AS medico,
        payload->>'especialidade' AS especialidade,
        payload->>'servico' AS servico,
        payload->>'hora_consulta' AS hora_consulta,
        payload->>'codigo_procedimento' AS codigo_procedimento,
        payload->>'visto_em' AS visto_em
      FROM eventos
      WHERE tenant_id = ${TENANT} AND tipo = 'status_consulta'
        AND chave IS NOT NULL AND payload->>'data_consulta' = ${dataBR}
      ORDER BY chave, ts DESC
    )
    SELECT u.*,
      EXISTS (
        SELECT 1 FROM eventos l
        WHERE l.tenant_id = ${TENANT} AND l.tipo = 'envio_lembrete' AND l.chave = u.chave
      ) AS avisada,
      (
        SELECT l.payload->>'tipo_consulta' FROM eventos l
        WHERE l.tenant_id = ${TENANT} AND l.tipo = 'envio_lembrete' AND l.chave = u.chave
        ORDER BY l.ts DESC LIMIT 1
      ) AS tipo_anunciado,
      (
        EXISTS (
          SELECT 1 FROM eventos c
          WHERE c.tenant_id = ${TENANT} AND c.tipo = 'confirmacao' AND c.chave = u.chave
            AND c.payload->>'resultado' IN ('ok', 'ja_confirmado')
        )
        OR EXISTS (
          SELECT 1 FROM eventos s
          WHERE s.tenant_id = ${TENANT} AND s.tipo = 'status_consulta' AND s.chave = u.chave
            AND s.payload->>'situacao' = 'Confirmado'
        )
      ) AS confirmada
    FROM ultimos u
    ORDER BY u.hora_consulta NULLS LAST, u.paciente NULLS LAST
  `;

  let agendaVistaEm: string | null = null;
  let semTipo = 0;
  const consultas: ConsultaDetalhada[] = [];

  for (const l of linhas) {
    const vistoEm = (l.visto_em as string) ?? null;
    if (vistoEm && (agendaVistaEm === null || vistoEm > agendaVistaEm)) agendaVistaEm = vistoEm;

    const horaConsulta = (l.hora_consulta as string) ?? null;
    const codigoProcedimento = (l.codigo_procedimento as string) ?? null;

    consultas.push({
      chave: String(l.chave),
      paciente: (l.paciente as string) ?? null,
      telefone: (l.telefone as string) ?? null,
      medico: (l.medico as string) ?? null,
      especialidade: (l.especialidade as string) ?? null,
      servico: (l.servico as string) ?? null,
      situacao: String(l.situacao ?? ""),
      horaConsulta,
      vistoEm,
      codigoProcedimento,
      tipo: classificaAtendimento({
        horaConsulta,
        codigoProcedimento,
        tipoAnunciado: (l.tipo_anunciado as string) ?? null,
      }),
      avisada: Boolean(l.avisada),
      confirmada: Boolean(l.confirmada),
    });
  }

  // Conta o que ficou REALMENTE sem tipo, não o que está sem código: o tipo
  // anunciado pelo lembrete cobre a maioria das consultas antigas, e contar por
  // código faria a tela avisar de um problema que ela já resolveu.
  semTipo = consultas.filter((c) => c.tipo === "desconhecido").length;

  return { dia, dataBR, consultas, agendaVistaEm, semTipo };
}
