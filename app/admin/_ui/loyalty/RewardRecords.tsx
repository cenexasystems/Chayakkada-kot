"use client";

import { useMemo, useState } from "react";
import { rupee } from "@/lib/money";
import { rewardLabel } from "@/lib/loyalty/engine";
import type { LoyaltyState, Voucher, VoucherSource, VoucherStatus } from "@/lib/loyalty/types";
import { useAdmin } from "../Store";
import { Badge, Empty, SearchBox, cx, downloadExcel, fmtDate, fmtDateTime } from "../kit";
import { Pager, Stat, tableWrap, td, th, usePaged } from "./shared";

/* Every reward a member has earned — who, which, how they got it, and what became of it
   (waiting to be used, used on a bill, expired or cancelled). */

const SOURCE: Record<VoucherSource, string> = {
  birthday: "Birthday",
  anniversary: "Anniversary",
  milestone: "Visit stamps",
  campaign: "Campaign gift",
  points: "Bought with points",
  manual: "Given by staff",
};
const STATUS: Record<VoucherStatus, { label: string; tone: "green" | "amber" | "slate" | "red" }> = {
  issued: { label: "Waiting to be used", tone: "amber" },
  used: { label: "Used", tone: "green" },
  expired: { label: "Expired", tone: "slate" },
  cancelled: { label: "Cancelled", tone: "red" },
};

