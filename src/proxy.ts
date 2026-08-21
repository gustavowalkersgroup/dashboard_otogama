import { NextRequest, NextResponse } from "next/server";
import { COOKIE_SESSAO, validarTokenSessao } from "@/lib/sessao";

// Rotas alcançáveis sem sessão. A ingestão tem a própria auth (x-api-key), e o
// diagnóstico de configuração também — ele precisa ficar aqui justamente porque
// quem o consulta é quem não está conseguindo entrar.
const PUBLICAS = [
  "/login",
  "/api/login",
  "/api/login/diagnostico",
  "/api/eventos",
  "/api/eventos/health",
];

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLICAS.some((p) => pathname === p)) {
    return NextResponse.next();
  }

  const sessaoValida = await validarTokenSessao(req.cookies.get(COOKIE_SESSAO)?.value);
  if (sessaoValida) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  }

  const destino = new URL("/login", req.url);
  return NextResponse.redirect(destino);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
