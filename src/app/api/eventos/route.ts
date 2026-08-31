import { NextRequest, NextResponse } from "next/server";
import { chaveConfere, chaveIngestEsperada } from "@/lib/chave";
import { motivoDoErro, sql, TENANT } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIPOS = new Set([
  "envio_lembrete",
  "confirmacao",
  "precisa_ajuda",
  "agendamento_ia",
  "desfecho_agendamento",
  "api_status",
  "status_consulta",
  "falha_envio",
  "pedido_reagendamento",
]);

// Rate limit em memória (por instância): suficiente contra loop acidental de
// workflow — um crashloop martela a mesma instância quente.
const env: Record<string, string | undefined> = process.env;
const LIMITE_POR_MINUTO = Number(env.RATE_LIMIT_POR_MINUTO ?? 60);
let janelaAtual = 0;
let contagemJanela = 0;

function estourouRateLimit(): boolean {
  const janela = Math.floor(Date.now() / 60_000);
  if (janela !== janelaAtual) {
    janelaAtual = janela;
    contagemJanela = 0;
  }
  contagemJanela += 1;
  return contagemJanela > LIMITE_POR_MINUTO;
}

function expandirChaves(chave: unknown): (string | null)[] {
  if (chave === null || chave === undefined) return [null];
  const partes = String(chave)
    .split(/[,;\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (partes.length === 0) return [null];
  return [...new Set(partes)];
}

export async function POST(req: NextRequest) {
  // Configuração ausente não pode responder 401: 401 diz "sua chave está errada"
  // e manda quem integra caçar o problema no n8n, quando ele está no deployment.
  const esperada = chaveIngestEsperada();
  if (!esperada) {
    console.error("INGEST_API_KEY ausente ou vazia no ambiente deste deployment.");
    return NextResponse.json(
      { erro: "INGEST_API_KEY ausente ou vazia neste deployment." },
      { status: 500 },
    );
  }
  if (!chaveConfere(req.headers.get("x-api-key"), esperada)) {
    return NextResponse.json({ erro: "api key inválida ou ausente" }, { status: 401 });
  }
  if (estourouRateLimit()) {
    return NextResponse.json({ erro: "rate limit excedido" }, { status: 429 });
  }

  let corpo: Record<string, unknown>;
  try {
    corpo = await req.json();
  } catch {
    return NextResponse.json({ erro: "body não é JSON válido" }, { status: 400 });
  }
  if (typeof corpo !== "object" || corpo === null || Array.isArray(corpo)) {
    return NextResponse.json({ erro: "body precisa ser um objeto JSON" }, { status: 400 });
  }

  const tipo = corpo.tipo;
  if (typeof tipo !== "string" || !TIPOS.has(tipo)) {
    return NextResponse.json(
      { erro: `tipo inválido — esperado um de: ${[...TIPOS].join(", ")}` },
      { status: 400 },
    );
  }

  // ts ausente → now(); presente → ISO com offset, sempre.
  let ts: Date;
  if (corpo.ts === undefined || corpo.ts === null || corpo.ts === "") {
    ts = new Date();
  } else {
    ts = new Date(String(corpo.ts));
    if (Number.isNaN(ts.getTime())) {
      return NextResponse.json({ erro: "ts inválido — use ISO 8601 com offset" }, { status: 400 });
    }
  }

  // Tolerante a lixo: campos extras ignorados; telefone vazio aceito.
  const telefone =
    typeof corpo.telefone === "string" || typeof corpo.telefone === "number"
      ? String(corpo.telefone).replace(/\D/g, "") || null
      : null;
  const paciente =
    typeof corpo.paciente === "string" && corpo.paciente.trim() !== ""
      ? corpo.paciente.trim()
      : null;
  const payload =
    typeof corpo.payload === "object" && corpo.payload !== null && !Array.isArray(corpo.payload)
      ? corpo.payload
      : {};

  const chaves = expandirChaves(corpo.chave);

  const db = sql();
  let inseridos = 0;
  let duplicados = 0;
  try {
    for (const chave of chaves) {
      const linhas = await db`
        INSERT INTO eventos (tenant_id, tipo, chave, telefone, paciente, payload, ts)
        VALUES (${TENANT}, ${tipo}, ${chave}, ${telefone}, ${paciente},
                ${JSON.stringify(payload)}::jsonb, ${ts.toISOString()})
        ON CONFLICT (tenant_id, tipo, COALESCE(chave, ''), ts) DO NOTHING
        RETURNING id
      `;
      if (linhas.length > 0) inseridos += 1;
      else duplicados += 1;
    }
  } catch (e) {
    console.error("ingestão falhou:", e);
    // Devolve o motivo, não só "falhou". Quem chama aqui já provou a chave, e a
    // mensagem crua do Postgres é a diferença entre "a tabela sumiu" e "não
    // consegui conectar" — dois problemas com consertos opostos. Sem isso, em
    // 30/08 a ingestão passou dias devolvendo 500 e a única forma de saber o
    // motivo era ler log da Vercel, que ninguém lê a tempo.
    return NextResponse.json(
      { erro: `falha ao gravar evento: ${motivoDoErro(e)}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, inseridos, dup: duplicados > 0 });
}
