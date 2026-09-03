import Link from "next/link";
import ErroDados from "@/components/ErroDados";
import TabelaConsultas from "@/components/TabelaConsultas";
import { DIAS_RELATIVOS, agendaDoDia } from "@/lib/metricas";
import { ROTULO_DIA, dataHoraBRT, type DiaRelativo } from "@/lib/formato";
import { numeroBR } from "@/lib/formato";

export const dynamic = "force-dynamic";

function diaValido(d: string | undefined): DiaRelativo {
  return (DIAS_RELATIVOS as readonly string[]).includes(d ?? "") ? (d as DiaRelativo) : "hoje";
}

export default async function Consultas({
  searchParams,
}: {
  searchParams: Promise<{ d?: string }>;
}) {
  const dia = diaValido((await searchParams).d);

  let agenda;
  try {
    agenda = await agendaDoDia(dia);
  } catch (e) {
    console.error("consultas:", e);
    return <ErroDados />;
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">
          Consultas de {ROTULO_DIA[dia].toLowerCase()} ({agenda.dataBR})
        </h2>
        <div className="inline-flex rounded-lg border border-grade bg-superficie p-0.5">
          {DIAS_RELATIVOS.map((d) => (
            <Link
              key={d}
              href={`/consultas?d=${d}`}
              aria-current={d === dia ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                d === dia ? "bg-tinta text-white" : "text-tinta-2 hover:text-tinta"
              }`}
            >
              {ROTULO_DIA[d]}
            </Link>
          ))}
        </div>
      </div>

      <p className="mt-1 text-sm text-tinta-2">
        Quem atende, que tipo de atendimento é e se o paciente já confirmou — filtrável por
        profissional e por tipo.
      </p>

      {/* Dizer o tamanho do que se sabe, e não só listar: o poll grava a situação
          apenas quando ela muda, então consulta marcada há tempo e estável desde
          então pode não estar aqui. Foi uma leitura de "a lista está completa" que
          fez parecer que a Fonoaudiologia não havia recebido lembrete. */}
      <p className="mt-2 rounded-lg border border-grade bg-superficie px-3 py-2 text-xs text-tinta-3">
        {agenda.consultas.length === 0 ? (
          <>
            O event store não tem nenhuma consulta para este dia. Ele registra a situação quando
            ela muda, então um dia inteiro sem alteração desde a última varredura aparece vazio —
            confira na Konsist antes de concluir que a agenda está vazia.
          </>
        ) : (
          <>
            {numeroBR(agenda.consultas.length)} consultas conhecidas pelo event store
            {agenda.agendaVistaEm && <> · agenda vista pelo poll em {dataHoraBRT(agenda.agendaVistaEm)}</>}.
            Esta lista é o que o poll observou, não a agenda da Konsist: ele grava quando a
            situação muda, então consulta estável de longa data pode faltar.
            {agenda.semTipo > 0 && (
              <>
                {" "}
                {numeroBR(agenda.semTipo)} sem tipo identificável: não foram avisadas (o lembrete
                é que registra o tipo anunciado) e são anteriores a 03/09, quando o poll passou a
                guardar o código do procedimento.
              </>
            )}
          </>
        )}
      </p>

      {agenda.consultas.length > 0 && (
        <div className="mt-4">
          <TabelaConsultas consultas={agenda.consultas} />
        </div>
      )}
    </>
  );
}
