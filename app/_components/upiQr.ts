"use client";

import { useEffect, useState } from "react";

/* The UPI link behind a payment QR. The QR is renewed every `minutes`: the reference (and so the link) changes
   each round, and everything — the round, the reference, the time left — follows from the clock, so a tab that
   stays open keeps showing a fresh one. UPI itself doesn't enforce the time; it is a freshness rule on screen. */

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const enc = (v: string) => encodeURIComponent(v).replace(/%40/g, "@");

export function useUpiQr(upi: { id: string; name: string; minutes: number }, amount: number, shop: string, tag: string) {
  const period = Math.max(1, upi.minutes) * 60_000;
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = Math.max(0, now - startedAt);
  const round = Math.floor(elapsed / period);
  const left = Math.max(0, Math.ceil((period - (elapsed % period)) / 1000));
  const ref = `${tag}${(startedAt + round * period).toString(36).toUpperCase().slice(-6)}`;
  const link = `upi://pay?pa=${enc(upi.id)}&pn=${enc(upi.name)}&am=${amount.toFixed(2)}&cu=INR&tn=${enc(`${shop} ${ref}`.slice(0, 40))}&tr=${enc(ref)}`;
  return { link, ref, left };
}
