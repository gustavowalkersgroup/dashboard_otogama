/**
 * Classificação de atendimento: consulta, encaixe ou exame.
 *
 * A Konsist não tem esse campo. Quem inventou a distinção foi o disparo de
 * lembretes, porque cada um usa um template diferente na NexTags — a regra vive
 * em `Achatar Pacientes x Consultas` do workflow "Lembrete de Consulta (1 Dia
 * Antes)", e é replicada aqui para a tela dizer o mesmo que a mensagem disse:
 *
 *   exame   = prefixo do código do procedimento em 40/41/51, ou código 'PAC'
 *   encaixe = minuto que não termina em 0 nem em 5
 *
 * **Encaixe tem precedência sobre exame**, igual ao n8n (`eh_encaixe ? 'encaixe'
 * : (tipo_atendimento === 'Exame' ? 'exame' : 'consulta')`). Um exame remarcado
 * para 09:05 é anunciado ao paciente como encaixe, então é assim que a tela
 * precisa mostrá-lo — inverter a ordem faria a tela contradizer o WhatsApp.
 *
 * O `codigo_procedimento` só passou a ser gravado no `status_consulta` em
 * 03/09/2026. Antes disso dá para saber que algo é encaixe (a hora basta), mas
 * não separar exame de consulta: esses casos voltam como "desconhecido" em vez
 * de virarem "consulta" por omissão, que é o palpite que mais engana — a maioria
 * dos atendimentos de Fonoaudiologia é exame.
 */
export const TIPOS_ATENDIMENTO = ["consulta", "encaixe", "exame"] as const;

export type TipoAtendimento = (typeof TIPOS_ATENDIMENTO)[number] | "desconhecido";

export const ROTULO_TIPO: Record<TipoAtendimento, string> = {
  consulta: "Consulta",
  encaixe: "Encaixe",
  exame: "Exame",
  desconhecido: "Sem tipo",
};

const PREFIXOS_EXAME = ["40", "41", "51"];

/**
 * A grade da clínica é de 5 minutos: minuto terminado em 0 ou 5 é horário
 * normal, qualquer outro é encaixe. Confirmado pela clínica em 03/09/2026.
 *
 * Os três workflows do n8n discordavam entre si e todos erravam: o D-1 e o D-0
 * usavam `% 10`, que chamava 09:05 e 09:45 de encaixe, e o reenvio manual usava
 * `minuto ∉ [0,20,40]`, que ainda incluía 09:10 e 09:30. Os três foram alinhados
 * a esta regra na mesma data.
 */
function ehEncaixe(horaConsulta: string | null | undefined): boolean {
  if (!horaConsulta) return false;
  const partes = String(horaConsulta).split(":");
  if (partes.length < 2) return false;
  const minuto = Number.parseInt(partes[1], 10);
  return Number.isFinite(minuto) && minuto % 5 !== 0;
}

function ehExame(codigoProcedimento: string | null | undefined): boolean {
  const codigo = String(codigoProcedimento ?? "").trim().toUpperCase();
  if (!codigo) return false;
  return PREFIXOS_EXAME.includes(codigo.slice(0, 2)) || codigo === "PAC";
}

/**
 * Ordem de precedência, e o motivo de cada degrau:
 *
 * 1. **Encaixe pela hora.** É aritmética sobre um dado que sempre existe, e é a
 *    única fonte confiável para encaixe. Vem primeiro também porque o log do
 *    reenvio manual grava `tipo_consulta` como "Consulta"/"Exame" e perde o
 *    encaixe — sem este degrau, um encaixe reenviado viraria exame.
 * 2. **O tipo que o lembrete anunciou**, e SÓ quando ele diz exame ou consulta.
 *    `envio_lembrete.payload.tipo_consulta` é confiável por chave apesar do
 *    agrupamento por telefone, porque o tipo É a chave do grupo: todas as
 *    consultas de uma mensagem compartilham o tipo (ao contrário de `medico` e
 *    `especialidade`, que variam dentro do grupo e por isso não se usam aqui).
 *    Um "encaixe" anunciado é DESCARTADO: foi derivado da hora pela regra antiga
 *    (`% 10`), que marcava 09:05 e 09:45 como encaixe. Como o degrau 1 já
 *    decidiu que esta hora não é encaixe, aceitar esse rótulo aqui seria
 *    reintroduzir na tela exatamente o erro que a regra nova corrige. O custo é
 *    que esses casos não dizem nada sobre exame vs consulta — o agrupamento
 *    antigo punha todo encaixe no mesmo balde, qualquer que fosse o
 *    procedimento — e caem no degrau 3.
 * 3. **O código do procedimento.** Só existe em evento gravado a partir de
 *    03/09/2026.
 * 4. Nada disso — "desconhecido", em vez de chutar "consulta".
 */
export function classificaAtendimento(entrada: {
  horaConsulta: string | null | undefined;
  codigoProcedimento: string | null | undefined;
  tipoAnunciado?: string | null | undefined;
}): TipoAtendimento {
  if (ehEncaixe(entrada.horaConsulta)) return "encaixe";

  const anunciado = String(entrada.tipoAnunciado ?? "").trim().toLowerCase();
  if (anunciado === "exame" || anunciado === "consulta") {
    return anunciado as TipoAtendimento;
  }

  const codigo = String(entrada.codigoProcedimento ?? "").trim();
  if (!codigo) return "desconhecido";
  return ehExame(codigo) ? "exame" : "consulta";
}

export function tipoValido(t: string | undefined): TipoAtendimento | null {
  if (!t) return null;
  if (t === "desconhecido") return "desconhecido";
  return (TIPOS_ATENDIMENTO as readonly string[]).includes(t) ? (t as TipoAtendimento) : null;
}
