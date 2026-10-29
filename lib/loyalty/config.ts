/* Loyalty programme settings: one JSON document, edited by the admin. Shared by the
   server (which enforces it) and the admin screens (which preview with it).
   Every value here is a default the owner can change on the Loyalty → Settings tab. */

export type TierKey = "bronze" | "silver" | "gold" | "platinum";
export const TIER_KEYS: TierKey[] = ["bronze", "silver", "gold", "platinum"];

export type Tier = { key: TierKey; name: string; min: number; multiplier: number; benefits: string };

export type RewardKind = "free_item" | "percent" | "amount";

/** A reward handed out automatically (visit milestone, birthday, …). */
export type AutoReward = { kind: RewardKind | "none"; name: string; value: number; productId: string | null };

export type Milestone = { visits: number; reward: AutoReward; validityDays: number };

export type Occasion = { enabled: boolean; bonusPoints: number; reward: AutoReward; windowDays: number; validityDays: number; tiers: TierKey[] };

export type EarnRule = { target: "product" | "category"; key: string; multiplier: number };

export type LoyaltyConfig = {
  enabled: boolean;
  earn: {
    /** per100: N points for every ₹100; percent: N% of the amount, as points */
    mode: "per100" | "percent";
    per100: number;
    percent: number;
    fixedPerBill: number;
    minBill: number;
    /** 0 = no cap (applies to purchase points, not bonuses) */
    maxPerBill: number;
    rounding: "floor" | "round" | "ceil";
    firstPurchaseBonus: number;
    excludedProductIds: string[];
    excludedCategories: string[];
    rules: EarnRule[];
  };
  redeem: {
    enabled: boolean;
    /** rupees per point */
    pointValue: number;
    minPoints: number;
    /** % of the eligible bill that points may pay for */
    maxPercent: number;
    /** ₹ cap per bill, 0 = none */
    maxAmount: number;
    withCoupon: boolean;
    withManual: boolean;
    withReward: boolean;
    excludedProductIds: string[];
    excludedCategories: string[];
  };
  tiers: Tier[];
  expiry: { days: number; warnDays: number };
  stamps: { enabled: boolean; minBill: number; rule: "per_day" | "per_bill"; tiers: TierKey[]; milestones: Milestone[] };
  birthday: Occasion;
  anniversary: Occasion;
  referral: { enabled: boolean; referrerBonus: number; refereeBonus: number; minPurchase: number; startsOn: string; endsOn: string; maxPerReferrer: number; tiers: TierKey[] };
  crm: { newDays: number; regularVisits: number; frequentVisits: number; frequentDays: number; highValue: number; vipSpend: number; atRiskDays: number; inactiveDays: number; lostDays: number };
};

const none: AutoReward = { kind: "none", name: "", value: 0, productId: null };

export const DEFAULT_CONFIG: LoyaltyConfig = {
  enabled: true,
  earn: { mode: "per100", per100: 5, percent: 5, fixedPerBill: 0, minBill: 0, maxPerBill: 0, rounding: "floor", firstPurchaseBonus: 0, excludedProductIds: [], excludedCategories: [], rules: [] },
  redeem: { enabled: true, pointValue: 0.5, minPoints: 20, maxPercent: 20, maxAmount: 0, withCoupon: true, withManual: true, withReward: true, excludedProductIds: [], excludedCategories: [] },
  tiers: [
    { key: "bronze", name: "Bronze", min: 0, multiplier: 1, benefits: "Standard earning · basic rewards" },
    { key: "silver", name: "Silver", min: 500, multiplier: 1.25, benefits: "1.25× points · exclusive offers" },
    { key: "gold", name: "Gold", min: 1500, multiplier: 1.5, benefits: "1.5× points · birthday rewards · special offers" },
    { key: "platinum", name: "Platinum", min: 3000, multiplier: 2, benefits: "2× points · VIP rewards · exclusive benefits" },
  ],
  expiry: { days: 365, warnDays: 30 },
  stamps: {
    enabled: true,
    minBill: 100,
    rule: "per_day",
    tiers: [],
    milestones: [
      { visits: 5, reward: { kind: "amount", name: "Free tea", value: 20, productId: null }, validityDays: 30 },
      { visits: 10, reward: { kind: "amount", name: "Free snack", value: 50, productId: null }, validityDays: 30 },
      { visits: 15, reward: { kind: "percent", name: "15th visit treat — 25% off", value: 25, productId: null }, validityDays: 30 },
    ],
  },
  birthday: { enabled: true, bonusPoints: 50, reward: { kind: "percent", name: "Birthday treat — 15% off", value: 15, productId: null }, windowDays: 7, validityDays: 14, tiers: [] },
  anniversary: { enabled: false, bonusPoints: 50, reward: none, windowDays: 7, validityDays: 14, tiers: [] },
  referral: { enabled: true, referrerBonus: 50, refereeBonus: 25, minPurchase: 200, startsOn: "", endsOn: "", maxPerReferrer: 20, tiers: [] },
  crm: { newDays: 30, regularVisits: 3, frequentVisits: 6, frequentDays: 90, highValue: 5000, vipSpend: 15000, atRiskDays: 30, inactiveDays: 60, lostDays: 90 },
};

