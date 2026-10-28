const stack = [
  'Vite 8 · React 19 · TypeScript 7',
  'Apollo Client · GraphQL · Supabase JS',
  'Tailwind v4 · shadcn/ui',
  'Three · GSAP · Motion · Lenis · Vanta · Spline',
  'D3 · react-force-graph-2d · react-map-gl · MapLibre',
]

export default function App() {
  return (
    <main className="grid min-h-full place-items-center p-6">
      <section className="w-full max-w-2xl rounded-2xl border border-black/10 bg-white p-10 shadow-sm">
        <p className="text-xs font-semibold tracking-[0.2em] text-fridge-accent uppercase">
          Placeholder
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-fridge-ink">
          FridgeGraph web shell
        </h1>
        <p className="mt-4 text-base leading-relaxed text-black/60">
          Environment scaffold only. No product features, routes, data or
          network calls are wired here yet.
        </p>
        <ul className="mt-8 grid gap-2 text-sm text-black/70">
          {stack.map((line) => (
            <li key={line} className="rounded-lg bg-black/[0.03] px-3 py-2">
              {line}
            </li>
          ))}
        </ul>
        <p className="mt-8 text-xs text-black/40">
          See <code>TOOLBOX.md</code> for each library&rsquo;s role and boundary.
        </p>
      </section>
    </main>
  )
}
