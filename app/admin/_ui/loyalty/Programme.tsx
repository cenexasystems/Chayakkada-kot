"use client";

import { useState } from "react";
import { rupee } from "@/lib/money";
import { TIER_KEYS, type TierKey } from "@/lib/loyalty/config";
import { campaignLive, rewardAvailable, SEGMENTS, tierByKey } from "@/lib/loyalty/engine";
import type { Campaign, LoyaltyState, Reward, Segment } from "@/lib/loyalty/types";
import { useAdmin } from "../Store";
import { Badge, Btn, Empty, Field, Modal, cx, fmtDate, inputLineCls } from "../kit";

const chip = (on: boolean) => cx("h-8 rounded-lg border px-3 text-[12px] font-bold transition", on ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-400");

function TierPicker({ value, onChange, d }: { value: TierKey[]; onChange: (v: TierKey[]) => void; d: LoyaltyState }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <button type="button" className={chip(!value.length)} onClick={() => onChange([])}>
        All tiers
      </button>
      {TIER_KEYS.map((k) => (
        <button key={k} type="button" className={chip(value.includes(k))} onClick={() => onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k])}>
          {tierByKey(k, d.config).name}
        </button>
      ))}
    </div>
  );
}

/* ================================ rewards ================================ */

type RF = { id?: string; name: string; description: string; imageUrl: string; category: string; kind: Reward["kind"]; value: string; productId: string; pointsCost: string; tiers: TierKey[]; startsOn: string; endsOn: string; active: boolean; maxRedemptions: string; perCustomerLimit: string; terms: string };
const RBLANK: RF = { name: "", description: "", imageUrl: "", category: "", kind: "free_item", value: "", productId: "", pointsCost: "100", tiers: [], startsOn: "", endsOn: "", active: true, maxRedemptions: "", perCustomerLimit: "", terms: "" };

