/* Loyalty on the server: the points ledger, earning and redemption at billing,
   reversals when a bill is voided or deleted, rewards, stamps, referrals, occasions,
   campaigns and the admin/reporting reads.

   Integrity rules:
   - Every points movement is one immutable row in loyalty_ledger, written in the same
     transaction as the cached balances on loyalty_customers and the point lots.
   - Writes already run one at a time (store.mutate locks the meta row), so two tills
     can't spend the same points.
   - Credits carry an idempotency `key` (unique in the database): a bill can't earn twice.
   - Balances never go below zero. Points a refund should take back but which were
     already spent become `debt`, recovered from the customer's next earnings.
   - Nothing here trusts amounts from the browser: points, values and eligibility are
     recomputed from the database. */

import { and, asc, desc, eq, gt, gte, inArray, isNotNull, like, lt, lte, ne, or, sql, ilike } from "drizzle-orm";
import { db, type Db, type Tx } from "../db";
import { bills, loyaltyAudit, loyaltyCampaigns, loyaltyCustomers, loyaltyLedger, loyaltyLots, loyaltyReferrals, loyaltyRewards, loyaltySettings, loyaltyStamps, loyaltyVouchers, products, settings } from "../db/schema";
import { ApiError } from "../store";
import { code, uid } from "../seed";
import { round2 } from "../money";
import type { Bill, OrderItem } from "../types";
import { DEFAULT_CONFIG, TIER_KEYS, sanitizeConfig, type AutoReward, type LoyaltyConfig, type RewardKind, type TierKey } from "./config";
import { campaignApplies, earnFor, eligibleSubtotal, occasionYear, pointsValue, redeemCap, rewardAvailable, rewardValue, segmentOf, shopDate, statsFrom, tierFor, tierOk, voucherLive, type CatOf } from "./engine";
import type { Campaign, LedgerEntry, LedgerType, LoyaltyCustomer, LoyaltyLookup, LoyaltyState, PurchaseStats, Reward, Segment, Voucher, VoucherSource } from "./types";

type Q = Db | Tx;
type Args = Record<string, unknown>;
const DAY = 86_400_000;

const str = (v: unknown, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown) => {
  const x = typeof v === "string" && v.trim() === "" ? NaN : Number(v);
  return Number.isFinite(x) ? x : NaN;
};
const optInt = (v: unknown) => (v === null || v === undefined || v === "" ? null : Math.floor(num(v)));
const first = async <T>(rows: Promise<T[]>): Promise<T | null> => (await rows)[0] ?? null;
const strs = (v: unknown, max = 100) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim().slice(0, 80)))].slice(0, max) : []);
const tiersOf = (v: unknown): TierKey[] => strs(v).filter((x) => /^[a-z0-9_-]{1,20}$/.test(x));
const day = (v: unknown) => {
  const x = str(v, 10);
  if (x && !/^\d{4}-\d{2}-\d{2}$/.test(x)) throw new ApiError("Dates should be picked from the calendar.");
  return x;
};

/** 10-digit Indian mobile, tolerant of +91 / spaces. "" if absent, null if invalid. */
export function mobile(v: unknown): string | null {
  const d = str(v, 24).replace(/\D/g, "");
  if (!d) return "";
  const ten = d.length === 12 && d.startsWith("91") ? d.slice(2) : d.length === 11 && d.startsWith("0") ? d.slice(1) : d;
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
}

/** YYYY-MM-DD or MM-DD (year unknown). */
function occasionDate(v: unknown, label: string) {
  const x = str(v, 10);
  if (!x) return "";
  const m = /^(?:(\d{4})-)?(\d{2})-(\d{2})$/.exec(x);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12 || Number(m[3]) < 1 || Number(m[3]) > 31) throw new ApiError(`${label} should be a valid date.`);
  return x;
}

const SYSTEM = "system";

/* ================================ config ================================ */

export async function getConfig(q: Q): Promise<LoyaltyConfig> {
  const r = await first(q.select().from(loyaltySettings).where(eq(loyaltySettings.id, 1)));
  return r ? sanitizeConfig(r.config) : DEFAULT_CONFIG;
}

/** The fixed points per unit the admin set on products (absent = the earn rule). */
async function pointsMap(q: Q) {
  const rows = await q.select({ id: products.id, pts: products.loyaltyPoints }).from(products);
  const m = new Map(rows.filter((r) => r.pts !== null).map((r) => [r.id, r.pts as number]));
  return (pid: string | null) => (pid ? m.get(pid) ?? null : null);
}

async function catMap(q: Q): Promise<CatOf> {
  const rows = await q.select({ id: products.id, category: products.category }).from(products);
  const m = new Map(rows.map((r) => [r.id, r.category]));
  return (pid) => (pid ? m.get(pid) ?? "" : "");
}

async function audit(tx: Tx, actor: string, action: string, x: { customerId?: string | null; ref?: string; before?: unknown; after?: unknown; reason?: string }) {
  await tx.insert(loyaltyAudit).values({ id: uid(), actor, action, customerId: x.customerId ?? null, ref: x.ref ?? "", before: (x.before ?? null) as never, after: (x.after ?? null) as never, reason: x.reason ?? "", createdAt: Date.now() });
}

/* ================================ customers ================================ */

const byPhone = (q: Q, phone: string) => first(q.select().from(loyaltyCustomers).where(eq(loyaltyCustomers.phone, phone)));
const byId = (q: Q, id: string) => first(q.select().from(loyaltyCustomers).where(eq(loyaltyCustomers.id, id)));

async function mustCustomer(q: Q, id: string): Promise<LoyaltyCustomer> {
  const c = await byId(q, str(id, 40));
  if (!c) throw new ApiError("Loyalty member not found.", 404);
  return c;
}

async function uniqueValue(q: Q, make: () => string, col: typeof loyaltyCustomers.code | typeof loyaltyCustomers.referralCode | typeof loyaltyCustomers.walletToken) {
  for (;;) {
    const v = make();
    if (!(await first(q.select({ id: loyaltyCustomers.id }).from(loyaltyCustomers).where(eq(col, v))))) return v;
  }
}

async function billsOf(q: Q, phone: string) {
  return q.select({ id: bills.id, total: bills.total, createdAt: bills.createdAt, status: bills.status, customerName: bills.customerName }).from(bills).where(eq(bills.customerPhone, phone)).orderBy(desc(bills.createdAt));
}

export async function statsForPhone(q: Q, phone: string, cfg: LoyaltyConfig): Promise<PurchaseStats> {
  return statsFrom(await billsOf(q, phone), cfg.crm.frequentDays);
}

