"use client";

import { mmss, useUpiQr } from "@/app/_components/upiQr";
import { rupee } from "@/lib/money";
import { Qr } from "./Qr";

/* Counter screen: a QR the customer scans with any UPI app to pay `amount`. It renews every few minutes (the
   shop sets how many in Settings). The shop's UPI account can't tell the app a payment arrived, so staff look
   in their UPI app before completing the bill. */
export function UpiQrCard({ upi, amount, shop, label }: { upi: { id: string; name: string; minutes: number }; amount: number; shop: string; label: string }) {
  const { link, ref, left } = useUpiQr(upi, amount, shop, "POS");
  return (
    <div className="mt-3 flex flex-wrap items-center gap-4 rounded-2xl bg-slate-50 p-4">
      <div className="w-44 shrink-0 rounded-xl border border-slate-200 bg-white p-2">
        <Qr text={link} className="block h-auto w-full" />
      </div>
      <div className="min-w-0 flex-1 space-y-1 text-[12.5px] text-slate-600">
        <p className="text-[15px] font-extrabold text-slate-900">
          {label} {rupee(amount)}
        </p>
        <p>Ask the customer to scan this with any UPI app.</p>
        <p>
          New QR in <b className="adm-num text-slate-900">{mmss(left)}</b> · note <span className="font-mono">{ref}</span>
        </p>
        <p className="truncate">
          Pays to <b className="text-slate-800">{upi.id}</b>
        </p>
        <p className="text-[11.5px] text-slate-400">Check your UPI app for the payment, then complete the bill.</p>
      </div>
    </div>
  );
}
