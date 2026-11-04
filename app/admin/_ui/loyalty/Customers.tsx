"use client";

import { useEffect, useMemo, useState } from "react";
import { rupee } from "@/lib/money";
import { nextTier, pointsValue, segmentOf, SEGMENTS, tierByKey, voucherLive } from "@/lib/loyalty/engine";
import type { LedgerEntry, LoyaltyCustomer, LoyaltyState, Voucher } from "@/lib/loyalty/types";
import type { Bill } from "@/lib/types";
import { useAdmin } from "../Store";
import { waLink } from "../receipt";
import { EnrolledStep } from "./billing";
import { MemberUpdate, type MemberNotice } from "./notify";
import { Badge, Btn, Drawer, Empty, Field, Icon, Modal, SearchBox, WaIcon, cx, downloadExcel, fmtDate, fmtDateTime, inputLineCls } from "../kit";
import { EMPTY_STATS, LEDGER_LABEL, Pager, TierBadge, tableWrap, td, th, usePaged, useStatsByPhone } from "./shared";

export default function Customers({ d, reload }: { d: LoyaltyState; reload: () => void }) {
  const { s, now } = useAdmin();
  const cfg = d.config;
  const stats = useStatsByPhone(s.bills, cfg.crm.frequentDays);
  const [q, setQ] = useState("");
  const [tier, setTier] = useState("");
  const [status, setStatus] = useState("");
  const [seg, setSeg] = useState("");
  const [sort, setSort] = useState<"new" | "points" | "spend" | "visit">("new");
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return d.customers
      .map((c) => {
        const st = stats.get(c.phone) ?? EMPTY_STATS;
        return { c, st, seg: segmentOf(st, cfg, c.tier, now) };
      })
      .filter(({ c, seg: sg }) => (!t || c.name.toLowerCase().includes(t) || c.phone.includes(t) || c.code.toLowerCase().includes(t)) && (!tier || c.tier === tier) && (!status || c.status === status) && (!seg || sg === seg))
      .sort((a, b) => (sort === "points" ? b.c.available - a.c.available : sort === "spend" ? b.st.spent - a.st.spent : sort === "visit" ? (b.st.last ?? 0) - (a.st.last ?? 0) : b.c.createdAt - a.c.createdAt));
  }, [d.customers, stats, q, tier, status, seg, sort, cfg, now]);
  const pg = usePaged(rows, 25);

  const exportRows = () =>
    downloadExcel(`loyalty-members-${new Date().toISOString().slice(0, 10)}`, [
      ["Member ID", "Name", "Mobile", "Email", "Birthday", "Tier", "Status", "Available pts", "Lifetime pts", "Redeemed pts", "Expired pts", "Stamps", "Orders", "Visits", "Spent", "Avg bill", "Last visit", "Segment", "Joined", "Marketing OK"],
      ...rows.map(({ c, st, seg: sg }) => [c.code, c.name, c.phone, c.email, c.birthday, tierByKey(c.tier, cfg).name, c.status, c.available, c.lifetime, c.redeemed, c.expired, c.stamps, st.orders, st.visits, st.spent, st.aov, st.last ? fmtDate(st.last) : "", SEGMENTS.find((x) => x.key === sg)?.label ?? "", fmtDate(c.createdAt), c.consent ? "Yes" : "No"]),
    ]);

  const sel = "h-10 rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-700 outline-none focus:border-slate-400";
  const current = open ? d.customers.find((c) => c.id === open) ?? null : null;
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchBox value={q} onChange={setQ} placeholder="Search name, mobile or member ID…" className="h-10 min-w-[220px] flex-1 rounded-xl" />
        <select className={sel} value={tier} onChange={(e) => setTier(e.target.value)} aria-label="Tier">
          <option value="">All tiers</option>
          {cfg.tiers.map((t) => (
            <option key={t.key} value={t.key}>
              {t.name}
            </option>
          ))}
        </select>
        <select className={sel} value={seg} onChange={(e) => setSeg(e.target.value)} aria-label="Segment">
          <option value="">All segments</option>
          {SEGMENTS.map((x) => (
            <option key={x.key} value={x.key}>
              {x.label}
            </option>
          ))}
        </select>
        <select className={sel} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Active & inactive</option>
          <option value="active">Active</option>
          <option value="inactive">Deactivated</option>
        </select>
        <select className={sel} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
          <option value="new">Newest first</option>
          <option value="points">Most points</option>
          <option value="spend">Top spenders</option>
          <option value="visit">Recent visit</option>
        </select>
        <Btn icon="download" onClick={exportRows} disabled={!rows.length}>
          Export
        </Btn>
        <Btn kind="red" icon="plus" onClick={() => setAdding(true)}>
          Enrol member
        </Btn>
      </div>

      {!rows.length ? (
        <Empty icon="users" title={d.customers.length ? "No members match" : "No members yet"}>
          {d.customers.length ? "Try a different search or filter." : "Enrol your first member — or do it from Billing when you type a mobile number."}
        </Empty>
      ) : (
        <>
          <div className={tableWrap}>
            <table className="w-full min-w-[820px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className={th}>Member</th>
                  <th className={th}>Tier</th>
                  <th className={cx(th, "text-right")}>Points</th>
                  <th className={cx(th, "text-right")}>Visits</th>
                  <th className={cx(th, "text-right")}>Spent</th>
                  <th className={th}>Last visit</th>
                  <th className={th}>Segment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pg.rows.map(({ c, st, seg: sg }) => {
                  const sm = SEGMENTS.find((x) => x.key === sg);
                  return (
                    <tr key={c.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(c.id)}>
                      <td className={td}>
                        <b className="block text-slate-900">{c.name}</b>
                        <span className="text-[11.5px] text-slate-500">
                          {c.phone} · <span className="font-mono">{c.code}</span>
                        </span>
                        {c.status !== "active" && (
                          <Badge tone="red" className="ml-2">
                            Off
                          </Badge>
                        )}
                      </td>
                      <td className={td}>
                        <TierBadge tier={c.tier} name={tierByKey(c.tier, cfg).name} />
                      </td>
                      <td className={cx(td, "adm-num text-right font-bold text-slate-900")}>{c.available}</td>
                      <td className={cx(td, "adm-num text-right")}>{st.visits}</td>
                      <td className={cx(td, "adm-num text-right")}>{rupee(st.spent)}</td>
                      <td className={td}>{st.last ? fmtDate(st.last) : "—"}</td>
                      <td className={td}>{sm ? <Badge tone={sm.tone}>{sm.label}</Badge> : <span className="text-slate-400">No visits</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pager page={pg.page} pages={pg.pages} onPage={pg.setPage} total={pg.total} />
        </>
      )}
      {adding && <RegisterModal onClose={() => setAdding(false)} onDone={(id) => (reload(), setOpen(id))} />}
      <Drawer open={!!current} onClose={() => setOpen(null)}>
        {current && <Profile key={current.id} c={current} d={d} bills={stats.get(current.phone)?.bills ?? []} onClose={() => setOpen(null)} />}
      </Drawer>
    </div>
  );
}

function RegisterModal({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const { act, toast } = useAdmin();
  const [f, setF] = useState({ phone: "", name: "", email: "", birthday: "", anniversary: "", referralCode: "", consent: true });
  const [busy, setBusy] = useState(false);
  const [member, setMember] = useState<LoyaltyCustomer | null>(null);
  const save = async () => {
    setBusy(true);
    const r = await act<LoyaltyCustomer>("loyalty.register", f);
    setBusy(false);
    if (r.ok) {
      toast({ kind: "ok", title: `${r.result.name} enrolled — ${r.result.code}` });
      setMember(r.result);
    }
  };
  if (member) return <EnrolledStep member={member} onClose={() => { onClose(); onDone(member.id); }} />;
  return (
    <Modal
      open
      onClose={onClose}
      title="Enrol a loyalty member"
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind="red" disabled={busy || !/^[6-9]\d{9}$/.test(f.phone)} onClick={save}>
            {busy ? "Enrolling…" : "Enrol"}
          </Btn>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Mobile *">
          <input className={inputLineCls} inputMode="numeric" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value.replace(/\D/g, "").slice(-10) })} placeholder="10-digit number" />
        </Field>
        <Field label="Name" hint="Blank uses the name on their earlier bills">
          <input className={inputLineCls} value={f.name} maxLength={60} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Birthday">
          <input className={inputLineCls} type="date" value={f.birthday} onChange={(e) => setF({ ...f, birthday: e.target.value })} />
        </Field>
        <Field label="Anniversary">
          <input className={inputLineCls} type="date" value={f.anniversary} onChange={(e) => setF({ ...f, anniversary: e.target.value })} />
        </Field>
        <Field label="Email">
          <input className={inputLineCls} type="email" value={f.email} maxLength={120} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="Optional" />
        </Field>
        <Field label="Referral code">
          <input className={cx(inputLineCls, "uppercase")} value={f.referralCode} maxLength={20} onChange={(e) => setF({ ...f, referralCode: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} placeholder="If a friend referred them" />
        </Field>
        <label className="flex items-center gap-2 text-[13px] text-slate-700 sm:col-span-2">
          <input type="checkbox" checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} /> Customer agrees to receive offers on WhatsApp
        </label>
      </div>
    </Modal>
  );
}

type Dialog = null | "edit" | "adjust" | "status" | "issue" | { refund: Bill } | { cancel: Voucher };

function Profile({ c, d, bills, onClose }: { c: LoyaltyCustomer; d: LoyaltyState; bills: Bill[]; onClose: () => void }) {
  const { s, role, act, confirm, toast } = useAdmin();
  const admin = role === "admin";
  const cfg = d.config;
  const st = useStatsByPhone(bills, cfg.crm.frequentDays).get(c.phone) ?? EMPTY_STATS;
  const [sec, setSec] = useState<"points" | "rewards" | "bills" | "more">("points");
  const [dlg, setDlg] = useState<Dialog>(null);
  const [ledger, setLedger] = useState<{ rows: LedgerEntry[]; total: number } | null>(null);
  const [lpage, setLpage] = useState(1);
  useEffect(() => {
    let live = true;
    fetch(`/api/admin/loyalty/ledger?customerId=${c.id}&page=${lpage}&size=20`, { cache: "no-store" })
      .then((r) => r.json())
      .then((x) => live && setLedger(x))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [c.id, c.available, c.updatedAt, lpage]);

  const tier = tierByKey(c.tier, cfg);
  const next = nextTier(c.lifetime, cfg);
  const size = cfg.stamps.milestones.at(-1)?.visits ?? 0;
  const pos = c.stamps && size ? ((c.stamps - 1) % size) + 1 : 0;
  const nextMs = cfg.stamps.milestones.find((m) => m.visits > pos);
  const vouchers = d.vouchers.filter((v) => v.customerId === c.id);
  const referrer = c.referredBy ? d.customers.find((x) => x.id === c.referredBy) : null;
  const referred = d.referrals.filter((r) => r.referrerId === c.id);
  const expiring = d.expiringSoon.find((x) => x.customerId === c.id);

  /* Delete the member for good — asks first, and says exactly what goes and what stays */
  const remove = async () => {
    const waiting = vouchers.filter((v) => v.status === "issued").length;
    const yes = await confirm({
      title: `Delete ${c.name} from loyalty?`,
      danger: true,
      ok: "Yes, delete member",
      body: (
        <div className="space-y-2.5 text-[13.5px] leading-relaxed text-slate-700">
          <p>
            <b>{c.name}</b> ({c.phone}) will be removed from the loyalty programme for good.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Their <b>{c.available} points</b> ({rupee(pointsValue(c.available, cfg))}), points history and {c.lifetime} lifetime points are erased.
            </li>
            <li>
              {waiting ? `${waiting} reward${waiting === 1 ? "" : "s"} waiting to be used ${waiting === 1 ? "is" : "are"} lost, and ` : ""}their reward history, visit stamps and referral links are erased.
            </li>
            {bills.length > 0 && (
              <li>
                Their <b>{bills.length} bill{bills.length === 1 ? "" : "s"}</b> stay in Orders and in your sales — they just stop being linked to loyalty.
              </li>
            )}
            <li>Their wallet link stops working.</li>
          </ul>
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] font-semibold text-amber-800">This can&apos;t be undone. If you only want them to stop earning points, use Deactivate instead — it keeps everything.</p>
        </div>
      ),
    });
    if (!yes) return;
    const r = await act("loyalty.delete", { id: c.id });
    if (r.ok) {
      toast({ kind: "ok", title: `${c.name} was deleted from loyalty` });
      onClose();
    }
  };
  const history = d.audit.filter((a) => a.customerId === c.id);
  const base = (s.settings.publicUrl || (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/$/, "");
  const walletLink = `${base}/w/${c.walletToken}`;

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="min-w-0">
          <h2 className="truncate text-[18px] font-bold text-slate-900">{c.name}</h2>
          <p className="text-[12.5px] text-slate-500">
            {c.phone} · <span className="font-mono">{c.code}</span> · joined {fmtDate(c.createdAt)}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <TierBadge tier={c.tier} name={tier.name} />
            {c.status !== "active" && <Badge tone="red">Deactivated</Badge>}
            {!c.consent && <Badge tone="slate">No marketing</Badge>}
            {c.debt > 0 && <Badge tone="red">{c.debt} pts owed from a refund</Badge>}
          </div>
        </div>
        <button type="button" onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-500 hover:bg-slate-100" aria-label="Close">
          <Icon name="x" size={16} />
        </button>
      </div>

      <div className="space-y-4 px-5 py-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            ["Available", c.available, `≈ ${rupee(pointsValue(c.available, cfg))}`],
            ["Lifetime", c.lifetime, ""],
            ["Redeemed", c.redeemed, `${c.expired} expired`],
          ].map(([l, v, h]) => (
            <div key={l as string} className="rounded-xl bg-slate-50 p-2.5">
              <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{l}</span>
              <b className="adm-num block text-[19px] text-slate-900">{v}</b>
              {h && <span className="block text-[10.5px] text-slate-400">{h}</span>}
            </div>
          ))}
        </div>
        {next && (
          <div>
            <div className="mb-1 flex justify-between text-[11.5px] text-slate-500">
              <span>{tier.name}</span>
              <span>
                {next.need} pts to {next.tier.name}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-amber-500" style={{ width: `${Math.min(100, ((c.lifetime - tier.min) / (next.tier.min - tier.min)) * 100)}%` }} />
            </div>
          </div>
        )}
        <p className="text-[12px] text-slate-500">{tier.benefits}</p>
        {expiring && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-[12.5px] font-semibold text-amber-800">
            {expiring.points} pts expire on {fmtDate(expiring.expiresAt)}
          </p>
        )}
        <div className="grid grid-cols-4 gap-2 text-center text-[11.5px]">
          {[
            ["Orders", st.orders],
            ["Visits", st.visits],
            ["Spent", rupee(st.spent)],
            ["Avg bill", rupee(st.aov)],
          ].map(([l, v]) => (
            <div key={l as string} className="rounded-xl border border-slate-100 p-2">
              <span className="block text-slate-500">{l}</span>
              <b className="adm-num text-[13px] text-slate-900">{v}</b>
            </div>
          ))}
        </div>
        <p className="text-[12px] text-slate-500">Last visit: {st.last ? fmtDateTime(st.last) : "never"}</p>
        {cfg.stamps.enabled && size > 0 && (
          <div>
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">Visit stamps</span>
            <div className="flex flex-wrap gap-1">
              {Array.from({ length: size }, (_, i) => (
                <span key={i} className={cx("grid h-6 w-6 place-items-center rounded-full border text-[10px] font-bold", i < pos ? "border-red-600 bg-red-600 text-white" : cfg.stamps.milestones.some((m) => m.visits === i + 1) ? "border-amber-400 text-amber-600" : "border-slate-200 text-slate-400")}>
                  {i + 1}
                </span>
              ))}
            </div>
            {nextMs && (
              <p className="mt-1 text-[11.5px] text-slate-500">
                {nextMs.visits - pos} more visit{nextMs.visits - pos === 1 ? "" : "s"} to “{nextMs.reward.name}”
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Btn size="sm" kind="dark" icon="star" onClick={() => setDlg("issue")} disabled={c.status !== "active"}>
            Redeem reward
          </Btn>
          {admin && (
            <>
              <Btn size="sm" icon="edit" onClick={() => setDlg("edit")}>
                Edit
              </Btn>
              <Btn size="sm" icon="sliders" onClick={() => setDlg("adjust")}>
                Adjust points
              </Btn>
              <Btn size="sm" kind={c.status === "active" ? "warn" : "ok"} onClick={() => setDlg("status")}>
                {c.status === "active" ? "Deactivate" : "Reactivate"}
              </Btn>
              <Btn size="sm" kind="red" icon="trash" onClick={remove}>
                Delete member
              </Btn>
            </>
          )}
          <a href={waLink(c.phone, `Hi ${c.name}! Here's your ${s.settings.shopName} loyalty wallet — points, rewards and visit stamps:\n${walletLink}`)} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#22c55e] px-3 text-[12px] font-bold text-white hover:bg-[#16a34a]">
            <WaIcon size={14} /> Send wallet
          </a>
        </div>

        <div className="flex gap-1 rounded-xl bg-slate-100 p-1 text-[12px] font-bold">
          {(
            [
              ["points", "Points history"],
              ["rewards", `Rewards (${vouchers.length})`],
              ["bills", `Bills (${bills.length})`],
              ["more", "Referrals & log"],
            ] as const
          ).map(([k, t]) => (
            <button key={k} type="button" onClick={() => setSec(k)} className={cx("h-8 flex-1 rounded-lg px-2 transition", sec === k ? "bg-white text-slate-900 shadow" : "text-slate-500")}>
              {t}
            </button>
          ))}
        </div>

        {sec === "points" &&
          (!ledger ? (
            <p className="py-6 text-center text-[12.5px] text-slate-400">Loading…</p>
          ) : !ledger.rows.length ? (
            <p className="py-6 text-center text-[12.5px] text-slate-400">No points movements yet.</p>
          ) : (
            <>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
                {ledger.rows.map((l) => (
                  <li key={l.id} className="flex items-start justify-between gap-3 px-3 py-2.5 text-[12.5px]">
                    <span className="min-w-0">
                      <b className="block text-slate-800">{LEDGER_LABEL[l.type] ?? l.type}</b>
                      <span className="block text-slate-500">{l.description}</span>
                      <span className="block text-[11px] text-slate-400">
                        {fmtDateTime(l.createdAt)}
                        {l.invoiceNo && ` · ${l.invoiceNo}`}
                        {l.actor !== "system" && ` · by ${l.actor}`}
                        {l.expiresAt && l.points > 0 && ` · expires ${fmtDate(l.expiresAt)}`}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <b className={cx("adm-num block", l.points > 0 ? "text-emerald-600" : "text-red-600")}>
                        {l.points > 0 ? "+" : ""}
                        {l.points}
                      </b>
                      <span className="text-[11px] text-slate-400">bal {l.balanceAfter}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <Pager page={lpage} pages={Math.max(1, Math.ceil(ledger.total / 20))} onPage={setLpage} total={ledger.total} />
            </>
          ))}

        {sec === "rewards" &&
          (!vouchers.length ? (
            <p className="py-6 text-center text-[12.5px] text-slate-400">No rewards yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
              {vouchers.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-[12.5px]">
                  <span className="min-w-0">
                    <b className="block text-slate-800">{v.name}</b>
                    <span className="text-[11px] text-slate-500">
                      <span className="font-mono">{v.ref}</span> · {v.source} · {fmtDate(v.issuedAt)}
                      {v.pointsCost > 0 && ` · ${v.pointsCost} pts`}
                      {v.invoiceNo && ` · ${v.invoiceNo}`}
                      {v.expiresAt && v.status === "issued" && ` · until ${fmtDate(v.expiresAt)}`}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Badge tone={voucherLive(v) ? "green" : v.status === "used" ? "sky" : "slate"}>{voucherLive(v) ? "Ready" : v.status === "issued" ? "expired" : v.status}</Badge>
                    {admin && v.status === "issued" && (
                      <button type="button" className="text-[11px] font-bold text-red-600 hover:underline" onClick={() => setDlg({ cancel: v })}>
                        Cancel
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ))}

        {sec === "bills" &&
          (!bills.length ? (
            <p className="py-6 text-center text-[12.5px] text-slate-400">No bills for this mobile yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
              {bills.slice(0, 60).map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-[12.5px]">
                  <span className="min-w-0">
                    <b className="block text-slate-800">
                      {b.invoiceNo} {b.status === "void" && <Badge tone="red">Void</Badge>}
                    </b>
                    <span className="text-[11px] text-slate-500">
                      {fmtDateTime(b.createdAt)} · {b.itemCount} items
                      {b.pointsEarned > 0 && ` · +${b.pointsEarned} pts`}
                      {b.pointsRedeemed > 0 && ` · −${b.pointsRedeemed} pts`}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <b className="adm-num">{rupee(b.total)}</b>
                    {admin && b.status === "completed" && b.loyaltyCustomerId === c.id && b.pointsEarned > 0 && (
                      <button type="button" className="text-[11px] font-bold text-slate-500 hover:text-slate-900" onClick={() => setDlg({ refund: b })} title="Record a partial refund and take back that share of the points">
                        Partial refund
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ))}

        {sec === "more" && (
          <div className="space-y-4 text-[12.5px]">
            <div className="rounded-xl border border-slate-100 p-3">
              <p>
                Referral code: <b className="font-mono">{c.referralCode}</b>
              </p>
              {referrer && <p className="text-slate-500">Referred by {referrer.name} ({referrer.code})</p>}
              <p className="text-slate-500">
                Referred {referred.length} friend{referred.length === 1 ? "" : "s"} · {referred.filter((r) => r.status === "rewarded").length} rewarded
              </p>
              {(c.birthday || c.anniversary || c.email) && (
                <p className="mt-1 text-slate-500">
                  {[c.birthday && `Birthday ${c.birthday}`, c.anniversary && `Anniversary ${c.anniversary}`, c.email].filter(Boolean).join(" · ")}
                </p>
              )}
              {c.note && <p className="mt-1 text-slate-500">Note: {c.note}</p>}
            </div>
            <div>
              <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">Membership & audit log</span>
              {!history.length ? (
                <p className="text-slate-400">Nothing logged yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
                  {history.map((a) => (
                    <li key={a.id} className="px-3 py-2">
                      <b className="text-slate-800">{a.action}</b> <span className="text-slate-400">· {a.actor} · {fmtDateTime(a.createdAt)}</span>
                      {a.reason && <span className="block text-slate-500">{a.reason}</span>}
                      {a.action === "tier.change" && <span className="block text-slate-500">{`${(a.before as { tier?: string })?.tier} → ${(a.after as { tier?: string })?.tier}`}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>

      {dlg === "edit" && <EditModal c={c} onClose={() => setDlg(null)} />}
      {dlg === "adjust" && <AdjustModal c={c} onClose={() => setDlg(null)} />}
      {dlg === "status" && <StatusModal c={c} onClose={() => setDlg(null)} />}
      {dlg === "issue" && <IssueModal c={c} d={d} onClose={() => setDlg(null)} />}
      {dlg && typeof dlg === "object" && "refund" in dlg && <RefundModal b={dlg.refund} onClose={() => setDlg(null)} />}
      {dlg && typeof dlg === "object" && "cancel" in dlg && <CancelModal v={dlg.cancel} onClose={() => setDlg(null)} />}
    </div>
  );
}

/* Runs a member action. When it succeeds and a message is given, the WhatsApp update for the
   member is offered next (`notice` — a modal to return in place of the form) instead of closing. */
function useSubmit(onClose: () => void) {
  const { act, toast } = useAdmin();
  const [busy, setBusy] = useState(false);
  const [notify, setNotify] = useState<MemberNotice | null>(null);
  const run = async (op: string, args: Record<string, unknown>, ok: string, tell?: MemberNotice) => {
    setBusy(true);
    const r = await act(op, args);
    setBusy(false);
    if (r.ok) {
      if (!r.pending) toast({ kind: "ok", title: ok });
      if (tell && !r.pending && tell.phone) setNotify(tell);
      else onClose();
    }
  };
  const notice = notify ? <MemberUpdate {...notify} onClose={onClose} /> : null;
  return { busy, run, notice };
}

function EditModal({ c, onClose }: { c: LoyaltyCustomer; onClose: () => void }) {
  const { busy, run } = useSubmit(onClose);
  const [f, setF] = useState({ name: c.name, email: c.email, birthday: c.birthday, anniversary: c.anniversary, consent: c.consent, note: c.note });
  const full = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
  return (
    <Modal open onClose={onClose} title={`Edit ${c.name}`} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="red" disabled={busy || !f.name.trim()} onClick={() => run("loyalty.update", { id: c.id, ...f }, "Member updated")}>Save</Btn></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <input className={inputLineCls} value={f.name} maxLength={60} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Email">
          <input className={inputLineCls} value={f.email} maxLength={120} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        <Field label="Birthday" hint={f.birthday && !full(f.birthday) ? `Saved as ${f.birthday}` : undefined}>
          <input className={inputLineCls} type="date" value={full(f.birthday)} onChange={(e) => setF({ ...f, birthday: e.target.value })} />
        </Field>
        <Field label="Anniversary">
          <input className={inputLineCls} type="date" value={full(f.anniversary)} onChange={(e) => setF({ ...f, anniversary: e.target.value })} />
        </Field>
        <Field label="Note" className="sm:col-span-2">
          <input className={inputLineCls} value={f.note} maxLength={300} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
        <label className="flex items-center gap-2 text-[13px] text-slate-700 sm:col-span-2">
          <input type="checkbox" checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} /> OK to send offers on WhatsApp
        </label>
        <p className="text-[11.5px] text-slate-400 sm:col-span-2">The mobile number is the member&apos;s identity and can&apos;t be changed — enrol the new number instead.</p>
      </div>
    </Modal>
  );
}

function AdjustModal({ c, onClose }: { c: LoyaltyCustomer; onClose: () => void }) {
  const { busy, run, notice } = useSubmit(onClose);
  const [pts, setPts] = useState("");
  const [reason, setReason] = useState("");
  const n = Math.trunc(Number(pts) || 0);
  if (notice) return notice;
  return (
    <Modal open onClose={onClose} title={`Adjust points · ${c.name}`} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="red" disabled={busy || !n || !reason.trim()} onClick={() => run("loyalty.adjust", { id: c.id, points: n, reason }, `Points ${n > 0 ? "added" : "removed"}`, { phone: c.phone, name: c.name, kind: "adjust", vars: { points: n > 0 ? `+${n}` : String(n), reason } })}>Apply</Btn></>}>
      <div className="space-y-3">
        <p className="text-[13px] text-slate-600">Available now: <b>{c.available}</b> pts. Use a minus sign to remove points. Adjustments don&apos;t change the member&apos;s tier.</p>
        <Field label="Points (+ or −)">
          <input className={inputLineCls} inputMode="numeric" value={pts} onChange={(e) => setPts(e.target.value.replace(/[^\d-]/g, ""))} placeholder="e.g. 50 or -50" />
        </Field>
        <Field label="Reason (required — goes in the audit log)">
          <input className={inputLineCls} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Goodwill for a late order" />
        </Field>
      </div>
    </Modal>
  );
}

function StatusModal({ c, onClose }: { c: LoyaltyCustomer; onClose: () => void }) {
  const { busy, run, notice } = useSubmit(onClose);
  const [reason, setReason] = useState("");
  const off = c.status === "active";
  if (notice) return notice;
  return (
    <Modal open onClose={onClose} title={off ? `Deactivate ${c.name}?` : `Reactivate ${c.name}?`} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind={off ? "red" : "dark"} disabled={busy || !reason.trim()} onClick={() => run("loyalty.status", { id: c.id, status: off ? "inactive" : "active", reason }, off ? "Loyalty account deactivated" : "Loyalty account reactivated", { phone: c.phone, name: c.name, kind: "status", vars: { status: off ? "deactivated" : "active again" } })}>{off ? "Deactivate" : "Reactivate"}</Btn></>}>
      <div className="space-y-3">
        <p className="text-[13px] text-slate-600">{off ? "They stop earning and can't redeem until reactivated. Their points and history are kept. Normal billing is unaffected." : "They can earn and redeem again."}</p>
        <Field label="Reason (required)">
          <input className={inputLineCls} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function IssueModal({ c, d, onClose }: { c: LoyaltyCustomer; d: LoyaltyState; onClose: () => void }) {
  const { act, toast } = useAdmin();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Voucher | null>(null);
  const [tell, setTell] = useState(false);
  const list = d.rewards.filter((r) => r.active);
  if (tell && done) return <MemberUpdate phone={c.phone} name={c.name} kind="reward" vars={{ reward: done.name, ref: done.ref, expires: done.expiresAt ? fmtDate(done.expiresAt) : "no expiry" }} onClose={onClose} />;
  const issue = async (id: string) => {
    setBusy(true);
    const r = await act<Voucher>("loyalty.issueReward", { id: c.id, rewardId: id });
    setBusy(false);
    if (r.ok) {
      setDone(r.result);
      toast({ kind: "ok", title: `Reward issued — ${r.result.ref}` });
    }
  };
  return (
    <Modal open onClose={onClose} title={`Redeem a reward · ${c.available} pts`}>
      {done ? (
        <div className="grid place-items-center gap-2 py-4 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-emerald-50 text-emerald-600">
            <Icon name="check" size={24} />
          </span>
          <b className="text-slate-900">{done.name}</b>
          <p className="font-mono text-[22px] font-extrabold tracking-wider">{done.ref}</p>
          <p className="text-[12.5px] text-slate-500">Pick it under Loyalty → Reward on their next bill. Valid 30 days.</p>
          <Btn kind="green" onClick={() => setTell(true)}>
            Send on WhatsApp
          </Btn>
          <Btn onClick={onClose}>Done</Btn>
        </div>
      ) : !list.length ? (
        <p className="py-6 text-center text-[13px] text-slate-400">No rewards in the catalogue yet{" "}— add them on the Rewards tab.</p>
      ) : (
        <ul className="space-y-2">
          {list.map((r) => {
            const why = r.pointsCost > c.available ? `Needs ${r.pointsCost - c.available} more pts` : r.tiers.length && !r.tiers.includes(c.tier) ? "Not for this tier" : "";
            return (
              <li key={r.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 p-3">
                <span className="min-w-0">
                  <b className="block text-[13.5px] text-slate-900">{r.name}</b>
                  <span className="text-[11.5px] text-slate-500">{r.pointsCost ? `${r.pointsCost} pts` : "Free"}{r.description && ` · ${r.description}`}</span>
                  {why && <span className="block text-[11px] font-semibold text-amber-600">{why}</span>}
                </span>
                <Btn size="sm" kind="dark" disabled={busy || !!why} onClick={() => issue(r.id)}>
                  Redeem
                </Btn>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}

function RefundModal({ b, onClose }: { b: Bill; onClose: () => void }) {
  const { busy, run, notice } = useSubmit(onClose);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const a = Number(amount) || 0;
  if (notice) return notice;
  return (
    <Modal open onClose={onClose} title={`Partial refund · ${b.invoiceNo}`} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="red" disabled={busy || !(a > 0 && a <= b.total) || !reason.trim()} onClick={() => run("loyalty.refund", { billId: b.id, amount: a, reason }, "Points adjusted for the refund", { phone: b.customerPhone, name: b.customerName, kind: "adjust", vars: { points: `-${Math.round((b.pointsEarned * a) / (b.total || 1))}`, reason } })}>Take back points</Btn></>}>
      <div className="space-y-3">
        <p className="text-[13px] text-slate-600">
          Records the loyalty side of a partial refund: takes back the share of the {b.pointsEarned} pts this {rupee(b.total)} bill earned. It doesn&apos;t change the bill or move money — for a full refund, void the bill on the Orders page (points are reversed automatically).
        </p>
        <Field label="Amount refunded (₹)">
          <input className={inputLineCls} type="number" min={1} max={b.total} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        {a > 0 && a <= b.total && <p className="text-[12.5px] font-semibold text-slate-700">≈ {Math.round((b.pointsEarned * a) / b.total)} pts will be taken back</p>}
        <Field label="Reason (required)">
          <input className={inputLineCls} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function CancelModal({ v, onClose }: { v: Voucher; onClose: () => void }) {
  const { busy, run } = useSubmit(onClose);
  const [reason, setReason] = useState("");
  return (
    <Modal open onClose={onClose} title={`Cancel reward ${v.ref}?`} footer={<><Btn onClick={onClose}>Keep it</Btn><Btn kind="red" disabled={busy || !reason.trim()} onClick={() => run("loyalty.cancelVoucher", { id: v.id, reason }, "Reward cancelled")}>Cancel reward</Btn></>}>
      <div className="space-y-3">
        <p className="text-[13px] text-slate-600">{v.pointsCost > 0 ? `${v.pointsCost} pts go back to the member.` : "It was a free reward, so no points move."}</p>
        <Field label="Reason (required)">
          <input className={inputLineCls} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
