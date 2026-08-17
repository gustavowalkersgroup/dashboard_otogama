import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Sem auth: usado pelo n8n para monitorar o próprio dashboard.
export async function GET() {
  return NextResponse.json({ ok: true, ts: new Date().toISOString() });
}
