import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { sql, TENANT } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIPOS = new Set([
  "envio_lembrete",
  "confirmacao",
  "precisa_ajuda",
  "agendamento_ia",
  "desfecho_agendamento",
  "api_status",
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

function chaveValida(recebida: string | null): boolean {
  const env: Record<string, string | undefined> = process.env;
  const esperada = env.INGEST_API_KEY;
  if (!esperada || !recebida) return false;
  const a = createHash("sha256").update(recebida).digest();
  const b = createHash("sha256").update(esperada).digest();
  return timingSafeEqual(a, b);
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
  if (!chaveValida(req.headers.get("x-api-key"))) {
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
    return NextResponse.json({ erro: "falha ao gravar evento" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, inseridos, dup: duplicados > 0 });
}
