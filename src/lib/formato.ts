export const FUSO = "America/Sao_Paulo";

const fmtDataHora = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO,
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const fmtDataHoraAno = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO,
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const fmtDiaMes = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO,
  day: "2-digit",
  month: "2-digit",
});

export function dataHoraBRT(d: Date | string): string {
  return fmtDataHora.format(new Date(d));
}

export function dataHoraAnoBRT(d: Date | string): string {
  return fmtDataHoraAno.format(new Date(d));
}

export function diaMesBRT(d: Date | string): string {
  return fmtDiaMes.format(new Date(d));
}

/** Início do dia BRT, `dias - 1` dias atrás (período inclui hoje). BRT é UTC-3 fixo desde 2019. */
export function inicioPeriodo(dias: number): Date {
  const hojeBRT = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(new Date());
  const inicio = new Date(`${hojeBRT}T00:00:00-03:00`);
  inicio.setUTCDate(inicio.getUTCDate() - (dias - 1));
  return inicio;
}

export type DiaRelativo = "hoje" | "ontem" | "amanha";

const DESLOCAMENTO: Record<DiaRelativo, number> = { ontem: -1, hoje: 0, amanha: 1 };

export const ROTULO_DIA: Record<DiaRelativo, string> = {
  ontem: "Ontem",
  hoje: "Hoje",
  amanha: "Amanhã",
};

/** Data do dia BRT em ISO (YYYY-MM-DD) — é por ela que se acha a agenda do dia. */
export function isoDiaRelativo(dia: DiaRelativo): string {
  // meio-dia evita que o deslocamento de fuso jogue para o dia vizinho
  const hojeBRT = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(new Date());
  const d = new Date(`${hojeBRT}T12:00:00-03:00`);
  d.setUTCDate(d.getUTCDate() + DESLOCAMENTO[dia]);
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(d);
}

/** Janela [início, fim) do dia BRT em UTC — para o que se recorta por data do evento. */
export function janelaDia(dia: DiaRelativo): { inicio: Date; fim: Date } {
  const inicio = new Date(`${isoDiaRelativo(dia)}T00:00:00-03:00`);
  const fim = new Date(inicio);
  fim.setUTCDate(fim.getUTCDate() + 1);
  return { inicio, fim };
}

/** "3h 24min", "12min", "1d 4h" — para deltas e duração de quedas. */
export function duracaoHumana(segundos: number): string {
  const s = Math.round(segundos);
  if (s < 60) return `${s}s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const restoMin = min % 60;
  if (h < 24) return restoMin > 0 ? `${h}h ${restoMin}min` : `${h}h`;
  const d = Math.floor(h / 24);
  const restoH = h % 24;
  return restoH > 0 ? `${d}d ${restoH}h` : `${d}d`;
}

export function numeroBR(n: number): string {
  return new Intl.NumberFormat("pt-BR").format(n);
}

/** 5561999998888 → "(61) 99999-8888" */
export function telefoneCompleto(t: string | null): string {
  if (!t) return "—";
  const d = t.replace(/\D/g, "");
  const resto = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
  if (resto.length < 10) return resto || "—";
  const ddd = resto.slice(0, 2);
  const num = resto.slice(2);
  const corte = num.length - 4;
  return `(${ddd}) ${num.slice(0, corte)}-${num.slice(corte)}`;
}

/** 5561999998888 → "(61) 9••••-••88" — default da UI (LGPD). */
export function telefoneMascarado(t: string | null): string {
  if (!t) return "—";
  const d = t.replace(/\D/g, "");
  const resto = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
  if (resto.length < 10) return resto ? "•".repeat(resto.length) : "—";
  const ddd = resto.slice(0, 2);
  const num = resto.slice(2);
  const corte = num.length - 4;
  const frente = num.length === 9 ? `${num[0]}••••` : "••••";
  return `(${ddd}) ${frente}-••${num.slice(corte + 2)}`;
}
