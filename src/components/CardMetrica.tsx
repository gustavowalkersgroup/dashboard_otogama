export default function CardMetrica({
  rotulo,
  valor,
  detalhe,
  className = "",
}: {
  rotulo: string;
  valor: string;
  detalhe?: string;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-grade bg-superficie p-4 ${className}`}>
      <p className="text-sm text-tinta-2">{rotulo}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight">{valor}</p>
      {detalhe && <p className="mt-1 text-xs text-tinta-3">{detalhe}</p>}
    </div>
  );
}