export async function registerCustomer(tx: Tx, a: Args, actor: string): Promise<LoyaltyCustomer> {
  const cfg = await getConfig(tx);
  const phone = mobile(a.phone);
  if (!phone) throw new ApiError("Enter the customer's 10-digit mobile number.");
  const existing = await byPhone(tx, phone);
  if (existing) throw new ApiError(`${phone} is already a member (${existing.code}).`);
  const email = str(a.email, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError("That email address doesn't look right.");
  const history = await billsOf(tx, phone);
  const name = str(a.name, 60) || history.find((b) => b.customerName && b.customerName !== "Walk-in customer")?.customerName || "";
  if (!name) throw new ApiError("Enter the customer's name.");
  const now = Date.now();

  // referral: only for someone new to the shop, and never their own code
  const refCode = str(a.referralCode, 20).toUpperCase().replace(/[^A-Z0-9]/g, "");
  let referrer: LoyaltyCustomer | null = null;
  if (refCode) {
    if (!cfg.referral.enabled) throw new ApiError("Referrals are switched off right now.");
    referrer = await first(tx.select().from(loyaltyCustomers).where(eq(loyaltyCustomers.referralCode, refCode)));
    if (!referrer) throw new ApiError(`Referral code ${refCode} doesn't exist.`);
    if (referrer.phone === phone) throw new ApiError("A customer can't refer themselves.");
    if (referrer.status !== "active") throw new ApiError("That referral code's member account isn't active.");
    if (history.some((b) => b.status === "completed")) throw new ApiError("Referral codes are for new customers — this number has visited before.");
  }

  const c: LoyaltyCustomer = {
    id: uid(),
    code: await uniqueValue(tx, () => `CK${code(6)}`, loyaltyCustomers.code),
    phone,
    name,
    email,
    birthday: occasionDate(a.birthday, "Birthday"),
    anniversary: occasionDate(a.anniversary, "Anniversary"),
    status: "active",
    consent: a.consent !== false,
    referralCode: await uniqueValue(tx, () => code(7), loyaltyCustomers.referralCode),
    referredBy: referrer?.id ?? null,
    walletToken: await uniqueValue(tx, () => uid(24), loyaltyCustomers.walletToken),
    tier: cfg.tiers[0].key,
    tierSince: now,
    available: 0,
    lifetime: 0,
    redeemed: 0,
    expired: 0,
    debt: 0,
    stamps: 0,
    note: str(a.note, 300),
    createdAt: now,
    updatedAt: now,
  };
  await tx.insert(loyaltyCustomers).values(c);
  if (referrer) await tx.insert(loyaltyReferrals).values({ id: uid(), referrerId: referrer.id, refereeId: c.id, status: "pending", billId: null, referrerPoints: 0, refereePoints: 0, createdAt: now, rewardedAt: null });
  await audit(tx, actor, "customer.register", { customerId: c.id, ref: c.code, after: { name, phone, referredBy: referrer?.code ?? null } });
  await grantOccasions(tx, c, cfg, now);
  return c;
}

export async function updateCustomer(tx: Tx, a: Args, actor: string): Promise<LoyaltyCustomer> {
  const c = await mustCustomer(tx, str(a.id, 40));
  const email = a.email === undefined ? c.email : str(a.email, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError("That email address doesn't look right.");
  const patch = {
    name: a.name === undefined ? c.name : str(a.name, 60) || c.name,
    email,
    birthday: a.birthday === undefined ? c.birthday : occasionDate(a.birthday, "Birthday"),
    anniversary: a.anniversary === undefined ? c.anniversary : occasionDate(a.anniversary, "Anniversary"),
    consent: typeof a.consent === "boolean" ? a.consent : c.consent,
    note: a.note === undefined ? c.note : str(a.note, 300),
    updatedAt: Date.now(),
  };
  const [u] = await tx.update(loyaltyCustomers).set(patch).where(eq(loyaltyCustomers.id, c.id)).returning();
  await audit(tx, actor, "customer.update", { customerId: c.id, ref: c.code, before: { name: c.name, email: c.email, birthday: c.birthday, anniversary: c.anniversary, consent: c.consent, note: c.note }, after: { name: u.name, email: u.email, birthday: u.birthday, anniversary: u.anniversary, consent: u.consent, note: u.note } });
  return u;
}

export async function setStatus(tx: Tx, a: Args, actor: string) {
  const c = await mustCustomer(tx, str(a.id, 40));
  const status = a.status === "inactive" ? "inactive" : "active";
  const reason = str(a.reason, 300);
  if (!reason) throw new ApiError("Give a reason — it goes in the audit log.");
  if (status === c.status) return c;
  const [u] = await tx.update(loyaltyCustomers).set({ status, updatedAt: Date.now() }).where(eq(loyaltyCustomers.id, c.id)).returning();
  await audit(tx, actor, status === "active" ? "customer.activate" : "customer.deactivate", { customerId: c.id, ref: c.code, before: { status: c.status }, after: { status }, reason });
  return u;
}

/* ================================ ledger ================================ */

/** Types that count towards lifetime points (and so membership). */
const EARNS: LedgerType[] = ["purchase", "bonus", "promo", "referral", "occasion"];

type Post = {
  type: LedgerType;
  points: number;
  billId?: string | null;
  invoiceNo?: string | null;
  ref?: string;
  key?: string | null;
  description: string;
  actor?: string;
  reversalOf?: string | null;
  /** debit: take what's there rather than refusing (refunds); the rest becomes debt */
  partial?: boolean;
  /** debit this one lot only (expiry) */
  lotId?: string;
  /** lifetime change; defaults to +points for earning types */
  lifetime?: number;
};

/** Writes one ledger row and keeps the member's balances and lots in step. Mutates `c`
    so several posts in one transaction see each other. Returns null if `key` was used before. */
async function post(tx: Tx, c: LoyaltyCustomer, p: Post, cfg: LoyaltyConfig, now = Date.now()): Promise<LedgerEntry | null> {
  if (p.key && (await first(tx.select({ id: loyaltyLedger.id }).from(loyaltyLedger).where(eq(loyaltyLedger.key, p.key))))) return null;
  let pts = Math.trunc(p.points);
  if (!pts) return null;
  let shortfall = 0;
  let expiresAt: number | null = null;

  if (pts < 0) {
    let need = -pts;
    if (need > c.available) {
      if (!p.partial) throw new ApiError(`Only ${c.available} points available.`);
      shortfall = need - c.available;
      need = c.available;
      pts = -need;
    }
    if (need > 0) {
      const lots = p.lotId
        ? await tx.select().from(loyaltyLots).where(and(eq(loyaltyLots.id, p.lotId), gt(loyaltyLots.remaining, 0)))
        : await tx
            .select()
            .from(loyaltyLots)
            .where(and(eq(loyaltyLots.customerId, c.id), gt(loyaltyLots.remaining, 0)))
            .orderBy(sql`${loyaltyLots.expiresAt} asc nulls last`, asc(loyaltyLots.earnedAt));
      let left = need;
      for (const l of lots) {
        if (!left) break;
        const take = Math.min(l.remaining, left);
        await tx.update(loyaltyLots).set({ remaining: l.remaining - take }).where(eq(loyaltyLots.id, l.id));
        left -= take;
      }
      if (left > 0) throw new ApiError("Points records are out of step for this member — run the reconcile check on the Loyalty page.");
    }
  } else {
    expiresAt = cfg.expiry.days > 0 ? now + cfg.expiry.days * DAY : null;
  }

  const before = c.available;
  const entry: LedgerEntry = {
    id: uid(),
    customerId: c.id,
    type: p.type,
    points: pts,
    balanceBefore: before,
    balanceAfter: before + pts,
    billId: p.billId ?? null,
    invoiceNo: p.invoiceNo ?? null,
    ref: p.ref ?? "",
    key: p.key ?? null,
    description: shortfall ? `${p.description} — ${shortfall} pts already spent, recovered from future earnings` : p.description,
    expiresAt,
    actor: p.actor ?? SYSTEM,
    reversalOf: p.reversalOf ?? null,
    createdAt: now,
  };
  if (pts !== 0 || shortfall) await tx.insert(loyaltyLedger).values(entry);
  if (pts > 0) await tx.insert(loyaltyLots).values({ id: uid(), customerId: c.id, ledgerId: entry.id, points: pts, remaining: pts, earnedAt: now, expiresAt });

  c.available = before + pts;
  const life = p.lifetime ?? (EARNS.includes(p.type) ? pts : 0);
  c.lifetime = Math.max(0, c.lifetime + life);
  if (p.type === "redemption" || p.type === "reward") c.redeemed += -pts;
  if (p.type === "refund_restore" || p.type === "reward_reversal") c.redeemed = Math.max(0, c.redeemed - pts);
  if (p.type === "expiry") c.expired += -pts;
  c.debt += shortfall;
  if (p.type === "debt_recovery") c.debt = Math.max(0, c.debt + pts);

  const t = tierFor(c.lifetime, cfg).key;
  const tierChanged = t !== c.tier;
  const oldTier = c.tier;
  if (tierChanged) {
    c.tier = t;
    c.tierSince = now;
  }
  c.updatedAt = now;
  await tx.update(loyaltyCustomers).set({ available: c.available, lifetime: c.lifetime, redeemed: c.redeemed, expired: c.expired, debt: c.debt, tier: c.tier, tierSince: c.tierSince, updatedAt: now }).where(eq(loyaltyCustomers.id, c.id));
  if (tierChanged) await audit(tx, SYSTEM, "tier.change", { customerId: c.id, ref: c.code, before: { tier: oldTier }, after: { tier: t, lifetime: c.lifetime } });

  // new points first pay back points a refund couldn't take
  if (pts > 0 && c.debt > 0 && p.type !== "refund_restore") {
    const take = Math.min(c.debt, c.available);
    if (take > 0) await post(tx, c, { type: "debt_recovery", points: -take, billId: p.billId, invoiceNo: p.invoiceNo, description: "Recovered points from an earlier refund", lifetime: 0 }, cfg, now);
  }
  return entry;
}

/** Expires a member's points whose date has passed — one ledger row per lot, so it stays auditable. */
async function expireFor(tx: Tx, c: LoyaltyCustomer, cfg: LoyaltyConfig, now = Date.now()) {
  const due = await tx.select().from(loyaltyLots).where(and(eq(loyaltyLots.customerId, c.id), gt(loyaltyLots.remaining, 0), isNotNull(loyaltyLots.expiresAt), lt(loyaltyLots.expiresAt, now)));
  let n = 0;
  for (const l of due) {
    const e = await post(tx, c, { type: "expiry", points: -l.remaining, lotId: l.id, key: `exp:${l.id}`, description: `Points earned ${shopDate(l.earnedAt)} expired`, partial: true, lifetime: 0 }, cfg, now);
    if (e) n += -e.points;
  }
  return n;
}

/* ================================ vouchers ================================ */

async function newRef(tx: Tx) {
  for (;;) {
    const r = `RW-${code(7)}`;
    if (!(await first(tx.select({ id: loyaltyVouchers.id }).from(loyaltyVouchers).where(eq(loyaltyVouchers.ref, r))))) return r;
  }
}

async function issueVoucher(tx: Tx, c: LoyaltyCustomer, x: { name: string; kind: RewardKind; value: number; productId: string | null; source: VoucherSource; key: string; validityDays: number; note?: string; rewardId?: string | null; pointsCost?: number; status?: "issued" | "used"; billId?: string | null; invoiceNo?: string | null }, now = Date.now()) {
  if (await first(tx.select({ id: loyaltyVouchers.id }).from(loyaltyVouchers).where(eq(loyaltyVouchers.key, x.key)))) return null;
  const v: Voucher = {
    id: uid(),
    ref: await newRef(tx),
    customerId: c.id,
    rewardId: x.rewardId ?? null,
    name: x.name,
    kind: x.kind,
    value: x.value,
    productId: x.productId,
    source: x.source,
    pointsCost: x.pointsCost ?? 0,
    status: x.status ?? "issued",
    billId: x.billId ?? null,
    invoiceNo: x.invoiceNo ?? null,
    key: x.key,
    issuedAt: now,
    usedAt: x.status === "used" ? now : null,
    expiresAt: x.validityDays > 0 && x.status !== "used" ? now + x.validityDays * DAY : null,
    note: x.note ?? "",
  };
  await tx.insert(loyaltyVouchers).values(v);
  return v;
}

const autoVoucher = (r: AutoReward) => (r.kind === "none" ? null : { name: r.name || (r.kind === "percent" ? `${r.value}% off` : r.kind === "amount" ? `₹${r.value} off` : "Free item"), kind: r.kind, value: r.value, productId: r.productId });

/* ================================ occasions ================================ */

/** Birthday / anniversary rewards, once per member per year, inside the configured window. */
async function grantOccasions(tx: Tx, c: LoyaltyCustomer, cfg: LoyaltyConfig, now = Date.now()) {
  if (!cfg.enabled || c.status !== "active") return 0;
  let n = 0;
  for (const [k, occ, date] of [
    ["birthday", cfg.birthday, c.birthday],
    ["anniversary", cfg.anniversary, c.anniversary],
  ] as const) {
    if (!occ.enabled || !date || !tierOk(occ.tiers, c.tier)) continue;
    const year = occasionYear(date, occ.windowDays, now);
    if (year === null) continue;
    const label = k === "birthday" ? "Birthday" : "Anniversary";
    if (occ.bonusPoints > 0 && (await post(tx, c, { type: "occasion", points: occ.bonusPoints, key: `${k}:${c.id}:${year}`, ref: `${k}-${year}`, description: `${label} bonus ${year}` }, cfg, now))) n++;
    const v = autoVoucher(occ.reward);
    if (v && (await issueVoucher(tx, c, { ...v, source: k, key: `${k}-reward:${c.id}:${year}`, validityDays: occ.validityDays, note: `${label} ${year}` }, now))) n++;
  }
  return n;
}

/* ================================ billing ================================ */

export type LoyaltyPlan = {
  cfg: LoyaltyConfig;
  customer: LoyaltyCustomer;
  reward: { voucher: Voucher } | { reward: Reward } | null;
  rewardDiscount: number;
  rewardName: string | null;
  points: number;
  pointsDiscount: number;
};

/** Before the bill is written: checks the reward and points the cashier asked for, and
    works out what they take off. Throws (and the whole bill is refused) if anything is off. */
export async function planBill(tx: Tx, x: { phone: string; items: OrderItem[]; subtotal: number; afterManual: number; couponApplied: boolean; manualApplied: boolean; points: unknown; rewardId: unknown; voucherRef: unknown }): Promise<LoyaltyPlan | null> {
  const wantPoints = Math.max(0, Math.floor(num(x.points) || 0));
  const rewardId = str(x.rewardId, 40);
  const voucherRef = str(x.voucherRef, 20).toUpperCase();
  if (!wantPoints && !rewardId && !voucherRef) return null;
  const cfg = await getConfig(tx);
  if (!cfg.enabled) throw new ApiError("The loyalty programme is switched off.");
  if (!x.phone) throw new ApiError("Enter the member's mobile number to use points or rewards.");
  const c = await byPhone(tx, x.phone);
  if (!c) throw new ApiError("This mobile isn't a loyalty member yet.");
  if (c.status !== "active") throw new ApiError("This member's loyalty account is deactivated.");
  await expireFor(tx, c, cfg);
  const catOf = await catMap(tx);

  let reward: LoyaltyPlan["reward"] = null;
  let rewardDiscount = 0;
  let rewardName: string | null = null;
  let spend = 0;
  if (voucherRef) {
    const v = await first(tx.select().from(loyaltyVouchers).where(eq(loyaltyVouchers.ref, voucherRef)));
    if (!v || v.customerId !== c.id) throw new ApiError(`Reward ${voucherRef} isn't this member's.`);
    if (!voucherLive(v)) throw new ApiError(`Reward ${voucherRef} is ${v.status === "issued" ? "expired" : v.status}.`);
    const r = rewardValue(v, x.items, x.afterManual);
    if (r.reason) throw new ApiError(r.reason + ".");
    reward = { voucher: v };
    rewardDiscount = r.amount;
    rewardName = v.name;
  } else if (rewardId) {
    const rw = await first(tx.select().from(loyaltyRewards).where(eq(loyaltyRewards.id, rewardId)));
    if (!rw) throw new ApiError("That reward no longer exists.");
    const why = rewardAvailable(rw, c.tier);
    if (why) throw new ApiError(`${rw.name}: ${why}.`);
    if (rw.pointsCost > c.available) throw new ApiError(`${rw.name} needs ${rw.pointsCost} points — ${c.available} available.`);
    if (rw.perCustomerLimit !== null) {
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(loyaltyVouchers).where(and(eq(loyaltyVouchers.customerId, c.id), eq(loyaltyVouchers.rewardId, rw.id), inArray(loyaltyVouchers.status, ["issued", "used"])));
      if (n >= rw.perCustomerLimit) throw new ApiError(`${rw.name}: this member has used it the maximum ${rw.perCustomerLimit} time(s).`);
    }
    const r = rewardValue(rw, x.items, x.afterManual);
    if (r.reason) throw new ApiError(r.reason + ".");
    reward = { reward: rw };
    rewardDiscount = r.amount;
    rewardName = rw.name;
    spend = rw.pointsCost;
  }

  let pointsDiscount = 0;
  if (wantPoints) {
    const cap = redeemCap({ cfg, items: x.items, catOf, subtotal: x.subtotal, remaining: x.afterManual - rewardDiscount, available: c.available - spend, couponApplied: x.couponApplied, manualApplied: x.manualApplied, rewardApplied: !!reward });
    if (cap.reason) throw new ApiError(cap.reason + ".");
    if (wantPoints < cfg.redeem.minPoints) throw new ApiError(`Redeem at least ${cfg.redeem.minPoints} points at a time.`);
    if (wantPoints > cap.maxPoints) throw new ApiError(`At most ${cap.maxPoints} points can be used on this bill.`);
    pointsDiscount = pointsValue(wantPoints, cfg);
  }
  return { cfg, customer: c, reward, rewardDiscount, rewardName, points: wantPoints, pointsDiscount };
}

/** Is this mobile an active loyalty member? Decides which audience of coupons it can use. */
export async function isMember(q: Q, phone: string | null | undefined) {
  const p = (phone ?? "").replace(/\D/g, "").slice(-10);
  if (!p) return false;
  const c = await byPhone(q, p);
  return !!c && c.status === "active";
}

/** Members' points still on the plan's customer, used by createBill to stamp the bill. */
export async function memberFor(tx: Tx, phone: string) {
  if (!phone) return null;
  const c = await byPhone(tx, phone);
  return c && c.status === "active" ? c : null;
}

/** After the bill is written (same transaction): spend what was planned, then earn,
    stamp, settle any referral and hand out occasion rewards. Returns points earned. */
export async function afterBill(tx: Tx, bill: Bill, plan: LoyaltyPlan | null, actor: string): Promise<{ earned: number; customerId: string | null }> {
  const cfg = plan?.cfg ?? (await getConfig(tx));
  if (!cfg.enabled) return { earned: 0, customerId: null };
  const c = plan?.customer ?? (await memberFor(tx, bill.customerPhone));
  if (!c) return { earned: 0, customerId: null };
  const now = bill.createdAt;
  if (!plan) await expireFor(tx, c, cfg, now);
  const ctx = { billId: bill.id, invoiceNo: bill.invoiceNo, actor };

  // ---- spend ----
  if (plan?.reward && "reward" in plan.reward) {
    const rw = plan.reward.reward;
    const v = await issueVoucher(tx, c, { name: rw.name, kind: rw.kind, value: rw.value, productId: rw.productId, source: "points", key: `reward:${bill.id}`, validityDays: 0, rewardId: rw.id, pointsCost: rw.pointsCost, status: "used", billId: bill.id, invoiceNo: bill.invoiceNo }, now);
    if (v) {
      if (rw.pointsCost > 0) await post(tx, c, { type: "reward", points: -rw.pointsCost, ...ctx, ref: v.ref, key: `reward-pts:${bill.id}`, description: `Redeemed reward: ${rw.name}` }, cfg, now);
      await tx.update(loyaltyRewards).set({ redeemed: sql`${loyaltyRewards.redeemed} + 1` }).where(eq(loyaltyRewards.id, rw.id));
      await tx.update(bills).set({ rewardRef: v.ref }).where(eq(bills.id, bill.id));
    }
  } else if (plan?.reward && "voucher" in plan.reward) {
    await tx.update(loyaltyVouchers).set({ status: "used", usedAt: now, billId: bill.id, invoiceNo: bill.invoiceNo }).where(eq(loyaltyVouchers.id, plan.reward.voucher.id));
  }
  if (plan?.points) await post(tx, c, { type: "redemption", points: -plan.points, ...ctx, key: `redeem:${bill.id}`, description: `Redeemed ${plan.points} pts for ₹${plan.pointsDiscount} off` }, cfg, now);

  // ---- earn ----
  const catOf = await catMap(tx);
  const stats = await statsForPhone(tx, c.phone, cfg);
  const seg = segmentOf(stats, cfg, c.tier, now);
  const firstPurchase = !(await first(tx.select({ id: loyaltyLedger.id }).from(loyaltyLedger).where(and(eq(loyaltyLedger.customerId, c.id), eq(loyaltyLedger.type, "purchase")))));
  const elig = eligibleSubtotal(bill.items, catOf, cfg.earn.excludedProductIds, cfg.earn.excludedCategories);
  const ratio = bill.subtotal > 0 ? Math.max(0, bill.subtotal - bill.discount) / bill.subtotal : 0;
  const all = (await tx.select().from(loyaltyCampaigns).where(eq(loyaltyCampaigns.active, true))) as Campaign[];
  const camps: Campaign[] = [];
  for (const k of all) {
    if (!campaignApplies(k, { now, tier: c.tier, segment: seg, eligibleNet: round2(elig * ratio), items: bill.items, catOf })) continue;
    if (k.perCustomerLimit !== null) {
      const [{ n }] = await tx.select({ n: sql<number>`count(distinct ${loyaltyLedger.billId})::int` }).from(loyaltyLedger).where(and(eq(loyaltyLedger.customerId, c.id), eq(loyaltyLedger.ref, `camp:${k.id}`)));
      if (n >= k.perCustomerLimit) continue;
    }
    camps.push(k);
  }
  const earn = earnFor({ cfg, items: bill.items, catOf, pointsOf: await pointsMap(tx), subtotal: bill.subtotal, discount: bill.discount, tier: c.tier, firstPurchase, campaigns: camps });
  let earned = 0;
  const usedCamps = new Map<string, number>();
  for (const p of earn.parts) {
    const key = p.type === "bonus" ? `first:${c.id}` : `earn:${bill.id}:${p.type}:${p.campaignId ?? ""}`;
    const e = await post(tx, c, { type: p.type, points: p.points, ...ctx, ref: p.campaignId ? `camp:${p.campaignId}` : "", key, description: p.label }, cfg, now);
    if (e) {
      earned += e.points;
      if (p.campaignId) usedCamps.set(p.campaignId, (usedCamps.get(p.campaignId) ?? 0) + e.points);
    }
  }
  for (const [id, pts] of usedCamps) await tx.update(loyaltyCampaigns).set({ used: sql`${loyaltyCampaigns.used} + 1`, pointsGiven: sql`${loyaltyCampaigns.pointsGiven} + ${pts}` }).where(eq(loyaltyCampaigns.id, id));

  // ---- stamp ----
  const st = cfg.stamps;
  if (st.enabled && bill.total >= st.minBill && tierOk(st.tiers, c.tier)) {
    const visitKey = st.rule === "per_bill" ? `bill:${bill.id}` : `${c.id}:${bill.sessionId ? `tab:${bill.sessionId}` : shopDate(now)}`;
    const dayKey = `${c.id}:${shopDate(now)}`;
    // a tab and a counter bill on the same day are still one visit
    const dupe = await first(tx.select({ id: loyaltyStamps.id }).from(loyaltyStamps).where(and(eq(loyaltyStamps.status, "active"), st.rule === "per_bill" ? eq(loyaltyStamps.visitKey, visitKey) : or(eq(loyaltyStamps.visitKey, visitKey), eq(loyaltyStamps.visitKey, dayKey))!)));
    if (!dupe) {
      await tx.insert(loyaltyStamps).values({ id: uid(), customerId: c.id, billId: bill.id, visitKey: st.rule === "per_bill" ? visitKey : dayKey, status: "active", createdAt: now });
      c.stamps += 1;
      await tx.update(loyaltyCustomers).set({ stamps: c.stamps }).where(eq(loyaltyCustomers.id, c.id));
      const size = st.milestones.length ? st.milestones[st.milestones.length - 1].visits : 0;
      if (size) {
        const pos = ((c.stamps - 1) % size) + 1;
        const cycle = Math.floor((c.stamps - 1) / size);
        const m = st.milestones.find((x) => x.visits === pos);
        const v = m && autoVoucher(m.reward);
        if (m && v) await issueVoucher(tx, c, { ...v, source: "milestone", key: `ms:${c.id}:${cycle}:${pos}`, validityDays: m.validityDays, note: `${pos}-visit reward`, billId: null }, now);
      }
    }
  }

  // ---- referral ----
  const rf = cfg.referral;
  const ref = await first(tx.select().from(loyaltyReferrals).where(and(eq(loyaltyReferrals.refereeId, c.id), eq(loyaltyReferrals.status, "pending"))));
  const today = shopDate(now);
  if (ref && rf.enabled && (!rf.startsOn || today >= rf.startsOn) && (!rf.endsOn || today <= rf.endsOn) && earn.eligibleNet >= rf.minPurchase) {
    const referrer = await byId(tx, ref.referrerId);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(loyaltyReferrals).where(and(eq(loyaltyReferrals.referrerId, ref.referrerId), eq(loyaltyReferrals.status, "rewarded")));
    if (!referrer || referrer.status !== "active" || !tierOk(rf.tiers, referrer.tier) || (rf.maxPerReferrer > 0 && n >= rf.maxPerReferrer)) {
      await tx.update(loyaltyReferrals).set({ status: "rejected", billId: bill.id }).where(eq(loyaltyReferrals.id, ref.id));
    } else {
      const a = await post(tx, referrer, { type: "referral", points: rf.referrerBonus, ...ctx, ref: ref.id, key: `ref:${ref.id}:r`, description: `Referral reward — ${c.name} made their first purchase` }, cfg, now);
      const b = await post(tx, c, { type: "referral", points: rf.refereeBonus, ...ctx, ref: ref.id, key: `ref:${ref.id}:n`, description: `Welcome reward — referred by ${referrer.name}` }, cfg, now);
      if (b) earned += b.points;
      await tx.update(loyaltyReferrals).set({ status: "rewarded", billId: bill.id, referrerPoints: a?.points ?? 0, refereePoints: b?.points ?? 0, rewardedAt: now }).where(eq(loyaltyReferrals.id, ref.id));
    }
  }

  await grantOccasions(tx, c, cfg, now);
  await tx.update(bills).set({ loyaltyCustomerId: c.id, pointsEarned: earned }).where(eq(bills.id, bill.id));
  return { earned, customerId: c.id };
}

/** Undo what a bill did to loyalty — on void or delete (fraction 1), or a partial refund
    (fraction < 1, earned points only). Safe to call twice: reversal keys are unique. */
export async function reverseBill(tx: Tx, bill: Pick<Bill, "id" | "invoiceNo" | "total" | "loyaltyCustomerId">, actor: string, fraction = 1, reason = "Bill voided") {
  if (!bill.loyaltyCustomerId) return;
  const c = await byId(tx, bill.loyaltyCustomerId);
  if (!c) return;
  const cfg = await getConfig(tx);
  const now = Date.now();
  const ctx = { billId: bill.id, invoiceNo: bill.invoiceNo, actor };
  const rows = await tx.select().from(loyaltyLedger).where(eq(loyaltyLedger.billId, bill.id));
  const mine = rows.filter((r) => r.customerId === c.id);
  const full = fraction >= 0.9999;

  // earned points (purchase / bonus / promo / this member's referral welcome)
  const earned = mine.filter((r) => ["purchase", "bonus", "promo"].includes(r.type) || (r.type === "referral" && r.key?.endsWith(":n"))).reduce((a, r) => a + r.points, 0);
  // what earlier partial refunds already took back (points taken + what became debt)
  const already = mine.filter((r) => r.type === "refund_reversal").reduce((a, r) => a - r.points + debtOf(r.description), 0);
  const target = full ? earned : Math.min(earned, Math.round(earned * fraction) + already);
  const take = Math.max(0, target - already);
  if (take > 0) await post(tx, c, { type: "refund_reversal", points: -take, ...ctx, key: full ? `rev:${bill.id}:earn` : `rev:${bill.id}:earn:${uid(6)}`, partial: true, description: `${reason}: points from ${bill.invoiceNo} taken back`, lifetime: -take }, cfg, now);

  if (full) {
    // points spent on the bill come back
    const spent = -mine.filter((r) => r.type === "redemption").reduce((a, r) => a + r.points, 0);
    if (spent > 0) await post(tx, c, { type: "refund_restore", points: spent, ...ctx, key: `rev:${bill.id}:redeem`, description: `${reason}: ${spent} redeemed pts returned`, lifetime: 0 }, cfg, now);
    // reward used on the bill
    const v = await first(tx.select().from(loyaltyVouchers).where(and(eq(loyaltyVouchers.billId, bill.id), eq(loyaltyVouchers.status, "used"))));
    if (v) {
      if (v.source === "points") {
        await tx.update(loyaltyVouchers).set({ status: "cancelled", note: `${reason} (${bill.invoiceNo})` }).where(eq(loyaltyVouchers.id, v.id));
        if (v.pointsCost > 0) await post(tx, c, { type: "reward_reversal", points: v.pointsCost, ...ctx, ref: v.ref, key: `rev:${bill.id}:reward`, description: `${reason}: points for ${v.name} returned`, lifetime: 0 }, cfg, now);
        if (v.rewardId) await tx.update(loyaltyRewards).set({ redeemed: sql`greatest(0, ${loyaltyRewards.redeemed} - 1)` }).where(eq(loyaltyRewards.id, v.rewardId));
      } else {
        await tx.update(loyaltyVouchers).set({ status: "issued", usedAt: null, billId: null, invoiceNo: null }).where(eq(loyaltyVouchers.id, v.id));
      }
    }
    // the visit stamp, and an unused milestone reward it unlocked
    const stamp = await first(tx.select().from(loyaltyStamps).where(and(eq(loyaltyStamps.billId, bill.id), eq(loyaltyStamps.status, "active"))));
    if (stamp) {
      const size = cfg.stamps.milestones.length ? cfg.stamps.milestones[cfg.stamps.milestones.length - 1].visits : 0;
      if (size && c.stamps > 0) {
        const pos = ((c.stamps - 1) % size) + 1;
        const cycle = Math.floor((c.stamps - 1) / size);
        await tx.update(loyaltyVouchers).set({ status: "cancelled", key: null, note: `Visit stamp reversed (${bill.invoiceNo})` }).where(and(eq(loyaltyVouchers.key, `ms:${c.id}:${cycle}:${pos}`), eq(loyaltyVouchers.status, "issued")));
      }
      // free the visit key, so another bill on the same visit can still earn the stamp
      await tx.update(loyaltyStamps).set({ status: "reversed", visitKey: `${stamp.visitKey}:reversed:${stamp.id}` }).where(eq(loyaltyStamps.id, stamp.id));
      c.stamps = Math.max(0, c.stamps - 1);
      await tx.update(loyaltyCustomers).set({ stamps: c.stamps }).where(eq(loyaltyCustomers.id, c.id));
    }
    // a referral this bill qualified
    const ref = await first(tx.select().from(loyaltyReferrals).where(and(eq(loyaltyReferrals.billId, bill.id), eq(loyaltyReferrals.status, "rewarded"))));
    if (ref) {
      const referrer = await byId(tx, ref.referrerId);
      if (referrer && ref.referrerPoints > 0) await post(tx, referrer, { type: "refund_reversal", points: -ref.referrerPoints, ...ctx, ref: ref.id, key: `rev:${ref.id}:r`, partial: true, description: `${reason}: referral reward taken back`, lifetime: -ref.referrerPoints }, cfg, now);
      await tx.update(loyaltyReferrals).set({ status: "reversed" }).where(eq(loyaltyReferrals.id, ref.id));
    }
    // campaign use
    for (const r of mine) if (r.ref.startsWith("camp:") && r.points > 0) await tx.update(loyaltyCampaigns).set({ used: sql`greatest(0, ${loyaltyCampaigns.used} - 1)`, pointsGiven: sql`greatest(0, ${loyaltyCampaigns.pointsGiven} - ${r.points})` }).where(eq(loyaltyCampaigns.id, r.ref.slice(5)));
  }
  await audit(tx, actor, full ? "bill.reverse" : "bill.partial_refund", { customerId: c.id, ref: bill.invoiceNo, after: { fraction: round2(fraction), pointsTakenBack: take }, reason });
}
/** A bill is deleted for good: undo what it did to points, rewards, stamps and referrals (so balances are
    right), then erase every record that mentions it — the points it earned, the "taken back" correction,
    the reversed stamp, the cancelled reward, the audit lines — so nothing about it is left behind. */
export async function purgeBill(tx: Tx, bill: Pick<Bill, "id" | "invoiceNo" | "total" | "loyaltyCustomerId" | "status">, actor: string) {
  if (!bill.loyaltyCustomerId) return;
  if (bill.status === "completed") await reverseBill(tx, bill, actor, 1, "Bill deleted");
  await wipeBillTraces(tx, bill.id, bill.invoiceNo);
}

/** Erases the loyalty records that belong to one bill. A member's points rows are only erased when they cancel
    out exactly (earned = taken back, spent = returned), so balances and lifetime totals stay right; if a refund
    ever had to be recorded as debt, those rows are kept. */
export async function wipeBillTraces(tx: Tx, billId: string, invoiceNo: string | null) {
  const rows = await tx.select().from(loyaltyLedger).where(eq(loyaltyLedger.billId, billId));
  const net = new Map<string, number>();
  for (const r of rows) net.set(r.customerId, (net.get(r.customerId) ?? 0) + r.points);
  const now = Date.now();
  let erased = 0;
  for (const [customerId, n] of net) {
    if (n !== 0) continue; // doesn't cancel out (a refund became debt): keep these rows
    const ids = rows.filter((r) => r.customerId === customerId).map((r) => r.id);
    /* Points are used oldest-expiry first, so a "taken back" row may have used up OTHER lots, not the one
       this bill created. Erasing the bill's lots would then lose track of those points — so what is left
       in the bill's own lots goes back into the lots it was taken from. */
    const mine = await tx.select().from(loyaltyLots).where(inArray(loyaltyLots.ledgerId, ids));
    const owed = mine.reduce((a, l) => a + l.remaining, 0);
    const others = (await tx.select().from(loyaltyLots).where(eq(loyaltyLots.customerId, customerId)))
      .filter((l) => !ids.includes(l.ledgerId) && l.points > l.remaining && (l.expiresAt === null || l.expiresAt >= now))
      .sort((x, y) => (x.expiresAt ?? Infinity) - (y.expiresAt ?? Infinity) || x.earnedAt - y.earnedAt);
    if (others.reduce((a, l) => a + (l.points - l.remaining), 0) < owed) continue; // can't put them back cleanly: keep these rows
    let left = owed;
    for (const l of others) {
      if (!left) break;
      const add = Math.min(left, l.points - l.remaining);
      await tx.update(loyaltyLots).set({ remaining: l.remaining + add }).where(eq(loyaltyLots.id, l.id));
      left -= add;
    }
    await tx.delete(loyaltyLots).where(inArray(loyaltyLots.ledgerId, ids));
    await tx.delete(loyaltyLedger).where(inArray(loyaltyLedger.id, ids));
    erased += ids.length;
  }
  await tx.delete(loyaltyStamps).where(and(eq(loyaltyStamps.billId, billId), eq(loyaltyStamps.status, "reversed")));
  await tx.delete(loyaltyVouchers).where(and(eq(loyaltyVouchers.billId, billId), eq(loyaltyVouchers.status, "cancelled")));
  if (invoiceNo) {
    await tx.delete(loyaltyVouchers).where(and(eq(loyaltyVouchers.status, "cancelled"), like(loyaltyVouchers.note, `%(${invoiceNo})%`)));
    await tx.delete(loyaltyAudit).where(and(eq(loyaltyAudit.ref, invoiceNo), inArray(loyaltyAudit.action, ["bill.reverse", "bill.partial_refund"])));
  }
  // a referral this bill had qualified goes back to waiting for the friend's next first bill
  await tx.update(loyaltyReferrals).set({ status: "pending", billId: null, referrerPoints: 0, refereePoints: 0, rewardedAt: null }).where(and(eq(loyaltyReferrals.billId, billId), eq(loyaltyReferrals.status, "reversed")));
  return erased;
}

/** Clears the loyalty records of bills that were deleted before this tidy-up existed. Only records whose bill is
    gone are touched, and only when they cancel out. Returns how many points rows were erased. */
export async function purgeOrphans(tx: Tx) {
  const gone = await tx.execute(sql`
    select distinct l.bill_id as id, l.invoice_no as inv from ${loyaltyLedger} l
    where l.bill_id is not null and not exists (select 1 from ${bills} b where b.id = l.bill_id)`);
  let n = 0;
  for (const r of gone.rows as { id: string; inv: string | null }[]) n += (await wipeBillTraces(tx, r.id, r.inv)) ?? 0;
  return n;
}

const debtOf = (desc: string) => Number(/— (\d+) pts already spent/.exec(desc)?.[1] ?? 0);

/* ================================ admin actions ================================ */

export async function adjustPoints(tx: Tx, a: Args, actor: string) {
  const c = await mustCustomer(tx, str(a.id, 40));
  const pts = Math.trunc(num(a.points));
  const reason = str(a.reason, 300);
  if (!pts) throw new ApiError("Enter the points to add (e.g. 50) or remove (e.g. -50).");
  if (Math.abs(pts) > 100000) throw new ApiError("That adjustment is too large.");
  if (!reason) throw new ApiError("A reason is required for manual adjustments.");
  const cfg = await getConfig(tx);
  await expireFor(tx, c, cfg);
  if (pts < 0 && -pts > c.available) throw new ApiError(`Only ${c.available} points available to remove.`);
  const before = c.available;
  await post(tx, c, { type: "adjustment", points: pts, description: `Manual adjustment: ${reason}`, actor, key: `adj:${uid(8)}`, lifetime: 0 }, cfg);
  await audit(tx, actor, "points.adjust", { customerId: c.id, ref: c.code, before: { available: before }, after: { available: c.available, change: pts }, reason });
  return c;
}

/** Redeem a catalogue reward now (outside billing) — points go immediately, staff use the reference later. */
export async function issueReward(tx: Tx, a: Args, actor: string) {
  const c = await mustCustomer(tx, str(a.id, 40));
  if (c.status !== "active") throw new ApiError("This member's loyalty account is deactivated.");
  const cfg = await getConfig(tx);
  if (!cfg.enabled) throw new ApiError("The loyalty programme is switched off.");
  await expireFor(tx, c, cfg);
  const rw = await first(tx.select().from(loyaltyRewards).where(eq(loyaltyRewards.id, str(a.rewardId, 40))));
  if (!rw) throw new ApiError("That reward no longer exists.");
  const why = rewardAvailable(rw, c.tier);
  if (why) throw new ApiError(`${rw.name}: ${why}.`);
  if (rw.pointsCost > c.available) throw new ApiError(`${rw.name} needs ${rw.pointsCost} points — ${c.available} available.`);
  if (rw.perCustomerLimit !== null) {
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(loyaltyVouchers).where(and(eq(loyaltyVouchers.customerId, c.id), eq(loyaltyVouchers.rewardId, rw.id), inArray(loyaltyVouchers.status, ["issued", "used"])));
    if (n >= rw.perCustomerLimit) throw new ApiError(`${rw.name}: limit of ${rw.perCustomerLimit} per customer reached.`);
  }
  const v = await issueVoucher(tx, c, { name: rw.name, kind: rw.kind, value: rw.value, productId: rw.productId, source: "points", key: `issue:${uid(10)}`, validityDays: 30, rewardId: rw.id, pointsCost: rw.pointsCost });
  if (!v) throw new ApiError("Couldn't issue that reward — try again.");
  if (rw.pointsCost > 0) await post(tx, c, { type: "reward", points: -rw.pointsCost, ref: v.ref, key: `issue-pts:${v.id}`, description: `Redeemed reward: ${rw.name} (${v.ref})`, actor }, cfg);
  await tx.update(loyaltyRewards).set({ redeemed: sql`${loyaltyRewards.redeemed} + 1` }).where(eq(loyaltyRewards.id, rw.id));
  return v;
}

export async function cancelVoucher(tx: Tx, a: Args, actor: string) {
  const v = await first(tx.select().from(loyaltyVouchers).where(eq(loyaltyVouchers.id, str(a.id, 40))));
  if (!v) throw new ApiError("Reward not found.", 404);
  if (v.status !== "issued") throw new ApiError(`This reward is already ${v.status}.`);
  const reason = str(a.reason, 300);
  if (!reason) throw new ApiError("Give a reason — it goes in the audit log.");
  const c = await mustCustomer(tx, v.customerId);
  const cfg = await getConfig(tx);
  await tx.update(loyaltyVouchers).set({ status: "cancelled", note: reason }).where(eq(loyaltyVouchers.id, v.id));
  if (v.source === "points" && v.pointsCost > 0) await post(tx, c, { type: "reward_reversal", points: v.pointsCost, ref: v.ref, key: `cancel:${v.id}`, description: `Reward ${v.name} cancelled — points returned`, actor, lifetime: 0 }, cfg);
  if (v.rewardId) await tx.update(loyaltyRewards).set({ redeemed: sql`greatest(0, ${loyaltyRewards.redeemed} - 1)` }).where(eq(loyaltyRewards.id, v.rewardId));
  await audit(tx, actor, "reward.cancel", { customerId: c.id, ref: v.ref, reason });
  return null;
}

/** A partial refund on a bill: takes back that share of the points it earned. */
export async function partialRefund(tx: Tx, a: Args, actor: string) {
  const b = await first(tx.select().from(bills).where(eq(bills.id, str(a.billId, 40))));
  if (!b) throw new ApiError("Bill not found.", 404);
  if (b.status !== "completed") throw new ApiError("That bill is already void.");
  if (!b.loyaltyCustomerId) throw new ApiError("That bill isn't linked to a loyalty member.");
  const amount = round2(num(a.amount));
  if (!(amount > 0 && amount <= b.total)) throw new ApiError(`Refund amount should be between ₹1 and ₹${b.total}.`);
  const reason = str(a.reason, 300);
  if (!reason) throw new ApiError("Give a reason — it goes in the audit log.");
  await reverseBill(tx, b, actor, amount / b.total, `Partial refund ₹${amount} (${reason})`);
  return null;
}

/** Bonus points or a free reward for a set of members — targeted campaigns from the CRM tab. */
export async function grant(tx: Tx, a: Args, actor: string) {
  const ids = strs(a.customerIds, 5000);
  if (!ids.length) throw new ApiError("Pick at least one customer.");
  const reason = str(a.reason, 200);
  if (!reason) throw new ApiError("Name the campaign — it shows on each customer's history.");
  const pts = Math.max(0, Math.floor(num(a.points) || 0));
  const kind = ["free_item", "percent", "amount"].includes(String(a.kind)) ? (a.kind as RewardKind) : null;
  const value = num(a.value) || 0;
  if (!pts && !kind) throw new ApiError("Give bonus points, a reward, or both.");
  if (kind && !(value > 0) && kind !== "free_item") throw new ApiError("Enter the reward's value.");
  const cfg = await getConfig(tx);
  const gid = uid(8);
  const members = await tx.select().from(loyaltyCustomers).where(and(inArray(loyaltyCustomers.id, ids), eq(loyaltyCustomers.status, "active")));
  for (const c of members) {
    if (pts) await post(tx, c, { type: "promo", points: pts, key: `grant:${gid}:${c.id}`, ref: `grant:${gid}`, description: reason, actor }, cfg);
    if (kind) await issueVoucher(tx, c, { name: str(a.rewardName, 80) || reason, kind, value: kind === "percent" ? Math.min(100, value) : value, productId: str(a.productId, 40) || null, source: "campaign", key: `grant-v:${gid}:${c.id}`, validityDays: Math.max(1, Math.floor(num(a.validityDays) || 30)), note: reason });
  }
  await audit(tx, actor, "campaign.grant", { ref: gid, after: { customers: members.length, points: pts, reward: kind ? { kind, value } : null }, reason });
  return { customers: members.length };
}

/** Housekeeping, run when the Loyalty page opens: expire due points and old rewards,
    hand out birthday/anniversary rewards. */
export async function maintain(tx: Tx) {
  const cfg = await getConfig(tx);
  const now = Date.now();
  await purgeOrphans(tx);
  const due = await tx.selectDistinct({ id: loyaltyLots.customerId }).from(loyaltyLots).where(and(gt(loyaltyLots.remaining, 0), isNotNull(loyaltyLots.expiresAt), lt(loyaltyLots.expiresAt, now)));
  let expired = 0;
  for (const { id } of due) {
    const c = await byId(tx, id);
    if (c) expired += await expireFor(tx, c, cfg, now);
  }
  const old = await tx.update(loyaltyVouchers).set({ status: "expired" }).where(and(eq(loyaltyVouchers.status, "issued"), isNotNull(loyaltyVouchers.expiresAt), lt(loyaltyVouchers.expiresAt, now))).returning({ id: loyaltyVouchers.id });
  let occasions = 0;
  if (cfg.enabled && (cfg.birthday.enabled || cfg.anniversary.enabled)) {
    const withDates = await tx.select().from(loyaltyCustomers).where(and(eq(loyaltyCustomers.status, "active"), or(ne(loyaltyCustomers.birthday, ""), ne(loyaltyCustomers.anniversary, ""))!));
    for (const c of withDates) occasions += await grantOccasions(tx, c, cfg, now);
  }
  return { expired, vouchersExpired: old.length, occasions };
}

export async function saveConfig(tx: Tx, a: Args, actor: string) {
  const before = await getConfig(tx);
  const cfg = sanitizeConfig(a.config);
  await tx.insert(loyaltySettings).values({ id: 1, config: cfg, updatedAt: Date.now() }).onConflictDoUpdate({ target: loyaltySettings.id, set: { config: cfg, updatedAt: Date.now() } });
  await audit(tx, actor, "settings.update", { before, after: cfg, reason: str(a.reason, 300) });
  return cfg;
}

export async function saveReward(tx: Tx, a: Args, actor: string) {
  const name = str(a.name, 80);
  if (!name) throw new ApiError("Give the reward a name.");
  const kind: RewardKind = a.kind === "free_item" || a.kind === "percent" ? a.kind : "amount";
  const value = round2(num(a.value) || 0);
  if (kind === "percent" && !(value > 0 && value <= 100)) throw new ApiError("A percentage reward should be between 1 and 100%.");
  if (kind === "amount" && !(value > 0)) throw new ApiError("Enter the reward's rupee value.");
  const productId = str(a.productId, 40) || null;
  if (kind === "free_item" && !productId) throw new ApiError("Pick the free item.");
  if (productId && !(await first(tx.select({ id: products.id }).from(products).where(eq(products.id, productId))))) throw new ApiError("That item is no longer on the menu.");
  const pointsCost = Math.max(0, Math.floor(num(a.pointsCost) || 0));
  const startsOn = day(a.startsOn) || null;
  const endsOn = day(a.endsOn) || null;
  if (startsOn && endsOn && endsOn < startsOn) throw new ApiError("The end date is before the start date.");
  const maxR = optInt(a.maxRedemptions);
  const perC = optInt(a.perCustomerLimit);
  if ((maxR !== null && !(maxR >= 1)) || (perC !== null && !(perC >= 1))) throw new ApiError("Limits should be at least 1 (or blank for none).");
  const now = Date.now();
  const fields = { name, description: str(a.description, 300), imageUrl: /^https?:\/\//i.test(str(a.imageUrl, 500)) ? str(a.imageUrl, 500) : "", category: str(a.category, 40), kind, value: kind === "free_item" ? 0 : value, productId: kind === "free_item" ? productId : null, pointsCost, tiers: tiersOf(a.tiers), startsOn, endsOn, active: a.active !== false, maxRedemptions: maxR, perCustomerLimit: perC, terms: str(a.terms, 500), updatedAt: now };
  const id = str(a.id, 40);
  if (id) {
    const before = await first(tx.select().from(loyaltyRewards).where(eq(loyaltyRewards.id, id)));
    if (!before) throw new ApiError("Reward not found.", 404);
    const [r] = await tx.update(loyaltyRewards).set(fields).where(eq(loyaltyRewards.id, id)).returning();
    await audit(tx, actor, "reward.update", { ref: r.name, before, after: r });
    return r;
  }
  const [r] = await tx.insert(loyaltyRewards).values({ id: uid(), ...fields, redeemed: 0, createdAt: now }).returning();
  await audit(tx, actor, "reward.create", { ref: r.name, after: r });
  return r;
}

export async function deleteReward(tx: Tx, a: Args, actor: string) {
  const r = await first(tx.select().from(loyaltyRewards).where(eq(loyaltyRewards.id, str(a.id, 40))));
  if (!r) throw new ApiError("Reward not found.", 404);
  // a reward that's been redeemed stays for the history; it's just switched off
  if (r.redeemed > 0 || (await first(tx.select({ id: loyaltyVouchers.id }).from(loyaltyVouchers).where(eq(loyaltyVouchers.rewardId, r.id))))) {
    await tx.update(loyaltyRewards).set({ active: false, updatedAt: Date.now() }).where(eq(loyaltyRewards.id, r.id));
    await audit(tx, actor, "reward.archive", { ref: r.name });
    return { archived: true };
  }
  await tx.delete(loyaltyRewards).where(eq(loyaltyRewards.id, r.id));
  await audit(tx, actor, "reward.delete", { ref: r.name, before: r });
  return { archived: false };
}

const SEGS: Segment[] = ["new", "regular", "frequent", "high_value", "vip", "at_risk", "inactive", "lost"];

export async function saveCampaign(tx: Tx, a: Args, actor: string) {
  const name = str(a.name, 80);
  if (!name) throw new ApiError("Give the campaign a name.");
  const type = a.type === "bonus" ? "bonus" : "multiplier";
  const value = round2(num(a.value));
  if (type === "multiplier" && !(value > 1 && value <= 10)) throw new ApiError("A points multiplier should be more than 1 (e.g. 2 for double points) and at most 10.");
  if (type === "bonus" && !(value >= 1 && value <= 100000)) throw new ApiError("Enter the bonus points.");
  const startsOn = day(a.startsOn);
  const endsOn = day(a.endsOn);
  if (startsOn && endsOn && endsOn < startsOn) throw new ApiError("The end date is before the start date.");
  const hm = (v: unknown) => {
    const x = str(v, 5);
    if (x && !/^([01]\d|2[0-3]):[0-5]\d$/.test(x)) throw new ApiError("Times should be HH:MM.");
    return x;
  };
  const usageLimit = optInt(a.usageLimit);
  const perCustomerLimit = optInt(a.perCustomerLimit);
  if ((usageLimit !== null && !(usageLimit >= 1)) || (perCustomerLimit !== null && !(perCustomerLimit >= 1))) throw new ApiError("Limits should be at least 1 (or blank for none).");
  const now = Date.now();
  const fields = {
    name,
    description: str(a.description, 300),
    type: type as "bonus" | "multiplier",
    value,
    startsOn,
    endsOn,
    startTime: hm(a.startTime),
    endTime: hm(a.endTime),
    days: Array.isArray(a.days) ? [...new Set((a.days as unknown[]).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))] : [],
    minPurchase: Math.max(0, round2(num(a.minPurchase) || 0)),
    tiers: tiersOf(a.tiers),
    segments: strs(a.segments).filter((x): x is Segment => (SEGS as string[]).includes(x)),
    categories: strs(a.categories),
    productIds: strs(a.productIds),
    usageLimit,
    perCustomerLimit,
    active: a.active !== false,
    updatedAt: now,
  };
  const id = str(a.id, 40);
  if (id) {
    const before = await first(tx.select().from(loyaltyCampaigns).where(eq(loyaltyCampaigns.id, id)));
    if (!before) throw new ApiError("Campaign not found.", 404);
    const [r] = await tx.update(loyaltyCampaigns).set(fields).where(eq(loyaltyCampaigns.id, id)).returning();
    await audit(tx, actor, "campaign.update", { ref: r.name, before, after: r });
    return r;
  }
  const [r] = await tx.insert(loyaltyCampaigns).values({ id: uid(), ...fields, used: 0, pointsGiven: 0, createdAt: now }).returning();
  await audit(tx, actor, "campaign.create", { ref: r.name, after: r });
  return r;
}

export async function deleteCampaign(tx: Tx, a: Args, actor: string) {
  const r = await first(tx.select().from(loyaltyCampaigns).where(eq(loyaltyCampaigns.id, str(a.id, 40))));
  if (!r) throw new ApiError("Campaign not found.", 404);
  if (r.used > 0) {
    await tx.update(loyaltyCampaigns).set({ active: false, updatedAt: Date.now() }).where(eq(loyaltyCampaigns.id, r.id));
    await audit(tx, actor, "campaign.archive", { ref: r.name });
    return { archived: true };
  }
  await tx.delete(loyaltyCampaigns).where(eq(loyaltyCampaigns.id, r.id));
  await audit(tx, actor, "campaign.delete", { ref: r.name, before: r });
  return { archived: false };
}

/** One row per member whose cached balance disagrees with the ledger or the point lots. */
async function mismatches(q: Q): Promise<string[]> {
  const rows = await q.execute(sql`
    select c.id from ${loyaltyCustomers} c
    left join (select customer_id, sum(points)::int s from ${loyaltyLedger} group by customer_id) l on l.customer_id = c.id
    left join (select customer_id, sum(remaining)::int s from ${loyaltyLots} group by customer_id) p on p.customer_id = c.id
    where c.available <> coalesce(l.s, 0) or c.available <> coalesce(p.s, 0)`);
  return (rows.rows as { id: string }[]).map((r) => r.id);
}

/* ================================ reads ================================ */

export async function loyaltyState(): Promise<LoyaltyState> {
  const q = db;
  const now = Date.now();
  const cfg = await getConfig(q);
  const [customers, rewards, vouchers, campaigns, referrals, auditRows, monthRows, regRows, totalRows, billRows, mism, soon] = await Promise.all([
    q.select().from(loyaltyCustomers).orderBy(desc(loyaltyCustomers.createdAt)),
    q.select().from(loyaltyRewards).orderBy(desc(loyaltyRewards.createdAt)),
    q.select().from(loyaltyVouchers).orderBy(desc(loyaltyVouchers.issuedAt)).limit(2000),
    q.select().from(loyaltyCampaigns).orderBy(desc(loyaltyCampaigns.createdAt)),
    q.select().from(loyaltyReferrals).orderBy(desc(loyaltyReferrals.createdAt)),
    q.select().from(loyaltyAudit).orderBy(desc(loyaltyAudit.createdAt)).limit(300),
    q.execute(sql`
      select to_char(to_timestamp(created_at / 1000) at time zone 'Asia/Kolkata', 'YYYY-MM') m,
        coalesce(sum(points) filter (where type in ('purchase','bonus','promo','referral','occasion')), 0)::int earned,
        coalesce(-sum(points) filter (where type in ('redemption','reward')), 0)::int redeemed,
        coalesce(-sum(points) filter (where type = 'expiry'), 0)::int expired
      from ${loyaltyLedger} group by 1 order by 1`),
    q.execute(sql`select to_char(to_timestamp(created_at / 1000) at time zone 'Asia/Kolkata', 'YYYY-MM') m, count(*)::int n from ${loyaltyCustomers} group by 1`),
    q.execute(sql`
      select
        coalesce(sum(points) filter (where type in ('purchase','bonus','promo','referral','occasion')), 0)::int earned,
        coalesce(-sum(points) filter (where type in ('redemption','reward')), 0)::int redeemed,
        coalesce(-sum(points) filter (where type = 'expiry'), 0)::int expired,
        coalesce(sum(points) filter (where type not in ('purchase','bonus','promo','referral','occasion','redemption','reward','expiry')), 0)::int adjusted
      from ${loyaltyLedger}`),
    q.execute(sql`select coalesce(sum(points_discount), 0)::float d, coalesce(sum(reward_discount), 0)::float r from ${bills} where status = 'completed'`),
    mismatches(q),
    q
      .select({ customerId: loyaltyLots.customerId, points: sql<number>`sum(${loyaltyLots.remaining})::int`, expiresAt: sql<number>`min(${loyaltyLots.expiresAt})` })
      .from(loyaltyLots)
      .where(and(gt(loyaltyLots.remaining, 0), isNotNull(loyaltyLots.expiresAt), gte(loyaltyLots.expiresAt, now), lte(loyaltyLots.expiresAt, now + cfg.expiry.warnDays * DAY)))
      .groupBy(loyaltyLots.customerId),
  ]);
  const regs = new Map((regRows.rows as { m: string; n: number }[]).map((r) => [r.m, r.n]));
  const months = (monthRows.rows as { m: string; earned: number; redeemed: number; expired: number }[]).map((r) => ({ month: r.m, earned: r.earned, redeemed: r.redeemed, expired: r.expired, registrations: regs.get(r.m) ?? 0 }));
  for (const [m, n] of regs) if (!months.some((x) => x.month === m)) months.push({ month: m, earned: 0, redeemed: 0, expired: 0, registrations: n });
  months.sort((a, b) => a.month.localeCompare(b.month));
  const t = (totalRows.rows[0] ?? { earned: 0, redeemed: 0, expired: 0, adjusted: 0 }) as { earned: number; redeemed: number; expired: number; adjusted: number };
  const bd = (billRows.rows[0] ?? { d: 0, r: 0 }) as { d: number; r: number };
  return {
    config: cfg,
    customers,
    rewards,
    vouchers,
    campaigns: campaigns as Campaign[],
    referrals,
    audit: auditRows,
    months,
    totals: {
      earned: t.earned,
      redeemed: t.redeemed,
      expired: t.expired,
      adjusted: t.adjusted,
      discounts: round2(bd.d),
      rewardDiscounts: round2(bd.r),
      rewardRedemptions: vouchers.filter((v) => v.status === "used").length,
      outstanding: customers.reduce((a, c) => a + c.available, 0),
      debt: customers.reduce((a, c) => a + c.debt, 0),
    },
    mismatched: mism,
    expiringSoon: soon.map((r) => ({ customerId: r.customerId, points: Number(r.points), expiresAt: Number(r.expiresAt) })),
  };
}

/** Billing's view of one mobile. Read-only: points due to expire are already left out. */
export async function lookup(phoneRaw: unknown): Promise<LoyaltyLookup> {
  const q = db;
  const cfg = await getConfig(q);
  const phone = mobile(phoneRaw);
  const blank: PurchaseStats = { orders: 0, visits: 0, spent: 0, aov: 0, first: null, last: null, recentVisits: 0 };
  if (!phone) return { enabled: cfg.enabled, config: cfg, customer: null, knownName: "", stats: blank, vouchers: [], rewards: [], campaigns: [], firstPurchase: true };
  const now = Date.now();
  const [c, history, rewards, camps] = await Promise.all([byPhone(q, phone), billsOf(q, phone), q.select().from(loyaltyRewards).where(eq(loyaltyRewards.active, true)), q.select().from(loyaltyCampaigns).where(eq(loyaltyCampaigns.active, true))]);
  const stats = statsFrom(history, cfg.crm.frequentDays, now);
  const knownName = history.find((b) => b.customerName && b.customerName !== "Walk-in customer")?.customerName ?? "";
  if (!c) return { enabled: cfg.enabled, config: cfg, customer: null, knownName, stats, vouchers: [], rewards: [], campaigns: camps as Campaign[], firstPurchase: true };
  const [lapsed] = await q.select({ n: sql<number>`coalesce(sum(${loyaltyLots.remaining}), 0)::int` }).from(loyaltyLots).where(and(eq(loyaltyLots.customerId, c.id), gt(loyaltyLots.remaining, 0), isNotNull(loyaltyLots.expiresAt), lt(loyaltyLots.expiresAt, now)));
  const vouchers = (await q.select().from(loyaltyVouchers).where(and(eq(loyaltyVouchers.customerId, c.id), eq(loyaltyVouchers.status, "issued")))).filter((v) => voucherLive(v, now));
  const counts = await q.select({ id: loyaltyVouchers.rewardId, n: sql<number>`count(*)::int` }).from(loyaltyVouchers).where(and(eq(loyaltyVouchers.customerId, c.id), inArray(loyaltyVouchers.status, ["issued", "used"]))).groupBy(loyaltyVouchers.rewardId);
  const used = new Map(counts.map((r) => [r.id, r.n]));
  const firstPurchase = !(await first(q.select({ id: loyaltyLedger.id }).from(loyaltyLedger).where(and(eq(loyaltyLedger.customerId, c.id), eq(loyaltyLedger.type, "purchase")))));
  const customer = { ...c, available: c.available - lapsed.n };
  return {
    enabled: cfg.enabled,
    config: cfg,
    customer,
    knownName,
    stats,
    vouchers,
    rewards: rewards.filter((r) => !rewardAvailable(r, c.tier, now) && (r.perCustomerLimit === null || (used.get(r.id) ?? 0) < r.perCustomerLimit)),
    campaigns: camps as Campaign[],
    firstPurchase,
  };
}

/** One page of the ledger for the reports and a member's history. */
export async function ledgerPage(p: URLSearchParams) {
  const page = Math.max(1, Math.floor(Number(p.get("page")) || 1));
  const size = Math.min(5000, Math.max(1, Math.floor(Number(p.get("size")) || 50)));
  const conds = [];
  const cid = p.get("customerId");
  if (cid) conds.push(eq(loyaltyLedger.customerId, cid));
  const types = (p.get("type") ?? "").split(",").filter(Boolean);
  if (types.length) conds.push(inArray(loyaltyLedger.type, types as LedgerType[]));
  const from = Number(p.get("from"));
  const to = Number(p.get("to"));
  if (from > 0) conds.push(gte(loyaltyLedger.createdAt, from));
  if (to > 0) conds.push(lte(loyaltyLedger.createdAt, to));
  const text = (p.get("q") ?? "").trim().slice(0, 60);
  if (text) conds.push(or(ilike(loyaltyLedger.description, `%${text}%`), ilike(loyaltyLedger.invoiceNo, `%${text}%`), ilike(loyaltyLedger.ref, `%${text}%`))!);
  const where = conds.length ? and(...conds) : undefined;
  const [rows, [agg]] = await Promise.all([
    db.select().from(loyaltyLedger).where(where).orderBy(desc(loyaltyLedger.createdAt), desc(loyaltyLedger.id)).limit(size).offset((page - 1) * size),
    db.select({ n: sql<number>`count(*)::int`, credit: sql<number>`coalesce(sum(${loyaltyLedger.points}) filter (where ${loyaltyLedger.points} > 0), 0)::int`, debit: sql<number>`coalesce(-sum(${loyaltyLedger.points}) filter (where ${loyaltyLedger.points} < 0), 0)::int` }).from(loyaltyLedger).where(where),
  ]);
  return { rows, total: agg.n, credit: agg.credit, debit: agg.debit, page, size };
}

/** The customer's own wallet page, found by its secret token. */
export async function walletView(tokenRaw: unknown) {
  const token = str(tokenRaw, 40);
  if (token.length < 16) return null;
  const q = db;
  const c = await first(q.select().from(loyaltyCustomers).where(eq(loyaltyCustomers.walletToken, token)));
  if (!c) return null;
  const now = Date.now();
  const cfg = await getConfig(q);
  const [shop, ledger, vouchers, rewards, lots, history] = await Promise.all([
    first(q.select({ n: settings.shopName, logo: settings.logoUrl }).from(settings).where(eq(settings.id, 1))),
    q.select().from(loyaltyLedger).where(eq(loyaltyLedger.customerId, c.id)).orderBy(desc(loyaltyLedger.createdAt)).limit(50),
    q.select().from(loyaltyVouchers).where(eq(loyaltyVouchers.customerId, c.id)).orderBy(desc(loyaltyVouchers.issuedAt)).limit(30),
    q.select().from(loyaltyRewards).where(eq(loyaltyRewards.active, true)),
    q.select().from(loyaltyLots).where(and(eq(loyaltyLots.customerId, c.id), gt(loyaltyLots.remaining, 0), isNotNull(loyaltyLots.expiresAt))).orderBy(asc(loyaltyLots.expiresAt)),
    q.select({ invoiceNo: bills.invoiceNo, total: bills.total, createdAt: bills.createdAt, pointsEarned: bills.pointsEarned, pointsRedeemed: bills.pointsRedeemed, status: bills.status }).from(bills).where(eq(bills.customerPhone, c.phone)).orderBy(desc(bills.createdAt)).limit(20),
  ]);
  const lapsed = lots.filter((l) => (l.expiresAt ?? Infinity) < now).reduce((a, l) => a + l.remaining, 0);
  return {
    shopName: shop?.n ?? "Cafe",
    logoUrl: shop?.logo?.startsWith("data:") ? `/shop-logo?v=${shop.logo.length}` : shop?.logo ?? "",
    config: cfg,
    customer: { code: c.code, name: c.name, tier: c.tier, available: c.available - lapsed, lifetime: c.lifetime, redeemed: c.redeemed, expired: c.expired, stamps: c.stamps, referralCode: c.referralCode, status: c.status, createdAt: c.createdAt },
    ledger: ledger.map((l) => ({ id: l.id, type: l.type, points: l.points, description: l.description, invoiceNo: l.invoiceNo, createdAt: l.createdAt })),
    vouchers: vouchers.map((v) => ({ ref: v.ref, name: v.name, status: voucherLive(v, now) ? "issued" : v.status === "issued" ? "expired" : v.status, expiresAt: v.expiresAt, issuedAt: v.issuedAt })),
    rewards: rewards.filter((r) => !rewardAvailable(r, c.tier, now)).map((r) => ({ id: r.id, name: r.name, description: r.description, pointsCost: r.pointsCost, terms: r.terms, imageUrl: r.imageUrl })),
    expiring: lots.filter((l) => (l.expiresAt ?? 0) >= now).slice(0, 5).map((l) => ({ points: l.remaining, expiresAt: l.expiresAt! })),
    history,
  };
}
