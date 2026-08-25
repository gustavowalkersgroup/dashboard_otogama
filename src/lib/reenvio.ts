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
  // Token dedicado, sem cair no INGEST_API_KEY se faltar. A primeira versão tinha
  // esse fallback para poupar uma variável, e ele custou uma tarde: o webhook
  // recusava com 403 e a mensagem de erro acusava o token, quando o valor enviado
  // era o da ingestão. Faltar variável tem que falhar dizendo o nome dela.
  const token = (env.N8N_REENVIO_TOKEN ?? "").trim();
  if (!url) return { problema: "N8N_REENVIO_URL ausente ou vazia neste deployment." };
  if (!token) return { problema: "N8N_REENVIO_TOKEN ausente ou vazia neste deployment." };
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
    if (resp.status !== 401 && resp.status !== 403) {
      return { ok: false, status: 502, erro: `O n8n devolveu ${resp.status}.` };
    }
    // O webhook devolve tamanho e impressão do que recebeu (nunca o valor). Repassar
    // isso transforma "não bateu" em "chegou com 39 caracteres e o esperado tem 40",
    // que é acionável sem ninguém precisar saber o segredo.
    let detalhe = "";
    try {
      const corpo = JSON.parse(texto) as {
        recebido_tamanho?: number;
        recebido_impressao?: string | null;
        esperado_tamanho?: number;
      };
      if (typeof corpo.recebido_tamanho === "number") {
        detalhe =
          ` O webhook recebeu ${corpo.recebido_tamanho} caracteres` +
          (corpo.recebido_impressao ? ` (impressão ${corpo.recebido_impressao})` : "") +
          (typeof corpo.esperado_tamanho === "number"
            ? ` e espera ${corpo.esperado_tamanho}.`
            : ".");
      }
    } catch {
      // n8n pode responder texto puro quando a recusa vem antes do workflow
    }
    return {
      ok: false,
      status: 502,
      erro:
        "O n8n recusou o token: o N8N_REENVIO_TOKEN deste deployment não é o mesmo que o" +
        " workflow de reenvio espera." +
        detalhe,
    };
  }

  const corpo = (await resp.json().catch(() => null)) as RespostaReenvio | null;
  return { ok: true, corpo: corpo ?? { aceito: true } };
}
