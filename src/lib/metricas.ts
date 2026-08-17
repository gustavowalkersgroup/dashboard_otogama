import { sql, TENANT } from "@/lib/db";
import { inicioPeriodo } from "@/lib/formato";

export const PERIODOS = [7, 30, 90] as const;
export type Periodo = (typeof PERIODOS)[number];

export function periodoValido(p: string | undefined): Periodo {
  const n = Number(p);
  return (PERIODOS as readonly number[]).includes(n) ? (n as Periodo) : 30;
}

// Constantes da métrica "trabalho poupado" (minutos por evento) — editáveis via env.
export const MINUTOS = {
  lembrete: Number(process.env.MINUTOS_POR_LEMBRETE ?? 3),
  confirmacao: Number(process.env.MINUTOS_POR_CONFIRMACAO ?? 2),
  agendamentoIa: Number(process.env.MINUTOS_POR_AGENDAMENTO_IA ?? 8),
};

// Horas após o envio para um agendamento sem resposta contar como "pendente".
export const PENDENTE_APOS_HORAS = Number(process.env.PENDENTE_APOS_HORAS ?? 4);

const n = (v: unknown): number => Number(v ?? 0);

// ---------------------------------------------------------------- lembretes

export async function contagemLembretes(dias: Periodo) {
  const [linha] = await sql()`
    SELECT COUNT(DISTINCT (telefone, ts)) AS mensagens, COUNT(*) AS agendamentos
    FROM eventos
    WHERE tenant_id = ${TENANT} AND tipo = 'envio_lembrete' AND ts >= ${inicioPeriodo(dias)}
  `;
  return { mensagens: n(linha?.mensagens), agendamentos: n(linha?.agendamentos) };
}

// -------------------------------------------------------------- confirmações

export async function contagemConfirmacoes(dias: Periodo) {
  const [linha] = await sql()`
    SELECT
      COUNT(*) FILTER (WHERE payload->>'resultado' IN ('ok','ja_confirmado')) AS total,
      COUNT(DISTINCT (telefone, ts))
        FILTER (WHERE payload->>'resultado' IN ('ok','ja_confirmado')) AS mensagens,
      COUNT(*) FILTER (WHERE payload->>'resultado' = 'ok') AS ok,
      COUNT(*) FILTER (WHERE payload->>'resultado' = 'ja_confirmado') AS ja_confirmado,
      COUNT(*) FILTER (WHERE payload->>'resultado' = 'sem_paciente') AS sem_paciente
    FROM eventos
    WHERE tenant_id = ${TENANT} AND tipo = 'confirmacao' AND ts >= ${inicioPeriodo(dias)}
  `;
  return {
    total: n(linha?.total),
    mensagens: n(linha?.mensagens),
    ok: n(linha?.ok),
    jaConfirmado: n(linha?.ja_confirmado),
    semPaciente: n(linha?.sem_paciente),
  };
}

/** Taxa por agendamento: chaves avisadas no período × chaves com confirmação posterior. */
export async function taxaConfirmacao(dias: Periodo) {
  const [linha] = await sql()`
    WITH envios AS (
      SELECT chave, MIN(ts) AS primeiro_envio
      FROM eventos
      WHERE tenant_id = ${TENANT} AND tipo = 'envio_lembrete'
        AND ts >= ${inicioPeriodo(dias)} AND chave IS NOT NULL
      GROUP BY chave
    )
    SELECT
      COUNT(*) AS avisados,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM eventos c
        WHERE c.tenant_id = ${TENANT} AND c.tipo = 'confirmacao'
          AND c.chave = e.chave AND c.ts >= e.primeiro_envio
          AND c.payload->>'resultado' IN ('ok','ja_confirmado')
      )) AS confirmados
    FROM envios e
  `;
  const avisados = n(linha?.avisados);
  const confirmados = n(linha?.confirmados);
  return { avisados, confirmados, taxa: avisados > 0 ? confirmados / avisados : null };
}

/** Mediana e média de (confirmação − envio mais recente anterior), descartando <0 ou >72h. */
export async function tempoAteConfirmar(dias: Periodo) {
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
        AND c.ts >= ${inicioPeriodo(dias)} AND c.chave IS NOT NULL
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
        AND c.ts >= ${inicioPeriodo(dias)} AND c.chave IS NOT NULL
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
  const linhas = await sql()`
    WITH envios AS (
      SELECT DISTINCT ON (chave)
        chave, paciente, telefone, ts, payload->>'origem' AS origem
      FROM eventos
      WHERE tenant_id = ${TENANT} AND tipo = 'envio_lembrete'
        AND ts >= ${inicioPeriodo(dias)} AND chave IS NOT NULL
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
  ts: string;
};

export async function listaPedidosAjuda(dias: Periodo): Promise<PedidoAjuda[]> {
  const linhas = await sql()`
    SELECT DISTINCT ON (COALESCE(chave, ''), COALESCE(telefone, ''))
      chave, paciente, telefone, ts
    FROM eventos
    WHERE tenant_id = ${TENANT} AND tipo = 'precisa_ajuda' AND ts >= ${inicioPeriodo(dias)}
    ORDER BY COALESCE(chave, ''), COALESCE(telefone, ''), ts DESC
    LIMIT 200
  `;
  return linhas
    .map((l) => ({
      chave: (l.chave as string) ?? null,
      paciente: (l.paciente as string) ?? null,
      telefone: (l.telefone as string) ?? null,
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
};

export async function listaAgendamentosIa(dias: Periodo): Promise<AgendamentoIa[]> {
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
        d.ts AS desfecho_ts
      FROM eventos a
      LEFT JOIN LATERAL (
        SELECT d2.payload->>'status' AS status, d2.ts
        FROM eventos d2
        WHERE d2.tenant_id = a.tenant_id AND d2.tipo = 'desfecho_agendamento'
          AND d2.chave = a.chave
        ORDER BY d2.ts DESC LIMIT 1
      ) d ON true
      WHERE a.tenant_id = ${TENANT} AND a.tipo = 'agendamento_ia'
        AND a.ts >= ${inicioPeriodo(dias)}
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
  const inicio = inicioPeriodo(dias);
  const [eventos, [ultimo]] = await Promise.all([
    sql()`
      SELECT ts, payload->>'estado' AS estado, payload->>'detalhe' AS detalhe,
             payload->>'duracao_min' AS duracao_min
      FROM eventos
      WHERE tenant_id = ${TENANT} AND tipo = 'api_status' AND ts >= ${inicio}
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
  const totalMs = agora - inicioMs;
  let foraMs = 0;
  for (const q of quedas) {
    const a = Math.max(new Date(q.inicio).getTime(), inicioMs);
    const b = q.fim ? new Date(q.fim).getTime() : agora;
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
