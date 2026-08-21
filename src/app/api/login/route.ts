import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { COOKIE_SESSAO, OPCOES_COOKIE, criarTokenSessao, problemaNoSegredo } from "@/lib/sessao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Espaço/quebra de linha no fim do valor é acidente de copiar-e-colar no painel
// da Vercel, não senha — sem o trim vira um 401 impossível de diagnosticar.
function senhaEsperada(): string {
  // alias evita o inline de `process.env.X` do bundler (mesma causa do bug em db.ts)
  const env: Record<string, string | undefined> = process.env;
  return (env.DASHBOARD_PASSWORD ?? "").trim();
}

function senhaCorreta(recebida: string, esperada: string): boolean {
  const a = createHash("sha256").update(recebida).digest();
  const b = createHash("sha256").update(esperada).digest();
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  // Configuração ausente não pode responder 401: 401 diz "sua senha está errada"
  // e manda o operador procurar no lugar errado. Falha alto, como o SESSION_SECRET.
  const esperada = senhaEsperada();
  if (!esperada) {
    console.error("DASHBOARD_PASSWORD ausente ou vazia no ambiente deste deployment.");
    return NextResponse.json(
      { erro: "DASHBOARD_PASSWORD ausente ou vazia neste deployment." },
      { status: 500 },
    );
  }

  // Sem segredo de sessão o login é impossível mesmo com a senha certa: a senha
  // confere, o cookie não pode ser assinado e a exceção vira um 500 sem
  // mensagem — indistinguível de senha errada para quem está tentando entrar.
  // Falha antes de comparar a senha, dizendo o que falta.
  const problemaSegredo = problemaNoSegredo();
  if (problemaSegredo) {
    console.error(problemaSegredo);
    return NextResponse.json({ erro: problemaSegredo }, { status: 500 });
  }

  let senha = "";
  try {
    const corpo = await req.json();
    senha = typeof corpo?.senha === "string" ? corpo.senha : "";
  } catch {
    // corpo inválido cai no fluxo de senha errada
  }

  if (!senha || !senhaCorreta(senha, esperada)) {
    // atraso fixo desencoraja força bruta sem infraestrutura extra
    await new Promise((r) => setTimeout(r, 800));
    return NextResponse.json({ erro: "senha incorreta" }, { status: 401 });
  }

  const resposta = NextResponse.json({ ok: true });
  resposta.cookies.set(COOKIE_SESSAO, await criarTokenSessao(), OPCOES_COOKIE);
  return resposta;
}
