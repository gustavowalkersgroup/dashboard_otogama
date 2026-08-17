"use client";

import { useMemo, useState } from "react";
import Badge from "@/components/Badge";
import { Telefone, ToggleTelefones } from "@/components/telefones";
import { dataHoraBRT } from "@/lib/formato";
import type { AgendamentoIa } from "@/lib/metricas";

function tomStatus(status: string): "bom" | "alerta" | "critico" | "neutro" {
  const s = status.toLowerCase();
  if (s.includes("agendado")) return "bom";
  if (s.includes("recusado")) return "critico";
  if (s.includes("análise") || s.includes("analise")) return "alerta";
  return "neutro";
}

export default function TabelaAgendamentos({ agendamentos }: { agendamentos: AgendamentoIa[] }) {
  const [busca, setBusca] = useState("");
  const filtrados = useMemo(() => {
    if (!busca) return agendamentos;
    const b = busca.toLowerCase();
    return agendamentos.filter((a) =>
      [a.paciente, a.telefone, a.chave, a.protocolo, a.medico]
        .filter(Boolean)
        .some((c) => c!.toLowerCase().includes(b)),
    );
  }, [agendamentos, busca]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Buscar por nome, telefone ou protocolo…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="w-full max-w-xs rounded-lg border border-grade bg-superficie px-3 py-1.5 text-sm outline-none focus:border-serie-1"
        />
        <ToggleTelefones />
      </div>

      <section className="mt-4 rounded-2xl border border-grade bg-superficie p-4">
        {filtrados.length === 0 ? (
          <p className="text-sm text-tinta-2">Nenhum pré-agendamento da IA no período.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-xs text-tinta-3">
                  <th className="py-1.5 pr-3 font-medium">Paciente</th>
                  <th className="py-1.5 pr-3 font-medium">Telefone</th>
                  <th className="py-1.5 pr-3 font-medium">Médico / serviço</th>
                  <th className="py-1.5 pr-3 font-medium">Criado em</th>
                  <th className="py-1.5 pr-3 font-medium">Status</th>
                  <th className="py-1.5 font-medium">Desfecho em</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((a, i) => (
                  <tr key={`${a.chave}-${i}`} className="border-t border-grade">
                    <td className="py-2 pr-3 font-medium">{a.paciente ?? "—"}</td>
                    <td className="py-2 pr-3">
                      <Telefone numero={a.telefone} />
                    </td>
                    <td className="py-2 pr-3">
                      {a.medico ?? "—"}
                      <span className="block text-xs text-tinta-3">
                        {a.servico ?? a.especialidade ?? ""}
                      </span>
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{dataHoraBRT(a.criadoEm)}</td>
                    <td className="py-2 pr-3">
                      <Badge tom={tomStatus(a.statusAtual)}>{a.statusAtual}</Badge>
                    </td>
                    <td className="py-2 tabular-nums">
                      {a.desfechoEm ? dataHoraBRT(a.desfechoEm) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
