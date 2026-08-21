import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Diagnóstico de configuração: responde o que ESTE deployment enxerga nas suas
// variáveis, sem revelar valor nenhum. Existe porque a Vercel congela as env
// vars no build — quando o login para de aceitar a senha, não há como saber de
// fora se o valor está errado, vazio, ou se o deployment é anterior à mudança.
//
// Protegido pela INGEST_API_KEY (a mesma da ingestão): não dá para exigir
// sessão, já que quem precisa disto é justamente quem não consegue entrar.

function autorizado(recebida: string | null): boolean {
  const env: Record<string, string | undefined> = process.env;
  const esperada = (env.INGEST_API_KEY ?? "").trim();
  if (!esperada || !recebida) return false;
  const a = createHash("sha256").update(recebida.trim()).digest();
  const b = createHash("sha256").update(esperada).digest();
  return timingSafeEqual(a, b);
}

/** Primeiros 8 hex do sha256 — permite conferir se o valor é o esperado sem expô-lo. */
function impressao(v: string): string {
  return createHash("sha256").update(v).digest("hex").slice(0, 8);
}

function descrever(bruto: string | undefined) {
  const valor = bruto ?? "";
  const aparado = valor.trim();
  return {
    configurada: aparado.length > 0,
    tamanho: aparado.length,
    // espaço/quebra de linha colados junto é a causa mais comum de "a senha
    // está certa e mesmo assim não entra"
    tinhaEspacoSobrando: valor !== aparado,
    impressao: aparado.length > 0 ? impressao(aparado) : null,
  };
}

export async function GET(req: NextRequest) {
  if (!autorizado(req.headers.get("x-api-key"))) {
    return NextResponse.json({ erro: "api key inválida ou ausente" }, { status: 401 });
  }
  const env: Record<string, string | undefined> = process.env;
  return NextResponse.json({
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    DASHBOARD_PASSWORD: descrever(env.DASHBOARD_PASSWORD),
    SESSION_SECRET: descrever(env.SESSION_SECRET),
    INGEST_API_KEY: descrever(env.INGEST_API_KEY),
    DATABASE_URL: { configurada: (env.DATABASE_URL ?? "").trim().length > 0 },
  });
}
