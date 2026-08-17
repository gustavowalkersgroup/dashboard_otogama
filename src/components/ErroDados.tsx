export default function ErroDados() {
  return (
    <div className="rounded-2xl border border-alerta/50 bg-alerta/10 p-5 text-sm">
      <p className="font-medium">Não foi possível carregar os dados.</p>
      <p className="mt-1 text-tinta-2">
        Verifique se o banco está configurado (variável <code>DATABASE_URL</code>) e se o schema
        foi aplicado (<code>npm run db:init</code>). Detalhes no README.
      </p>
    </div>
  );
}