export default function RewardRecords({ d }: { d: LoyaltyState }) {
  const { s } = useAdmin();
  const [status, setStatus] = useState<"all" | VoucherStatus>("all");
  const [source, setSource] = useState<"all" | VoucherSource>("all");
  const [q, setQ] = useState("");

  const who = useMemo(() => new Map(d.customers.map((c) => [c.id, c])), [d.customers]);
  const product = useMemo(() => new Map(s.products.map((p) => [p.id, p.name])), [s.products]);
  const billOff = useMemo(() => new Map(s.bills.map((b) => [b.id, b.rewardDiscount])), [s.bills]);

  // the reward's name, plus what it gives — unless the name already says so ("Birthday treat — 15% off")
  const what = (v: Voucher) => {
    const gives = rewardLabel(v.kind, v.value, v.productId ? product.get(v.productId) : undefined);
    return v.name.toLowerCase().includes(gives.toLowerCase()) ? v.name : `${v.name} · ${gives}`;
  };
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return [...d.vouchers]
      .sort((a, b) => b.issuedAt - a.issuedAt)
      .filter((v) => (status === "all" || v.status === status) && (source === "all" || v.source === source))
      .filter((v) => {
        if (!n) return true;
        const m = who.get(v.customerId);
        return `${m?.name ?? ""} ${m?.phone ?? ""} ${v.name} ${v.ref} ${v.invoiceNo ?? ""}`.toLowerCase().includes(n);
      });
  }, [d.vouchers, status, source, q, who]);
  const pg = usePaged(rows, 20);

  const count = (st: VoucherStatus) => d.vouchers.filter((v) => v.status === st).length;
  const off = (v: Voucher) => (v.billId ? billOff.get(v.billId) ?? 0 : 0);

  const exportRows = () =>
    downloadExcel(`reward-records-${new Date().toISOString().slice(0, 10)}.xlsx`, [
      {
        name: "Rewards earned",
        rows: [
          ["Earned on", "Member", "Mobile", "Reward", "What it gives", "How they got it", "Note", "Code", "Cost in points", "Status", "Valid till", "Used on", "Used on invoice", "Money off the bill"],
          ...rows.map((v) => {
            const m = who.get(v.customerId);
            return [fmtDateTime(v.issuedAt), m?.name ?? "", m?.phone ?? "", v.name, rewardLabel(v.kind, v.value, v.productId ? product.get(v.productId) : undefined), SOURCE[v.source], v.note, v.ref, v.pointsCost, STATUS[v.status].label, v.expiresAt ? fmtDate(v.expiresAt) : "No expiry", v.usedAt ? fmtDateTime(v.usedAt) : "", v.invoiceNo ?? "", off(v)];
          }),
        ],
      },
    ]);

  const chip = (on: boolean) => cx("h-8 whitespace-nowrap rounded-full px-3.5 text-[12px] font-bold transition", on ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200");
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Rewards earned" value={d.vouchers.length} hint="All rewards ever given" note="Every reward a member has been given: birthday treats, visit-stamp rewards, campaign gifts and rewards bought with points." />
        <Stat label="Used" value={count("used")} tone="green" hint={`${rupee(d.totals.rewardDiscounts)} taken off bills`} note="Rewards that have been used on a bill." />
        <Stat label="Waiting to be used" value={count("issued")} tone="amber" note="Earned but not used yet — they expire on the date shown in the list." />
        <Stat label="Expired / cancelled" value={count("expired") + count("cancelled")} note="Not used in time, or cancelled by staff or because a bill was voided." />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {(["all", "issued", "used", "expired", "cancelled"] as const).map((k) => (
            <button key={k} type="button" className={chip(status === k)} onClick={() => setStatus(k)}>
              {k === "all" ? "All" : STATUS[k].label}
            </button>
          ))}
        </div>
        <select className="h-9 rounded-full border border-slate-200 bg-white px-3 text-[12.5px] font-semibold text-slate-700 outline-none" value={source} onChange={(e) => setSource(e.target.value as typeof source)} aria-label="How they got it">
          <option value="all">Any way of earning</option>
          {(Object.keys(SOURCE) as VoucherSource[]).map((k) => (
            <option key={k} value={k}>
              {SOURCE[k]}
            </option>
          ))}
        </select>
        <SearchBox value={q} onChange={setQ} placeholder="Member, mobile, reward, code…" className="w-full sm:ml-auto sm:w-64" />
        <button type="button" onClick={exportRows} disabled={!rows.length} className="inline-flex items-center gap-1.5 text-[13px] font-bold text-emerald-700 hover:underline disabled:opacity-40">
          Download Excel
        </button>
      </div>

      {!rows.length ? (
        <Empty icon="star" title={d.vouchers.length ? "No rewards match" : "No rewards earned yet"}>
          {d.vouchers.length ? "Try a different filter." : "Rewards appear here as members earn them — on their birthday, at visit milestones, from campaigns, or by spending points."}
        </Empty>
      ) : (
        <>
          <div className={tableWrap}>
            <table className="w-full min-w-[860px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className={th}>Earned on</th>
                  <th className={th}>Member</th>
                  <th className={th}>Reward</th>
                  <th className={th}>How they got it</th>
                  <th className={th}>Status</th>
                  <th className={th}>Valid till / used</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pg.rows.map((v) => {
                  const m = who.get(v.customerId);
                  const st = STATUS[v.status];
                  return (
                    <tr key={v.id}>
                      <td className={cx(td, "whitespace-nowrap")}>{fmtDateTime(v.issuedAt)}</td>
                      <td className={td}>
                        <b className="block text-slate-900">{m?.name ?? "—"}</b>
                        <span className="text-[11.5px] text-slate-500">{m?.phone}</span>
                      </td>
                      <td className={td}>
                        <b className="block text-slate-900">{what(v)}</b>
                        <span className="font-mono text-[11px] text-slate-500">{v.ref}</span>
                      </td>
                      <td className={td}>
                        {SOURCE[v.source]}
                        <span className="block text-[11.5px] text-slate-500">{v.pointsCost > 0 ? `cost ${v.pointsCost} pts` : v.note || "free"}</span>
                      </td>
                      <td className={td}>
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </td>
                      <td className={cx(td, "whitespace-nowrap")}>
                        {v.status === "used" ? (
                          <>
                            {v.usedAt ? fmtDate(v.usedAt) : ""}
                            <span className="block text-[11.5px] text-slate-500">
                              {v.invoiceNo} · {rupee(off(v))} off
                            </span>
                          </>
                        ) : v.expiresAt ? (
                          fmtDate(v.expiresAt)
                        ) : (
                          "No expiry"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pager page={pg.page} pages={pg.pages} onPage={pg.setPage} total={pg.total} />
        </>
      )}
    </div>
  );
}
