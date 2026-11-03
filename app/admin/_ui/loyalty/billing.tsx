"use client";

/* Loyalty controls for the Billing screen: who the member is, enrolment, points and
   reward redemption, and the points this bill will earn. The numbers here are a
   preview — the server re-checks and recomputes everything when the bill is saved. */

import { useCallback, useEffect, useState } from "react";
import type { Bill, OrderItem, Product } from "@/lib/types";
import { rupee, shopToday } from "@/lib/money";
import type { LoyaltyLookup } from "@/lib/loyalty/types";
import { campaignApplies, earnFor, nextTier, pointsValue, redeemCap, rewardValue, segmentOf, tierByKey, voucherLive } from "@/lib/loyalty/engine";
import { useAdmin } from "../Store";
import { MemberUpdate } from "./notify";
import { Badge, Btn, Icon, Modal, cx, inputLineCls, labelCls } from "../kit";

const okPhone = (p: string) => /^[6-9]\d{9}$/.test(p);

const KNOWN_TONE: Record<string, "orange" | "slate" | "amber" | "violet"> = { bronze: "orange", silver: "slate", gold: "amber", platinum: "violet" };
const EXTRA_TONE = ["sky", "green", "red", "violet", "orange"] as const;
/** Badge colour for a tier: the starter four keep theirs, added tiers get one from the palette. */
export const tierTone = (key: string) => KNOWN_TONE[key] ?? EXTRA_TONE[[...key].reduce((a, ch) => a + ch.charCodeAt(0), 0) % EXTRA_TONE.length];

export async function fetchLookup(phone: string): Promise<LoyaltyLookup | null> {
  try {
    const r = await fetch(`/api/admin/loyalty/lookup?phone=${encodeURIComponent(phone)}`, { cache: "no-store" });
    return r.ok ? ((await r.json()) as LoyaltyLookup) : null;
  } catch {
    return null;
  }
}

