"use client";

import { useState } from "react";
import type { TabView } from "@/lib/types";
import { rupee } from "@/lib/money";
import { Qr } from "../admin/_ui/Qr";
import { mmss, useUpiQr } from "./upiQr";

type Tab = NonNullable<TabView["tab"]>;

/* Pay by UPI from the guest's own tab. The QR (and the "Open my UPI app" button) carry the shop's
   UPI ID and the exact amount the tab comes to. Every few minutes — the shop sets how many — the QR is
   replaced by a fresh one with a new reference. The shop's UPI account can't tell the app a payment
   arrived, so "I've paid" only tells the counter; staff check their own UPI app before billing. */

export function UpiPay({ tab, shop, phone, onView }: { tab: Tab; shop: string; phone: string; onView: (v: TabView) => void }) {
  const upi = tab.upi!;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const { link, ref, left } = useUpiQr(upi, tab.payable, shop, `T${phone.slice(-4)}`);

  const claim = tab.payClaim;
  const claimedFull = !!claim && Math.abs(claim.amount - tab.payable) < 0.01;

  const call = async (action: "pay.claim" | "pay.unclaim") => {
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/tab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, phone, ref }) });
      const d = await r.json();
      if (!r.ok) setMsg(d.error || "Couldn't tell the counter. Try again.");
      else onView(d.view);
    } catch {
      setMsg("You seem to be offline. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(upi.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <section className="tm-upi" aria-label="Pay by UPI">
      <h4>
        Pay <b>{rupee(tab.payable)}</b> by UPI
      </h4>
      <a className="tm-upi__open" href={link}>
        Open my UPI app
      </a>
      <div className="tm-upi__qr">
        <Qr text={link} className="tm-upi__svg" color="#1f2218" />
      </div>
      <p className="tm-upi__hint">
        On a phone, tap the button. Or scan this QR from another phone. New QR in <b>{mmss(left)}</b>.
      </p>
      <p className="tm-upi__id">
        UPI ID <b>{upi.id}</b>{" "}
        <button type="button" onClick={copy}>
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </p>
      {claimedFull ? (
        <div className="tm-upi__done">
          <b>Thanks — the counter will confirm your payment ✓</b>
          <button type="button" disabled={busy} onClick={() => call("pay.unclaim")}>
            I didn&apos;t pay yet
          </button>
        </div>
      ) : (
        <>
          {claim && <p className="tm-upi__hint">You told us you paid {rupee(claim.amount)}, but your tab is now {rupee(tab.payable)} — pay the difference and tap again.</p>}
          <button type="button" className="tm-send" disabled={busy} onClick={() => call("pay.claim")}>
            {busy ? "Telling the counter…" : "I've paid"}
          </button>
        </>
      )}
      {msg && <p className="tm-upi__err">{msg}</p>}
    </section>
  );
}
