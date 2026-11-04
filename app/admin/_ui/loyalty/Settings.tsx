"use client";

import { useState } from "react";
import { rupee } from "@/lib/money";
import { DEFAULT_CONFIG, MAX_TIERS, MESSAGE_FIELDS, MESSAGE_META, type AutoReward, type LoyaltyConfig, type Milestone, type Occasion, type Tier, type TierKey } from "@/lib/loyalty/config";
import { fillMessage } from "@/lib/loyalty/messages";
import { tierByKey } from "@/lib/loyalty/engine";
import type { LoyaltyState } from "@/lib/loyalty/types";
import { useAdmin } from "../Store";
import { Badge, Btn, Card, Field, Switch, cx, fmtDateTime, inputLineCls } from "../kit";
import { Pager, usePaged } from "./shared";
import { tierTone } from "./billing";

const numIn = "h-10 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-[13.5px] text-slate-900 outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-100";

function Num({ label, value, onChange, hint, step = 1, min = 0 }: { label: string; value: number; onChange: (n: number) => void; hint?: string; step?: number; min?: number }) {
  return (
    <Field label={label} hint={hint}>
      <input className={numIn} type="number" min={min} step={step} value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))} />
    </Field>
  );
}

function Toggle({ label, on, onChange, hint }: { label: string; on: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 px-4 py-3">
      <span>
        <span className="block text-[13px] font-bold text-slate-800">{label}</span>
        {hint && <span className="block text-[11.5px] text-slate-500">{hint}</span>}
      </span>
      <Switch on={on} onChange={onChange} label={label} />
    </div>
  );
}

function Tiers({ value, onChange, cfg, label }: { value: TierKey[]; onChange: (v: TierKey[]) => void; cfg: LoyaltyConfig; label?: string }) {
  const chip = (on: boolean) => cx("h-8 rounded-lg border px-3 text-[12px] font-bold", on ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-600");
  return (
    <div>
      {label && <span className={cap}>{label}</span>}
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={chip(!value.length)} onClick={() => onChange([])}>
          All tiers
        </button>
        {cfg.tiers.map((t) => t.key).map((k) => (
          <button key={k} type="button" className={chip(value.includes(k))} onClick={() => onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k])}>
            {tierByKey(k, cfg).name}
          </button>
        ))}
      </div>
    </div>
  );
}

const cap = "mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600";

/** One line that says in plain words what a reward gives. */
function rewardText(r: AutoReward, products: { id: string; name: string }[]) {
  if (r.kind === "none") return "no reward";
  const name = r.name.trim() ? ` — “${r.name.trim()}”` : "";
  if (r.kind === "free_item") return `a free ${products.find((p) => p.id === r.productId)?.name ?? "item (pick which one)"}${name}`;
  if (r.kind === "percent") return `${r.value}% off the bill${name}`;
  return `₹${r.value} off the bill${name}`;
}

