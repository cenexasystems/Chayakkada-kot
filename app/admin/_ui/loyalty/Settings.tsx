"use client";

import { useState } from "react";
import { rupee } from "@/lib/money";
import { DEFAULT_CONFIG, MESSAGE_FIELDS, MESSAGE_META, rangeWarnings, type LoyaltyConfig, type MessageKey, type RedeemRange } from "@/lib/loyalty/config";
import type { LoyaltyState } from "@/lib/loyalty/types";
import { useAdmin } from "../Store";
import { Btn, Card, Field, Switch as RawSwitch, cx, downloadExcel, inputLineCls } from "../kit";

/** A switch with its words next to it (the kit switch only labels itself for screen readers). */
function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <span className="inline-flex items-center gap-2.5 text-[13px] font-semibold text-slate-700">
      <RawSwitch on={on} onChange={onChange} label={label} />
      {label}
    </span>
  );
}

const note = "text-[12.5px] leading-relaxed text-slate-500";
const small = "h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-right text-[13.5px] text-slate-900 outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-100";

export default function SettingsTab({ d }: { d: LoyaltyState }) {
  // the form starts again from the saved settings whenever they change (after Save)
  return <Form key={JSON.stringify(d.config)} saved={d.config} />;
}

function Form({ saved }: { saved: LoyaltyConfig }) {
  const { s, act } = useAdmin();
  const [c, setC] = useState<LoyaltyConfig>(saved);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(c) !== JSON.stringify(saved);
  const cats = [...new Set(s.products.map((p) => p.category))].sort();

  const set = <K extends keyof LoyaltyConfig>(k: K, patch: Partial<LoyaltyConfig[K]>) => setC((x) => ({ ...x, [k]: { ...(x[k] as object), ...patch } as LoyaltyConfig[K] }));
  const warnings = rangeWarnings(c.redeem.ranges);
  const sample = c.redeem.ranges[0];
  const save = async () => {
    setBusy(true);
    await act("loyalty.config", { config: c, reason });
    setBusy(false);
    setReason("");
  };
  const yes = (v: boolean) => (v ? "On" : "Off");
  const exportSettings = () =>
    downloadExcel(`loyalty-settings-${new Date().toISOString().slice(0, 10)}`, [
      {
        name: "Settings",
        rows: [
          ["Setting", "Value"],
          ["Loyalty programme", yes(saved.enabled)],
          ["Points for every ₹100", saved.earn.per100],
          ["Value of 1 point (₹)", saved.redeem.pointValue],
          ["Smallest bill that earns points (₹)", saved.earn.minBill],
          ["Rounding of points", saved.earn.rounding],
          ["Categories that don't earn", saved.earn.excludedCategories.join(", ")],
          ["Items that don't earn", saved.earn.excludedProductIds.map((id) => s.products.find((p) => p.id === id)?.name ?? id).join(", ")],
          ["Using points", yes(saved.redeem.enabled)],
          ["Points with a coupon", yes(saved.redeem.withCoupon)],
          ["Points with a manual discount", yes(saved.redeem.withManual)],
          ["Points with a free gift", yes(saved.redeem.withReward)],
          ["Categories points can't pay for", saved.redeem.excludedCategories.join(", ")],
          ["Items points can't pay for", saved.redeem.excludedProductIds.map((id) => s.products.find((p) => p.id === id)?.name ?? id).join(", ")],
          ["Points gifts", yes(saved.gifts.points)],
          ["Spending rewards", yes(saved.gifts.milestone)],
          ["Bill offers", yes(saved.gifts.offers)],
          ["Spending rewards count every bill ever", yes(saved.gifts.countOldBills)],
          ["Restock free gifts when a bill is voided", yes(saved.gifts.restockOnVoid)],
          ["Unlocked reward valid for (days, 0 = never)", saved.gifts.validityDays],
          ["Points expire after (days, 0 = never)", saved.expiry.days],
          ["Warn before expiry (days)", saved.expiry.warnDays],
          ["Loyalty summary on receipts", yes(saved.display.receiptSummary)],
          ["Consent box starts ticked", yes(saved.display.defaultConsent)],
          ["Tidy deleted bills automatically", yes(saved.display.autoTidy)],
          ["WhatsApp messages", yes(saved.messages.enabled)],
          ...MESSAGE_META.map((m) => [`WhatsApp · ${m.label}`, `${yes(saved.messages.events[m.key])} — ${saved.messages.templates[m.key]}`]),
        ],
      },
      { name: "Points ranges", rows: [["Bill from (₹)", "Up to (₹)", "Minimum points", "Maximum points"], ...saved.redeem.ranges.map((r) => [r.from, r.to ?? "and above", r.min, r.max])] },
      { name: "Customer groups", rows: [["Setting", "Value"], ["New for the first (days)", saved.crm.newDays], ["Regular from (visits)", saved.crm.regularVisits], ["Frequent from (visits)", saved.crm.frequentVisits], ["…counted over (days)", saved.crm.frequentDays], ["High value from (₹)", saved.crm.highValue], ["VIP from (₹)", saved.crm.vipSpend], ["At risk after (days)", saved.crm.atRiskDays], ["Inactive after (days)", saved.crm.inactiveDays], ["Lost after (days)", saved.crm.lostDays]] },
    ]);
  const setRange = (i: number, patch: Partial<RedeemRange>) => set("redeem", { ranges: c.redeem.ranges.map((r, k) => (k === i ? { ...r, ...patch } : r)) });

  return (
    <div className="space-y-5">
      {/* save bar */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <Switch on={c.enabled} onChange={(v) => setC({ ...c, enabled: v })} label={c.enabled ? "Loyalty programme is on" : "Loyalty programme is off — nobody earns or uses points"} />
        <div className="flex flex-wrap items-center gap-2">
          <input className="h-10 w-64 rounded-xl border border-slate-200 bg-white px-3 text-[13px] outline-none focus:border-slate-400" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Reason for the change (audit log)" />
          <Btn icon="download" onClick={exportSettings}>
            Excel
          </Btn>
          <Btn disabled={!dirty || busy} onClick={() => setC(saved)}>
            Discard
          </Btn>
          <Btn kind="red" disabled={!dirty || busy} onClick={save}>
            {busy ? "Saving…" : "Save settings"}
          </Btn>
        </div>
      </div>

      {/* earning */}
      <Card title="Earning points">
        <p className={cx(note, "mb-4")}>Customers earn points on every <b>paid</b> bill. Points are worked out on the eligible bill amount after discounts — never on free gifts, never on the part paid with points, and never twice for the same bill.</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Points for every ₹100" hint="Default 5">
            <input type="number" min={0} step={0.5} className={small} value={c.earn.per100} onChange={(e) => set("earn", { per100: Math.max(0, Number(e.target.value) || 0), mode: "per100" })} />
          </Field>
          <Field label="Value of 1 point (₹)" hint="Default ₹0.50">
            <input type="number" min={0.01} step={0.05} className={small} value={c.redeem.pointValue} onChange={(e) => set("redeem", { pointValue: Math.max(0.01, Number(e.target.value) || 0.01) })} />
          </Field>
          <Field label="Smallest bill that earns points (₹)" hint="0 = every bill">
            <input type="number" min={0} className={small} value={c.earn.minBill} onChange={(e) => set("earn", { minBill: Math.max(0, Number(e.target.value) || 0) })} />
          </Field>
          <Field label="Rounding of points" hint="A ₹250 bill is 12.5 points">
            <select className={inputLineCls} value={c.earn.rounding} onChange={(e) => set("earn", { rounding: e.target.value as LoyaltyConfig["earn"]["rounding"] })}>
              <option value="floor">Round down (12)</option>
              <option value="round">Nearest (13)</option>
              <option value="ceil">Round up (13)</option>
            </select>
          </Field>
        </div>
        <div className="mt-4">
          <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">Categories that don&apos;t earn points</span>
          <Chips all={cats} picked={c.earn.excludedCategories} onChange={(v) => set("earn", { excludedCategories: v })} none="Every category earns points" />
        </div>
        <div className="mt-4">
          <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">Items that don&apos;t earn points</span>
          <ItemPicker products={s.products} picked={c.earn.excludedProductIds} onChange={(v) => set("earn", { excludedProductIds: v })} none="Every item earns points" />
        </div>
        <p className="mt-4 rounded-xl bg-slate-50 px-3.5 py-2.5 text-[13px] text-slate-700">
          <b>In plain words:</b> {c.earn.per100} points for every ₹100 — a ₹500 bill earns {Math.floor((500 / 100) * c.earn.per100 + 1e-9)} points. 1 point is worth {rupee(c.redeem.pointValue)}, so those points are worth {rupee(Math.floor((500 / 100) * c.earn.per100 + 1e-9) * c.redeem.pointValue)}.
        </p>
      </Card>

      {/* redeeming */}
      <Card title="Using points on a bill" right={<Switch on={c.redeem.enabled} onChange={(v) => set("redeem", { enabled: v })} label={c.redeem.enabled ? "On" : "Off"} />}>
        <p className={cx(note, "mb-4")}>How many points a customer may use depends on the size of the bill. Find the range the bill falls in: they must use at least the minimum and at most the maximum (and never more than they own, or more than the bill).</p>
        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <table className="w-full min-w-[560px] text-[13px]">
            <thead className="bg-slate-50 text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Bill from (₹)</th>
                <th className="px-3 py-2 text-left">Up to (₹)</th>
                <th className="px-3 py-2 text-left">Minimum points</th>
                <th className="px-3 py-2 text-left">Maximum points</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {c.redeem.ranges.map((r, i) => (
                <tr key={i}>
                  <td className="px-3 py-2">
                    <input type="number" min={0} className={small} value={r.from} onChange={(e) => setRange(i, { from: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" min={0} className={small} value={r.to ?? ""} placeholder="and above" onChange={(e) => setRange(i, { to: e.target.value === "" ? null : Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" min={1} className={small} value={r.min} onChange={(e) => setRange(i, { min: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" min={1} className={small} value={r.max} onChange={(e) => setRange(i, { max: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Btn size="sm" kind="warn" icon="trash" aria-label="Delete range" onClick={() => set("redeem", { ranges: c.redeem.ranges.filter((_, k) => k !== i) })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Btn size="sm" icon="plus" onClick={() => set("redeem", { ranges: [...c.redeem.ranges, { from: (c.redeem.ranges.at(-1)?.to ?? c.redeem.ranges.at(-1)?.from ?? 0) + 1, to: null, min: 20, max: 40 }] })}>
            Add range
          </Btn>
          <Btn size="sm" onClick={() => set("redeem", { ranges: DEFAULT_CONFIG.redeem.ranges })}>
            Use the suggested ranges
          </Btn>
        </div>
        {warnings.length > 0 && (
          <ul className="mt-3 space-y-1 rounded-xl bg-amber-50 px-3.5 py-2.5 text-[12.5px] font-semibold text-amber-800">
            {warnings.map((w) => (
              <li key={w}>⚠ {w}</li>
            ))}
          </ul>
        )}
        <p className="mt-3 rounded-xl bg-slate-50 px-3.5 py-2.5 text-[13px] text-slate-700">
          <b>In plain words:</b>{" "}
          {sample
            ? `on a bill of ${rupee(sample.from)}${sample.to === null ? " or more" : ` to ${rupee(sample.to)}`}, a customer can use ${sample.min} to ${sample.max} points — that takes ${rupee(sample.min * c.redeem.pointValue)} to ${rupee(sample.max * c.redeem.pointValue)} off.`
            : "no range is set, so points can't be used."}
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-[13px] text-slate-700">
            <input type="checkbox" checked={c.redeem.withCoupon} onChange={(e) => set("redeem", { withCoupon: e.target.checked })} /> Allow points on a bill that already has a coupon
          </label>
          <label className="flex items-center gap-2 text-[13px] text-slate-700">
            <input type="checkbox" checked={c.redeem.withManual} onChange={(e) => set("redeem", { withManual: e.target.checked })} /> Allow points on a bill with a manual discount
          </label>
          <label className="flex items-center gap-2 text-[13px] text-slate-700">
            <input type="checkbox" checked={c.redeem.withReward} onChange={(e) => set("redeem", { withReward: e.target.checked })} /> Allow points on a bill that also claims a free gift
          </label>
        </div>
        <div className="mt-4">
          <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">Categories that can&apos;t be paid for with points</span>
          <Chips all={cats} picked={c.redeem.excludedCategories} onChange={(v) => set("redeem", { excludedCategories: v })} none="Points can pay for any category" />
        </div>
        <div className="mt-4">
          <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">Items that can&apos;t be paid for with points</span>
          <ItemPicker products={s.products} picked={c.redeem.excludedProductIds} onChange={(v) => set("redeem", { excludedProductIds: v })} none="Points can pay for any item" />
        </div>
      </Card>

      {/* gifts */}
      <Card title="Free gifts">
        <p className={cx(note, "mb-3")}>Create the gifts themselves in <b>Free Gifts &amp; Rewards</b>. Here you can switch each kind on or off.</p>
        <div className="space-y-3">
          <Switch on={c.gifts.points} onChange={(v) => set("gifts", { points: v })} label="Gifts customers unlock with points" />
          <Switch on={c.gifts.milestone} onChange={(v) => set("gifts", { milestone: v })} label="Gifts for total spending" />
          <Switch on={c.gifts.offers} onChange={(v) => set("gifts", { offers: v })} label="Offers on the bill (spend ₹500, get a juice…)" />
        </div>
        <div className="mt-4 space-y-2.5 border-t border-slate-100 pt-4">
          <label className="flex items-start gap-2.5 text-[13px] text-slate-700">
            <input type="checkbox" className="mt-0.5" checked={c.gifts.countOldBills} onChange={(e) => set("gifts", { countOldBills: e.target.checked })} />
            <span>
              <b>Spending rewards count every bill ever paid</b>, not only bills from the day the reward was created. <span className="text-slate-500">Careful: turning this on can unlock gifts for customers right away.</span>
            </span>
          </label>
          <label className="flex items-start gap-2.5 text-[13px] text-slate-700">
            <input type="checkbox" className="mt-0.5" checked={c.gifts.restockOnVoid} onChange={(e) => set("gifts", { restockOnVoid: e.target.checked })} />
            <span>
              <b>Put free gifts back in stock when a bill is voided or deleted.</b> <span className="text-slate-500">Off = the gift was already handed over, so only the paid items go back.</span>
            </span>
          </label>
          <Field label="An unlocked spending reward stays valid for (days)" hint="0 = it never expires">
            <input type="number" min={0} className={small} value={c.gifts.validityDays} onChange={(e) => set("gifts", { validityDays: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
          </Field>
        </div>
      </Card>

      {/* expiry */}
      <Card title="Points expiry">
        <p className={cx(note, "mb-3")}>Leave at 0 if points should never run out. Otherwise points expire this many days after they were earned — the oldest are used first — and customers are flagged a little before.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Points expire after (days)" hint="0 = never. Applies to points earned from now on.">
            <input type="number" min={0} className={small} value={c.expiry.days} onChange={(e) => set("expiry", { days: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
          </Field>
          <Field label="Warn this many days before" hint="Shown on the customer's profile">
            <input type="number" min={1} className={small} value={c.expiry.warnDays} onChange={(e) => set("expiry", { warnDays: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
          </Field>
        </div>
      </Card>

      {/* customer groups */}
      <Card title="Customer groups (CRM)">
        <p className={cx(note, "mb-3")}>Every loyalty customer is put in a group from their paid bills — shown in the Customer CRM tab. These numbers decide where the lines fall.</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="“New” for the first (days)">
            <input type="number" min={1} className={small} value={c.crm.newDays} onChange={(e) => set("crm", { newDays: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
          </Field>
          <Field label="“Regular” from (visits)">
            <input type="number" min={1} className={small} value={c.crm.regularVisits} onChange={(e) => set("crm", { regularVisits: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
          </Field>
          <Field label="“Frequent” from (visits)">
            <input type="number" min={1} className={small} value={c.crm.frequentVisits} onChange={(e) => set("crm", { frequentVisits: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
          </Field>
          <Field label="…counted over the last (days)">
            <input type="number" min={1} className={small} value={c.crm.frequentDays} onChange={(e) => set("crm", { frequentDays: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
          </Field>
          <Field label="“High value” from spending (₹)">
            <input type="number" min={0} className={small} value={c.crm.highValue} onChange={(e) => set("crm", { highValue: Math.max(0, Number(e.target.value) || 0) })} />
          </Field>
          <Field label="“VIP” from spending (₹)">
            <input type="number" min={0} className={small} value={c.crm.vipSpend} onChange={(e) => set("crm", { vipSpend: Math.max(0, Number(e.target.value) || 0) })} />
          </Field>
          <Field label="“At risk” after (days away)">
            <input type="number" min={1} className={small} value={c.crm.atRiskDays} onChange={(e) => set("crm", { atRiskDays: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
          </Field>
          <Field label="“Inactive” after (days away)">
            <input type="number" min={1} className={small} value={c.crm.inactiveDays} onChange={(e) => set("crm", { inactiveDays: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
          </Field>
          <Field label="“Lost” after (days away)">
            <input type="number" min={1} className={small} value={c.crm.lostDays} onChange={(e) => set("crm", { lostDays: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
          </Field>
        </div>
      </Card>

      {/* billing and receipts */}
      <Card title="Billing &amp; receipts">
        <div className="space-y-2.5">
          <label className="flex items-start gap-2.5 text-[13px] text-slate-700">
            <input type="checkbox" className="mt-0.5" checked={c.display.receiptSummary} onChange={(e) => set("display", { receiptSummary: e.target.checked })} />
            <span>
              <b>Print the loyalty summary</b> (previous balance, earned, redeemed, remaining) on receipts and the invoice page for loyalty customers. <span className="text-slate-500">Bills without a loyalty customer never show it.</span>
            </span>
          </label>
          <label className="flex items-start gap-2.5 text-[13px] text-slate-700">
            <input type="checkbox" className="mt-0.5" checked={c.display.defaultConsent} onChange={(e) => set("display", { defaultConsent: e.target.checked })} />
            <span>
              <b>Start with &ldquo;agrees to WhatsApp messages&rdquo; ticked</b> when adding a customer. <span className="text-slate-500">Only tick this if you always ask the customer first.</span>
            </span>
          </label>
          <label className="flex items-start gap-2.5 text-[13px] text-slate-700">
            <input type="checkbox" className="mt-0.5" checked={c.display.autoTidy} onChange={(e) => set("display", { autoTidy: e.target.checked })} />
            <span>
              <b>Tidy up automatically</b> — when this page opens, remove the loyalty records of bills that were deleted.
            </span>
          </label>
        </div>
      </Card>

      {/* whatsapp */}
      <Card title="WhatsApp messages" right={<Switch on={c.messages.enabled} onChange={(v) => set("messages", { enabled: v })} label={c.messages.enabled ? "On" : "Off"} />}>
        <p className={cx(note, "mb-4")}>
          Messages are prepared after each event and kept in the customer&apos;s history — only for customers who agreed to WhatsApp messages. A browser can&apos;t send WhatsApp by itself, so staff tap <b>Send on WhatsApp</b> to open the chat with the message ready. WhatsApp doesn&apos;t report delivery, so they are shown as &ldquo;Opened in WhatsApp&rdquo;, never &ldquo;Sent&rdquo;. Billing is never held up by a message.
        </p>
        <div className="space-y-4">
          {MESSAGE_META.map((m) => (
            <div key={m.key} className="rounded-xl border border-slate-100 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <b className="text-[13.5px] text-slate-900">{m.label}</b>
                  <span className="block text-[12px] text-slate-500">{m.when}</span>
                </span>
                <Switch on={c.messages.events[m.key]} onChange={(v) => set("messages", { events: { ...c.messages.events, [m.key]: v } })} label={c.messages.events[m.key] ? "On" : "Off"} />
              </div>
              <textarea
                className={cx(inputLineCls, "mt-2.5 h-24 resize-y py-2.5 leading-relaxed")}
                value={c.messages.templates[m.key]}
                maxLength={600}
                onChange={(e) => set("messages", { templates: { ...c.messages.templates, [m.key]: e.target.value } as Record<MessageKey, string> })}
                aria-label={`${m.label} message`}
              />
              {c.messages.templates[m.key] !== DEFAULT_CONFIG.messages.templates[m.key] && (
                <button type="button" className="mt-1 text-[12px] font-semibold text-red-600 hover:underline" onClick={() => set("messages", { templates: { ...c.messages.templates, [m.key]: DEFAULT_CONFIG.messages.templates[m.key] } as Record<MessageKey, string> })}>
                  Use the standard wording
                </button>
              )}
            </div>
          ))}
        </div>
        <p className="mt-3 text-[12px] text-slate-500">
          Words that are filled in for each customer: {MESSAGE_FIELDS.map((f) => `{${f}}`).join("  ")}
        </p>
      </Card>
    </div>
  );
}

/** Pick individual menu items from a list; the chosen ones show as chips that can be removed. */
function ItemPicker({ products, picked, onChange, none }: { products: { id: string; name: string; category: string }[]; picked: string[]; onChange: (v: string[]) => void; none: string }) {
  const left = [...products].filter((p) => !picked.includes(p.id)).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  const name = (id: string) => products.find((p) => p.id === id)?.name ?? "(removed item)";
  return (
    <div className="space-y-2">
      <select className={inputLineCls} value="" onChange={(e) => e.target.value && onChange([...picked, e.target.value])} aria-label="Add an item">
        <option value="">Add an item…</option>
        {left.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} — {p.category}
          </option>
        ))}
      </select>
      <div className="flex flex-wrap items-center gap-2">
        {picked.map((id) => (
          <button key={id} type="button" onClick={() => onChange(picked.filter((x) => x !== id))} className="h-8 rounded-full border border-red-600 bg-red-600 px-3 text-[12.5px] font-semibold text-white" title="Remove">
            ✕ {name(id)}
          </button>
        ))}
        {!picked.length && <span className="text-[12px] text-slate-400">{none}</span>}
      </div>
    </div>
  );
}

/** Toggle chips for a list of choices. */
function Chips({ all, picked, onChange, none }: { all: string[]; picked: string[]; onChange: (v: string[]) => void; none: string }) {
  if (!all.length) return <p className="text-[12.5px] text-slate-400">No categories yet.</p>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {all.map((x) => {
        const on = picked.includes(x);
        return (
          <button key={x} type="button" onClick={() => onChange(on ? picked.filter((y) => y !== x) : [...picked, x])} className={cx("h-8 rounded-full border px-3 text-[12.5px] font-semibold transition", on ? "border-red-600 bg-red-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50")}>
            {on ? "✕ " : ""}
            {x}
          </button>
        );
      })}
      {!picked.length && <span className="text-[12px] text-slate-400">{none}</span>}
    </div>
  );
}
