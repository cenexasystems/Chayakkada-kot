"use client";

import { useMemo, useState } from "react";
import { rupee, round2 } from "@/lib/money";
import { segmentOf, SEGMENTS, tierByKey } from "@/lib/loyalty/engine";
import type { LoyaltyState, Segment } from "@/lib/loyalty/types";
import type { RewardKind } from "@/lib/loyalty/config";
import { useAdmin } from "../Store";
import { waLink } from "../receipt";
import { Badge, Btn, Empty, Field, Modal, SearchBox, cx, downloadExcel, fmtDate, inputLineCls } from "../kit";
import { OfferSend } from "./OfferSend";
import { Pager, Stat, TierBadge, tableWrap, td, th, usePaged, useStatsByPhone } from "./shared";

const DAY = 86_400_000;

/* Customer intelligence from every bill with a mobile — members or not. */
export default function Crm({ d }: { d: LoyaltyState }) {
  const { s, now } = useAdmin();
  const cfg = d.config;
  const stats = useStatsByPhone(s.bills, cfg.crm.frequentDays);
  const [q, setQ] = useState("");
  const [seg, setSeg] = useState<Segment | "">("");
  const [members, setMembers] = useState<"" | "yes" | "no">("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [granting, setGranting] = useState(false);
  const [msgTo, setMsgTo] = useState<{ phone: string; name: string } | null>(null);

  const all = useMemo(() => {
    const byPhone = new Map(d.customers.map((c) => [c.phone, c]));
    return [...stats.entries()]
      .filter(([, st]) => st.orders > 0)
      .map(([phone, st]) => {
        const m = byPhone.get(phone) ?? null;
        const counts = new Map<string, number>();
        for (const b of st.bills) if (b.status === "completed") for (const i of b.items) counts.set(i.name, (counts.get(i.name) ?? 0) + i.qty);
        const fav = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n);
        const spanDays = st.first && st.last ? Math.max(1, (st.last - st.first) / DAY) : 1;
        return { phone, name: m?.name || st.name || "—", st, m, seg: segmentOf(st, cfg, m?.tier ?? null, now), fav, perMonth: round2((st.visits / spanDays) * 30) };
      });
  }, [stats, d.customers, cfg, now]);

  const rows = all
    .filter((r) => (!seg || r.seg === seg) && (!members || (members === "yes" ? !!r.m : !r.m)) && (!q || r.name.toLowerCase().includes(q.toLowerCase()) || r.phone.includes(q)))
    .sort((a, b) => b.st.spent - a.st.spent);
  const pg = usePaged(rows, 25);

  // retention: of customers who visited 30–60 days ago, how many came back in the last 30 days
  const m = useMemo(() => {
    const prev = new Set<string>();
    const recent = new Set<string>();
    for (const b of s.bills) {
      if (b.status !== "completed" || !b.customerPhone) continue;
      const age = (now - b.createdAt) / DAY;
      if (age <= 30) recent.add(b.customerPhone);
      else if (age <= 60) prev.add(b.customerPhone);
    }
    const kept = [...prev].filter((p) => recent.has(p)).length;
    const repeat = all.filter((r) => r.st.visits >= 2).length;
    return { retention: prev.size ? Math.round((kept / prev.size) * 100) : null, repeat: all.length ? Math.round((repeat / all.length) * 100) : 0, risk: all.filter((r) => r.seg === "at_risk" || r.seg === "inactive").length, clv: all.length ? round2(all.reduce((a, r) => a + r.st.spent, 0) / all.length) : 0 };
  }, [s.bills, all, now]);

  const counts = new Map<Segment, number>();
  for (const r of all) if (r.seg) counts.set(r.seg, (counts.get(r.seg) ?? 0) + 1);
  const pickable = rows.filter((r) => r.m && r.m.status === "active");
  const pickedMembers = d.customers.filter((c) => picked.has(c.id));

  const exportRows = () =>
    downloadExcel(`customer-segments-${new Date().toISOString().slice(0, 10)}`, [
      ["Name", "Mobile", "Member", "Member ID", "Tier", "Segment", "Orders", "Visits", "Visits / month", "Total spent (CLV)", "Avg bill", "First visit", "Last visit", "Days since visit", "Favourite items", "Marketing OK"],
      ...rows.map((r) => [r.name, r.phone, r.m ? "Yes" : "No", r.m?.code ?? "", r.m ? tierByKey(r.m.tier, cfg).name : "", SEGMENTS.find((x) => x.key === r.seg)?.label ?? "", r.st.orders, r.st.visits, r.perMonth, r.st.spent, r.st.aov, r.st.first ? fmtDate(r.st.first) : "", r.st.last ? fmtDate(r.st.last) : "", r.st.last ? Math.floor((now - r.st.last) / DAY) : "", r.fav.join(", "), r.m ? (r.m.consent ? "Yes" : "No") : ""]),
    ]);

  const sel = "h-10 rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-700 outline-none focus:border-slate-400";
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Customers with a mobile" value={all.length} hint={`${d.customers.length} are loyalty members`} />
        <Stat label="Repeat purchase rate" value={`${m.repeat}%`} hint="came back at least once" tone="green" />
        <Stat label="30-day retention" value={m.retention === null ? "—" : `${m.retention}%`} hint="of last month's customers returned" />
        <Stat label="Churn risk" value={m.risk} hint={`at risk (${cfg.crm.atRiskDays}+ days) or inactive (${cfg.crm.inactiveDays}+)`} tone="red" />
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setSeg("")} className={cx("h-8 rounded-lg border px-3 text-[12px] font-bold", !seg ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 text-slate-600")}>
          All · {all.length}
        </button>
        {SEGMENTS.map((x) => (
          <button key={x.key} type="button" onClick={() => setSeg(x.key)} className={cx("h-8 rounded-lg border px-3 text-[12px] font-bold", seg === x.key ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 text-slate-600")}>
            {x.label} · {counts.get(x.key) ?? 0}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={q} onChange={setQ} placeholder="Search name or mobile…" className="h-10 min-w-[200px] flex-1 rounded-xl" />
        <select className={sel} value={members} onChange={(e) => setMembers(e.target.value as typeof members)} aria-label="Membership">
          <option value="">Members & non-members</option>
          <option value="yes">Loyalty members</option>
          <option value="no">Not members</option>
        </select>
        <Btn icon="download" onClick={exportRows} disabled={!rows.length}>
          Export segment
        </Btn>
        <Btn kind="dark" icon="star" disabled={!pickable.length} onClick={() => (setPicked(new Set(pickable.map((r) => r.m!.id))), setGranting(true))}>
          Reward these {pickable.length} members
        </Btn>
      </div>
      <p className="-mt-2 text-[11.5px] text-slate-400">
        Average customer lifetime value {rupee(m.clv)}. Segments: new = first visit in the last {cfg.crm.newDays} days; regular = {cfg.crm.regularVisits}+ visits; frequent = {cfg.crm.frequentVisits}+ visits in {cfg.crm.frequentDays} days; high value = {rupee(cfg.crm.highValue)}+; VIP = Platinum or {rupee(cfg.crm.vipSpend)}+; lost after {cfg.crm.lostDays} days. Change these in Settings.
      </p>

      {!rows.length ? (
        <Empty icon="users" title="No customers here">
          Customers appear once a bill is saved with their mobile number.
        </Empty>
      ) : (
        <>
          <div className={tableWrap}>
            <table className="w-full min-w-[900px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className={th}>Customer</th>
                  <th className={th}>Segment</th>
                  <th className={cx(th, "text-right")}>Visits</th>
                  <th className={cx(th, "text-right")}>Spent</th>
                  <th className={cx(th, "text-right")}>Avg bill</th>
                  <th className={th}>Last visit</th>
                  <th className={th}>Favourites</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pg.rows.map((r) => {
                  const sm = SEGMENTS.find((x) => x.key === r.seg);
                  const days = r.st.last ? Math.floor((now - r.st.last) / DAY) : null;
                  return (
                    <tr key={r.phone}>
                      <td className={td}>
                        <b className="block text-slate-900">{r.name}</b>
                        <span className="text-[11.5px] text-slate-500">{r.phone}</span>
                        {r.m && (
                          <span className="ml-2">
                            <TierBadge tier={r.m.tier} name={tierByKey(r.m.tier, cfg).name} />
                          </span>
                        )}
                      </td>
                      <td className={td}>{sm && <Badge tone={sm.tone}>{sm.label}</Badge>}</td>
                      <td className={cx(td, "adm-num text-right")}>
                        {r.st.visits}
                        <span className="block text-[10.5px] text-slate-400">{r.perMonth}/mo</span>
                      </td>
                      <td className={cx(td, "adm-num text-right font-semibold")}>{rupee(r.st.spent)}</td>
                      <td className={cx(td, "adm-num text-right")}>{rupee(r.st.aov)}</td>
                      <td className={td}>
                        {r.st.last ? fmtDate(r.st.last) : "—"}
                        {days !== null && <span className="block text-[10.5px] text-slate-400">{days} days ago</span>}
                      </td>
                      <td className={cx(td, "max-w-[220px] truncate text-[12px]")}>{r.fav.join(", ")}</td>
                      <td className={td}>
                        {(!r.m || r.m.consent) && (
                          <button type="button" onClick={() => setMsgTo({ phone: r.phone, name: r.name !== "—" ? r.name : "" })} className="text-[12px] font-bold text-emerald-700 hover:underline">
                            WhatsApp
                          </button>
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
      {granting && <GrantModal ids={pickedMembers.map((c) => c.id)} label={seg ? SEGMENTS.find((x) => x.key === seg)!.label : "selected"} onClose={() => setGranting(false)} />}
      {msgTo && <MessageModal to={msgTo} shop={s.settings.shopName} onClose={() => setMsgTo(null)} />}
    </div>
  );
}

/* The customer message, editable before WhatsApp opens. The wording is remembered on
   this device, with {name} and {shop} filled in for each customer. */
const MSG_KEY = "clc-crm-message";
const DEFAULT_MSG = "Hi {name}! We miss you at {shop} — come by soon!";

function MessageModal({ to, shop, onClose }: { to: { phone: string; name: string }; shop: string; onClose: () => void }) {
  const [tpl, setTpl] = useState(() => {
    try {
      return localStorage.getItem(MSG_KEY) || DEFAULT_MSG;
    } catch {
      return DEFAULT_MSG;
    }
  });
  const text = tpl.replaceAll("{name}", to.name).replaceAll("{shop}", shop).replace(/Hi !/, "Hi!").trim();
  const send = () => {
    try {
      localStorage.setItem(MSG_KEY, tpl);
    } catch {}
    window.open(waLink(to.phone, text), "_blank", "noopener,noreferrer");
    onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Message ${to.name || to.phone}`}
      footer={
        <>
          <Btn kind="plain" onClick={() => setTpl(DEFAULT_MSG)}>
            Reset wording
          </Btn>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind="green" disabled={!text} onClick={send}>
            Open WhatsApp
          </Btn>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Message" hint="{name} and {shop} are filled in for each customer. Your wording is remembered for next time.">
          <textarea className={cx(inputLineCls, "h-32 resize-y py-2.5 leading-relaxed")} value={tpl} maxLength={1000} onChange={(e) => setTpl(e.target.value)} />
        </Field>
        <div>
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">Preview</span>
          <p className="whitespace-pre-wrap rounded-xl bg-emerald-50 px-3.5 py-2.5 text-[13px] text-slate-800">{text || "—"}</p>
        </div>
      </div>
    </Modal>
  );
}

function GrantModal({ ids, label, onClose }: { ids: string[]; label: string; onClose: () => void }) {
  const { s, act, toast } = useAdmin();
  const [f, setF] = useState({ reason: "", points: "", kind: "" as RewardKind | "", rewardName: "", value: "", productId: "", validityDays: "30" });
  const [busy, setBusy] = useState(false);
  const [tell, setTell] = useState(false);
  const go = async () => {
    setBusy(true);
    const r = await act<{ customers: number }>("loyalty.grant", { customerIds: ids, ...f, kind: f.kind || null });
    setBusy(false);
    if (r.ok) {
      toast({ kind: "ok", title: `Sent to ${r.result.customers} members` });
      setTell(true); // next: tell them on WhatsApp
    }
  };
  if (tell) {
    const pts = Number(f.points) || 0;
    return (
      <OfferSend
        title="Tell these members on WhatsApp"
        who="this gift"
        template={`Hi {name}! 🎁 {shop} has added a gift to your loyalty account: ${f.reason.trim()}.${pts ? ` +${pts} bonus points.` : ""}${f.kind ? ` You also get: ${f.rewardName.trim() || "a reward"}.` : ""} See it in your wallet.`}
        filter={({ customer }) => ids.includes(customer.id)}
        onClose={onClose}
      />
    );
  }
  return (
    <Modal open onClose={onClose} title={`Targeted campaign · ${ids.length} ${label} members`} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="red" disabled={busy || !f.reason.trim() || (!Number(f.points) && !f.kind)} onClick={go}>{busy ? "Sending…" : "Give to all"}</Btn></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Campaign name *" className="sm:col-span-2" hint="Shows on each member's history">
          <input className={inputLineCls} value={f.reason} maxLength={200} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. We miss you — 50 bonus points" />
        </Field>
        <Field label="Bonus points">
          <input className={inputLineCls} type="number" min={0} value={f.points} onChange={(e) => setF({ ...f, points: e.target.value })} placeholder="0" />
        </Field>
        <Field label="And/or a reward">
          <select className={inputLineCls} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as RewardKind | "" })}>
            <option value="">No reward</option>
            <option value="amount">₹ off</option>
            <option value="percent">% off</option>
            <option value="free_item">Free item</option>
          </select>
        </Field>
        {f.kind && (
          <>
            <Field label="Reward name">
              <input className={inputLineCls} value={f.rewardName} maxLength={80} onChange={(e) => setF({ ...f, rewardName: e.target.value })} placeholder="e.g. Free chai" />
            </Field>
            {f.kind === "free_item" ? (
              <Field label="Item">
                <select className={inputLineCls} value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })}>
                  <option value="">Pick…</option>
                  {s.products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field label={f.kind === "percent" ? "Percent off" : "Rupees off"}>
                <input className={inputLineCls} type="number" min={1} value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
              </Field>
            )}
            <Field label="Valid for (days)">
              <input className={inputLineCls} type="number" min={1} value={f.validityDays} onChange={(e) => setF({ ...f, validityDays: e.target.value })} />
            </Field>
          </>
        )}
        <p className="text-[11.5px] text-slate-400 sm:col-span-2">Only active members get it. Messaging stays manual — use the WhatsApp links, which respect each member&apos;s marketing preference.</p>
      </div>
    </Modal>
  );
}
