"use client";

import { useMemo, useState } from "react";
import Badge from "@/components/Badge";
import { Telefone, ToggleTelefones } from "@/components/telefones";
import { ROTULO_TIPO, TIPOS_ATENDIMENTO, type TipoAtendimento } from "@/lib/atendimento";
import { numeroBR } from "@/lib/formato";
import type { ConsultaDetalhada } from "@/lib/metricas";

const TOM_SITUACAO: Record<string, "bom" | "alerta" | "critico" | "neutro"> = {
  Confirmado: "bom",
  Realizado: "bom",
  Agendado: "neutro",
  Faltou: "critico",
  Cancelado: "alerta",
};

// Encaixe antes de exame, igual ao classificador e ao lembrete: é o rótulo que o
// paciente viu na mensagem.
const ORDEM_TIPO: TipoAtendimento[] = [...TIPOS_ATENDIMENTO, "desconhecido"];

function bateBusca(busca: string, ...campos: (string | null)[]): boolean {
  if (!busca) return true;
  const b = busca.toLowerCase();
  return campos.some((c) => c?.toLowerCase().includes(b));
}

export default function TabelaConsultas({ consultas }: { consultas: ConsultaDetalhada[] }) {
  const [busca, setBusca] = useState("");
  const [profissional, setProfissional] = useState("");
  const [tipo, setTipo] = useState("");
  const [soPendentes, setSoPendentes] = useState(false);

  // As opções vêm do próprio dia, não de uma lista fixa: profissional que não
  // atende nesse dia não deve aparecer como filtro que devolve vazio.
  const profissionais = useMemo(() => {
    const vistos = new Map<string, number>();
    for (const c of consultas) {
      const nome = c.medico ?? "—";
      vistos.set(nome, (vistos.get(nome) ?? 0) + 1);
    }
    return [...vistos.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));
  }, [consultas]);

  const tipos = useMemo(() => {
    const vistos = new Map<TipoAtendimento, number>();
    for (const c of consultas) vistos.set(c.tipo, (vistos.get(c.tipo) ?? 0) + 1);
    return ORDEM_TIPO.filter((t) => vistos.has(t)).map((t) => [t, vistos.get(t) ?? 0] as const);
  }, [consultas]);

  const filtradas = useMemo(
    () =>
      consultas.filter((c) => {
        if (profissional && (c.medico ?? "—") !== profissional) return false;
        if (tipo && c.tipo !== tipo) return false;
        if (soPendentes && c.confirmada) return false;
        return bateBusca(busca, c.paciente, c.medico, c.especialidade, c.servico, c.chave);
      }),
    [consultas, profissional, tipo, soPendentes, busca],
  );

  const avisadas = filtradas.filter((c) => c.avisada).length;
  const confirmadas = filtradas.filter((c) => c.confirmada).length;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar paciente, profissional, serviço…"
          className="min-w-52 flex-1 rounded-lg border border-grade bg-superficie px-3 py-1.5 text-sm"
        />
        <select
          value={profissional}
          onChange={(e) => setProfissional(e.target.value)}
          aria-label="Filtrar por profissional"
          className="rounded-lg border border-grade bg-superficie px-3 py-1.5 text-sm"
        >
          <option value="">Todos os profissionais</option>
          {profissionais.map(([nome, n]) => (
            <option key={nome} value={nome}>
              {nome} ({n})
            </option>
          ))}
        </select>
        <select
          value={tipo}
          onChange={(e) => setTipo(e.target.value)}
          aria-label="Filtrar por tipo de atendimento"
          className="rounded-lg border border-grade bg-superficie px-3 py-1.5 text-sm"
        >
          <option value="">Consulta, encaixe e exame</option>
          {tipos.map(([t, n]) => (
            <option key={t} value={t}>
              {ROTULO_TIPO[t]} ({n})
            </option>
          ))}
        </select>
        <label className="inline-flex items-center gap-1.5 text-sm text-tinta-2">
          <input
            type="checkbox"
            checked={soPendentes}
            onChange={(e) => setSoPendentes(e.target.checked)}
            className="rounded border-grade"
          />
          só sem confirmação
        </label>
        <ToggleTelefones />
      </div>

      <p className="mt-2 text-xs text-tinta-3">
        {numeroBR(filtradas.length)} de {numeroBR(consultas.length)} consultas ·{" "}
        {numeroBR(avisadas)} avisadas · {numeroBR(confirmadas)} confirmadas
      </p>

      {filtradas.length === 0 ? (
        <p className="mt-4 text-sm text-tinta-2">Nenhuma consulta com esses filtros.</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-grade">
          <table className="w-full min-w-[52rem] text-sm">
            <thead className="bg-grade/40 text-left text-xs uppercase tracking-wide text-tinta-3">
              <tr>
                <th className="px-3 py-2 font-medium">Hora</th>
                <th className="px-3 py-2 font-medium">Paciente</th>
                <th className="px-3 py-2 font-medium">Telefone</th>
                <th className="px-3 py-2 font-medium">Profissional</th>
                <th className="px-3 py-2 font-medium">Tipo</th>
                <th className="px-3 py-2 font-medium">Serviço</th>
                <th className="px-3 py-2 font-medium">Situação</th>
                <th className="px-3 py-2 font-medium">Aviso</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((c) => (
                <tr key={c.chave} className="border-t border-grade/70 align-top">
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{c.horaConsulta ?? "—"}</td>
                  <td className="px-3 py-2">{c.paciente ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-tinta-2">
                    <Telefone numero={c.telefone} />
                  </td>
                  <td className="px-3 py-2">
                    <div>{c.medico ?? "—"}</div>
                    <div className="text-xs text-tinta-3">{c.especialidade ?? "—"}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      title={
                        c.tipo === "desconhecido"
                          ? "Nenhuma fonte diz o tipo: não houve lembrete (que registra o tipo anunciado) e o evento é anterior a 03/09, quando o poll passou a guardar o código do procedimento."
                          : undefined
                      }
                    >
                      <Badge tom="neutro">{ROTULO_TIPO[c.tipo]}</Badge>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-tinta-2">{c.servico ?? "—"}</td>
                  <td className="px-3 py-2">
                    <Badge tom={TOM_SITUACAO[c.situacao] ?? "neutro"}>{c.situacao || "—"}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {c.confirmada ? (
                      <Badge tom="bom">confirmou</Badge>
                    ) : c.avisada ? (
                      <Badge tom="alerta">avisada</Badge>
                    ) : (
                      <Badge tom="neutro">sem aviso</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
