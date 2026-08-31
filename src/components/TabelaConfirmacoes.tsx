"use client";

import { useMemo, useState } from "react";
import Badge from "@/components/Badge";
import { Telefone, ToggleTelefones } from "@/components/telefones";
import { dataHoraBRT, duracaoHumana } from "@/lib/formato";
import type { Confirmado, PedidoAjuda, Pendente, PresaApi } from "@/lib/metricas";

const ORIGEM: Record<string, string> = {
  d0: "lembrete do dia",
  d1: "véspera",
  perdida: "consulta perdida",
  fluxo_confirmacao: "fluxo de confirmação",
  fluxo_perdida: "aviso de falta",
  botao_ajuda_painel: "botão do painel",
  reenvio_manual: "reenvio manual",
};

function bateBusca(busca: string, ...campos: (string | null)[]): boolean {
  if (!busca) return true;
  const b = busca.toLowerCase();
  return campos.some((c) => c?.toLowerCase().includes(b));
}

export default function TabelaConfirmacoes({
  confirmados,
  pendentes,
  ajuda,
  presasApi,
}: {
  confirmados: Confirmado[];
  pendentes: Pendente[];
  ajuda: PedidoAjuda[];
  presasApi: PresaApi[];
}) {
  const [busca, setBusca] = useState("");

  const travadas = useMemo(
    () => presasApi.filter((p) => bateBusca(busca, p.paciente, p.telefone, p.chave)),
    [presasApi, busca],
  );
  // A fila desistiu: ninguém mais vai tentar. Precisa vir antes e mais forte que
  // as que ainda estão sendo retentadas — são as duas únicas linhas desta tela
  // onde o paciente acha que confirmou e a clínica não tem o registro.
  const perdidasF = useMemo(
    () => travadas.filter((p) => p.resultado === "falha_definitiva"),
    [travadas],
  );
  const presasF = useMemo(
    () => travadas.filter((p) => p.resultado === "erro_api"),
    [travadas],
  );
  const ajudaF = useMemo(
    () => ajuda.filter((a) => bateBusca(busca, a.paciente, a.telefone, a.chave)),
    [ajuda, busca],
  );
  const pendentesF = useMemo(
    () => pendentes.filter((p) => bateBusca(busca, p.paciente, p.telefone, p.chave)),
    [pendentes, busca],
  );
  const confirmadosF = useMemo(
    () => confirmados.filter((c) => bateBusca(busca, c.paciente, c.telefone, c.chave)),
    [confirmados, busca],
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Buscar por nome ou telefone…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="w-full max-w-xs rounded-lg border border-grade bg-superficie px-3 py-1.5 text-sm outline-none focus:border-serie-1"
        />
        <ToggleTelefones />
      </div>

      {perdidasF.length > 0 && (
        <section className="mt-4 rounded-2xl border border-critico/40 bg-critico/5 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <span className="text-critico" aria-hidden>
              ▲
            </span>
            Confirmação perdida — gravar na mão na Konsist
          </h2>
          <p className="mt-0.5 text-xs text-tinta-3">
            O paciente confirmou pelo WhatsApp, a Konsist não registrou, e a fila do n8n desistiu
            depois de 5 tentativas. Ninguém mais vai tentar: sem alguém gravar no sistema da
            clínica, esta consulta consta como não confirmada e o paciente acha que está tudo
            certo.
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="text-left text-xs text-tinta-3">
                  <th className="py-1.5 pr-3 font-medium">Paciente</th>
                  <th className="py-1.5 pr-3 font-medium">Telefone</th>
                  <th className="py-1.5 pr-3 font-medium">Agendamento</th>
                  <th className="py-1.5 pr-3 font-medium">Tentativas</th>
                  <th className="py-1.5 font-medium">Quando confirmou</th>
                </tr>
              </thead>
              <tbody>
                {perdidasF.map((p) => (
                  <tr key={p.chave} className="border-t border-grade">
                    <td className="py-2 pr-3 font-medium">{p.paciente ?? "—"}</td>
                    <td className="py-2 pr-3">
                      <Telefone numero={p.telefone} />
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{p.chave}</td>
                    <td className="py-2 pr-3 tabular-nums">{p.tentativas ?? "—"}</td>
                    <td className="py-2 tabular-nums">{dataHoraBRT(p.ts)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {presasF.length > 0 && (
        <section className="mt-4 rounded-2xl border border-alerta/50 bg-alerta/5 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <span className="text-alerta" aria-hidden>
              ⏳
            </span>
            Confirmaram, mas a Konsist estava fora
          </h2>
          <p className="mt-0.5 text-xs text-tinta-3">
            O n8n guarda numa fila e retenta a cada 15min enquanto a API responde, desistindo
            depois de 5 tentativas. Some daqui sozinho quando gravar. O que continuar aqui depois
            de umas horas precisa ser confirmado na mão — o paciente já acha que confirmou.
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-xs text-tinta-3">
                  <th className="py-1.5 pr-3 font-medium">Paciente</th>
                  <th className="py-1.5 pr-3 font-medium">Telefone</th>
                  <th className="py-1.5 pr-3 font-medium">Agendamento</th>
                  <th className="py-1.5 font-medium">Quando confirmou</th>
                </tr>
              </thead>
              <tbody>
                {presasF.map((p) => (
                  <tr key={p.chave} className="border-t border-grade">
                    <td className="py-2 pr-3 font-medium">{p.paciente ?? "—"}</td>
                    <td className="py-2 pr-3">
                      <Telefone numero={p.telefone} />
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{p.chave}</td>
                    <td className="py-2 tabular-nums">{dataHoraBRT(p.ts)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {ajudaF.length > 0 && (
        <section className="mt-4 rounded-2xl border border-critico/40 bg-critico/5 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <span className="text-critico" aria-hidden>
              ▲
            </span>
            Pediram ajuda — ligar para o paciente
          </h2>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-xs text-tinta-3">
                  <th className="py-1.5 pr-3 font-medium">Paciente</th>
                  <th className="py-1.5 pr-3 font-medium">Telefone</th>
                  <th className="py-1.5 pr-3 font-medium">Agendamento</th>
                  <th className="py-1.5 pr-3 font-medium">Quando pediu</th>
                  <th className="py-1.5 font-medium">Veio de</th>
                </tr>
              </thead>
              <tbody>
                {ajudaF.map((a, i) => (
                  <tr key={i} className="border-t border-grade">
                    <td className="py-2 pr-3 font-medium">{a.paciente ?? "—"}</td>
                    <td className="py-2 pr-3">
                      <Telefone numero={a.telefone} />
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{a.chave ?? "—"}</td>
                    <td className="py-2 pr-3 tabular-nums">{dataHoraBRT(a.ts)}</td>
                    <td className="py-2">
                      <Badge>{a.origem ? (ORIGEM[a.origem] ?? a.origem) : "—"}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="mt-4 rounded-2xl border border-grade bg-superficie p-4">
        <h2 className="text-sm font-semibold">
          Sem resposta{" "}
          <span className="font-normal text-tinta-3">({pendentesF.length} agendamentos)</span>
        </h2>
        <p className="mt-0.5 text-xs text-tinta-3">
          Avisados que ainda não confirmaram — lista para a recepção agir.
        </p>
        {pendentesF.length === 0 ? (
          <p className="mt-3 text-sm text-tinta-2">Ninguém pendente no período. ✓</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-xs text-tinta-3">
                  <th className="py-1.5 pr-3 font-medium">Paciente</th>
                  <th className="py-1.5 pr-3 font-medium">Telefone</th>
                  <th className="py-1.5 pr-3 font-medium">Agendamento</th>
                  <th className="py-1.5 pr-3 font-medium">Lembrete enviado</th>
                  <th className="py-1.5 font-medium">Origem</th>
                </tr>
              </thead>
              <tbody>
                {pendentesF.map((p) => (
                  <tr key={p.chave} className="border-t border-grade">
                    <td className="py-2 pr-3 font-medium">{p.paciente ?? "—"}</td>
                    <td className="py-2 pr-3">
                      <Telefone numero={p.telefone} />
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{p.chave}</td>
                    <td className="py-2 pr-3 tabular-nums">{dataHoraBRT(p.enviadoEm)}</td>
                    <td className="py-2">
                      <Badge>{p.origem ? (ORIGEM[p.origem] ?? p.origem) : "—"}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-4 rounded-2xl border border-grade bg-superficie p-4">
        <h2 className="text-sm font-semibold">
          Confirmados{" "}
          <span className="font-normal text-tinta-3">({confirmadosF.length} agendamentos)</span>
        </h2>
        {confirmadosF.length === 0 ? (
          <p className="mt-3 text-sm text-tinta-2">Nenhuma confirmação no período.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-xs text-tinta-3">
                  <th className="py-1.5 pr-3 font-medium">Paciente</th>
                  <th className="py-1.5 pr-3 font-medium">Telefone</th>
                  <th className="py-1.5 pr-3 font-medium">Agendamento</th>
                  <th className="py-1.5 pr-3 font-medium">Confirmou em</th>
                  <th className="py-1.5 pr-3 font-medium">Tempo até confirmar</th>
                  <th className="py-1.5 font-medium">Retorno Konsist</th>
                </tr>
              </thead>
              <tbody>
                {confirmadosF.map((c) => (
                  <tr key={c.chave} className="border-t border-grade">
                    <td className="py-2 pr-3 font-medium">{c.paciente ?? "—"}</td>
                    <td className="py-2 pr-3">
                      <Telefone numero={c.telefone} />
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{c.chave}</td>
                    <td className="py-2 pr-3 tabular-nums">{dataHoraBRT(c.ts)}</td>
                    <td className="py-2 pr-3 tabular-nums">
                      {c.deltaS !== null ? duracaoHumana(c.deltaS) : "—"}
                    </td>
                    <td className="py-2">
                      {c.resultado === "ok" ? (
                        <Badge tom="bom">✓ gravado</Badge>
                      ) : (
                        <Badge>já estava confirmado</Badge>
                      )}
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
