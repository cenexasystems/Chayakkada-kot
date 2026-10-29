"use client";

import { useState } from "react";
import { rupee } from "@/lib/money";
import { DEFAULT_CONFIG, TIER_KEYS, type AutoReward, type LoyaltyConfig, type Milestone, type Occasion, type TierKey } from "@/lib/loyalty/config";
import { tierByKey } from "@/lib/loyalty/engine";
import type { LoyaltyState } from "@/lib/loyalty/types";
import { useAdmin } from "../Store";
import { Btn, Card, Field, Switch, cx, fmtDateTime, inputLineCls } from "../kit";
import { Pager, usePaged } from "./shared";

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

function Tiers({ value, onChange, cfg }: { value: TierKey[]; onChange: (v: TierKey[]) => void; cfg: LoyaltyConfig }) {
  const chip = (on: boolean) => cx("h-8 rounded-lg border px-3 text-[12px] font-bold", on ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-600");
  return (
    <div className="flex flex-wrap gap-1.5">
      <button type="button" className={chip(!value.length)} onClick={() => onChange([])}>
        All tiers
      </button>
      {TIER_KEYS.map((k) => (
        <button key={k} type="button" className={chip(value.includes(k))} onClick={() => onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k])}>
          {tierByKey(k, cfg).name}
        </button>
      ))}
    </div>
  );
}

