import Link from "next/link";
import type { Metadata } from "next";
import { walletView } from "@/lib/loyalty/server";
import { nextTier, pointsValue, tierByKey } from "@/lib/loyalty/engine";
import { rupee } from "@/lib/money";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My loyalty wallet", robots: { index: false, follow: false } };

const date = (t: number) => new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

/* A member's own wallet. The link carries a long random token that only staff can
   send (from the member's profile), so nothing here is reachable by guessing. */
export default async function WalletPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const w = await walletView(token);
  if (!w) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6 text-center">
        <h1 className="mb-1 text-base font-semibold text-slate-900">Wallet not found</h1>
        <p className="mb-5 max-w-sm text-sm text-slate-500">This link isn&apos;t valid any more. Ask at the counter for a fresh one.</p>
        <Link href="/" className="rounded-md bg-[#2b3022] px-4 py-2 text-xs font-medium text-white">
          See the menu
        </Link>
      </div>
    );
  }
  const c = w.customer;
  const cfg = w.config;
  const tier = tierByKey(c.tier, cfg);
  const next = nextTier(c.lifetime, cfg);
  const size = cfg.stamps.milestones.at(-1)?.visits ?? 0;
  const pos = c.stamps && size ? ((c.stamps - 1) % size) + 1 : 0;
  const nextMs = cfg.stamps.milestones.find((m) => m.visits > pos);
  const ready = w.vouchers.filter((v) => v.status === "issued");

  return (
    <div className="min-h-screen bg-[#f3f4e1] px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-md space-y-4">
        <div className="overflow-hidden rounded-3xl bg-[#2b3022] text-white shadow-xl">
          <div className="p-6">
            {w.logoUrl && <img src={w.logoUrl} alt="" style={{ height: 44, width: "auto", maxWidth: "100%", objectFit: "contain", marginBottom: 10, display: "block" }} />}
            <p className="text-[12px] font-extrabold uppercase tracking-[0.2em] text-[#c9d3a0]">{w.shopName} loyalty</p>
            <p className="mt-1 text-[18px] font-bold">{c.name}</p>
            <p className="font-mono text-[12px] text-slate-400">{c.code}</p>
            <div className="mt-5 flex items-end justify-between">
              <div>
                <p className="text-[44px] font-black leading-none">{c.available}</p>
                <p className="text-[13px] text-slate-300">points · worth {rupee(pointsValue(c.available, cfg))}</p>
              </div>
              <span className="rounded-full bg-amber-400 px-3 py-1 text-[12px] font-extrabold uppercase tracking-wide text-slate-900">{tier.name}</span>
            </div>
            {next && (
              <div className="mt-4">
                <div className="h-2 overflow-hidden rounded-full bg-white/15">
                  <div className="h-full rounded-full bg-amber-400" style={{ width: `${Math.min(100, ((c.lifetime - tier.min) / (next.tier.min - tier.min)) * 100)}%` }} />
                </div>
                <p className="mt-1 text-[12px] text-slate-400">
                  {next.need} more points to {next.tier.name}
                </p>
              </div>
            )}
          </div>
          <p className="bg-[#6b7550] px-6 py-3 text-[12.5px] font-semibold">{tier.benefits}</p>
        </div>
        {c.status !== "active" && <p className="rounded-xl bg-amber-50 px-4 py-3 text-[13px] font-semibold text-amber-800">This loyalty account is paused. Ask at the counter.</p>}

        {cfg.stamps.enabled && size > 0 && (
          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-[14px] font-bold">Visit stamps</h2>
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: size }, (_, i) => (
                <span key={i} className={`grid h-8 w-8 place-items-center rounded-full border-2 text-[11px] font-bold ${i < pos ? "border-[#6b7550] bg-[#6b7550] text-white" : cfg.stamps.milestones.some((m) => m.visits === i + 1) ? "border-amber-400 text-amber-600" : "border-slate-200 text-slate-400"}`}>
                  {i + 1}
                </span>
              ))}
            </div>
            {nextMs && (
              <p className="mt-2 text-[12.5px] text-slate-500">
                {nextMs.visits - pos} more visit{nextMs.visits - pos === 1 ? "" : "s"} to {nextMs.reward.name}
              </p>
            )}
          </section>
        )}

        {ready.length > 0 && (
          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-[14px] font-bold">Rewards ready to use</h2>
            <ul className="space-y-2">
              {ready.map((v) => (
                <li key={v.ref} className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                  <span>
                    <b className="block text-[13.5px]">{v.name}</b>
                    {v.expiresAt && <span className="text-[11.5px] text-slate-500">until {date(v.expiresAt)}</span>}
                  </span>
                  <span className="font-mono text-[13px] font-bold tracking-wider">{v.ref}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11.5px] text-slate-500">Show the code at billing.</p>
          </section>
        )}

        {w.rewards.length > 0 && (
          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-[14px] font-bold">Rewards you can redeem</h2>
            <ul className="divide-y divide-slate-100">
              {w.rewards.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <b className="block text-[13.5px]">{r.name}</b>
                    {(r.description || r.terms) && <span className="text-[11.5px] text-slate-500">{[r.description, r.terms].filter(Boolean).join(" · ")}</span>}
                  </span>
                  <span className={`shrink-0 text-[13px] font-bold ${r.pointsCost <= c.available ? "text-emerald-700" : "text-slate-400"}`}>{r.pointsCost ? `${r.pointsCost} pts` : "Free"}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {w.expiring.length > 0 && (
          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="mb-2 text-[14px] font-bold">Points expiring</h2>
            <ul className="text-[13px] text-slate-600">
              {w.expiring.map((e, i) => (
                <li key={i}>
                  {e.points} pts on {date(e.expiresAt)}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-[14px] font-bold">Points history</h2>
          {!w.ledger.length ? (
            <p className="text-[13px] text-slate-400">Nothing yet — you earn points on every paid bill.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {w.ledger.map((l) => (
                <li key={l.id} className="flex items-start justify-between gap-3 py-2.5 text-[13px]">
                  <span className="min-w-0">
                    <span className="block text-slate-800">{l.description}</span>
                    <span className="text-[11.5px] text-slate-400">
                      {date(l.createdAt)}
                      {l.invoiceNo && ` · ${l.invoiceNo}`}
                    </span>
                  </span>
                  <b className={`shrink-0 ${l.points > 0 ? "text-emerald-600" : "text-[#6b7550]"}`}>
                    {l.points > 0 ? "+" : ""}
                    {l.points}
                  </b>
                </li>
              ))}
            </ul>
          )}
        </section>

        {w.history.length > 0 && (
          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-[14px] font-bold">Recent bills</h2>
            <ul className="divide-y divide-slate-100 text-[13px]">
              {w.history.map((b) => (
                <li key={b.invoiceNo} className="flex justify-between py-2">
                  <span>
                    {date(b.createdAt)} <span className="text-slate-400">· {b.invoiceNo}</span>
                    {b.status === "void" && <span className="ml-1 text-[#6b7550]">(void)</span>}
                  </span>
                  <span className="font-semibold">
                    {rupee(b.total)}
                    {b.pointsEarned > 0 && <span className="ml-2 text-emerald-600">+{b.pointsEarned}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {cfg.referral.enabled && (
          <section className="rounded-2xl bg-white p-5 text-center shadow-sm">
            <p className="text-[13px] text-slate-600">Refer a friend — share your code. You both get points after their first visit.</p>
            <p className="mt-2 font-mono text-[24px] font-extrabold tracking-[0.15em]">{c.referralCode}</p>
          </section>
        )}
        <p className="text-center text-[11px] text-slate-400">Member since {date(c.createdAt)} · {c.lifetime} lifetime points</p>
      </div>
    </div>
  );
}
