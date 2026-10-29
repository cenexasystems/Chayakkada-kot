"use client";

import { useEffect, useMemo, useState } from "react";
import { rupee, round2 } from "@/lib/money";
import { pointsValue, shopDate, tierByKey } from "@/lib/loyalty/engine";
import type { LedgerEntry, LoyaltyState } from "@/lib/loyalty/types";
import { useAdmin } from "../Store";
import { Btn, DateRange, SearchBox, cx, downloadExcel, fmtDate, fmtDateTime } from "../kit";
import { EMPTY_STATS, LEDGER_LABEL, Pager, monthLabel, tableWrap, td, th, usePaged, useStatsByPhone } from "./shared";

type Cell = string | number;
type Table = { cols: string[]; rows: Cell[][]; num?: number[] };

const LEDGER_REPORTS = {
  earned: { t: "Points earned", types: "purchase,bonus,promo,referral,occasion" },
  redeemed: { t: "Points redeemed", types: "redemption,reward" },
  expired: { t: "Points expired", types: "expiry" },
  adjustments: { t: "Manual point adjustments", types: "adjustment" },
  ledger: { t: "Full points ledger", types: "" },
} as const;

const REPORTS = [
  ["summary", "Customer loyalty summary"],
  ["earned", "Points earned"],
  ["redeemed", "Points redeemed"],
  ["expired", "Points expired"],
  ["liability", "Outstanding points liability"],
  ["purchases", "Member purchase history"],
  ["repeat", "Repeat customers"],
  ["tiers", "Membership distribution"],
  ["rewards", "Reward redemptions"],
  ["referrals", "Referral performance"],
  ["coupons", "Coupon usage"],
  ["campaigns", "Campaign performance"],
  ["visits", "Visit-based rewards"],
  ["retention", "Customer retention (monthly)"],
  ["adjustments", "Manual point adjustments"],
  ["discounts", "Loyalty discounts given"],
  ["ledger", "Full points ledger"],
] as const;
type Key = (typeof REPORTS)[number][0];

const startMs = (d: string) => (d ? new Date(`${d}T00:00:00+05:30`).getTime() : 0);
const endMs = (d: string) => (d ? new Date(`${d}T23:59:59.999+05:30`).getTime() : 0);

export default function Reports({ d }: { d: LoyaltyState }) {
  const [key, setKey] = useState<Key>("summary");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const isLedger = key in LEDGER_REPORTS;
  const title = REPORTS.find((r) => r[0] === key)![1];
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-bold text-slate-800 outline-none focus:border-slate-400" value={key} onChange={(e) => setKey(e.target.value as Key)} aria-label="Report">
          {REPORTS.map(([k, t], i) => (
            <option key={k} value={k}>
              {i + 1}. {t}
            </option>
          ))}
        </select>
        <DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />
        <SearchBox value={q} onChange={setQ} placeholder="Search…" className="h-10 min-w-[180px] flex-1 rounded-xl" />
      </div>
      {isLedger ? <LedgerReport key={`${key}|${from}|${to}|${q}`} k={key as keyof typeof LEDGER_REPORTS} d={d} from={from} to={to} q={q} title={title} /> : <StateReport k={key} d={d} from={from} to={to} q={q} title={title} />}
    </div>
  );
}

