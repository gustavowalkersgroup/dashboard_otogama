import { SignJWT, jwtVerify } from "jose";

export const COOKIE_SESSAO = "otogama_sessao";
const DURACAO_DIAS = 30;

function segredo(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error("SESSION_SECRET ausente ou curta demais (mínimo 16 caracteres).");
  }
  return new TextEncoder().encode(s);
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
