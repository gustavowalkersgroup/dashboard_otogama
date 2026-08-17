import { NextResponse } from "next/server";

export default async function proxy() {
  // TEMP — bypass total pra diagnosticar o bug de login em produção.
  // REMOVER (git revert deste commit) antes de ir ao ar de verdade.
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