function TableView({ t, title, pageSize = 25 }: { t: Table; title: string; pageSize?: number }) {
  const [sort, setSort] = useState<{ i: number; dir: 1 | -1 } | null>(null);
  const rows = useMemo(() => {
    if (!sort) return t.rows;
    return [...t.rows].sort((a, b) => {
      const x = a[sort.i];
      const y = b[sort.i];
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * sort.dir;
    });
  }, [t.rows, sort]);
  const pg = usePaged(rows, pageSize);
  return (
    <div>
      <div className="mb-2 flex justify-end">
        <Btn icon="download" disabled={!t.rows.length} onClick={() => downloadExcel(`${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${new Date().toISOString().slice(0, 10)}`, [t.cols, ...rows])}>
          Export Excel
        </Btn>
      </div>
      {!t.rows.length ? (
        <p className="rounded-2xl border border-slate-100 py-10 text-center text-[13px] text-slate-400">No records for this report and period.</p>
      ) : (
        <>
          <div className={tableWrap}>
            <table className="w-full min-w-[720px]">
              <thead className="bg-slate-50">
                <tr>
                  {t.cols.map((c, i) => (
                    <th key={c} className={cx(th, t.num?.includes(i) && "text-right")}>
                      <button type="button" className="uppercase hover:text-slate-900" onClick={() => setSort((s) => ({ i, dir: s?.i === i ? (s.dir === 1 ? -1 : 1) : -1 }))}>
                        {c}
                        {sort?.i === i ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pg.rows.map((r, k) => (
                  <tr key={k}>
                    {r.map((c, i) => (
                      <td key={i} className={cx(td, t.num?.includes(i) && "adm-num text-right")}>
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={pg.page} pages={pg.pages} onPage={pg.setPage} total={pg.total} />
        </>
      )}
    </div>
  );
}

function LedgerReport({ k, d, from, to, q, title }: { k: keyof typeof LEDGER_REPORTS; d: LoyaltyState; from: string; to: string; q: string; title: string }) {
  const { s } = useAdmin();
  const [page, setPage] = useState(1);
  const [res, setRes] = useState<{ rows: LedgerEntry[]; total: number; credit: number; debit: number } | null>(null);
  const [exporting, setExporting] = useState(false);
  const names = new Map(d.customers.map((c) => [c.id, c]));
  const params = (p: number, size: number) => new URLSearchParams({ type: LEDGER_REPORTS[k].types, from: String(startMs(from)), to: String(endMs(to)), q, page: String(p), size: String(size) });
  useEffect(() => {
    let live = true;
    fetch(`/api/admin/loyalty/ledger?${params(page, 50)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((x) => live && setRes(x))
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k, from, to, q, page, s.version]);
  const rowOf = (l: LedgerEntry): Cell[] => [fmtDateTime(l.createdAt), names.get(l.customerId)?.name ?? "", names.get(l.customerId)?.code ?? "", LEDGER_LABEL[l.type] ?? l.type, l.points, l.balanceAfter, l.invoiceNo ?? "", l.ref, l.description, l.actor];
  const cols = ["When", "Member", "Member ID", "Type", "Points", "Balance after", "Invoice", "Reference", "Description", "By"];
  const exportAll = async () => {
    setExporting(true);
    try {
      const r = await fetch(`/api/admin/loyalty/ledger?${params(1, 5000)}`, { cache: "no-store" });
      const x = await r.json();
      downloadExcel(`${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${new Date().toISOString().slice(0, 10)}`, [cols, ...(x.rows as LedgerEntry[]).map(rowOf)]);
    } finally {
      setExporting(false);
    }
  };
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px] text-slate-600">{res ? `${res.total} entries · +${res.credit} pts credited · −${res.debit} pts debited (${rupee(pointsValue(res.debit, d.config))})` : "Loading…"}</p>
        <Btn icon="download" disabled={!res?.total || exporting} onClick={exportAll}>
          {exporting ? "Preparing…" : "Export Excel"}
        </Btn>
      </div>
      {res && !res.rows.length ? (
        <p className="rounded-2xl border border-slate-100 py-10 text-center text-[13px] text-slate-400">No entries for this report and period.</p>
      ) : (
        res && (
          <>
            <div className={tableWrap}>
              <table className="w-full min-w-[900px]">
                <thead className="bg-slate-50">
                  <tr>
                    {cols.map((c, i) => (
                      <th key={c} className={cx(th, (i === 4 || i === 5) && "text-right")}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {res.rows.map((l) => (
                    <tr key={l.id}>
                      {rowOf(l).map((c, i) => (
                        <td key={i} className={cx(td, (i === 4 || i === 5) && "adm-num text-right", i === 4 && (Number(c) > 0 ? "text-emerald-600" : "text-red-600"), i === 8 && "max-w-[260px] truncate")}>
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} pages={Math.max(1, Math.ceil(res.total / 50))} onPage={setPage} total={res.total} />
          </>
        )
      )}
    </div>
  );
}

function StateReport({ k, d, from, to, q, title }: { k: Key; d: LoyaltyState; from: string; to: string; q: string; title: string }) {
  const { s } = useAdmin();
  const cfg = d.config;
  const stats = useStatsByPhone(s.bills, cfg.crm.frequentDays);
  const a = startMs(from);
  const b = endMs(to);
  const inRange = (t: number | null) => t !== null && (!a || t >= a) && (!b || t <= b);
  const member = new Map(d.customers.map((c) => [c.id, c]));
  const tier = (k2: string) => tierByKey(k2 as never, cfg).name;

  const t: Table = (() => {
    switch (k) {
      case "summary":
        return { cols: ["Member ID", "Name", "Mobile", "Tier", "Status", "Available", "Lifetime", "Redeemed", "Expired", "Stamps", "Visits", "Spent", "Joined"], num: [5, 6, 7, 8, 9, 10, 11], rows: d.customers.filter((c) => !from && !to ? true : inRange(c.createdAt)).map((c) => { const st = stats.get(c.phone) ?? EMPTY_STATS; return [c.code, c.name, c.phone, tier(c.tier), c.status, c.available, c.lifetime, c.redeemed, c.expired, c.stamps, st.visits, st.spent, fmtDate(c.createdAt)]; }) };
      case "liability": {
        const exp = new Map(d.expiringSoon.map((x) => [x.customerId, x]));
        return { cols: ["Member ID", "Name", "Mobile", "Tier", "Unspent points", "Value (₹)", "Expiring soon", "First expiry"], num: [4, 5, 6], rows: d.customers.filter((c) => c.available > 0).sort((x, y) => y.available - x.available).map((c) => [c.code, c.name, c.phone, tier(c.tier), c.available, pointsValue(c.available, cfg), exp.get(c.id)?.points ?? 0, exp.get(c.id) ? fmtDate(exp.get(c.id)!.expiresAt) : ""]) };
      }
      case "purchases":
        return { cols: ["Invoice", "Date", "Member", "Mobile", "Total", "Points earned", "Points redeemed", "Points discount", "Reward", "Status"], num: [4, 5, 6, 7], rows: s.bills.filter((x) => x.loyaltyCustomerId && inRange(x.createdAt)).sort((x, y) => y.createdAt - x.createdAt).map((x) => [x.invoiceNo, fmtDateTime(x.createdAt), member.get(x.loyaltyCustomerId!)?.name ?? x.customerName, x.customerPhone, x.total, x.pointsEarned, x.pointsRedeemed, x.pointsDiscount, x.rewardName ?? "", x.status]) };
      case "repeat":
        return { cols: ["Name", "Mobile", "Member", "Visits", "Orders", "Spent", "Avg bill", "First visit", "Last visit"], num: [3, 4, 5, 6], rows: [...stats.entries()].filter(([, st]) => st.visits >= 2 && (!from && !to ? true : inRange(st.last))).sort((x, y) => y[1].visits - x[1].visits).map(([phone, st]) => { const m = d.customers.find((c) => c.phone === phone); return [m?.name || st.name, phone, m ? m.code : "—", st.visits, st.orders, st.spent, st.aov, st.first ? fmtDate(st.first) : "", st.last ? fmtDate(st.last) : ""]; }) };
      case "tiers":
        return { cols: ["Tier", "From (lifetime pts)", "Multiplier", "Members", "Share", "Avg lifetime pts", "Unspent pts"], num: [1, 2, 3, 5, 6], rows: cfg.tiers.map((x) => { const ms = d.customers.filter((c) => c.tier === x.key); return [x.name, x.min, `${x.multiplier}×`, ms.length, d.customers.length ? `${Math.round((ms.length / d.customers.length) * 100)}%` : "0%", ms.length ? Math.round(ms.reduce((p, c) => p + c.lifetime, 0) / ms.length) : 0, ms.reduce((p, c) => p + c.available, 0)]; }) };
      case "rewards":
        return { cols: ["Reference", "Reward", "Member", "Source", "Points", "Status", "Invoice", "Issued", "Used"], num: [4], rows: d.vouchers.filter((v) => inRange(v.usedAt ?? v.issuedAt) || (!from && !to)).map((v) => [v.ref, v.name, member.get(v.customerId)?.name ?? "", v.source, v.pointsCost, v.status, v.invoiceNo ?? "", fmtDate(v.issuedAt), v.usedAt ? fmtDate(v.usedAt) : ""]) };
      case "referrals":
        return { cols: ["Referrer", "Referrer ID", "New customer", "Status", "Referrer pts", "New customer pts", "Registered", "Rewarded"], num: [4, 5], rows: d.referrals.filter((r) => !from && !to ? true : inRange(r.createdAt)).map((r) => [member.get(r.referrerId)?.name ?? "", member.get(r.referrerId)?.code ?? "", member.get(r.refereeId)?.name ?? "", r.status, r.referrerPoints, r.refereePoints, fmtDate(r.createdAt), r.rewardedAt ? fmtDate(r.rewardedAt) : ""]) };
      case "coupons":
        return { cols: ["Code", "Discount", "Active", "Bills in period", "Discount given", "Used (all time)", "Limit", "Sent", "Sent-to only"], num: [3, 4, 5, 7], rows: s.coupons.map((c) => { const bs = s.bills.filter((x) => x.status === "completed" && x.couponCode === c.code && inRange(x.createdAt)); return [c.code, `${c.percent}%`, c.active ? "Yes" : "No", bs.length, round2(bs.reduce((p, x) => p + x.couponDiscount, 0)), c.used, c.limit ?? "∞", c.sent, c.restricted ? "Yes" : "No"]; }) };
      case "campaigns":
        return { cols: ["Campaign", "Type", "Value", "Dates", "Active", "Bills", "Points given", "Usage limit"], num: [5, 6], rows: d.campaigns.map((c) => [c.name, c.type === "multiplier" ? "Multiplier" : "Bonus", c.type === "multiplier" ? `${c.value}×` : `+${c.value}`, `${c.startsOn || "…"} → ${c.endsOn || "…"}`, c.active ? "Yes" : "No", c.used, c.pointsGiven, c.usageLimit ?? "∞"]) };
      case "visits":
        return { cols: ["Reference", "Reward", "Member", "Milestone", "Status", "Issued", "Used", "Invoice"], rows: d.vouchers.filter((v) => v.source === "milestone" && (inRange(v.issuedAt) || (!from && !to))).map((v) => [v.ref, v.name, member.get(v.customerId)?.name ?? "", v.note, v.status, fmtDate(v.issuedAt), v.usedAt ? fmtDate(v.usedAt) : "", v.invoiceNo ?? ""]) };
      case "retention": {
        const months = new Map<string, Set<string>>();
        for (const x of s.bills) {
          if (x.status !== "completed" || !x.customerPhone || !inRange(x.createdAt)) continue;
          const m = shopDate(x.createdAt).slice(0, 7);
          (months.get(m) ?? months.set(m, new Set()).get(m)!).add(x.customerPhone);
        }
        const firsts = new Map<string, string>();
        for (const [phone, st] of stats) if (st.first) firsts.set(phone, shopDate(st.first).slice(0, 7));
        const keys = [...months.keys()].sort();
        return { cols: ["Month", "Customers", "New", "Returning", "Kept from last month", "Retention"], num: [1, 2, 3, 4], rows: keys.map((m, i) => { const set = months.get(m)!; const prev = i > 0 ? months.get(keys[i - 1]) : undefined; const kept = prev ? [...prev].filter((p) => set.has(p)).length : 0; const fresh = [...set].filter((p) => firsts.get(p) === m).length; return [monthLabel(m), set.size, fresh, set.size - fresh, kept, prev?.size ? `${Math.round((kept / prev.size) * 100)}%` : "—"]; }) };
      }
      case "discounts":
        return { cols: ["Invoice", "Date", "Member", "Points used", "Points discount", "Reward", "Reward discount", "Bill total", "Status"], num: [3, 4, 6, 7], rows: s.bills.filter((x) => (x.pointsDiscount > 0 || x.rewardDiscount > 0) && inRange(x.createdAt)).sort((x, y) => y.createdAt - x.createdAt).map((x) => [x.invoiceNo, fmtDateTime(x.createdAt), member.get(x.loyaltyCustomerId ?? "")?.name ?? x.customerName, x.pointsRedeemed, x.pointsDiscount, x.rewardName ?? "", x.rewardDiscount, x.total, x.status]) };
      default:
        return { cols: [], rows: [] };
    }
  })();
  const needle = q.trim().toLowerCase();
  const filtered = needle ? { ...t, rows: t.rows.filter((r) => r.some((c) => String(c).toLowerCase().includes(needle))) } : t;
  return <TableView key={k} t={filtered} title={title} />;
}