/** The member behind a mobile, re-fetched when the number changes or data moves. */
export function useLoyaltyLookup(phone: string, version: number) {
  const [data, setData] = useState<{ phone: string; lk: LoyaltyLookup | null } | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!okPhone(phone)) return;
    let live = true;
    const t = setTimeout(async () => {
      const lk = await fetchLookup(phone);
      if (live) setData({ phone, lk });
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [phone, version, tick]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  const lk = okPhone(phone) && data?.phone === phone ? data.lk : null;
  return { lk, loading: okPhone(phone) && data?.phone !== phone, reload };
}

type Base = { subtotal: number; couponDiscount: number; manualDiscount: number; discount: number };

/** Works out the reward and points discounts for the preview, plus what the bill would earn. */
export function loyaltyCalc(x: { lk: LoyaltyLookup | null; sel: string; pts: string; items: OrderItem[]; products: Product[]; base: Base }) {
  const { lk, items, base } = x;
  const c = lk?.customer;
  const none = { active: false, rewardDiscount: 0, pointsDiscount: 0, points: 0, rewardName: "", problems: [] as string[], cap: { maxPoints: 0, maxAmount: 0, reason: "" }, payload: {} as Record<string, unknown> };
  if (!lk || !c || !lk.enabled || c.status !== "active") return none;
  const cfg = lk.config;
  const cat = new Map(x.products.map((p) => [p.id, p.category]));
  const catOf = (pid: string | null) => (pid ? cat.get(pid) ?? "" : "");
  const afterManual = Math.max(0, base.subtotal - base.couponDiscount - base.manualDiscount);
  const problems: string[] = [];

  let rewardDiscount = 0;
  let rewardName = "";
  let spend = 0;
  const payload: Record<string, unknown> = {};
  if (x.sel.startsWith("v:")) {
    const v = lk.vouchers.find((y) => y.ref === x.sel.slice(2));
    if (v && voucherLive(v)) {
      const r = rewardValue(v, items, afterManual);
      if (r.reason) problems.push(r.reason + ".");
      rewardDiscount = r.amount;
      rewardName = v.name;
      payload.voucherRef = v.ref;
    }
  } else if (x.sel.startsWith("r:")) {
    const rw = lk.rewards.find((y) => y.id === x.sel.slice(2));
    if (rw) {
      if (rw.pointsCost > c.available) problems.push(`${rw.name} needs ${rw.pointsCost} points.`);
      const r = rewardValue(rw, items, afterManual);
      if (r.reason) problems.push(r.reason + ".");
      rewardDiscount = r.amount;
      rewardName = rw.name;
      spend = rw.pointsCost;
      payload.rewardId = rw.id;
    }
  }
  const cap = redeemCap({ cfg, items, catOf, subtotal: base.subtotal, remaining: afterManual - rewardDiscount, available: Math.max(0, c.available - spend), couponApplied: base.couponDiscount > 0, manualApplied: base.manualDiscount > 0, rewardApplied: !!payload.rewardId || !!payload.voucherRef });
  const points = Math.max(0, Math.floor(Number(x.pts) || 0));
  if (points) {
    if (cap.reason) problems.push(cap.reason + ".");
    else if (points < cfg.redeem.minPoints) problems.push(`Redeem at least ${cfg.redeem.minPoints} points at a time.`);
    else if (points > cap.maxPoints) problems.push(`At most ${cap.maxPoints} points can be used on this bill.`);
    payload.loyaltyPoints = points;
  }
  return { active: true, rewardDiscount, pointsDiscount: points && !cap.reason ? pointsValue(Math.min(points, cap.maxPoints), cfg) : 0, points, rewardName, problems, cap, payload };
}

/** Points the bill should earn — the same formula the server runs after payment. */
export function earnPreview(lk: LoyaltyLookup | null, items: OrderItem[], products: Product[], subtotal: number, discount: number) {
  const c = lk?.customer;
  if (!lk || !c || !lk.enabled || c.status !== "active") return 0;
  const cat = new Map(products.map((p) => [p.id, p.category]));
  const catOf = (pid: string | null) => (pid ? cat.get(pid) ?? "" : "");
  const own = new Map(products.map((p) => [p.id, p.loyaltyPoints]));
  const pointsOf = (pid: string | null) => (pid ? own.get(pid) ?? null : null);
  const now = Date.now();
  const seg = segmentOf(lk.stats, lk.config, c.tier, now);
  const ratio = subtotal > 0 ? Math.max(0, subtotal - discount) / subtotal : 0;
  const net = items.reduce((a, i) => a + i.price * i.qty, 0) * ratio;
  const camps = lk.campaigns.filter((k) => campaignApplies(k, { now, tier: c.tier, segment: seg, eligibleNet: net, items, catOf }));
  return earnFor({ cfg: lk.config, items, catOf, pointsOf, subtotal, discount, tier: c.tier, firstPurchase: lk.firstPurchase, campaigns: camps }).total;
}

/* ---------------- member strip (under Customer details) ---------------- */
export function MemberStrip({ phone, name, lk, loading, onEnrolled }: { phone: string; name: string; lk: LoyaltyLookup | null; loading: boolean; onEnrolled: () => void }) {
  const [enrol, setEnrol] = useState(false);
  if (!okPhone(phone)) return null;
  if (loading && !lk) return <p className="mt-3 text-[12px] text-slate-400">Checking loyalty membership…</p>;
  if (!lk || !lk.enabled) return null;
  const c = lk.customer;
  if (!c)
    return (
      <>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-slate-300 px-3.5 py-2.5 text-[12.5px]">
          <span className="text-slate-600">
            Not a loyalty member{lk.stats.orders ? ` · ${lk.stats.visits} earlier visit${lk.stats.visits === 1 ? "" : "s"}` : ""}
          </span>
          <Btn size="sm" kind="dark" icon="star" onClick={() => setEnrol(true)}>
            Enrol
          </Btn>
        </div>
        {enrol && <EnrolModal phone={phone} name={name || lk.knownName} onClose={() => setEnrol(false)} onDone={onEnrolled} />}
      </>
    );
  const tier = tierByKey(c.tier, lk.config);
  const next = nextTier(c.lifetime, lk.config);
  const size = lk.config.stamps.milestones.at(-1)?.visits ?? 0;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-amber-200 bg-amber-50/60 px-3.5 py-2.5 text-[12.5px]">
      <span className="flex items-center gap-2">
        <Icon name="star" size={14} className="text-amber-600" />
        <b className="text-slate-900">{c.name}</b>
        <span className="font-mono text-[11px] text-slate-500">{c.code}</span>
        <Badge tone={tierTone(c.tier)}>{tier.name}</Badge>
        {c.status !== "active" && <Badge tone="red">Deactivated</Badge>}
      </span>
      <span className="text-slate-700">
        <b className="adm-num text-slate-900">{c.available}</b> pts <span className="text-slate-500">(≈ {rupee(pointsValue(c.available, lk.config))})</span>
      </span>
      {lk.config.stamps.enabled && size > 0 && (
        <span className="text-slate-600">
          Stamps {c.stamps ? ((c.stamps - 1) % size) + 1 : 0}/{size}
        </span>
      )}
      {lk.vouchers.length > 0 && <span className="font-semibold text-emerald-700">{lk.vouchers.length} reward{lk.vouchers.length === 1 ? "" : "s"} ready</span>}
      {next && <span className="text-slate-400">{next.need} pts to {next.tier.name}</span>}
    </div>
  );
}

