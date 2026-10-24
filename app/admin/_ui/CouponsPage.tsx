"use client";

import { useRef, useState } from "react";
import type { Coupon } from "@/lib/types";
import { couponStatus, rupee } from "@/lib/money";
import { useAdmin } from "./Store";
import { Btn, Empty, Icon, Page, PageHead, SearchBox, cx, labelCls } from "./kit";

type Form = { id?: string; code: string; percent: string; minOrder: string; expiresAt: string; limit: string; active: boolean };
const EMPTY: Form = { code: "", percent: "", minOrder: "", expiresAt: "", limit: "", active: true };

const field = "h-12 w-full rounded-xl bg-slate-50 px-4 text-[14px] font-medium text-slate-900 outline-none ring-slate-100 transition placeholder:text-slate-400 focus:bg-white focus:ring-4";
const STATUS = {
  active: ["Active", "text-emerald-600"],
  expired: ["Expired", "text-red-600"],
  exhausted: ["Used up", "text-red-600"],
  paused: ["Paused", "text-slate-500"],
} as const;

function gen() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const r = new Uint32Array(7);
  crypto.getRandomValues(r);
  return Array.from(r, (n) => A[n % A.length]).join("");
}

const ddmmyyyy = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return `${day}/${m}/${y}`;
};

/* The form sits on the left and is always open; the list sits on the right. Editing a
   coupon loads it into the same form. */
