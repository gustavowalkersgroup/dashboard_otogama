import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { COOKIE_SESSAO, OPCOES_COOKIE, criarTokenSessao } from "@/lib/sessao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function senhaCorreta(recebida: string): boolean {
  const esperada = process.env.DASHBOARD_PASSWORD;
  if (!esperada) return false;
  const a = createHash("sha256").update(recebida).digest();
  const b = createHash("sha256").update(esperada).digest();
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  let senha = "";
  try {
    const corpo = await req.json();
    senha = typeof corpo?.senha === "string" ? corpo.senha : "";
  } catch {
    // corpo inválido cai no fluxo de senha errada
  }

  if (!senha || !senhaCorreta(senha)) {
    // atraso fixo desencoraja força bruta sem infraestrutura extra
    await new Promise((r) => setTimeout(r, 800));
    return NextResponse.json({ erro: "senha incorreta" }, { status: 401 });
  }

  const resposta = NextResponse.json({ ok: true });
  resposta.cookies.set(COOKIE_SESSAO, await criarTokenSessao(), OPCOES_COOKIE);
  return resposta;
}
