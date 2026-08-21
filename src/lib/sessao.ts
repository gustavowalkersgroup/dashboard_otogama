import { SignJWT, jwtVerify } from "jose";

export const COOKIE_SESSAO = "otogama_sessao";
const DURACAO_DIAS = 30;

const MIN_SEGREDO = 16;

/** Motivo pelo qual não dá para assinar sessão, ou null se está tudo certo. */
export function problemaNoSegredo(): string | null {
  // alias evita o inline de `process.env.X` do bundler (mesma causa do bug em db.ts)
  const env: Record<string, string | undefined> = process.env;
  const s = (env.SESSION_SECRET ?? "").trim();
  if (!s) return "SESSION_SECRET ausente ou vazia neste deployment.";
  if (s.length < MIN_SEGREDO) {
    return `SESSION_SECRET curta demais neste deployment (${s.length} caracteres, mínimo ${MIN_SEGREDO}).`;
  }
  return null;
}

function segredo(): Uint8Array {
  const problema = problemaNoSegredo();
  if (problema) throw new Error(problema);
  const env: Record<string, string | undefined> = process.env;
  return new TextEncoder().encode((env.SESSION_SECRET ?? "").trim());
}

export async function criarTokenSessao(): Promise<string> {
  return new SignJWT({ escopo: "dashboard" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("otogama")
    .setIssuedAt()
    .setExpirationTime(`${DURACAO_DIAS}d`)
    .sign(segredo());
}

export async function validarTokenSessao(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    await jwtVerify(token, segredo(), { algorithms: ["HS256"] });
    return true;
  } catch {
    return false;
  }
}

export const OPCOES_COOKIE = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: DURACAO_DIAS * 24 * 60 * 60,
};