/* ---------- sanitising: whatever comes in, a valid config goes out ---------- */
const n = (v: unknown, lo: number, hi: number, d: number) => {
  const x = typeof v === "string" && v.trim() === "" ? NaN : Number(v);
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d;
};
const i = (v: unknown, lo: number, hi: number, d: number) => Math.round(n(v, lo, hi, d));
const b = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const s = (v: unknown, max: number, d = "") => (typeof v === "string" ? v.trim().slice(0, max) : d);
const strs = (v: unknown, max = 200) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim().slice(0, 80)))].slice(0, max) : []);
const tiersOf = (v: unknown): TierKey[] => strs(v).filter((x): x is TierKey => (TIER_KEYS as string[]).includes(x));
const day = (v: unknown) => {
  const x = s(v, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : "";
};
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function autoReward(v: unknown, d: AutoReward): AutoReward {
  const o = obj(v);
  const kind = ["none", "free_item", "percent", "amount"].includes(String(o.kind)) ? (o.kind as AutoReward["kind"]) : d.kind;
  return { kind, name: s(o.name, 80, d.name), value: kind === "percent" ? n(o.value, 0, 100, d.value) : n(o.value, 0, 100000, d.value), productId: s(o.productId, 40) || null };
}

function occasion(v: unknown, d: Occasion): Occasion {
  const o = obj(v);
  return { enabled: b(o.enabled, d.enabled), bonusPoints: i(o.bonusPoints, 0, 100000, d.bonusPoints), reward: autoReward(o.reward, d.reward), windowDays: i(o.windowDays, 0, 31, d.windowDays), validityDays: i(o.validityDays, 1, 365, d.validityDays), tiers: o.tiers === undefined ? d.tiers : tiersOf(o.tiers) };
}

export function sanitizeConfig(raw: unknown): LoyaltyConfig {
  const D = DEFAULT_CONFIG;
  const r = obj(raw);
  const e = obj(r.earn);
  const rd = obj(r.redeem);
  const ex = obj(r.expiry);
  const st = obj(r.stamps);
  const rf = obj(r.referral);
  const c = obj(r.crm);
  const rawTiers = Array.isArray(r.tiers) ? (r.tiers as unknown[]).map(obj) : [];
  const tiers = D.tiers.map((t) => {
    const x = rawTiers.find((y) => y.key === t.key) ?? {};
    return { key: t.key, name: s(x.name, 30, t.name) || t.name, min: i(x.min, 0, 10_000_000, t.min), multiplier: n(x.multiplier, 0, 20, t.multiplier), benefits: s(x.benefits, 300, t.benefits) };
  });
  tiers[0].min = 0;
  for (let k = 1; k < tiers.length; k++) if (tiers[k].min <= tiers[k - 1].min) tiers[k].min = tiers[k - 1].min + 1;

  const milestones = (Array.isArray(st.milestones) ? (st.milestones as unknown[]) : D.stamps.milestones)
    .map(obj)
    .map((m) => ({ visits: i(m.visits, 1, 1000, 0), reward: autoReward(m.reward, none), validityDays: i(m.validityDays, 1, 365, 30) }))
    .filter((m) => m.visits > 0 && m.reward.kind !== "none")
    .sort((a, b) => a.visits - b.visits)
    .filter((m, k, all) => k === 0 || all[k - 1].visits !== m.visits)
    .slice(0, 20);

  return {
    enabled: b(r.enabled, D.enabled),
    earn: {
      mode: e.mode === "percent" ? "percent" : e.mode === "per100" ? "per100" : D.earn.mode,
      per100: n(e.per100, 0, 1000, D.earn.per100),
      percent: n(e.percent, 0, 100, D.earn.percent),
      fixedPerBill: i(e.fixedPerBill, 0, 10000, D.earn.fixedPerBill),
      minBill: n(e.minBill, 0, 1_000_000, D.earn.minBill),
      maxPerBill: i(e.maxPerBill, 0, 1_000_000, D.earn.maxPerBill),
      rounding: e.rounding === "round" || e.rounding === "ceil" || e.rounding === "floor" ? e.rounding : D.earn.rounding,
      firstPurchaseBonus: i(e.firstPurchaseBonus, 0, 100000, D.earn.firstPurchaseBonus),
      excludedProductIds: e.excludedProductIds === undefined ? D.earn.excludedProductIds : strs(e.excludedProductIds),
      excludedCategories: e.excludedCategories === undefined ? D.earn.excludedCategories : strs(e.excludedCategories),
      rules: (Array.isArray(e.rules) ? (e.rules as unknown[]) : D.earn.rules)
        .map(obj)
        .map((x) => ({ target: x.target === "product" ? ("product" as const) : ("category" as const), key: s(x.key, 80), multiplier: n(x.multiplier, 0, 20, 1) }))
        .filter((x) => x.key)
        .slice(0, 100),
    },
    redeem: {
      enabled: b(rd.enabled, D.redeem.enabled),
      pointValue: n(rd.pointValue, 0.01, 1000, D.redeem.pointValue),
      minPoints: i(rd.minPoints, 1, 1_000_000, D.redeem.minPoints),
      maxPercent: n(rd.maxPercent, 0, 100, D.redeem.maxPercent),
      maxAmount: n(rd.maxAmount, 0, 1_000_000, D.redeem.maxAmount),
      withCoupon: b(rd.withCoupon, D.redeem.withCoupon),
      withManual: b(rd.withManual, D.redeem.withManual),
      withReward: b(rd.withReward, D.redeem.withReward),
      excludedProductIds: rd.excludedProductIds === undefined ? D.redeem.excludedProductIds : strs(rd.excludedProductIds),
      excludedCategories: rd.excludedCategories === undefined ? D.redeem.excludedCategories : strs(rd.excludedCategories),
    },
    tiers,
    expiry: { days: i(ex.days, 0, 3650, D.expiry.days), warnDays: i(ex.warnDays, 1, 365, D.expiry.warnDays) },
    stamps: { enabled: b(st.enabled, D.stamps.enabled), minBill: n(st.minBill, 0, 1_000_000, D.stamps.minBill), rule: st.rule === "per_bill" ? "per_bill" : st.rule === "per_day" ? "per_day" : D.stamps.rule, tiers: st.tiers === undefined ? D.stamps.tiers : tiersOf(st.tiers), milestones },
    birthday: occasion(r.birthday, D.birthday),
    anniversary: occasion(r.anniversary, D.anniversary),
    referral: {
      enabled: b(rf.enabled, D.referral.enabled),
      referrerBonus: i(rf.referrerBonus, 0, 100000, D.referral.referrerBonus),
      refereeBonus: i(rf.refereeBonus, 0, 100000, D.referral.refereeBonus),
      minPurchase: n(rf.minPurchase, 0, 1_000_000, D.referral.minPurchase),
      startsOn: rf.startsOn === undefined ? D.referral.startsOn : day(rf.startsOn),
      endsOn: rf.endsOn === undefined ? D.referral.endsOn : day(rf.endsOn),
      maxPerReferrer: i(rf.maxPerReferrer, 0, 100000, D.referral.maxPerReferrer),
      tiers: rf.tiers === undefined ? D.referral.tiers : tiersOf(rf.tiers),
    },
    crm: {
      newDays: i(c.newDays, 1, 3650, D.crm.newDays),
      regularVisits: i(c.regularVisits, 1, 1000, D.crm.regularVisits),
      frequentVisits: i(c.frequentVisits, 1, 1000, D.crm.frequentVisits),
      frequentDays: i(c.frequentDays, 1, 3650, D.crm.frequentDays),
      highValue: n(c.highValue, 0, 100_000_000, D.crm.highValue),
      vipSpend: n(c.vipSpend, 0, 100_000_000, D.crm.vipSpend),
      atRiskDays: i(c.atRiskDays, 1, 3650, D.crm.atRiskDays),
      inactiveDays: i(c.inactiveDays, 1, 3650, D.crm.inactiveDays),
      lostDays: i(c.lostDays, 1, 3650, D.crm.lostDays),
    },
  };
}