function RewardEditor({ r, onChange, products }: { r: AutoReward; onChange: (r: AutoReward) => void; products: { id: string; name: string }[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <label>
        <span className={cap}>Reward type</span>
        <select className={numIn} value={r.kind} onChange={(e) => onChange({ ...r, kind: e.target.value as AutoReward["kind"] })}>
          <option value="none">No reward</option>
          <option value="amount">₹ off the bill</option>
          <option value="percent">% off the bill</option>
          <option value="free_item">A free item</option>
        </select>
      </label>
      {r.kind !== "none" && (
        <label>
          <span className={cap}>Reward name</span>
          <input className={numIn} value={r.name} maxLength={80} onChange={(e) => onChange({ ...r, name: e.target.value })} placeholder="e.g. Free tea" />
        </label>
      )}
      {r.kind === "free_item" ? (
        <label>
          <span className={cap}>Which item is free</span>
          <select className={numIn} value={r.productId ?? ""} onChange={(e) => onChange({ ...r, productId: e.target.value || null })}>
            <option value="">Pick an item…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        r.kind !== "none" && (
          <label>
            <span className={cap}>{r.kind === "percent" ? "How many % off" : "How many ₹ off"}</span>
            <input className={numIn} type="number" min={0} value={r.value} onChange={(e) => onChange({ ...r, value: Number(e.target.value) || 0 })} placeholder={r.kind === "percent" ? "e.g. 25" : "e.g. 20"} />
          </label>
        )
      )}
    </div>
  );
}

function ListPicker({ label, all, value, onChange }: { label: string; all: { v: string; t: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  if (!all.length) return null;
  return (
    <div>
      <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">{label}</span>
      <div className="adm-scroll flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
        {all.map((o) => (
          <button key={o.v} type="button" onClick={() => onChange(value.includes(o.v) ? value.filter((x) => x !== o.v) : [...value, o.v])} className={cx("h-7 rounded-lg border px-2.5 text-[11.5px] font-semibold", value.includes(o.v) ? "border-red-600 bg-red-50 text-red-700" : "border-slate-200 text-slate-600")}>
            {o.t}
          </button>
        ))}
      </div>
    </div>
  );
}

/* "In plain words" lines: what the numbers on screen mean, with a worked example. */
function earnSummary(c: LoyaltyConfig) {
  const e = c.earn;
  const bill = 250;
  const raw = e.mode === "percent" ? (bill * e.percent) / 100 : (bill / 100) * e.per100;
  const round = e.rounding === "ceil" ? Math.ceil : e.rounding === "round" ? Math.round : Math.floor;
  const pts = round(raw + 1e-9) + e.fixedPerBill;
  const rate = e.mode === "percent" ? `${e.percent}% of what they spend, as points` : `${e.per100} points for every ₹100 they spend`;
  return `a member earns ${rate}${e.fixedPerBill ? `, plus ${e.fixedPerBill} extra points on every bill` : ""}. A ₹${bill} bill earns ${pts} points${e.minBill ? `; bills under ₹${e.minBill} earn nothing` : ""}${e.maxPerBill ? `; never more than ${e.maxPerBill} points on one bill` : ""}.`;
}

function redeemSummary(c: LoyaltyConfig) {
  const r = c.redeem;
  if (!r.enabled) return "members can't pay with points right now.";
  const bill = 500;
  let amt = (bill * r.maxPercent) / 100;
  if (r.maxAmount > 0) amt = Math.min(amt, r.maxAmount);
  const pts = Math.floor(amt / r.pointValue + 1e-9);
  return `1 point is worth ${rupee(r.pointValue)}. A member needs at least ${r.minPoints} points, and can pay up to ${r.maxPercent}% of a bill with points${r.maxAmount ? ` (never more than ${rupee(r.maxAmount)})` : ""}. On a ₹${bill} bill that is up to ${rupee(amt)} (${pts} points).`;
}

export default function SettingsTab({ d }: { d: LoyaltyState }) {
  const { s, act, toast, confirm } = useAdmin();
  const [c, setC] = useState<LoyaltyConfig>(d.config);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [sec, setSec] = useState<"earn" | "redeem" | "tiers" | "auto" | "messages" | "segments" | "audit">("earn");
  const show = (...x: (typeof sec)[]) => x.includes(sec);
  const dirty = JSON.stringify(c) !== JSON.stringify(d.config);
  const products = s.products.map((p) => ({ id: p.id, name: p.name }));
  const cats = [...new Set(s.products.map((p) => p.category).filter(Boolean))].sort().map((x) => ({ v: x, t: x }));
  const prods = s.products.map((p) => ({ v: p.id, t: p.name }));
  const set = <K extends keyof LoyaltyConfig>(k: K, v: Partial<LoyaltyConfig[K]>) => setC((x) => ({ ...x, [k]: Array.isArray(x[k]) ? v : { ...(x[k] as object), ...v } }));

  const save = async () => {
    setBusy(true);
    const r = await act<LoyaltyConfig>("loyalty.config", { config: c, reason });
    setBusy(false);
    if (r.ok) {
      setC(r.result);
      setReason("");
      toast({ kind: "ok", title: "Loyalty settings saved" });
    }
  };
  const occ = (k: "birthday" | "anniversary", label: string) => {
    const o: Occasion = c[k];
    const up = (v: Partial<Occasion>) => set(k, v);
    return (
      <Card title={`${label} rewards`}>
        <div className="space-y-3">
          <Toggle label={`${label} rewards on`} on={o.enabled} onChange={(v) => up({ enabled: v })} hint={`Given once a year, within ${o.windowDays} days of the date — at billing or when the Loyalty page opens.`} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Num label="Bonus points" hint="Points given on the occasion" value={o.bonusPoints} onChange={(n) => up({ bonusPoints: n })} />
            <Num label="Window (± days)" hint="Given within this many days before or after the date" value={o.windowDays} onChange={(n) => up({ windowDays: n })} />
            <Num label="Reward valid (days)" hint="How long they have to use the reward" value={o.validityDays} onChange={(n) => up({ validityDays: n })} min={1} />
          </div>
          <RewardEditor r={o.reward} onChange={(r) => up({ reward: r })} products={products} />
          <Tiers label="Which memberships get this (All tiers = every member)" value={o.tiers} onChange={(t) => up({ tiers: t })} cfg={c} />
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-[12.5px] text-slate-700">
            <b>In plain words:</b> {o.enabled ? `each year, within ${o.windowDays} days of a member's ${label.toLowerCase()}, they get ${o.bonusPoints} bonus points and ${rewardText(o.reward, products)}, usable for ${o.validityDays} days.` : `${label} rewards are switched off.`}
          </p>
        </div>
      </Card>
    );
  };
  const setTier = (i: number, p: Partial<Tier>) => setC((x) => ({ ...x, tiers: x.tiers.map((y, j) => (j === i ? { ...y, ...p } : y)) }));
  const addTier = () =>
    setC((x) => {
      const last = x.tiers[x.tiers.length - 1];
      let n = x.tiers.length + 1;
      while (x.tiers.some((y) => y.key === `tier${n}`)) n++;
      return { ...x, tiers: [...x.tiers, { key: `tier${n}`, name: "New membership", min: last.min + 1000, multiplier: Math.round((last.multiplier + 0.25) * 100) / 100, benefits: "" }] };
    });
  const removeTier = async (i: number) => {
    const tr = c.tiers[i];
    if (!(await confirm({ title: `Remove ${tr.name}?`, body: "Members in it move to the nearest tier the next time they earn points. Rewards, campaigns or stamp rules limited to this tier stop matching it until you change them. Nothing is saved until you press Save.", ok: "Remove", danger: true }))) return;
    setC((x) => ({ ...x, tiers: x.tiers.filter((_, j) => j !== i) }));
  };
  const SAMPLE: Record<string, string | number> = {
    name: "Asha",
    shop: s.settings.shopName,
    date: new Date().toLocaleDateString("en-GB"),
    points: 120,
    balance: 860,
    tier: c.tiers[Math.min(1, c.tiers.length - 1)]?.name ?? "",
    benefits: c.tiers[Math.min(1, c.tiers.length - 1)]?.benefits ?? "",
    code: "CK7H2P9Q",
    wallet: `${(s.settings.publicUrl || "https://your-shop.example").replace(/\/$/, "")}/w/abc123`,
    reason: "Goodwill for a late order",
    reward: "Free chai",
    ref: "RW4X9K",
    expires: "30/04/2026",
    status: "deactivated",
  };
  const SECS: [typeof sec, string][] = [
    ["earn", "Earning & expiry"],
    ["redeem", "Redeeming"],
    ["tiers", "Memberships"],
    ["auto", "Stamps, birthdays & referrals"],
    ["messages", "WhatsApp messages"],
    ["segments", "Customer segments"],
    ["audit", "Audit log"],
  ];
  const setMs = (i: number, m: Partial<Milestone>) => set("stamps", { milestones: c.stamps.milestones.map((x, j) => (j === i ? { ...x, ...m } : x)) });

  return (
    <div className="space-y-5">
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <Switch on={c.enabled} onChange={(v) => setC({ ...c, enabled: v })} label="Programme on" />
          <span className="text-[13px] font-bold text-slate-800">{c.enabled ? "Loyalty programme is on" : "Loyalty programme is off — nobody earns or redeems"}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input className={cx(inputLineCls, "h-10 w-56")} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Reason for the change (audit log)" />
          <Btn disabled={!dirty || busy} onClick={() => setC(d.config)}>
            Discard
          </Btn>
          <Btn kind="red" disabled={!dirty || busy} onClick={save}>
            {busy ? "Saving…" : "Save settings"}
          </Btn>
        </div>
      </div>

      <nav className="flex flex-wrap gap-1.5" aria-label="Loyalty settings sections">
        {SECS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setSec(k)} aria-current={sec === k} className={cx("h-9 rounded-full border px-4 text-[12.5px] font-bold transition", sec === k ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-400")}>
            {label}
          </button>
        ))}
      </nav>

      <div className="grid gap-5 xl:grid-cols-2">
        {show("earn") && (
        <Card title="Earning points">
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Earn by">
                <select className={numIn} value={c.earn.mode} onChange={(e) => set("earn", { mode: e.target.value as "per100" | "percent" })}>
                  <option value="per100">Points per ₹100</option>
                  <option value="percent">% of the bill as points</option>
                </select>
              </Field>
              {c.earn.mode === "per100" ? <Num label="Points per ₹100" value={c.earn.per100} step={0.5} onChange={(n) => set("earn", { per100: n })} /> : <Num label="% of amount" value={c.earn.percent} step={0.5} onChange={(n) => set("earn", { percent: n })} />}
              <Num label="Fixed points per bill" hint="Extra points on every paid bill, on top of the above" value={c.earn.fixedPerBill} onChange={(n) => set("earn", { fixedPerBill: n })} />
              <Num label="Minimum bill (₹)" hint="Bills below this earn no points" value={c.earn.minBill} onChange={(n) => set("earn", { minBill: n })} />
              <Num label="Max points per bill" value={c.earn.maxPerBill} onChange={(n) => set("earn", { maxPerBill: n })} hint="0 = no cap" />
              <Field label="Rounding" hint="What happens to a part of a point">
                <select className={numIn} value={c.earn.rounding} onChange={(e) => set("earn", { rounding: e.target.value as "floor" })}>
                  <option value="floor">Round down</option>
                  <option value="round">Nearest</option>
                  <option value="ceil">Round up</option>
                </select>
              </Field>
              <Num label="First-purchase bonus" hint="Extra points on a customer's very first paid bill" value={c.earn.firstPurchaseBonus} onChange={(n) => set("earn", { firstPurchaseBonus: n })} />
            </div>
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-[12.5px] text-slate-700">
              <b>In plain words:</b> {earnSummary(c)}
            </p>
            <p className="text-[11.5px] text-slate-500">Points are worked out on what the member paid for eligible items — after every discount, without GST or extra charges — and only once the bill is saved (paid). Tier multipliers and campaigns apply on top.</p>
            <ListPicker label="Categories that earn nothing" all={cats} value={c.earn.excludedCategories} onChange={(v) => set("earn", { excludedCategories: v })} />
            <ListPicker label="Items that earn nothing" all={prods} value={c.earn.excludedProductIds} onChange={(v) => set("earn", { excludedProductIds: v })} />
            <div>
              <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">Category / item multipliers</span>
              <p className="mb-2 text-[11.5px] text-slate-500">Give one category or item more (or fewer) points than usual. 2 = double points, 0.5 = half, 0 = none. Example: choose “Juices” and 2, and members earn double points on juices.</p>
              {c.earn.rules.map((r, i) => (
                <div key={i} className="mb-2 flex gap-2">
                  <select className={numIn} value={`${r.target}:${r.key}`} onChange={(e) => { const [t, ...k] = e.target.value.split(":"); set("earn", { rules: c.earn.rules.map((x, j) => (j === i ? { ...x, target: t as "product" | "category", key: k.join(":") } : x)) }); }}>
                    <optgroup label="Category">{cats.map((x) => <option key={x.v} value={`category:${x.v}`}>{x.t}</option>)}</optgroup>
                    <optgroup label="Item">{prods.map((x) => <option key={x.v} value={`product:${x.v}`}>{x.t}</option>)}</optgroup>
                  </select>
                  <input className={cx(numIn, "w-24")} type="number" min={0} step={0.25} value={r.multiplier} onChange={(e) => set("earn", { rules: c.earn.rules.map((x, j) => (j === i ? { ...x, multiplier: Number(e.target.value) || 0 } : x)) })} aria-label="Multiplier" />
                  <span className="self-center whitespace-nowrap text-[12px] text-slate-500">× points</span>
                  <Btn kind="plain" icon="x" onClick={() => set("earn", { rules: c.earn.rules.filter((_, j) => j !== i) })} aria-label="Remove rule" />
                </div>
              ))}
              {(cats.length > 0 || prods.length > 0) && (
                <Btn size="sm" icon="plus" onClick={() => set("earn", { rules: [...c.earn.rules, cats[0] ? { target: "category", key: cats[0].v, multiplier: 2 } : { target: "product", key: prods[0].v, multiplier: 2 }] })}>
                  Add multiplier
                </Btn>
              )}
            </div>
          </div>
        </Card>
        )}

        {show("redeem") && (
        <Card title="Redeeming points">
          <div className="space-y-3">
            <Toggle label="Points redemption at billing" hint="Off = members can still earn, but can't pay with points" on={c.redeem.enabled} onChange={(v) => set("redeem", { enabled: v })} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Num label="Value of 1 point (₹)" value={c.redeem.pointValue} step={0.05} min={0.01} onChange={(n) => set("redeem", { pointValue: n })} hint={`100 pts = ${rupee(100 * c.redeem.pointValue)}`} />
              <Num label="Minimum points to redeem" hint="A member needs at least this many points to use them" value={c.redeem.minPoints} min={1} onChange={(n) => set("redeem", { minPoints: n })} />
              <Num label="Max % of the bill" hint="Points can pay for at most this share of a bill" value={c.redeem.maxPercent} onChange={(n) => set("redeem", { maxPercent: n })} />
              <Num label="Max ₹ per bill" value={c.redeem.maxAmount} onChange={(n) => set("redeem", { maxAmount: n })} hint="0 = no cap" />
            </div>
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-[12.5px] text-slate-700">
              <b>In plain words:</b> {redeemSummary(c)}
            </p>
            <Toggle label="Allow with a coupon" hint="Can points be used on a bill that already has a coupon?" on={c.redeem.withCoupon} onChange={(v) => set("redeem", { withCoupon: v })} />
            <Toggle label="Allow with a manual discount" hint="Can points be used when staff have given a discount?" on={c.redeem.withManual} onChange={(v) => set("redeem", { withManual: v })} />
            <Toggle label="Allow with a reward on the same bill" hint="Can points be used together with a free reward or voucher?" on={c.redeem.withReward} onChange={(v) => set("redeem", { withReward: v })} />
            <ListPicker label="Categories points can't pay for" all={cats} value={c.redeem.excludedCategories} onChange={(v) => set("redeem", { excludedCategories: v })} />
            <ListPicker label="Items points can't pay for" all={prods} value={c.redeem.excludedProductIds} onChange={(v) => set("redeem", { excludedProductIds: v })} />
          </div>
        </Card>
        )}

        {show("tiers") && (
        <Card
          title="Membership tiers"
          right={
            <Btn size="sm" icon="plus" disabled={c.tiers.length >= MAX_TIERS} onClick={addTier}>
              Add membership
            </Btn>
          }
        >
          <p className="mb-3 text-[11.5px] text-slate-500">
            Based on lifetime points earned — redeeming never lowers a tier. Upgrades happen automatically. You can have up to {MAX_TIERS} memberships; they are ordered by points when saved.
          </p>
          <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-slate-500">
            {[...c.tiers]
              .sort((x, y) => x.min - y.min)
              .map((tr, i, all) => (
                <span key={tr.key} className="inline-flex items-center gap-1.5">
                  <Badge tone={tierTone(tr.key)}>{tr.name || "—"}</Badge>
                  <span>{i === 0 ? "from the start" : `${tr.min}+ pts`}</span>
                  {i < all.length - 1 && <span className="text-slate-300">→</span>}
                </span>
              ))}
          </div>
          <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-[12px] leading-relaxed text-slate-600">
            <b>Membership name</b> is what members see. <b>From points</b> is the lifetime points a member needs to reach it. <b>Points ×</b> is how many times the normal points they then earn — 1 = normal, 1.5 = 50% extra, 2 = double.
          </p>
          <div className="space-y-3">
            <div className="hidden gap-2 px-3 text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500 sm:grid sm:grid-cols-[1fr_110px_100px_auto]">
              <span>Membership name</span>
              <span>From points</span>
              <span>Points ×</span>
              <span className="w-9" />
            </div>
            {c.tiers.map((tr, i) => (
              <div key={tr.key} className="grid gap-2 rounded-xl border border-slate-100 p-3 sm:grid-cols-[1fr_110px_100px_auto]">
                <input className={numIn} value={tr.name} maxLength={30} onChange={(e) => setTier(i, { name: e.target.value })} aria-label="Membership name" placeholder="Name" />
                <input className={numIn} type="number" min={0} disabled={i === 0} value={tr.min} onChange={(e) => setTier(i, { min: Number(e.target.value) || 0 })} aria-label="From lifetime points" title="From lifetime points" />
                <input className={numIn} type="number" min={0} step={0.05} value={tr.multiplier} onChange={(e) => setTier(i, { multiplier: Number(e.target.value) || 0 })} aria-label="Points multiplier" title="Points multiplier" />
                <Btn kind="plain" icon="trash" disabled={c.tiers.length <= 1} onClick={() => removeTier(i)} aria-label={`Remove ${tr.name}`} />
                <input className={cx(numIn, "sm:col-span-4")} value={tr.benefits} maxLength={300} onChange={(e) => setTier(i, { benefits: e.target.value })} placeholder="Benefits shown to staff and the member" aria-label="Benefits" />
                <p className="text-[11.5px] text-slate-500 sm:col-span-4">
                  <b>{tr.name || "This membership"}</b>: {i === 0 ? "everyone starts here" : `reached at ${tr.min} lifetime points`} · earns {tr.multiplier}× points.
                </p>
              </div>
            ))}
          </div>
        </Card>
        )}

        {show("earn") && (
        <Card title="Points expiry">
          <div className="grid gap-3 sm:grid-cols-2">
            <Num label="Points valid for (days)" value={c.expiry.days} onChange={(n) => set("expiry", { days: n })} hint="0 = never expire. Applies to points earned from now on." />
            <Num label="Warn when expiring within (days)" hint="Show a warning on the member's card this many days before points run out" value={c.expiry.warnDays} min={1} onChange={(n) => set("expiry", { warnDays: n })} />
          </div>
          <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[12.5px] text-slate-700">
            <b>In plain words:</b> {c.expiry.days ? `points expire ${c.expiry.days} days after they are earned, and the member is warned ${c.expiry.warnDays} days before.` : "points never expire."}
          </p>
          <p className="mt-3 text-[11.5px] text-slate-500">Oldest points are used first. Expired points are recorded in the ledger, never deleted.</p>
        </Card>
        )}

        {show("auto") && (
        <Card title="Visit stamps">
          <div className="space-y-3">
            <Toggle label="Digital stamp card" on={c.stamps.enabled} onChange={(v) => set("stamps", { enabled: v })} hint="Separate from points: one stamp per qualifying paid visit." />
            <div className="grid gap-3 sm:grid-cols-2">
              <Num label="Minimum bill for a stamp (₹)" hint="Bills below this don't give a stamp" value={c.stamps.minBill} onChange={(n) => set("stamps", { minBill: n })} />
              <Field label="What counts as a visit">
                <select className={numIn} value={c.stamps.rule} onChange={(e) => set("stamps", { rule: e.target.value as "per_day" })}>
                  <option value="per_day">One per day (several bills = one visit)</option>
                  <option value="per_bill">Every qualifying bill</option>
                </select>
              </Field>
            </div>
            <Tiers label="Who earns stamps (All tiers = every member)" value={c.stamps.tiers} onChange={(t) => set("stamps", { tiers: t })} cfg={c} />
            <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">Milestones (the card restarts after the last one)</span>
            <p className="text-[11.5px] text-slate-500">Each qualifying visit adds one stamp to the member&apos;s card. A milestone gives a reward when the card reaches that stamp number — add as many as you like.</p>
            {c.stamps.milestones.map((m, i) => (
              <div key={i} className="space-y-2 rounded-xl border border-slate-100 p-3">
                <div className="flex items-end gap-2">
                  <Num label="On which visit" hint="The reward is given on this stamp" value={m.visits} min={1} onChange={(n) => setMs(i, { visits: n })} />
                  <Num label="Valid for (days)" hint="How long they have to use it" value={m.validityDays} min={1} onChange={(n) => setMs(i, { validityDays: n })} />
                  <Btn kind="plain" icon="trash" onClick={() => set("stamps", { milestones: c.stamps.milestones.filter((_, j) => j !== i) })} aria-label="Remove milestone" />
                </div>
                <RewardEditor r={m.reward} onChange={(r) => setMs(i, { reward: r })} products={products} />
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-600">On visit <b>#{m.visits}</b> the member gets <b>{rewardText(m.reward, products)}</b>, usable for <b>{m.validityDays} days</b> after they earn it.</p>
              </div>
            ))}
            <Btn size="sm" icon="plus" onClick={() => set("stamps", { milestones: [...c.stamps.milestones, { visits: (c.stamps.milestones.at(-1)?.visits ?? 0) + 5, reward: { kind: "amount", name: "Free snack", value: 50, productId: null }, validityDays: 30 }] })}>
              Add milestone
            </Btn>
          </div>
        </Card>
        )}

        {show("auto") && (
        <Card title="Referrals">
          <div className="space-y-3">
            <Toggle label="Referral programme" on={c.referral.enabled} onChange={(v) => set("referral", { enabled: v })} hint="Rewards only after the new customer's first qualifying paid bill; reversed if that bill is voided." />
            <div className="grid gap-3 sm:grid-cols-2">
              <Num label="Referrer bonus (pts)" hint="Points the member who brought a friend gets" value={c.referral.referrerBonus} onChange={(n) => set("referral", { referrerBonus: n })} />
              <Num label="New customer bonus (pts)" hint="Points the friend gets after their first bill" value={c.referral.refereeBonus} onChange={(n) => set("referral", { refereeBonus: n })} />
              <Num label="Minimum first bill (₹)" hint="The friend's first bill must be at least this much" value={c.referral.minPurchase} onChange={(n) => set("referral", { minPurchase: n })} />
              <Num label="Max rewards per referrer" value={c.referral.maxPerReferrer} onChange={(n) => set("referral", { maxPerReferrer: n })} hint="0 = no limit" />
              <Field label="Campaign starts" hint="Leave blank for no start date">
                <input className={numIn} type="date" value={c.referral.startsOn} onChange={(e) => set("referral", { startsOn: e.target.value })} />
              </Field>
              <Field label="Campaign ends" hint="Leave blank for no end date">
                <input className={numIn} type="date" value={c.referral.endsOn} onChange={(e) => set("referral", { endsOn: e.target.value })} />
              </Field>
            </div>
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-[12.5px] text-slate-700">
              <b>In plain words:</b> when a member refers a friend who pays a first bill of ₹{c.referral.minPurchase} or more, the member gets {c.referral.referrerBonus} points and the friend gets {c.referral.refereeBonus} points{c.referral.maxPerReferrer ? `, up to ${c.referral.maxPerReferrer} referrals per member` : ""}.
            </p>
            <Tiers label="Which memberships can refer (All tiers = every member)" value={c.referral.tiers} onChange={(t) => set("referral", { tiers: t })} cfg={c} />
          </div>
        </Card>
        )}

        {show("auto") && occ("birthday", "Birthday")}
        {show("auto") && occ("anniversary", "Anniversary")}

        {show("messages") && (
        <Card title="WhatsApp messages to members" className="xl:col-span-2">
          <div className="space-y-4">
            <Toggle
              label="Offer a WhatsApp message after every loyalty update"
              on={c.messages.enabled}
              onChange={(v) => setC((x) => ({ ...x, messages: { ...x.messages, enabled: v } }))}
              hint="After enrolling a member, a bill that earns or uses points, a tier upgrade, an adjustment, a reward or a status change, a window opens with the message ready — one tap sends it on WhatsApp."
            />
            <p className="text-[11.5px] leading-relaxed text-slate-500">
              Words you can use, each filled in for the member (anything that doesn&apos;t apply is left out): <span className="font-mono text-slate-700">{MESSAGE_FIELDS.map((f) => `{${f}}`).join(" ")}</span>
            </p>
            <div className="grid gap-4 lg:grid-cols-2">
              {MESSAGE_META.map((m) => (
                <div key={m.key} className="space-y-2 rounded-xl border border-slate-100 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <b className="text-[13.5px] text-slate-900">{m.label}</b>
                    <span className="text-[11px] text-slate-400">{m.when}</span>
                  </div>
                  <textarea
                    className={cx(inputLineCls, "h-24 resize-y py-2 text-[12.5px] leading-relaxed")}
                    value={c.messages.templates[m.key]}
                    maxLength={600}
                    onChange={(e) => setC((x) => ({ ...x, messages: { ...x.messages, templates: { ...x.messages.templates, [m.key]: e.target.value } } }))}
                    aria-label={`${m.label} message`}
                  />
                  <p className="whitespace-pre-wrap rounded-lg bg-emerald-50 px-3 py-2 text-[12px] text-slate-700">{fillMessage(c.messages.templates[m.key], SAMPLE)}</p>
                  <button type="button" className="text-[11.5px] font-bold text-slate-500 hover:text-slate-900" onClick={() => setC((x) => ({ ...x, messages: { ...x.messages, templates: { ...x.messages.templates, [m.key]: DEFAULT_CONFIG.messages.templates[m.key] } } }))}>
                    Reset wording
                  </button>
                </div>
              ))}
            </div>
          </div>
        </Card>
        )}

        {show("segments") && (
        <Card title="Customer segments (CRM)">
          <p className="mb-3 text-[11.5px] text-slate-500">Customers are grouped automatically by how often and how much they buy, so you can send the right offer to the right group. These numbers decide where the lines fall.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Num label="“New” within (days)" hint="A customer is “New” for this long after their first visit" value={c.crm.newDays} min={1} onChange={(n) => set("crm", { newDays: n })} />
            <Num label="“Regular” from visits" hint="Becomes “Regular” after this many visits" value={c.crm.regularVisits} min={1} onChange={(n) => set("crm", { regularVisits: n })} />
            <Num label="“Frequent” visits" hint="“Frequent” = at least this many visits…" value={c.crm.frequentVisits} min={1} onChange={(n) => set("crm", { frequentVisits: n })} />
            <Num label="…within (days)" hint="…in this many recent days" value={c.crm.frequentDays} min={1} onChange={(n) => set("crm", { frequentDays: n })} />
            <Num label="“High value” spend (₹)" hint="Total spent at or above this" value={c.crm.highValue} onChange={(n) => set("crm", { highValue: n })} />
            <Num label="“VIP” spend (₹)" hint="Total spent at or above this (or the top membership)" value={c.crm.vipSpend} onChange={(n) => set("crm", { vipSpend: n })} />
            <Num label="“At risk” after (days)" hint="A regular who hasn't visited for this long" value={c.crm.atRiskDays} min={1} onChange={(n) => set("crm", { atRiskDays: n })} />
            <Num label="“Inactive” after (days)" hint="Away for this many days" value={c.crm.inactiveDays} min={1} onChange={(n) => set("crm", { inactiveDays: n })} />
            <Num label="“Lost” after (days)" hint="Away for this many days — treated as gone" value={c.crm.lostDays} min={1} onChange={(n) => set("crm", { lostDays: n })} />
          </div>
        </Card>
        )}
      </div>

      <div className="flex justify-end">
        <Btn
          kind="plain"
          onClick={async () => {
            if (await confirm({ title: "Load the default settings?", body: "This fills the form with the suggested defaults (5 pts per ₹100, 1 pt = ₹0.50, Bronze/Silver/Gold/Platinum…). Nothing is saved until you press Save.", ok: "Load defaults" })) setC(DEFAULT_CONFIG);
          }}
        >
          Load suggested defaults
        </Btn>
      </div>

      {sec === "audit" && <AuditLog d={d} />}
    </div>
  );
}

function AuditLog({ d }: { d: LoyaltyState }) {
  const names = new Map(d.customers.map((c) => [c.id, c.name]));
  const pg = usePaged(d.audit, 15);
  return (
    <Card title="Audit log (latest 300)">
      {!d.audit.length ? (
        <p className="py-4 text-center text-[13px] text-slate-400">Nothing logged yet.</p>
      ) : (
        <>
          <ul className="divide-y divide-slate-100 text-[12.5px]">
            {pg.rows.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span className="min-w-0">
                  <b className="text-slate-800">{a.action}</b>
                  {a.customerId && <span className="text-slate-600"> · {names.get(a.customerId) ?? a.customerId}</span>}
                  {a.ref && <span className="text-slate-500"> · {a.ref}</span>}
                  {a.reason && <span className="block text-slate-500">“{a.reason}”</span>}
                </span>
                <span className="shrink-0 text-[11.5px] text-slate-400">
                  {a.actor} · {fmtDateTime(a.createdAt)}
                </span>
              </li>
            ))}
          </ul>
          <Pager page={pg.page} pages={pg.pages} onPage={pg.setPage} total={pg.total} />
        </>
      )}
    </Card>
  );
}