export default function CouponsPage() {
  const { s, act, confirm, toast, refresh } = useAdmin();
  const [f, setF] = useState<Form>(EMPTY);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await act<Coupon>("coupon.save", { ...f, limit: f.limit || null, minOrder: f.minOrder || 0 });
    setBusy(false);
    if (r.ok) {
      toast({ kind: "ok", title: f.id ? `${r.result.code} updated` : `${r.result.code} created — it's ready in Billing.` });
      setF(EMPTY);
    }
  };

  const edit = (c: Coupon) => {
    setF({ id: c.id, code: c.code, percent: String(c.percent), minOrder: c.minOrder ? String(c.minOrder) : "", expiresAt: c.expiresAt ?? "", limit: c.limit === null ? "" : String(c.limit), active: c.active });
    // on a phone the form is above the list, so bring it into view
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const remove = async (c: Coupon) => {
    if (await confirm({ title: `Delete ${c.code}?`, body: "Past bills keep the coupon code on record.", ok: "Delete", danger: true })) {
      const r = await act("coupon.delete", { id: c.id });
      if (r.ok && f.id === c.id) setF(EMPTY);
    }
  };

  const list = s.coupons.filter((c) => !q || c.code.toLowerCase().includes(q.toLowerCase()));

  return (
    <Page>
      <PageHead
        title="Coupon Management"
        right={
          <Btn icon="refresh" onClick={() => refresh()} className="h-10">
            Refresh
          </Btn>
        }
      />

      <p className="mb-6 rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-[13px] font-semibold text-sky-700">
        Coupon discount applies to the product subtotal only — not extra charges or GST. Guests can enter a code from their phone; staff can apply one in Billing.
      </p>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {/* ---------- new / edit ---------- */}
        <section className="scroll-mt-4 rounded-3xl border border-slate-100 bg-white p-5 shadow-[0_2px_12px_-4px_rgba(15,23,42,.1)] sm:p-8">
          <div className="mb-6 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-[18px] font-bold text-slate-900">
              {f.id ? (
                <>
                  <Icon name="edit" size={17} /> Edit {f.code || "coupon"}
                </>
              ) : (
                <>
                  <Icon name="plus" size={18} /> New Coupon
                </>
              )}
            </h2>
            {f.id && (
              <button type="button" onClick={() => setF(EMPTY)} className="text-[12.5px] font-bold text-slate-500 hover:text-slate-900">
                Cancel edit
              </button>
            )}
          </div>

          <form ref={formRef} onSubmit={save} className="space-y-5">
            <label className="block">
              <span className={labelCls}>Coupon code *</span>
              <span className="relative block">
                <input
                  className={cx(field, "pr-28 uppercase")}
                  placeholder="E.G. SUMMER20"
                  value={f.code}
                  maxLength={24}
                  onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })}
                  required
                />
                <button type="button" onClick={() => setF({ ...f, code: gen() })} className="absolute right-2 top-1/2 h-8 -translate-y-1/2 rounded-lg bg-red-600 px-4 text-[12.5px] font-bold text-white hover:bg-red-700">
                  Generate
                </button>
              </span>
            </label>
            <div className="grid gap-5 sm:grid-cols-2">
              <label className="block">
                <span className={labelCls}>Discount % *</span>
                <input className={field} type="number" min={1} max={100} step="0.5" placeholder="e.g. 15" value={f.percent} onChange={(e) => setF({ ...f, percent: e.target.value })} required />
              </label>
              <label className="block">
                <span className={labelCls}>Min order (₹)</span>
                <input className={field} type="number" min={0} placeholder="e.g. 1000" value={f.minOrder} onChange={(e) => setF({ ...f, minOrder: e.target.value })} />
              </label>
              <label className="block">
                <span className={labelCls}>Expiry date</span>
                <input className={field} type="date" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} />
              </label>
              <label className="block">
                <span className={labelCls}>Usage limit</span>
                <input className={field} type="number" min={1} placeholder="e.g. 50" value={f.limit} onChange={(e) => setF({ ...f, limit: e.target.value })} />
              </label>
            </div>
            <button
              type="submit"
              disabled={busy}
              className="h-12 w-full rounded-xl bg-red-600 text-[14px] font-extrabold uppercase tracking-wide text-white shadow-[0_8px_20px_-10px_rgba(215,38,61,.9)] transition hover:bg-red-700 active:scale-[.99] disabled:opacity-50"
            >
              {busy ? "Saving…" : f.id ? "Save changes" : "Create coupon"}
            </button>
          </form>
        </section>

        {/* ---------- list ---------- */}
        <section className="rounded-3xl border border-slate-100 bg-white p-5 shadow-[0_2px_12px_-4px_rgba(15,23,42,.1)] sm:p-8">
          <h2 className="mb-4 text-[18px] font-bold text-slate-900">All Coupons ({s.coupons.length})</h2>
          <SearchBox value={q} onChange={setQ} placeholder="Search coupons by code…" className="mb-5 h-11 w-full rounded-xl" />
          {!list.length ? (
            <Empty icon="coupon" title={s.coupons.length ? "No coupons match" : "No coupons yet"}>
              {s.coupons.length ? null : "Create one — guests and staff can use it straight away."}
            </Empty>
          ) : (
            <ul className="adm-scroll -mr-2 max-h-[560px] space-y-4 overflow-y-auto pr-2">
              {list.map((c) => {
                const st = couponStatus(c);
                return (
                  <li key={c.id} className={cx("rounded-2xl border bg-slate-50/60 p-4 transition", f.id === c.id ? "border-slate-400" : "border-slate-100")}>
                    <div className="flex items-start justify-between gap-3">
                      <b className="min-w-0 truncate text-[15px] tracking-wide text-slate-900">{c.code}</b>
                      <span className="flex shrink-0 gap-3 text-[11px] font-extrabold uppercase">
                        <button type="button" className="text-slate-500 hover:text-slate-900" onClick={() => act("coupon.save", { ...c, active: !c.active })}>
                          {c.active ? "Pause" : "Resume"}
                        </button>
                        <button type="button" className="text-sky-700 hover:underline" onClick={() => edit(c)}>
                          Edit
                        </button>
                        <button type="button" className="text-red-600 hover:underline" onClick={() => remove(c)}>
                          Del
                        </button>
                      </span>
                    </div>
                    <p className="mt-1 text-[13px] font-semibold text-emerald-700">
                      {c.percent}% off{c.minOrder ? ` · min ${rupee(c.minOrder)}` : ""}
                    </p>
                    <p className="mt-1 text-[11.5px] text-slate-500">
                      {c.limit === null ? "Unlimited" : `${Math.max(0, c.limit - c.used)} remaining`} · used {c.used}× · {c.expiresAt ? `expires ${ddmmyyyy(c.expiresAt)}` : "no expiry"}
                    </p>
                    <p className={cx("mt-1 text-[11.5px] font-bold", STATUS[st][1])}>{STATUS[st][0]}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </Page>
  );
}
