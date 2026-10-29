"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Bill } from "@/lib/types";
import type { LoyaltyState, PurchaseStats } from "@/lib/loyalty/types";
import { statsFrom } from "@/lib/loyalty/engine";
import type { TierKey } from "@/lib/loyalty/config";
import { useAdmin } from "../Store";
import { Badge, cx } from "../kit";
import { TIER_TONE } from "./billing";

/** The Loyalty page's data, fetched separately from the main admin state and
    refreshed whenever the shop's data version moves. */
export function useLoyaltyState() {
  const { s } = useAdmin();
  const [data, setData] = useState<LoyaltyState | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = await fetch("/api/admin/loyalty", { cache: "no-store" });
        const d = await r.json();
        if (!live) return;
        if (!r.ok) setError(d.error ?? "Couldn't load loyalty data.");
        else {
          setData(d);
          setError("");
        }
      } catch {
        if (live) setError("Network problem — couldn't load loyalty data.");
      }
    })();
    return () => {
      live = false;
    };
  }, [s.version, tick]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, error, reload };
}

/** Purchase stats per mobile from the admin's bills. */
export function useStatsByPhone(bills: Bill[], frequentDays: number) {
  const { now } = useAdmin();
  return useMemo(() => {
    const by = new Map<string, Bill[]>();
    for (const b of bills) {
      if (!b.customerPhone) continue;
      const list = by.get(b.customerPhone);
      if (list) list.push(b);
      else by.set(b.customerPhone, [b]);
    }
    const out = new Map<string, PurchaseStats & { bills: Bill[]; name: string }>();
    for (const [phone, list] of by) {
      list.sort((a, b) => b.createdAt - a.createdAt);
      out.set(phone, { ...statsFrom(list, frequentDays, now), bills: list, name: list.find((b) => b.customerName && b.customerName !== "Walk-in customer")?.customerName ?? "" });
    }
    return out;
  }, [bills, frequentDays, now]);
}

export const EMPTY_STATS: PurchaseStats = { orders: 0, visits: 0, spent: 0, aov: 0, first: null, last: null, recentVisits: 0 };

export function TierBadge({ tier, name }: { tier: TierKey; name: string }) {
  return <Badge tone={TIER_TONE[tier]}>{name}</Badge>;
}

export const LEDGER_LABEL: Record<string, string> = {
  purchase: "Purchase points",
  bonus: "Bonus",
  promo: "Promotion",
  referral: "Referral",
  occasion: "Birthday / occasion",
  redemption: "Points redeemed",
  reward: "Reward redeemed",
  expiry: "Expired",
  refund_reversal: "Refund reversal",
  refund_restore: "Refund — points returned",
  reward_reversal: "Reward reversal",
  adjustment: "Manual adjustment",
  debt_recovery: "Refund recovery",
};

export const monthLabel = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][mo - 1]} ${String(y).slice(2)}`;
};

/** Two-series columns (e.g. earned vs redeemed per month). */
export function PairColumns({ data, a, b, height = 180, empty = "No data yet" }: { data: { label: string; a: number; b: number }[]; a: string; b: string; height?: number; empty?: string }) {
  const max = Math.max(...data.flatMap((d) => [d.a, d.b]), 0);
  return (
    <div>
      <div className="mb-3 flex gap-4 text-[11.5px] font-semibold text-slate-600">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-red-600" /> {a}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-slate-400" /> {b}
        </span>
      </div>
      <div className="relative flex items-end gap-1 sm:gap-2" style={{ height }} role="img" aria-label={data.map((d) => `${d.label}: ${a} ${d.a}, ${b} ${d.b}`).join("; ")}>
        {!max && <p className="absolute inset-0 grid place-items-center text-[13px] text-slate-400">{empty}</p>}
        {data.map((d, i) => (
          <div key={d.label + i} tabIndex={0} className="group relative flex h-full flex-1 items-end justify-center gap-[2px] rounded-lg outline-none hover:bg-slate-50 focus-visible:bg-slate-50">
            {max > 0 && (
              <>
                <div className="adm-bar w-2 rounded-t-[3px] bg-red-600 sm:w-3" style={{ height: `${(d.a / max) * 88}%` }} />
                <div className="adm-bar w-2 rounded-t-[3px] bg-slate-400 sm:w-3" style={{ height: `${(d.b / max) * 88}%` }} />
              </>
            )}
            <div className="pointer-events-none absolute bottom-[92%] left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] leading-tight text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              <span className="block text-slate-300">{d.label}</span>
              {a} <b>{d.a}</b> · {b} <b>{d.b}</b>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-1 border-t border-slate-100 pt-3 sm:gap-2">
        {data.map((d, i) => (
          <span key={d.label + i} className="flex-1 text-center text-[10.5px] font-semibold uppercase text-slate-500">
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Ranked horizontal bars. */
export function BarList({ rows, fmt = String, empty = "Nothing yet" }: { rows: { label: React.ReactNode; value: number; key: string; sub?: string }[]; fmt?: (n: number) => string; empty?: string }) {
  const max = Math.max(...rows.map((r) => r.value), 0);
  if (!rows.length || !max) return <p className="py-6 text-center text-[13px] text-slate-400">{empty}</p>;
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="mb-1 flex items-center justify-between gap-3 text-[12.5px]">
            <span className="min-w-0 truncate font-semibold text-slate-700">
              {r.label}
              {r.sub && <span className="ml-1.5 font-normal text-slate-400">{r.sub}</span>}
            </span>
            <b className="adm-num shrink-0 text-slate-900">{fmt(r.value)}</b>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="adm-fill h-full rounded-full bg-red-600" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Pager({ page, pages, onPage, total }: { page: number; pages: number; onPage: (p: number) => void; total: number }) {
  if (pages <= 1) return <p className="mt-3 text-[12px] text-slate-400">{total} record{total === 1 ? "" : "s"}</p>;
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
      <span className="text-slate-500">
        {total} records · page {page} of {pages}
      </span>
      <span className="flex gap-1">
        {[
          ["‹ Prev", page - 1],
          ["Next ›", page + 1],
        ].map(([t, p]) => (
          <button key={t} type="button" disabled={(p as number) < 1 || (p as number) > pages} onClick={() => onPage(p as number)} className="h-8 rounded-lg border border-slate-200 px-3 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40">
            {t}
          </button>
        ))}
      </span>
    </div>
  );
}

export function usePaged<T>(rows: T[], size = 25) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(page, pages);
  return { rows: rows.slice((p - 1) * size, p * size), page: p, pages, setPage, total: rows.length };
}

export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: "red" | "green" | "amber" }) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-100 bg-white p-4 shadow-[0_2px_10px_-2px_rgba(15,23,42,.08)]">
      <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-600">{label}</span>
      <div className={cx("adm-num mt-2 truncate text-[22px] font-extrabold", tone === "red" ? "text-red-600" : tone === "green" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : "text-slate-900")}>{value}</div>
      {hint && <p className="mt-1 truncate text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

export const th = "px-3 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500";
export const td = "px-3 py-2.5 text-[13px] text-slate-700";
export const tableWrap = "adm-scroll overflow-x-auto rounded-2xl border border-slate-100";
