// Ponte para o n8n. O dashboard não fala com a Konsist nem com a NexTags: ele
// diz ao n8n quais consultas reenviar, e o n8n relê a agenda, monta a mensagem
// com todos os campos do template e dispara. Manter o disparo lá é o que garante
// que o reenvio manual e o automático produzam exatamente a mesma mensagem.

const TEMPO_LIMITE_MS = 15_000;

export type PedidoReenvio = {
  /** DD/MM/YYYY */
  data: string;
  chaves: string[];
  forcar: boolean;
};

export type RespostaReenvio = {
  aceito: boolean;
  total?: number;
  erro?: string;
};

function config(): { url: string; token: string } | { problema: string } {
  // alias evita o inline de `process.env.X` do bundler
  const env: Record<string, string | undefined> = process.env;
  const url = (env.N8N_REENVIO_URL ?? "").trim();
  // O webhook do n8n é protegido pela mesma credencial de header que o n8n já usa
  // para postar em /api/eventos, então por padrão o segredo é o INGEST_API_KEY que
  // este deployment já tem — uma variável nova a menos para configurar. Quem quiser
  // separar as duas capacidades define N8N_REENVIO_TOKEN e troca a credencial no n8n.
  const token = (env.N8N_REENVIO_TOKEN ?? env.INGEST_API_KEY ?? "").trim();
  if (!url) return { problema: "N8N_REENVIO_URL ausente ou vazia neste deployment." };
  if (!token) {
    return { problema: "Nem N8N_REENVIO_TOKEN nem INGEST_API_KEY configuradas neste deployment." };
  }
  return { url, token };
}

export async function pedirReenvio(
  pedido: PedidoReenvio,
): Promise<{ ok: true; corpo: RespostaReenvio } | { ok: false; status: number; erro: string }> {
  const c = config();
  if ("problema" in c) {
    console.error(c.problema);
    return { ok: false, status: 500, erro: c.problema };
  }

  let resp: Response;
  try {
    resp = await fetch(c.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": c.token },
      body: JSON.stringify({ ...pedido, origem: "dashboard" }),
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      cache: "no-store",
    });
  } catch (e) {
    // O webhook do n8n responde na hora e só depois trabalha, então estourar o
    // tempo aqui é sinal de n8n fora do ar, não de trabalho demorado.
    console.error("reenvio: n8n não respondeu:", e);
    return { ok: false, status: 502, erro: "O n8n não respondeu. Tente de novo em instantes." };
  }

  if (!resp.ok) {
    const texto = await resp.text().catch(() => "");
    console.error(`reenvio: n8n devolveu ${resp.status}: ${texto.slice(0, 300)}`);
    const erro =
      resp.status === 401 || resp.status === 403
        ? "O n8n recusou a chave (N8N_REENVIO_TOKEN não bate com o webhook)."
        : `O n8n devolveu ${resp.status}.`;
    return { ok: false, status: 502, erro };
  }

  const corpo = (await resp.json().catch(() => null)) as RespostaReenvio | null;
  return { ok: true, corpo: corpo ?? { aceito: true } };
}