/* Shown right after enrolment: the welcome message, ready to send on WhatsApp. */
export function EnrolledStep({ member, onClose }: { member: { name: string; phone: string; code: string; walletToken: string }; onClose: () => void }) {
  return <MemberUpdate phone={member.phone} name={member.name} kind="enrol" vars={{ code: member.code }} onClose={onClose} />;
}

function EnrolModal({ phone, name: start, onClose, onDone }: { phone: string; name: string; onClose: () => void; onDone: () => void }) {
  const { act, toast } = useAdmin();
  const [f, setF] = useState({ name: start, email: "", birthday: "", referralCode: "", consent: true });
  const [busy, setBusy] = useState(false);
  const [member, setMember] = useState<{ name: string; phone: string; code: string; walletToken: string } | null>(null);
  const save = async () => {
    setBusy(true);
    const r = await act<{ name: string; phone: string; code: string; walletToken: string }>("loyalty.register", { phone, ...f });
    setBusy(false);
    if (r.ok) {
      toast({ kind: "ok", title: `Enrolled — member ${r.result.code}` });
      setMember(r.result);
    }
  };
  // the member strip swaps this modal out once the lookup refreshes, so refresh only on close
  if (member) return <EnrolledStep member={member} onClose={() => { onDone(); onClose(); }} />;
  return (
    <Modal
      open
      onClose={onClose}
      title={`Enrol ${phone} in loyalty`}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind="red" disabled={busy || !f.name.trim()} onClick={save}>
            {busy ? "Enrolling…" : "Enrol member"}
          </Btn>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className={labelCls}>Name *</span>
          <input className={inputLineCls} value={f.name} maxLength={60} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </label>
        <label>
          <span className={labelCls}>Birthday</span>
          <input className={inputLineCls} type="date" value={f.birthday} onChange={(e) => setF({ ...f, birthday: e.target.value })} />
        </label>
        <label>
          <span className={labelCls}>Email</span>
          <input className={inputLineCls} type="email" value={f.email} maxLength={120} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="Optional" />
        </label>
        <label>
          <span className={labelCls}>Referral code</span>
          <input className={cx(inputLineCls, "uppercase")} value={f.referralCode} maxLength={20} onChange={(e) => setF({ ...f, referralCode: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} placeholder="If a friend referred them" />
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-[13px] text-slate-700">
          <input type="checkbox" checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} /> OK to send offers on WhatsApp
        </label>
      </div>
    </Modal>
  );
}

/* ---------------- redeem box (bill summary) ---------------- */
export function RedeemBox({ lk, sel, setSel, pts, setPts, info, earn }: { lk: LoyaltyLookup | null; sel: string; setSel: (v: string) => void; pts: string; setPts: (v: string) => void; info: ReturnType<typeof loyaltyCalc>; earn: number }) {
  const c = lk?.customer;
  if (!lk || !c || !lk.enabled) return null;
  if (c.status !== "active") return <p className="border-t border-dashed border-slate-200 pt-4 text-[12.5px] text-slate-500">This member&apos;s loyalty account is deactivated — no points on this bill.</p>;
  const cfg = lk.config;
  const live = lk.vouchers.filter((v) => voucherLive(v));
  return (
    <div className="space-y-2 border-t border-dashed border-slate-200 pt-4">
      <div className="flex items-center justify-between">
        <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-700">Loyalty</span>
        <span className="text-[12px] font-semibold text-slate-500">
          {c.available} pts · {tierByKey(c.tier, cfg).name}
        </span>
      </div>
      {(live.length > 0 || lk.rewards.length > 0) && (
        <select className="h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-[14px] font-semibold text-slate-800 outline-none focus:border-slate-400" value={sel} onChange={(e) => setSel(e.target.value)} aria-label="Reward">
          <option value="">No reward</option>
          {live.length > 0 && (
            <optgroup label="Ready to use">
              {live.map((v) => (
                <option key={v.id} value={`v:${v.ref}`}>
                  {v.name} · {v.ref}
                </option>
              ))}
            </optgroup>
          )}
          {lk.rewards.length > 0 && (
            <optgroup label="Redeem with points">
              {lk.rewards.map((r) => (
                <option key={r.id} value={`r:${r.id}`} disabled={r.pointsCost > c.available}>
                  {r.name} — {r.pointsCost ? `${r.pointsCost} pts` : "free"}
                  {r.pointsCost > c.available ? " · not enough points" : ""}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      )}
      {cfg.redeem.enabled && (
        <div className="flex gap-2">
          <input type="number" min={0} inputMode="numeric" placeholder="Points to redeem" className="h-11 flex-1 rounded-xl border border-slate-300 bg-white px-4 text-right text-[14px] outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-100" value={pts} onChange={(e) => setPts(e.target.value.replace(/\D/g, ""))} aria-label="Points to redeem" />
          <Btn className="h-11" disabled={!info.cap.maxPoints} onClick={() => setPts(String(info.cap.maxPoints))}>
            Max {info.cap.maxPoints || ""}
          </Btn>
        </div>
      )}
      {cfg.redeem.enabled && !pts && info.cap.reason && <p className="text-[11.5px] text-slate-400">{info.cap.reason}.</p>}
      {cfg.redeem.enabled && !info.cap.reason && !pts && <p className="text-[11.5px] text-slate-400">1 pt = {rupee(cfg.redeem.pointValue)} · up to {info.cap.maxPoints} pts ({rupee(info.cap.maxAmount)}) on this bill</p>}
      {info.pointsDiscount > 0 && <p className="text-[12px] font-semibold text-emerald-600">{info.points} pts → {rupee(info.pointsDiscount)} off · {c.available - info.points - (sel.startsWith("r:") ? lk.rewards.find((r) => `r:${r.id}` === sel)?.pointsCost ?? 0 : 0)} pts left</p>}
      {earn > 0 && <p className="text-[12px] font-semibold text-amber-700">This bill earns about {earn} pts</p>}
    </div>
  );
}

/** Points on a saved bill, for the "Bill saved" dialog. */
export function SavedLoyalty({ bill, tierBefore }: { bill: Bill; tierBefore?: string }) {
  const [lk, setLk] = useState<LoyaltyLookup | null>(null);
  const [tell, setTell] = useState(false);
  useEffect(() => {
    if (!bill.loyaltyCustomerId || !bill.customerPhone) return;
    let live = true;
    fetchLookup(bill.customerPhone).then((x) => live && setLk(x));
    return () => {
      live = false;
    };
  }, [bill.loyaltyCustomerId, bill.customerPhone]);
  if (!bill.loyaltyCustomerId) return null;
  const moved = bill.pointsEarned > 0 || bill.pointsRedeemed > 0;
  return (
    <div className="space-y-2">
    <p className="rounded-xl bg-amber-50 px-3 py-2 text-[12.5px] font-semibold text-amber-800">
      {bill.pointsEarned > 0 ? `Earned ${bill.pointsEarned} pts` : "No points on this bill"}
      {bill.pointsRedeemed > 0 && ` · used ${bill.pointsRedeemed} pts`}
      {bill.rewardName && ` · ${bill.rewardName}`}
      {lk?.customer && ` · balance ${lk.customer.available} pts (${tierByKey(lk.customer.tier, lk.config).name})`}
    </p>
    {moved && bill.customerPhone && (
      <button type="button" onClick={() => setTell(true)} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-[#22c55e] bg-white text-[13px] font-bold text-[#16a34a] hover:bg-emerald-50">
        Send points update on WhatsApp
      </button>
    )}
    {tell && (
      <MemberUpdate
        phone={bill.customerPhone}
        name={bill.customerName}
        kind={bill.pointsEarned > 0 ? "earned" : "redeemed"}
        vars={{ points: bill.pointsEarned > 0 ? bill.pointsEarned : bill.pointsRedeemed }}
        tierBefore={tierBefore}
        onClose={() => setTell(false)}
      />
    )}
    </div>
  );
}
