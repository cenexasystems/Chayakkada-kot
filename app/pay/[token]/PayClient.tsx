"use client";

import { useState } from "react";
import { rupee } from "@/lib/money";
import { Qr } from "@/app/admin/_ui/Qr";
import { mmss, spacedPhone, useUpiQr } from "@/app/_components/upiQr";

/* The page behind the WhatsApp payment link. The QR and the "Open my UPI app" button carry the amount and the
   shop's UPI ID; the QR is renewed every few minutes. Nothing here confirms a payment — the counter checks
   their UPI app — so it asks the customer to show the payment confirmation. */
export function PayClient({ amount, name, shop, logoUrl, upi, show }: { amount: number; name: string; shop: string; logoUrl: string; upi: { id: string; name: string; minutes: number; phone: string }; show: { qr: boolean; copy: boolean; phone: boolean; apps: boolean } }) {
  const { link, ref, left, ready, apps } = useUpiQr(upi, amount, shop, "W");
  const [copied, setCopied] = useState("");
  const copy = async (what: string, v: string) => {
    try {
      await navigator.clipboard.writeText(v);
      setCopied(what);
      setTimeout(() => setCopied(""), 2000);
    } catch {}
  };
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#f3f4e1] px-4 py-10 text-slate-900">
      <div className="w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-xl">
        <div className="bg-[#2b3022] p-6 text-center text-white">
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" style={{ height: 44, width: "auto", margin: "0 auto 10px", objectFit: "contain" }} />
          )}
          <p className="text-[12px] font-extrabold uppercase tracking-[0.2em] text-[#c9d3a0]">{shop}</p>
          <p className="mt-1 text-[14px] text-slate-300">{name ? `Hi ${name.split(" ")[0]}, your bill` : "Your bill"}</p>
          <p className="mt-1 text-[44px] font-black leading-none">{rupee(amount)}</p>
        </div>
        <div className="space-y-4 p-6 text-center">
          {show.qr && <div className="rounded-2xl border border-slate-200 p-4">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">Scan to pay {rupee(amount)}</p>
            <div className="mx-auto mt-2 w-52 rounded-2xl border border-slate-200 bg-white p-2">{ready ? <Qr text={link} className="block h-auto w-full" /> : <div className="aspect-square w-full" aria-hidden="true" />}</div>
            <p className="mt-2 text-[12.5px] text-slate-500">
              Paying on this phone? Take a screenshot, open your UPI app, tap <b>Scan</b> and pick the screenshot from your gallery. New QR in <b>{ready ? mmss(left) : "…"}</b>.
            </p>
          </div>}
          {show.copy && <div className="rounded-2xl border border-slate-200 p-4">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{show.qr ? "Or: copy the UPI ID" : "Copy the UPI ID"}</p>
            <p className="mt-1 break-all text-[20px] font-black">{upi.id}</p>
            <button type="button" onClick={() => copy("id", upi.id)} className="mt-2 inline-flex h-10 w-full items-center justify-center rounded-xl bg-[#6b7550] text-[14px] font-bold text-white hover:bg-[#576141]">
              {copied === "id" ? "Copied ✓" : "Copy UPI ID"}
            </button>
          </div>}
          {show.apps && <div className="rounded-2xl border border-slate-200 p-4">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">Open your app and pay {rupee(amount)}</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {apps.slice(0, 3).map((a) => (
                <a key={a.name} href={a.href} className="inline-flex h-11 items-center justify-center rounded-xl border border-[#6b7550] px-1 text-[13px] font-bold text-[#576141] hover:bg-slate-50">
                  {a.name}
                </a>
              ))}
            </div>
            <p className="mt-2 text-[12px] text-slate-500">Tap your app: it opens with the amount ready. If it can’t, scan the QR or enter the UPI ID in the app.</p>
          </div>}
          <dl className="space-y-2 rounded-2xl bg-slate-50 p-4 text-left text-[13px]">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-slate-500">Pay to</dt>
              <dd className="font-bold">{upi.name}</dd>
            </div>
            {show.copy && <div className="flex items-center justify-between gap-3">
              <dt className="text-slate-500">UPI ID</dt>
              <dd className="flex items-center gap-2 font-bold">
                {upi.id}
                <button type="button" onClick={() => copy("id", upi.id)} className="rounded-full border border-slate-300 px-2.5 py-0.5 text-[11px] font-bold text-slate-700">
                  {copied === "id" ? "Copied ✓" : "Copy"}
                </button>
              </dd>
            </div>}
            {upi.phone && show.phone && (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-500">GPay number</dt>
                <dd className="flex items-center gap-2 font-bold">
                  {spacedPhone(upi.phone)}
                  <button type="button" onClick={() => copy("phone", upi.phone)} className="rounded-full border border-slate-300 px-2.5 py-0.5 text-[11px] font-bold text-slate-700">
                    {copied === "phone" ? "Copied ✓" : "Copy"}
                  </button>
                </dd>
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <dt className="text-slate-500">Amount</dt>
              <dd className="font-bold">{rupee(amount)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-slate-500">Note</dt>
              <dd className="font-mono text-[12px]">{ref || "…"}</dd>
            </div>
          </dl>
          <p className="text-[12px] text-slate-500">After paying, show the confirmation on your phone at the counter.</p>
        </div>
      </div>
    </div>
  );
}