function RewardEditor({ r, onChange, products }: { r: AutoReward; onChange: (r: AutoReward) => void; products: { id: string; name: string }[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <select className={numIn} value={r.kind} onChange={(e) => onChange({ ...r, kind: e.target.value as AutoReward["kind"] })} aria-label="Reward type">
        <option value="none">No reward</option>
        <option value="amount">₹ off</option>
        <option value="percent">% off</option>
        <option value="free_item">Free item</option>
      </select>
      {r.kind !== "none" && <input className={numIn} value={r.name} maxLength={80} onChange={(e) => onChange({ ...r, name: e.target.value })} placeholder="Reward name" aria-label="Reward name" />}
      {r.kind === "free_item" ? (
        <select className={numIn} value={r.productId ?? ""} onChange={(e) => onChange({ ...r, productId: e.target.value || null })} aria-label="Free item">
          <option value="">Pick an item…</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      ) : (
        r.kind !== "none" && <input className={numIn} type="number" min={0} value={r.value} onChange={(e) => onChange({ ...r, value: Number(e.target.value) || 0 })} placeholder={r.kind === "percent" ? "%" : "₹"} aria-label="Value" />
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

export default function SettingsTab({ d }: { d: LoyaltyState }) {
  const { s, act, toast, confirm } = useAdmin();
  const [c, setC] = useState<LoyaltyConfig>(d.config);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
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
            <Num label="Bonus points" value={o.bonusPoints} onChange={(n) => up({ bonusPoints: n })} />
            <Num label="Window (± days)" value={o.windowDays} onChange={(n) => up({ windowDays: n })} />
            <Num label="Reward valid (days)" value={o.validityDays} onChange={(n) => up({ validityDays: n })} min={1} />
          </div>
          <RewardEditor r={o.reward} onChange={(r) => up({ reward: r })} products={products} />
          <Tiers value={o.tiers} onChange={(t) => up({ tiers: t })} cfg={c} />
        </div>
      </Card>
    );
  };
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

      <div className="grid gap-5 xl:grid-cols-2">
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
              <Num label="Fixed points per bill" value={c.earn.fixedPerBill} onChange={(n) => set("earn", { fixedPerBill: n })} />
              <Num label="Minimum bill (₹)" value={c.earn.minBill} onChange={(n) => set("earn", { minBill: n })} />
              <Num label="Max points per bill" value={c.earn.maxPerBill} onChange={(n) => set("earn", { maxPerBill: n })} hint="0 = no cap" />
              <Field label="Rounding">
                <select className={numIn} value={c.earn.rounding} onChange={(e) => set("earn", { rounding: e.target.value as "floor" })}>
                  <option value="floor">Round down</option>
                  <option value="round">Nearest</option>
                  <option value="ceil">Round up</option>
                </select>
              </Field>
              <Num label="First-purchase bonus" value={c.earn.firstPurchaseBonus} onChange={(n) => set("earn", { firstPurchaseBonus: n })} />
            </div>
            <p className="text-[11.5px] text-slate-500">Points are worked out on what the member paid for eligible items — after every discount, without GST or extra charges — and only once the bill is saved (paid). Tier multipliers and campaigns apply on top.</p>
            <ListPicker label="Categories that earn nothing" all={cats} value={c.earn.excludedCategories} onChange={(v) => set("earn", { excludedCategories: v })} />
            <ListPicker label="Items that earn nothing" all={prods} value={c.earn.excludedProductIds} onChange={(v) => set("earn", { excludedProductIds: v })} />
            <div>
              <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">Category / item multipliers</span>
              {c.earn.rules.map((r, i) => (
                <div key={i} className="mb-2 flex gap-2">
                  <select className={numIn} value={`${r.target}:${r.key}`} onChange={(e) => { const [t, ...k] = e.target.value.split(":"); set("earn", { rules: c.earn.rules.map((x, j) => (j === i ? { ...x, target: t as "product" | "category", key: k.join(":") } : x)) }); }}>
                    <optgroup label="Category">{cats.map((x) => <option key={x.v} value={`category:${x.v}`}>{x.t}</option>)}</optgroup>
                    <optgroup label="Item">{prods.map((x) => <option key={x.v} value={`product:${x.v}`}>{x.t}</option>)}</optgroup>
                  </select>
                  <input className={cx(numIn, "w-24")} type="number" min={0} step={0.25} value={r.multiplier} onChange={(e) => set("earn", { rules: c.earn.rules.map((x, j) => (j === i ? { ...x, multiplier: Number(e.target.value) || 0 } : x)) })} aria-label="Multiplier" />
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

        <Card title="Redeeming points">
          <div className="space-y-3">
            <Toggle label="Points redemption at billing" on={c.redeem.enabled} onChange={(v) => set("redeem", { enabled: v })} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Num label="Value of 1 point (₹)" value={c.redeem.pointValue} step={0.05} min={0.01} onChange={(n) => set("redeem", { pointValue: n })} hint={`100 pts = ${rupee(100 * c.redeem.pointValue)}`} />
              <Num label="Minimum points to redeem" value={c.redeem.minPoints} min={1} onChange={(n) => set("redeem", { minPoints: n })} />
              <Num label="Max % of the bill" value={c.redeem.maxPercent} onChange={(n) => set("redeem", { maxPercent: n })} />
              <Num label="Max ₹ per bill" value={c.redeem.maxAmount} onChange={(n) => set("redeem", { maxAmount: n })} hint="0 = no cap" />
            </div>
            <Toggle label="Allow with a coupon" on={c.redeem.withCoupon} onChange={(v) => set("redeem", { withCoupon: v })} />
            <Toggle label="Allow with a manual discount" on={c.redeem.withManual} onChange={(v) => set("redeem", { withManual: v })} />
            <Toggle label="Allow with a reward on the same bill" on={c.redeem.withReward} onChange={(v) => set("redeem", { withReward: v })} />
            <ListPicker label="Categories points can't pay for" all={cats} value={c.redeem.excludedCategories} onChange={(v) => set("redeem", { excludedCategories: v })} />
            <ListPicker label="Items points can't pay for" all={prods} value={c.redeem.excludedProductIds} onChange={(v) => set("redeem", { excludedProductIds: v })} />
          </div>
        </Card>

        <Card title="Membership tiers">
          <p className="mb-3 text-[11.5px] text-slate-500">Based on lifetime points earned — redeeming never lowers a tier. Upgrades happen automatically.</p>
          <div className="space-y-3">
            {c.tiers.map((t, i) => (
              <div key={t.key} className="grid gap-2 rounded-xl border border-slate-100 p-3 sm:grid-cols-[1fr_110px_100px]">
                <input className={numIn} value={t.name} maxLength={30} onChange={(e) => set("tiers", c.tiers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) as never)} aria-label="Tier name" />
                <input className={numIn} type="number" min={0} disabled={i === 0} value={t.min} onChange={(e) => set("tiers", c.tiers.map((x, j) => (j === i ? { ...x, min: Number(e.target.value) || 0 } : x)) as never)} aria-label="From lifetime points" title="From lifetime points" />
                <input className={numIn} type="number" min={0} step={0.05} value={t.multiplier} onChange={(e) => set("tiers", c.tiers.map((x, j) => (j === i ? { ...x, multiplier: Number(e.target.value) || 0 } : x)) as never)} aria-label="Points multiplier" title="Points multiplier" />
                <input className={cx(numIn, "sm:col-span-3")} value={t.benefits} maxLength={300} onChange={(e) => set("tiers", c.tiers.map((x, j) => (j === i ? { ...x, benefits: e.target.value } : x)) as never)} placeholder="Benefits shown to staff and the member" aria-label="Benefits" />
              </div>
            ))}
            <p className="text-[11px] text-slate-400">Columns: name · from lifetime points · points multiplier.</p>
          </div>
        </Card>

        <Card title="Points expiry">
          <div className="grid gap-3 sm:grid-cols-2">
            <Num label="Points valid for (days)" value={c.expiry.days} onChange={(n) => set("expiry", { days: n })} hint="0 = never expire. Applies to points earned from now on." />
            <Num label="Warn when expiring within (days)" value={c.expiry.warnDays} min={1} onChange={(n) => set("expiry", { warnDays: n })} />
          </div>
          <p className="mt-3 text-[11.5px] text-slate-500">Oldest points are used first. Expired points are recorded in the ledger, never deleted.</p>
        </Card>

        <Card title="Visit stamps">
          <div className="space-y-3">
            <Toggle label="Digital stamp card" on={c.stamps.enabled} onChange={(v) => set("stamps", { enabled: v })} hint="Separate from points: one stamp per qualifying paid visit." />
            <div className="grid gap-3 sm:grid-cols-2">
              <Num label="Minimum bill for a stamp (₹)" value={c.stamps.minBill} onChange={(n) => set("stamps", { minBill: n })} />
              <Field label="What counts as a visit">
                <select className={numIn} value={c.stamps.rule} onChange={(e) => set("stamps", { rule: e.target.value as "per_day" })}>
                  <option value="per_day">One per day (several bills = one visit)</option>
                  <option value="per_bill">Every qualifying bill</option>
                </select>
              </Field>
            </div>
            <Tiers value={c.stamps.tiers} onChange={(t) => set("stamps", { tiers: t })} cfg={c} />
            <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">Milestones (the card restarts after the last one)</span>
            {c.stamps.milestones.map((m, i) => (
              <div key={i} className="space-y-2 rounded-xl border border-slate-100 p-3">
                <div className="flex items-end gap-2">
                  <Num label="Visit #" value={m.visits} min={1} onChange={(n) => setMs(i, { visits: n })} />
                  <Num label="Valid (days)" value={m.validityDays} min={1} onChange={(n) => setMs(i, { validityDays: n })} />
                  <Btn kind="plain" icon="trash" onClick={() => set("stamps", { milestones: c.stamps.milestones.filter((_, j) => j !== i) })} aria-label="Remove milestone" />
                </div>
                <RewardEditor r={m.reward} onChange={(r) => setMs(i, { reward: r })} products={products} />
              </div>
            ))}
            <Btn size="sm" icon="plus" onClick={() => set("stamps", { milestones: [...c.stamps.milestones, { visits: (c.stamps.milestones.at(-1)?.visits ?? 0) + 5, reward: { kind: "amount", name: "Free snack", value: 50, productId: null }, validityDays: 30 }] })}>
              Add milestone
            </Btn>
          </div>
        </Card>

        <Card title="Referrals">
          <div className="space-y-3">
            <Toggle label="Referral programme" on={c.referral.enabled} onChange={(v) => set("referral", { enabled: v })} hint="Rewards only after the new customer's first qualifying paid bill; reversed if that bill is voided." />
            <div className="grid gap-3 sm:grid-cols-2">
              <Num label="Referrer bonus (pts)" value={c.referral.referrerBonus} onChange={(n) => set("referral", { referrerBonus: n })} />
              <Num label="New customer bonus (pts)" value={c.referral.refereeBonus} onChange={(n) => set("referral", { refereeBonus: n })} />
              <Num label="Minimum first bill (₹)" value={c.referral.minPurchase} onChange={(n) => set("referral", { minPurchase: n })} />
              <Num label="Max rewards per referrer" value={c.referral.maxPerReferrer} onChange={(n) => set("referral", { maxPerReferrer: n })} hint="0 = no limit" />
              <Field label="Campaign starts">
                <input className={numIn} type="date" value={c.referral.startsOn} onChange={(e) => set("referral", { startsOn: e.target.value })} />
              </Field>
              <Field label="Campaign ends">
                <input className={numIn} type="date" value={c.referral.endsOn} onChange={(e) => set("referral", { endsOn: e.target.value })} />
              </Field>
            </div>
            <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">Referrer tiers allowed</span>
            <Tiers value={c.referral.tiers} onChange={(t) => set("referral", { tiers: t })} cfg={c} />
          </div>
        </Card>

        {occ("birthday", "Birthday")}
        {occ("anniversary", "Anniversary")}

        <Card title="Customer segments (CRM)">
          <div className="grid gap-3 sm:grid-cols-3">
            <Num label="“New” within (days)" value={c.crm.newDays} min={1} onChange={(n) => set("crm", { newDays: n })} />
            <Num label="“Regular” from visits" value={c.crm.regularVisits} min={1} onChange={(n) => set("crm", { regularVisits: n })} />
            <Num label="“Frequent” visits" value={c.crm.frequentVisits} min={1} onChange={(n) => set("crm", { frequentVisits: n })} />
            <Num label="…within (days)" value={c.crm.frequentDays} min={1} onChange={(n) => set("crm", { frequentDays: n })} />
            <Num label="“High value” spend (₹)" value={c.crm.highValue} onChange={(n) => set("crm", { highValue: n })} />
            <Num label="“VIP” spend (₹)" value={c.crm.vipSpend} onChange={(n) => set("crm", { vipSpend: n })} />
            <Num label="“At risk” after (days)" value={c.crm.atRiskDays} min={1} onChange={(n) => set("crm", { atRiskDays: n })} />
            <Num label="“Inactive” after (days)" value={c.crm.inactiveDays} min={1} onChange={(n) => set("crm", { inactiveDays: n })} />
            <Num label="“Lost” after (days)" value={c.crm.lostDays} min={1} onChange={(n) => set("crm", { lostDays: n })} />
          </div>
        </Card>
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

      <AuditLog d={d} />
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
