import { NextResponse } from "next/server";

// TEMPORÁRIO — acesso liberado sem senha a pedido do cliente, para uma
// apresentação. O dashboard expõe nome e telefone de paciente, então isto
// NÃO pode ficar assim: reverter este commit logo após a reunião.
export default async function proxy() {
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
