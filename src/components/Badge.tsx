const ESTILOS: Record<string, string> = {
  bom: "bg-bom/10 text-[#006300]",
  alerta: "bg-alerta/15 text-[#7a5200]",
  critico: "bg-critico/10 text-critico",
  neutro: "bg-grade/60 text-tinta-2",
};

export default function Badge({
  tom = "neutro",
  children,
}: {
  tom?: keyof typeof ESTILOS;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${ESTILOS[tom]}`}
    >
      {children}
    </span>
  );
}
