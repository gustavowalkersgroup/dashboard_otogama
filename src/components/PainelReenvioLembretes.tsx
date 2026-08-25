"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import Badge from "@/components/Badge";
import { Telefone, ToggleTelefones } from "@/components/telefones";
import { dataHoraBRT } from "@/lib/formato";
import type { ConsultaDoDia, DiaLembrete, PainelLembretes } from "@/lib/metricas";

type Resultado =
  | { tipo: "ok"; enfileiradas: number; data: string }
  | { tipo: "erro"; mensagem: string };

export default function PainelReenvioLembretes({ painel }: { painel: PainelLembretes }) {
  const router = useRouter();
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  const faltando = painel.faltando;
  const todasMarcadas = faltando.length > 0 && marcadas.size === faltando.length;

  const selecionadas = useMemo(
    () => faltando.filter((c) => marcadas.has(c.chave)),
    [faltando, marcadas],
  );

  function alternar(chave: string) {
    setResultado(null);
    setConfirmando(false);
    setMarcadas((antes) => {
      const proximo = new Set(antes);
      if (proximo.has(chave)) proximo.delete(chave);
      else proximo.add(chave);
      return proximo;
    });
  }

  function alternarTodas() {
    setResultado(null);
    setConfirmando(false);
    setMarcadas(todasMarcadas ? new Set() : new Set(faltando.map((c) => c.chave)));
  }

  async function reenviar() {
    setEnviando(true);
    setResultado(null);
    try {
      const resp = await fetch("/api/acoes/reenviar-lembretes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dia: painel.dia, chaves: [...marcadas] }),
      });
      const corpo = await resp.json().catch(() => null);
      if (!resp.ok) {
        setResultado({ tipo: "erro", mensagem: corpo?.erro ?? `Falhou (HTTP ${resp.status}).` });
        return;
      }
      setResultado({ tipo: "ok", enfileiradas: corpo.enfileiradas, data: corpo.data });
      setMarcadas(new Set());
      router.refresh();
    } catch {
      setResultado({ tipo: "erro", mensagem: "Erro de rede — tente de novo." });
    } finally {
      setEnviando(false);
      setConfirmando(false);
    }
  }

  return (
    <>
      <div className="mt-4 grid grid-cols-4 gap-3">
        <Cartao rotulo="Sem lembrete" valor={faltando.length} destaque={faltando.length > 0} />
        <Cartao rotulo="Já avisadas" valor={painel.avisadas} />
        <Cartao rotulo="Canceladas" valor={painel.canceladas} />
        <Cartao rotulo="Já encerradas" valor={painel.encerradas} />
      </div>

      <p className="mt-4 text-xs text-tinta-3">
        Lista montada com a última leitura da agenda que a Konsist deixou passar
        {painel.agendaVistaEm ? ` (${dataHoraBRT(painel.agendaVistaEm)})` : ""}. No reenvio o n8n
        relê a agenda na hora e ignora consulta que não se encaixa mais — cancelada durante a
        queda, por exemplo.
      </p>

      {faltando.length === 0 ? (
        <section className="mt-3 rounded-2xl border border-grade bg-superficie p-4">
          <p className="text-sm text-tinta-2">
            {painel.avisadas > 0
              ? "Todo mundo com consulta nesse dia já recebeu lembrete. ✓"
              : "Nenhuma consulta em aberto nesse dia — nada a reenviar."}
          </p>
        </section>
      ) : (
        <section className="mt-3 rounded-2xl border border-alerta/40 bg-alerta/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">
              Ficaram sem lembrete{" "}
              <span className="font-normal text-tinta-3">({faltando.length})</span>
            </h2>
            <ToggleTelefones />
          </div>

          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-xs text-tinta-3">
                  <th className="py-1.5 pr-3 font-medium">
                    <input
                      type="checkbox"
                      checked={todasMarcadas}
                      onChange={alternarTodas}
                      aria-label="Selecionar todas"
                      className="align-middle"
                    />
                  </th>
                  <th className="py-1.5 pr-3 font-medium">Hora</th>
                  <th className="py-1.5 pr-3 font-medium">Paciente</th>
                  <th className="py-1.5 pr-3 font-medium">Telefone</th>
                  <th className="py-1.5 pr-3 font-medium">Médico</th>
                  <th className="py-1.5 pr-3 font-medium">Agendamento</th>
                  <th className="py-1.5 font-medium">Situação</th>
                </tr>
              </thead>
              <tbody>
                {faltando.map((c) => (
                  <Linha
                    key={c.chave}
                    consulta={c}
                    marcada={marcadas.has(c.chave)}
                    onAlternar={() => alternar(c.chave)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {!confirmando ? (
              <button
                type="button"
                disabled={marcadas.size === 0}
                onClick={() => setConfirmando(true)}
                className="rounded-lg bg-tinta px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40"
              >
                Reenviar lembrete
                {marcadas.size > 0 ? ` (${marcadas.size})` : ""}
              </button>
            ) : (
              <>
                <span className="text-sm">
                  Vai mandar WhatsApp para <strong>{marcadas.size}</strong>{" "}
                  {marcadas.size === 1 ? "paciente" : "pacientes"}. Confirma?
                </span>
                <button
                  type="button"
                  disabled={enviando}
                  onClick={reenviar}
                  className="rounded-lg bg-critico px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-50"
                >
                  {enviando ? "Enviando…" : "Sim, enviar"}
                </button>
                <button
                  type="button"
                  disabled={enviando}
                  onClick={() => setConfirmando(false)}
                  className="rounded-lg border border-grade px-4 py-2 text-sm font-medium text-tinta-2 hover:text-tinta"
                >
                  Cancelar
                </button>
              </>
            )}
          </div>

          {confirmando && selecionadas.length > 0 && (
            <p className="mt-2 text-xs text-tinta-3">
              {selecionadas
                .slice(0, 6)
                .map((c) => c.paciente ?? c.chave)
                .join(", ")}
              {selecionadas.length > 6 ? ` e mais ${selecionadas.length - 6}` : ""}
            </p>
          )}
        </section>
      )}

      {resultado?.tipo === "ok" && (
        <p className="mt-3 rounded-xl border border-bom/40 bg-bom/5 px-4 py-3 text-sm">
          Pedido aceito: <strong>{resultado.enfileiradas}</strong>{" "}
          {resultado.enfileiradas === 1 ? "consulta" : "consultas"} de {resultado.data}. O n8n relê
          a agenda na Konsist e dispara — quem receber sai desta lista. Se a Konsist estiver fora, o
          aviso cai no Discord e nada é enviado.
        </p>
      )}
      {resultado?.tipo === "erro" && (
        <p className="mt-3 rounded-xl border border-critico/40 bg-critico/5 px-4 py-3 text-sm text-critico">
          {resultado.mensagem}
        </p>
      )}
    </>
  );
}

function Cartao({
  rotulo,
  valor,
  destaque = false,
}: {
  rotulo: string;
  valor: number;
  destaque?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        destaque ? "border-alerta/50 bg-alerta/5" : "border-grade bg-superficie"
      }`}
    >
      <p className="text-sm text-tinta-2">{rotulo}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight">{valor}</p>
    </div>
  );
}

function Linha({
  consulta,
  marcada,
  onAlternar,
}: {
  consulta: ConsultaDoDia;
  marcada: boolean;
  onAlternar: () => void;
}) {
  return (
    <tr className="border-t border-grade">
      <td className="py-2 pr-3">
        <input
          type="checkbox"
          checked={marcada}
          onChange={onAlternar}
          aria-label={`Selecionar ${consulta.paciente ?? consulta.chave}`}
          className="align-middle"
        />
      </td>
      <td className="py-2 pr-3 tabular-nums">{consulta.horaConsulta ?? "—"}</td>
      <td className="py-2 pr-3 font-medium">{consulta.paciente ?? "—"}</td>
      <td className="py-2 pr-3">
        <Telefone numero={consulta.telefone} />
      </td>
      <td className="py-2 pr-3">{consulta.medico ?? "—"}</td>
      <td className="py-2 pr-3 tabular-nums">{consulta.chave}</td>
      <td className="py-2">
        <Badge tom={consulta.situacao === "Confirmado" ? "bom" : "neutro"}>
          {consulta.situacao}
        </Badge>
      </td>
    </tr>
  );
}

export type { DiaLembrete };
