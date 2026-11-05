"use client";

import { useMemo, useState } from "react";
import { rupee } from "@/lib/money";
import { pointsValue, shopDate } from "@/lib/loyalty/engine";
import type { LoyaltyState } from "@/lib/loyalty/types";
import { useAdmin } from "../Store";
import { Btn, Card, cx, downloadExcel, fmtDate, fmtDateTime } from "../kit";
import { Stat } from "./shared";
import { MSG_LABEL } from "./notify";
import { LEDGER_LABEL } from "./shared";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(2, 4)}`;

/** A plain overview of the loyalty programme: this month, the last six months of points, who the best customers are,
    the free gifts given, and what still needs doing (messages to send, points about to expire). */
export default function Dashboard({ d, onOpen }: { d: LoyaltyState; onOpen: (tab: "customers" | "rewards") => void }) {
  const { s, now } = useAdmin();
  const cfg = d.config;
  const thisMonth = shopDate(now).slice(0, 7);

  const x = useMemo(() => {
    const nameOf = new Map(d.customers.map((c) => [c.phone, c.name]));
    // free gifts from paid bills
    const gifts: { at: number; invoice: string; item: string; qty: number; who: string }[] = [];
    const byItem = new Map<string, number>();
    for (const b of s.bills) {
      if (b.status !== "completed") continue;
      for (const i of b.items) {
        if (!i.free) continue;
        gifts.push({ at: b.createdAt, invoice: b.invoiceNo, item: i.name, qty: i.qty, who: nameOf.get(b.customerPhone) ?? (b.customerName && b.customerName !== "Walk-in customer" ? b.customerName : "Walk-in") });
        byItem.set(i.name, (byItem.get(i.name) ?? 0) + i.qty);
      }
    }
    gifts.sort((a, b) => b.at - a.at);
    const monthGifts = gifts.filter((g) => shopDate(g.at).startsWith(thisMonth)).reduce((a, g) => a + g.qty, 0);
    const byPoints = [...d.customers].sort((a, b) => b.available - a.available).slice(0, 5);
    const bySpend = [...d.customers].sort((a, b) => (d.spend[b.id] ?? 0) - (d.spend[a.id] ?? 0)).slice(0, 5);
    const months = d.months.slice(-6);
    const m = d.months.find((r) => r.month === thisMonth) ?? { earned: 0, redeemed: 0 };
    const newThisMonth = d.customers.filter((c) => shopDate(c.createdAt).startsWith(thisMonth)).length;
    const waiting = d.vouchers.filter((v) => v.status === "issued" && v.kind === "free_item").length;
    const msg = { pending: d.messages.filter((r) => r.status === "pending").length, opened: d.messages.filter((r) => r.status === "opened").length, failed: d.messages.filter((r) => r.status === "failed").length };
    const expiring = Object.entries(d.expiring).map(([id, v]) => ({ c: d.customers.find((c) => c.id === id), ...v })).filter((r) => r.c);
    return { gifts, byItem: [...byItem].sort((a, b) => b[1] - a[1]).slice(0, 5), monthGifts, byPoints, bySpend, months, m, newThisMonth, waiting, msg, expiring };
  }, [d, s.bills, thisMonth]);

  const [busy, setBusy] = useState(false);
  const day = new Date().toISOString().slice(0, 10);
  const nameOf = (id: string) => d.customers.find((c) => c.id === id)?.name ?? "";

  /* one workbook with the whole picture: totals, months, customers, gifts given, messages */
  const exportAll = () =>
    downloadExcel(`loyalty-dashboard-${day}`, [
      {
        name: "Summary",
        rows: [
          ["Loyalty customers", d.customers.length],
          ["Points earned (all time)", d.totals.earned],
          ["Points redeemed (all time)", d.totals.redeemed],
          ["Available points", d.totals.outstanding],
          ["Value of available points (₹)", liability],
          ["Free gifts given", d.totals.giftsGiven],
          ["Unlocked gifts waiting", x.waiting],
          ["New customers this month", x.newThisMonth],
          ["Points earned this month", x.m.earned],
          ["Points redeemed this month", x.m.redeemed],
          ["Free gifts this month", x.monthGifts],
          ["WhatsApp messages ready to send", x.msg.pending],
          ["WhatsApp messages opened", x.msg.opened],
          ["WhatsApp messages failed", x.msg.failed],
        ],
      },
      { name: "Points by month", rows: [["Month", "Earned", "Redeemed"], ...d.months.map((r) => [r.month, r.earned, r.redeemed])] },
      { name: "Customers", rows: [["Customer", "Mobile", "Available points", "Points earned", "Points redeemed", "Total purchases (₹)"], ...d.customers.map((c) => [c.name, c.phone, c.available, c.lifetime, c.redeemed, d.spend[c.id] ?? 0])] },
      { name: "Free gifts given", rows: [["Date", "Bill", "Gift", "Quantity", "Given to"], ...x.gifts.map((g) => [fmtDate(g.at), g.invoice, g.item, g.qty, g.who])] },
      { name: "Points about to expire", rows: [["Customer", "Points", "Expire on"], ...x.expiring.map((r) => [r.c!.name, r.points, fmtDate(r.expiresAt)])] },
      { name: "WhatsApp messages", rows: [["When", "Customer", "Message", "Status", "Times opened", "Text"], ...d.messages.map((m) => [fmtDateTime(m.createdAt), nameOf(m.customerId), MSG_LABEL[m.type] ?? m.type, m.status === "opened" ? "Opened in WhatsApp" : m.status === "failed" ? "Failed" : "Ready to send", m.opens, m.text])] },
    ]);

  /* every points transaction of every customer */
  const exportLedger = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/admin/loyalty/ledger?size=5000", { cache: "no-store" });
      const j = await r.json();
      const rows = (j.rows ?? []) as { createdAt: number; customerId: string; type: string; balanceBefore: number; points: number; balanceAfter: number; invoiceNo: string | null; description: string; actor: string }[];
      downloadExcel(`points-transactions-${day}`, [{ name: "Points transactions", rows: [["When", "Customer", "Type", "Points before", "Change", "Points after", "Bill", "Note", "By"], ...rows.map((e) => [fmtDateTime(e.createdAt), nameOf(e.customerId), LEDGER_LABEL[e.type] ?? e.type, e.balanceBefore, e.points, e.balanceAfter, e.invoiceNo ?? "", e.description, e.actor])] }]);
    } finally {
      setBusy(false);
    }
  };

  const max = Math.max(...x.months.flatMap((r) => [r.earned, r.redeemed]), 1);
  const liability = pointsValue(d.totals.outstanding, cfg);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap justify-end gap-2">
        <Btn icon="download" onClick={exportAll}>
          Excel · whole dashboard
        </Btn>
        <Btn icon="download" onClick={exportLedger} disabled={busy}>
          {busy ? "Preparing…" : "Excel · all points transactions"}
        </Btn>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="New customers this month" value={x.newThisMonth} />
        <Stat label="Points earned this month" value={x.m.earned.toLocaleString("en-IN")} tone="green" />
        <Stat label="Points redeemed this month" value={x.m.redeemed.toLocaleString("en-IN")} tone="red" />
        <Stat label="Free gifts this month" value={x.monthGifts} hint={`${x.waiting} unlocked, waiting to be claimed`} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card title="Points, last 6 months">
          {!x.months.length ? (
            <p className="py-8 text-center text-[13px] text-slate-400">Points will appear here after the first loyalty bill.</p>
          ) : (
            <>
              <div className="mb-3 flex gap-4 text-[11.5px] font-semibold text-slate-600">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-red-600" /> Earned
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-slate-400" /> Redeemed
                </span>
              </div>
              <div className="flex items-end gap-2" style={{ height: 170 }} role="img" aria-label={x.months.map((r) => `${monthLabel(r.month)}: earned ${r.earned}, redeemed ${r.redeemed}`).join("; ")}>
                {x.months.map((r) => (
                  <div key={r.month} className="flex h-full flex-1 items-end justify-center gap-[3px]" title={`${monthLabel(r.month)} · earned ${r.earned} · redeemed ${r.redeemed}`}>
                    <div className="w-3 rounded-t-[3px] bg-red-600" style={{ height: `${(r.earned / max) * 90}%` }} />
                    <div className="w-3 rounded-t-[3px] bg-slate-400" style={{ height: `${(r.redeemed / max) * 90}%` }} />
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-2 border-t border-slate-100 pt-2">
                {x.months.map((r) => (
                  <span key={r.month} className="flex-1 text-center text-[10.5px] font-semibold uppercase text-slate-500">
                    {monthLabel(r.month)}
                  </span>
                ))}
              </div>
            </>
          )}
        </Card>

        <Card title="What needs doing">
          <ul className="space-y-2.5 text-[13px]">
            <Todo n={x.msg.pending} ok="No WhatsApp messages waiting" text={`WhatsApp message${x.msg.pending === 1 ? "" : "s"} ready to send`} onClick={() => onOpen("customers")} />
            <Todo n={x.msg.failed} ok="No failed messages" text={`message${x.msg.failed === 1 ? "" : "s"} failed — fix the number and retry`} bad onClick={() => onOpen("customers")} />
            <Todo n={x.waiting} ok="No unlocked gifts waiting" text={`unlocked gift${x.waiting === 1 ? "" : "s"} not claimed yet`} onClick={() => onOpen("customers")} />
            <Todo n={x.expiring.length} ok="No points about to expire" text={`customer${x.expiring.length === 1 ? "" : "s"} with points about to expire`} onClick={() => onOpen("customers")} />
          </ul>
          <p className="mt-4 rounded-xl bg-slate-50 px-3.5 py-2.5 text-[12.5px] text-slate-600">
            Customers hold <b>{d.totals.outstanding.toLocaleString("en-IN")}</b> points, worth <b>{rupee(liability)}</b> if all were used. WhatsApp messages: {x.msg.opened} opened, {x.msg.pending} waiting.
          </p>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Top customers by points">
          <Ranked rows={x.byPoints.map((c) => ({ key: c.id, name: c.name, sub: c.phone, value: `${c.available} pts` }))} />
        </Card>
        <Card title="Top customers by spending">
          <Ranked rows={x.bySpend.map((c) => ({ key: c.id, name: c.name, sub: c.phone, value: rupee(d.spend[c.id] ?? 0) }))} />
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Free gifts given" right={<button type="button" onClick={() => onOpen("rewards")} className="text-[12px] font-bold text-red-600 hover:underline">Manage gifts</button>}>
          {!x.gifts.length ? (
            <p className="py-6 text-center text-[13px] text-slate-400">No free gifts have been given yet.</p>
          ) : (
            <>
              <p className="mb-2 text-[12.5px] text-slate-600">
                <b>{d.totals.giftsGiven}</b> in total{x.byItem.length ? ` · most given: ${x.byItem.map(([n, q]) => `${n} (${q})`).join(", ")}` : ""}
              </p>
              <ul className="divide-y divide-slate-100">
                {x.gifts.slice(0, 6).map((g, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                    <span className="min-w-0 truncate">
                      <b>
                        {g.qty} × {g.item}
                      </b>{" "}
                      <span className="text-slate-500">to {g.who}</span>
                    </span>
                    <span className="shrink-0 text-[11.5px] text-slate-500">
                      {g.invoice} · {fmtDate(g.at)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
        <Card title="Points about to expire">
          {!x.expiring.length ? (
            <p className="py-6 text-center text-[13px] text-slate-400">{cfg.expiry.days > 0 ? "Nobody has points expiring soon." : "Points never expire (you can change this in Settings)."}</p>
          ) : (
            <Ranked rows={x.expiring.map((r) => ({ key: r.c!.id, name: r.c!.name, sub: `expire ${fmtDate(r.expiresAt)}`, value: `${r.points} pts` }))} />
          )}
        </Card>
      </div>

      <Card title="Latest WhatsApp messages">
        {!d.messages.length ? (
          <p className="py-6 text-center text-[13px] text-slate-400">No messages yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {d.messages.slice(0, 6).map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                <span className="min-w-0 truncate">
                  <b>{MSG_LABEL[m.type] ?? m.type}</b> <span className="text-slate-500">· {d.customers.find((c) => c.id === m.customerId)?.name ?? "customer"}</span>
                </span>
                <span className={cx("shrink-0 text-[11.5px] font-bold", m.status === "failed" ? "text-red-600" : m.status === "opened" ? "text-sky-700" : "text-amber-700")}>{m.status === "opened" ? "Opened in WhatsApp" : m.status === "failed" ? "Failed" : "Ready to send"}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Todo({ n, ok, text, bad, onClick }: { n: number; ok: string; text: string; bad?: boolean; onClick: () => void }) {
  if (!n) return <li className="text-slate-400">✓ {ok}</li>;
  return (
    <li>
      <button type="button" onClick={onClick} className={cx("text-left font-semibold hover:underline", bad ? "text-red-600" : "text-amber-700")}>
        {n} {text}
      </button>
    </li>
  );
}

function Ranked({ rows }: { rows: { key: string; name: string; sub: string; value: string }[] }) {
  if (!rows.length) return <p className="py-6 text-center text-[13px] text-slate-400">Nobody yet.</p>;
  return (
    <ol className="divide-y divide-slate-100">
      {rows.map((r, i) => (
        <li key={r.key} className="flex items-center justify-between gap-3 py-2 text-[13px]">
          <span className="min-w-0 truncate">
            <b className="mr-2 text-slate-400">{i + 1}</b>
            <b className="text-slate-900">{r.name}</b> <span className="text-slate-500">{r.sub}</span>
          </span>
          <b className="adm-num shrink-0 text-slate-900">{r.value}</b>
        </li>
      ))}
    </ol>
  );
}