export function Rewards({ d }: { d: LoyaltyState }) {
  const { s, act, confirm, toast } = useAdmin();
  const [f, setF] = useState<RF | null>(null);
  const [busy, setBusy] = useState(false);
  const prod = (id: string | null) => s.products.find((p) => p.id === id)?.name;
  const save = async () => {
    if (!f) return;
    setBusy(true);
    const r = await act<Reward>("loyalty.reward.save", { ...f, maxRedemptions: f.maxRedemptions || null, perCustomerLimit: f.perCustomerLimit || null });
    setBusy(false);
    if (r.ok) {
      toast({ kind: "ok", title: `${r.result.name} saved` });
      setF(null);
    }
  };
  const del = async (r: Reward) => {
    if (!(await confirm({ title: `Remove ${r.name}?`, body: r.redeemed ? "It has been redeemed before, so it will be switched off and kept for the history." : "It has never been redeemed, so it will be deleted.", ok: "Remove", danger: true }))) return;
    await act("loyalty.reward.delete", { id: r.id });
  };
  const edit = (r: Reward) => setF({ id: r.id, name: r.name, description: r.description, imageUrl: r.imageUrl, category: r.category, kind: r.kind, value: r.value ? String(r.value) : "", productId: r.productId ?? "", pointsCost: String(r.pointsCost), tiers: r.tiers, startsOn: r.startsOn ?? "", endsOn: r.endsOn ?? "", active: r.active, maxRedemptions: r.maxRedemptions === null ? "" : String(r.maxRedemptions), perCustomerLimit: r.perCustomerLimit === null ? "" : String(r.perCustomerLimit), terms: r.terms });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-slate-500">Rewards members can redeem with points at billing (or for free, when points cost is 0). Visit-milestone and birthday rewards are set on the Settings tab.</p>
        <Btn kind="red" icon="plus" onClick={() => setF(RBLANK)}>
          New reward
        </Btn>
      </div>
      {!d.rewards.length ? (
        <Empty icon="star" title="No rewards yet">
          Add a free tea, a snack, ₹50 off or a VIP treat — then staff can redeem it from Billing.
        </Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {d.rewards.map((r) => {
            const why = rewardAvailable(r, r.tiers[0] ?? "bronze"); // availability without the tier check
            return (
              <div key={r.id} className={cx("rounded-2xl border bg-white p-4 shadow-[0_1px_4px_rgba(15,23,42,.05)]", r.active ? "border-slate-100" : "border-dashed border-slate-200 opacity-70")}>
                <div className="flex items-start justify-between gap-2">
                  <b className="text-[15px] text-slate-900">{r.name}</b>
                  <Badge tone={!why ? "green" : "slate"}>{!why ? "Live" : why}</Badge>
                </div>
                <p className="mt-1 text-[14px] font-extrabold text-red-600">
                  {r.kind === "free_item" ? `Free ${prod(r.productId) ?? "item"}` : r.kind === "percent" ? `${r.value}% off` : `${rupee(r.value)} off`}
                  <span className="ml-2 text-[12.5px] font-semibold text-slate-500">{r.pointsCost ? `${r.pointsCost} pts` : "free"}</span>
                </p>
                {r.description && <p className="mt-1 text-[12px] text-slate-500">{r.description}</p>}
                <p className="mt-1 text-[11.5px] text-slate-400">
                  {r.tiers.length ? r.tiers.map((t) => tierByKey(t, d.config).name).join(", ") : "All tiers"} · redeemed {r.redeemed}
                  {r.maxRedemptions !== null && ` of ${r.maxRedemptions}`}
                  {r.perCustomerLimit !== null && ` · ${r.perCustomerLimit} per customer`}
                  {(r.startsOn || r.endsOn) && ` · ${r.startsOn || "…"} → ${r.endsOn || "…"}`}
                </p>
                <div className="mt-3 flex gap-2">
                  <Btn size="sm" icon="edit" onClick={() => edit(r)}>
                    Edit
                  </Btn>
                  <Btn size="sm" kind="warn" icon="trash" onClick={() => del(r)}>
                    Remove
                  </Btn>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {f && (
        <Modal
          open
          wide
          onClose={() => setF(null)}
          title={f.id ? `Edit ${f.name || "reward"}` : "New reward"}
          footer={
            <>
              <Btn onClick={() => setF(null)}>Cancel</Btn>
              <Btn kind="red" disabled={busy || !f.name.trim()} onClick={save}>
                {busy ? "Saving…" : "Save reward"}
              </Btn>
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name *">
              <input className={inputLineCls} value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Free masala chai" />
            </Field>
            <Field label="Category">
              <input className={inputLineCls} value={f.category} maxLength={40} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="e.g. Drinks, VIP, Birthday" />
            </Field>
            <Field label="Type">
              <select className={inputLineCls} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Reward["kind"] })}>
                <option value="free_item">Free item</option>
                <option value="amount">Fixed ₹ off</option>
                <option value="percent">% off the bill</option>
              </select>
            </Field>
            {f.kind === "free_item" ? (
              <Field label="Free item *" hint="Add it to the bill; the reward takes one of it off.">
                <select className={inputLineCls} value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })}>
                  <option value="">Pick an item…</option>
                  {s.products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {rupee(p.price)}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field label={f.kind === "percent" ? "Percent off *" : "Rupees off *"}>
                <input className={inputLineCls} type="number" min={1} value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
              </Field>
            )}
            <Field label="Points required" hint="0 = a free promotional reward">
              <input className={inputLineCls} type="number" min={0} value={f.pointsCost} onChange={(e) => setF({ ...f, pointsCost: e.target.value })} />
            </Field>
            <Field label="Image link">
              <input className={inputLineCls} value={f.imageUrl} maxLength={500} onChange={(e) => setF({ ...f, imageUrl: e.target.value })} placeholder="https://… (optional)" />
            </Field>
            <Field label="Starts">
              <input className={inputLineCls} type="date" value={f.startsOn} onChange={(e) => setF({ ...f, startsOn: e.target.value })} />
            </Field>
            <Field label="Ends">
              <input className={inputLineCls} type="date" value={f.endsOn} onChange={(e) => setF({ ...f, endsOn: e.target.value })} />
            </Field>
            <Field label="Max redemptions (total)">
              <input className={inputLineCls} type="number" min={1} value={f.maxRedemptions} onChange={(e) => setF({ ...f, maxRedemptions: e.target.value })} placeholder="Unlimited" />
            </Field>
            <Field label="Per-customer limit">
              <input className={inputLineCls} type="number" min={1} value={f.perCustomerLimit} onChange={(e) => setF({ ...f, perCustomerLimit: e.target.value })} placeholder="Unlimited" />
            </Field>
            <Field label="Description" className="sm:col-span-2">
              <input className={inputLineCls} value={f.description} maxLength={300} onChange={(e) => setF({ ...f, description: e.target.value })} />
            </Field>
            <Field label="Terms & conditions" className="sm:col-span-2">
              <input className={inputLineCls} value={f.terms} maxLength={500} onChange={(e) => setF({ ...f, terms: e.target.value })} placeholder="e.g. Dine-in only, one per visit" />
            </Field>
            <div className="sm:col-span-2">
              <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">Membership tiers</span>
              <TierPicker d={d} value={f.tiers} onChange={(tiers) => setF({ ...f, tiers })} />
            </div>
            <label className="flex items-center gap-2 text-[13px] text-slate-700">
              <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Available
            </label>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ================================ campaigns ================================ */

type CF = { id?: string; name: string; description: string; type: Campaign["type"]; value: string; startsOn: string; endsOn: string; startTime: string; endTime: string; days: number[]; minPurchase: string; tiers: TierKey[]; segments: Segment[]; categories: string[]; usageLimit: string; perCustomerLimit: string; active: boolean };
const CBLANK: CF = { name: "", description: "", type: "multiplier", value: "2", startsOn: "", endsOn: "", startTime: "", endTime: "", days: [], minPurchase: "", tiers: [], segments: [], categories: [], usageLimit: "", perCustomerLimit: "", active: true };
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function Campaigns({ d }: { d: LoyaltyState }) {
  const { s, act, confirm, toast, now } = useAdmin();
  const [f, setF] = useState<CF | null>(null);
  const [busy, setBusy] = useState(false);
  const cats = [...new Set(s.products.map((p) => p.category).filter(Boolean))].sort();
  const save = async () => {
    if (!f) return;
    setBusy(true);
    const r = await act<Campaign>("loyalty.campaign.save", { ...f, usageLimit: f.usageLimit || null, perCustomerLimit: f.perCustomerLimit || null });
    setBusy(false);
    if (r.ok) {
      toast({ kind: "ok", title: `${r.result.name} saved` });
      setF(null);
    }
  };
  const del = async (c: Campaign) => {
    if (!(await confirm({ title: `Remove ${c.name}?`, body: c.used ? "It has been used, so it will be switched off and kept for reporting." : "It has never been used, so it will be deleted.", ok: "Remove", danger: true }))) return;
    await act("loyalty.campaign.delete", { id: c.id });
  };
  const edit = (c: Campaign) => setF({ id: c.id, name: c.name, description: c.description, type: c.type, value: String(c.value), startsOn: c.startsOn, endsOn: c.endsOn, startTime: c.startTime, endTime: c.endTime, days: c.days, minPurchase: c.minPurchase ? String(c.minPurchase) : "", tiers: c.tiers, segments: c.segments, categories: c.categories, usageLimit: c.usageLimit === null ? "" : String(c.usageLimit), perCustomerLimit: c.perCustomerLimit === null ? "" : String(c.perCustomerLimit), active: c.active });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[13px] text-slate-500">
          Points promotions that apply automatically to members&apos; paid bills — double-points days, weekend or festival bonuses, tier- or segment-only offers. Discount codes stay on the Coupons page; to send bonus points or a reward to a group, use Customer CRM.
        </p>
        <Btn kind="red" icon="plus" onClick={() => setF(CBLANK)}>
          New campaign
        </Btn>
      </div>
      {!d.campaigns.length ? (
        <Empty icon="zap" title="No campaigns yet">
          Try “Double points weekend”: multiplier 2×, Saturday and Sunday.
        </Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {d.campaigns.map((c) => {
            const live = campaignLive(c, now);
            return (
              <div key={c.id} className={cx("rounded-2xl border bg-white p-4 shadow-[0_1px_4px_rgba(15,23,42,.05)]", c.active ? "border-slate-100" : "border-dashed border-slate-200 opacity-70")}>
                <div className="flex items-start justify-between gap-2">
                  <b className="text-[15px] text-slate-900">{c.name}</b>
                  <Badge tone={live ? "green" : c.active ? "amber" : "slate"}>{live ? "Running now" : c.active ? "Scheduled" : "Off"}</Badge>
                </div>
                <p className="mt-1 text-[14px] font-extrabold text-red-600">{c.type === "multiplier" ? `${c.value}× points` : `+${c.value} bonus pts`}</p>
                <p className="mt-1 text-[11.5px] text-slate-500">
                  {[c.startsOn || c.endsOn ? `${c.startsOn || "…"} → ${c.endsOn || "…"}` : "No end date", c.days.length ? c.days.map((x) => WD[x]).join(", ") : "", c.startTime || c.endTime ? `${c.startTime || "00:00"}–${c.endTime || "23:59"}` : "", c.minPurchase ? `min ${rupee(c.minPurchase)}` : "", c.tiers.length ? c.tiers.map((t) => tierByKey(t, d.config).name).join("/") : "", c.segments.length ? c.segments.map((x) => SEGMENTS.find((y) => y.key === x)?.label).join("/") : "", c.categories.length ? c.categories.join("/") : ""].filter(Boolean).join(" · ")}
                </p>
                <p className="mt-2 text-[12px] font-semibold text-slate-700">
                  Used on {c.used} bill{c.used === 1 ? "" : "s"}
                  {c.usageLimit !== null && ` of ${c.usageLimit}`} · {c.pointsGiven} pts given
                </p>
                <p className="text-[11px] text-slate-400">Created {fmtDate(c.createdAt)}</p>
                <div className="mt-3 flex gap-2">
                  <Btn size="sm" icon="edit" onClick={() => edit(c)}>
                    Edit
                  </Btn>
                  <Btn size="sm" kind="warn" icon="trash" onClick={() => del(c)}>
                    Remove
                  </Btn>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {f && (
        <Modal
          open
          wide
          onClose={() => setF(null)}
          title={f.id ? `Edit ${f.name || "campaign"}` : "New campaign"}
          footer={
            <>
              <Btn onClick={() => setF(null)}>Cancel</Btn>
              <Btn kind="red" disabled={busy || !f.name.trim()} onClick={save}>
                {busy ? "Saving…" : "Save campaign"}
              </Btn>
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name *">
              <input className={inputLineCls} value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Diwali double points" />
            </Field>
            <Field label="Type">
              <select className={inputLineCls} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as Campaign["type"], value: e.target.value === "multiplier" ? "2" : "25" })}>
                <option value="multiplier">Points multiplier (e.g. 2× points)</option>
                <option value="bonus">Bonus points per bill</option>
              </select>
            </Field>
            <Field label={f.type === "multiplier" ? "Multiplier" : "Bonus points"}>
              <input className={inputLineCls} type="number" min={f.type === "multiplier" ? 1.1 : 1} step={f.type === "multiplier" ? 0.5 : 1} value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
            </Field>
            <Field label="Minimum bill (₹)">
              <input className={inputLineCls} type="number" min={0} value={f.minPurchase} onChange={(e) => setF({ ...f, minPurchase: e.target.value })} placeholder="0" />
            </Field>
            <Field label="Start date">
              <input className={inputLineCls} type="date" value={f.startsOn} onChange={(e) => setF({ ...f, startsOn: e.target.value })} />
            </Field>
            <Field label="End date">
              <input className={inputLineCls} type="date" value={f.endsOn} onChange={(e) => setF({ ...f, endsOn: e.target.value })} />
            </Field>
            <Field label="From time">
              <input className={inputLineCls} type="time" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} />
            </Field>
            <Field label="To time">
              <input className={inputLineCls} type="time" value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} />
            </Field>
            <Field label="Total usage limit (bills)">
              <input className={inputLineCls} type="number" min={1} value={f.usageLimit} onChange={(e) => setF({ ...f, usageLimit: e.target.value })} placeholder="Unlimited" />
            </Field>
            <Field label="Per-customer limit (bills)">
              <input className={inputLineCls} type="number" min={1} value={f.perCustomerLimit} onChange={(e) => setF({ ...f, perCustomerLimit: e.target.value })} placeholder="Unlimited" />
            </Field>
            <Field label="Description" className="sm:col-span-2">
              <input className={inputLineCls} value={f.description} maxLength={300} onChange={(e) => setF({ ...f, description: e.target.value })} />
            </Field>
            <div className="sm:col-span-2">
              <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">Days of the week</span>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" className={chip(!f.days.length)} onClick={() => setF({ ...f, days: [] })}>
                  Every day
                </button>
                {WD.map((w, i) => (
                  <button key={w} type="button" className={chip(f.days.includes(i))} onClick={() => setF({ ...f, days: f.days.includes(i) ? f.days.filter((x) => x !== i) : [...f.days, i] })}>
                    {w}
                  </button>
                ))}
              </div>
            </div>
            <div className="sm:col-span-2">
              <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">Membership tiers</span>
              <TierPicker d={d} value={f.tiers} onChange={(tiers) => setF({ ...f, tiers })} />
            </div>
            <div className="sm:col-span-2">
              <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">Customer segments</span>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" className={chip(!f.segments.length)} onClick={() => setF({ ...f, segments: [] })}>
                  Everyone
                </button>
                {SEGMENTS.map((x) => (
                  <button key={x.key} type="button" className={chip(f.segments.includes(x.key))} onClick={() => setF({ ...f, segments: f.segments.includes(x.key) ? f.segments.filter((y) => y !== x.key) : [...f.segments, x.key] })}>
                    {x.label}
                  </button>
                ))}
              </div>
            </div>
            {cats.length > 0 && (
              <div className="sm:col-span-2">
                <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">Only when the bill has (categories)</span>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" className={chip(!f.categories.length)} onClick={() => setF({ ...f, categories: [] })}>
                    Any item
                  </button>
                  {cats.map((c) => (
                    <button key={c} type="button" className={chip(f.categories.includes(c))} onClick={() => setF({ ...f, categories: f.categories.includes(c) ? f.categories.filter((y) => y !== c) : [...f.categories, c] })}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <label className="flex items-center gap-2 text-[13px] text-slate-700">
              <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active
            </label>
          </div>
        </Modal>
      )}
    </div>
  );
}
