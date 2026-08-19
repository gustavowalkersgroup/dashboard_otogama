"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { ComparecimentoGrupo } from "@/lib/metricas";

const COR_PENDENTE = "#c3c2b7"; // status: neutro
const COR_REALIZADO = "#0ca30c"; // status: bom
const COR_FALTOU = "#d03b3b"; // status: crítico
const COR_CANCELADO = "#ec835a"; // status: sério

const SEGMENTOS = [
  { chave: "pendente", rotulo: "Pendente", cor: COR_PENDENTE },
  { chave: "realizado", rotulo: "Realizado", cor: COR_REALIZADO },
  { chave: "faltou", rotulo: "Faltou", cor: COR_FALTOU },
  { chave: "cancelado", rotulo: "Cancelado", cor: COR_CANCELADO },
] as const;

function fatias(g: ComparecimentoGrupo | undefined) {
  const total = g?.total ?? 0;
  return SEGMENTOS.map((s) => ({
    nome: s.rotulo,
    cor: s.cor,
    valor: g ? g[s.chave] : 0,
    pct: total > 0 && g ? (g[s.chave] / total) * 100 : 0,
  })).filter((f) => f.valor > 0);
}

function TooltipCustom({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: { nome: string; valor: number; pct: number } }[];
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-grade bg-superficie px-3 py-2 text-xs shadow-sm">
      <p className="font-medium">{d.nome}</p>
      <p className="text-tinta-2">
        {d.valor} ({Math.round(d.pct)}%)
      </p>
    </div>
  );
}

function Rosca({ titulo, grupo }: { titulo: string; grupo: ComparecimentoGrupo | undefined }) {
  const dados = fatias(grupo);
  const total = grupo?.total ?? 0;

  return (
    <div className="flex flex-col items-center">
      <p className="text-sm font-medium">{titulo}</p>
      <p className="text-xs text-tinta-3">
        {total} consulta{total === 1 ? "" : "s"}
      </p>
      {total === 0 ? (
        <div className="flex h-40 items-center justify-center text-xs text-tinta-2">Sem dados</div>
      ) : (
        <div className="h-40 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={dados}
                dataKey="valor"
                nameKey="nome"
                innerRadius={42}
                outerRadius={64}
                startAngle={90}
                endAngle={-270}
                label={(props: unknown) => {
                  const pct = (props as { pct: number }).pct;
                  return pct >= 8 ? `${Math.round(pct)}%` : "";
                }}
                labelLine={false}
                stroke="#fcfcfb"
                strokeWidth={2}
              >
                {dados.map((f) => (
                  <Cell key={f.nome} fill={f.cor} />
                ))}
              </Pie>
              <Tooltip content={<TooltipCustom />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

/** Duas roscas: desfecho de pré-agendamentos criados pela IA vs feitos manualmente. */
export default function GraficoComparecimentoIa({ grupos }: { grupos: ComparecimentoGrupo[] }) {
  const ia = grupos.find((g) => g.grupo === "ia");
  const humano = grupos.find((g) => g.grupo === "humano");

  return (
    <div className="rounded-2xl border border-grade bg-superficie p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">Comparecimento: criado pela IA × manual</h2>
        <div className="flex flex-wrap gap-3 text-xs text-tinta-2">
          {SEGMENTOS.map((s) => (
            <span key={s.chave} className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.cor }} />
              {s.rotulo}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Rosca titulo="Criado pela IA" grupo={ia} />
        <Rosca titulo="Agendamento manual" grupo={humano} />
      </div>
    </div>
  );
}
