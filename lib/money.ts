import type { Coupon, DiscountType, OrderItem } from "./types";

/* Shared by the server (authoritative totals) and the billing screen (live preview). */

export const TZ = "Asia/Kolkata";

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/** ₹1,47,246 */
export const rupee = (n: number) => `₹${inr.format(Math.round(n * 100) / 100)}`;

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** YYYY-MM-DD for "today" in the shop's timezone. */
export function shopToday(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export type CouponCheck = { ok: true } | { ok: false; reason: string };

export function checkCoupon(c: Coupon, subtotal: number, now = Date.now()): CouponCheck {
  if (!c.active) return { ok: false, reason: "Paused" };
  if (c.expiresAt && c.expiresAt < shopToday(now)) return { ok: false, reason: "Expired" };
  if (c.limit !== null && c.used >= c.limit) return { ok: false, reason: "Usage limit reached" };
  if (subtotal < c.minOrder) return { ok: false, reason: `Needs ${rupee(c.minOrder)} subtotal` };
  return { ok: true };
}

export function couponStatus(c: Coupon, now = Date.now()): "active" | "expired" | "exhausted" | "paused" {
  if (!c.active) return "paused";
  if (c.expiresAt && c.expiresAt < shopToday(now)) return "expired";
  if (c.limit !== null && c.used >= c.limit) return "exhausted";
  return "active";
}

export type BillInput = {
  items: OrderItem[];
  coupon: Coupon | null;
  manualType: DiscountType;
  manualValue: number;
  extra: number;
  /** GST bill: tax is added on top of the prices (exclusive). A non-GST bill carries none. */
  gst?: boolean;
  gstPercent?: number;
};

export function computeBill({ items, coupon, manualType, manualValue, extra, gst = false, gstPercent = 0 }: BillInput) {
  const subtotal = round2(items.reduce((s, i) => s + i.price * i.qty, 0));
  const itemCount = items.reduce((s, i) => s + i.qty, 0);
  const couponOk = coupon ? checkCoupon(coupon, subtotal) : null;
  const couponDiscount = coupon && couponOk?.ok ? Math.round((subtotal * coupon.percent) / 100) : 0;
  const afterCoupon = Math.max(0, subtotal - couponDiscount);
  const mv = Math.max(0, Number(manualValue) || 0);
  const manualDiscount = Math.min(afterCoupon, manualType === "percent" ? Math.round((afterCoupon * Math.min(100, mv)) / 100) : round2(mv));
  const discount = round2(couponDiscount + manualDiscount);
  const ex = Math.max(0, round2(Number(extra) || 0));
  /* GST is charged on what the customer is actually billed for — items after
     discounts, plus any extra charge — and sits on top of it. */
  const taxable = round2(Math.max(0, subtotal - discount) + ex);
  const rate = gst ? Math.min(100, Math.max(0, round2(Number(gstPercent) || 0))) : 0;
  const gstAmount = round2((taxable * rate) / 100);
  const total = round2(taxable + gstAmount);
  return { subtotal, itemCount, couponDiscount, couponOk, manualDiscount, discount, extra: ex, taxable, gstPercent: rate, gstAmount, total };
}

/** Collapse repeated products/lines into one line each. */
export function mergeItems(items: OrderItem[]): OrderItem[] {
  const out: OrderItem[] = [];
  for (const it of items) {
    const hit = out.find((o) => (it.productId ? o.productId === it.productId : !o.productId && o.name === it.name) && o.price === it.price);
    if (hit) hit.qty += it.qty;
    else out.push({ ...it });
  }
  return out;
}
