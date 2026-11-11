import Link from "next/link";

const points = [
  ["Approved directory", "Search only company suppliers and configured integrations. No invented quotes, no bypassed sites."],
  ["Server-side bidding", "Windows, increments, and rankings are validated on the server. Countdown clocks cannot be edited in the browser."],
  ["Separated simulation", "AI demo bidders are labeled and kept off the operational award board."],
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#f3f5f7] text-ink">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-navy text-sm font-bold text-white">S</div>
          <div>
            <div className="font-serif text-xl leading-none">Strata</div>
            <div className="text-[11px] uppercase tracking-[0.16em] text-muted">Procurement OS</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/vendor/login" className="btn btn-ghost">Vendor portal</Link>
          <Link href="/login" className="btn btn-primary">Sign in</Link>
        </div>
      </header>
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-6 pb-16 pt-8 md:grid-cols-[1.1fr_0.9fr]">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-navy-2">Industrial sourcing control room</p>
          <h1 className="mt-3 max-w-xl font-serif text-4xl leading-tight text-navy md:text-5xl">Buy against a recorded quotation, not a guessed market.</h1>
          <p className="mt-4 max-w-xl text-lg text-muted">Strata helps buying teams compare approved suppliers, run reverse auctions, negotiate directly, and keep an audit trail of every price change.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/register" className="btn btn-primary">Open a workspace</Link>
            <Link href="/login" className="btn btn-ghost">Enter the demo workspace</Link>
          </div>
        </div>
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3 text-sm">
            <span className="font-semibold">Illustrative ranking</span>
            <span className="badge badge-amber">Not live data</span>
          </div>
          <table className="data">
            <thead><tr><th>Rank</th><th>Supplier</th><th>Bid</th><th>Status</th></tr></thead>
            <tbody>
              <tr><td>1</td><td>Directory supplier A</td><td className="tabular-nums">INR 4,21,000</td><td><span className="badge badge-pine">Winning</span></td></tr>
              <tr><td>2</td><td>Directory supplier B</td><td className="tabular-nums">INR 4,32,000</td><td><span className="badge badge-slate">Outbid</span></td></tr>
              <tr><td>3</td><td>Directory supplier C</td><td className="tabular-nums">INR 4,48,000</td><td><span className="badge badge-slate">Outbid</span></td></tr>
            </tbody>
          </table>
          <p className="px-4 py-3 text-xs text-muted">Interface preview only. The application never fabricates a supplier or a price when the workspace has no record.</p>
        </div>
      </section>
      <section className="mx-auto grid max-w-6xl gap-4 px-6 pb-16 md:grid-cols-3">
        {points.map(([title, copy]) => (
          <article key={title} className="card p-5">
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-muted">{copy}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
