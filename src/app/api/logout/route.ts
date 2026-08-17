import { NextResponse } from "next/server";
import { COOKIE_SESSAO } from "@/lib/sessao";

export const dynamic = "force-dynamic";

export async function POST() {
  const resposta = NextResponse.json({ ok: true });
  resposta.cookies.set(COOKIE_SESSAO, "", { path: "/", maxAge: 0 });
  return resposta;
}
