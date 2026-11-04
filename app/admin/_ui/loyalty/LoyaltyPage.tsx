"use client";

import { useEffect, useMemo, useState } from "react";
import { rupee, round2 } from "@/lib/money";
import { pointsValue, shopDate, tierByKey } from "@/lib/loyalty/engine";
import type { LoyaltyState } from "@/lib/loyalty/types";
import { useAdmin } from "../Store";
import { Btn, Card, Empty, Icon, Page, PageHead, Tabs } from "../kit";
import { BarList, PairColumns, Stat, monthLabel, useLoyaltyState, useStatsByPhone } from "./shared";
import Customers from "./Customers";
import { Campaigns, Rewards } from "./Programme";
import Crm from "./Crm";
import RewardRecords from "./RewardRecords";
import Reports from "./Reports";
import SettingsTab from "./Settings";

type Tab = "overview" | "customers" | "rewards" | "records" | "campaigns" | "crm" | "reports" | "settings";

/* Loyalty, rewards, membership & CRM. Staff see the member list (look up, enrol, issue
   rewards); everything that changes the programme is the owner's. */
export default function LoyaltyPage() {
  const { role, act } = useAdmin();
  const admin = role === "admin";
  const [tab, setTab] = useState<Tab>(admin ? "overview" : "customers");
  const { data, error, reload } = useLoyaltyState();

  // housekeeping (expire due points, birthday rewards) once a day per browser
  useEffect(() => {
    const k = "clc-loyalty-maintain";
    const today = shopDate(Date.now());
    try {
      if (localStorage.getItem(k) === today) return;
      localStorage.setItem(k, today);
    } catch {}
    void act("loyalty.maintain");
  }, [act]);

  const tabs: { v: Tab; t: string; n?: number }[] = admin
    ? [
        { v: "overview", t: "Overview" },
        { v: "customers", t: "Members" },
        { v: "rewards", t: "Rewards" },
        { v: "records", t: "Rewards earned" },
        { v: "campaigns", t: "Campaigns" },
        { v: "crm", t: "Customer CRM" },
        { v: "reports", t: "Reports" },
        { v: "settings", t: "Settings" },
      ]
    : [{ v: "customers", t: "Members" }];

  return (
    <Page>
      <PageHead
        title="Loyalty & Rewards"
        sub={data ? (data.config.enabled ? "Points, membership tiers, rewards, visit stamps and referrals." : "The programme is switched off — turn it on in Settings.") : "Loading…"}
        right={
          <Btn icon="refresh" onClick={reload} className="h-10">
            Refresh
          </Btn>
        }
      />
      <Tabs value={tab} options={tabs} onChange={setTab} />
      {error && !data && <p className="rounded-xl bg-red-50 px-4 py-3 text-[13px] font-semibold text-red-700">{error} If this is the first run, apply the database migration (npm run db:migrate).</p>}
      {!data && !error && <p className="py-16 text-center text-[13px] text-slate-400">Loading loyalty data…</p>}
      {data && tab === "overview" && <Overview d={data} />}
      {data && tab === "customers" && <Customers d={data} reload={reload} />}
      {data && tab === "rewards" && <Rewards d={data} />}
      {data && tab === "records" && <RewardRecords d={data} />}
      {data && tab === "campaigns" && <Campaigns d={data} />}
      {data && tab === "crm" && <Crm d={data} />}
      {data && tab === "reports" && <Reports d={data} />}
      {data && tab === "settings" && <SettingsTab d={data} />}
    </Page>
  );
}

function Overview({ d }: { d: LoyaltyState }) {
  const { s, now } = useAdmin();
  const cfg = d.config;
  const stats = useStatsByPhone(s.bills, cfg.crm.frequentDays);
  const thisMonth = shopDate(now).slice(0, 7);

  const o = useMemo(() => {
    const members = d.customers;
    const active = members.filter((c) => c.status === "active");
    const memberPhones = new Set(members.map((c) => c.phone));
    let memberSpend = 0;
    let memberOrders = 0;
    let otherSpend = 0;
    let otherOrders = 0;
    for (const [phone, st] of stats) {
      if (memberPhones.has(phone)) {
        memberSpend += st.spent;
        memberOrders += st.orders;
      } else {
        otherSpend += st.spent;
        otherOrders += st.orders;
      }
    }
    const repeat = members.filter((c) => (stats.get(c.phone)?.visits ?? 0) >= 2).length;
    const tiers = cfg.tiers.map((t) => ({ key: t.key, label: t.name, value: members.filter((c) => c.tier === t.key).length }));
    // new vs returning customers per month, from every bill with a mobile
    const firstMonth = new Map<string, string>();
    for (const [phone, st] of stats) if (st.first) firstMonth.set(phone, shopDate(st.first).slice(0, 7));
    const nr = new Map<string, { n: number; r: number }>();
    for (const b of s.bills) {
      if (b.status !== "completed" || !b.customerPhone) continue;
      const m = shopDate(b.createdAt).slice(0, 7);
      const row = nr.get(m) ?? { n: 0, r: 0 };
      nr.set(m, row);
    }
    const seen = new Map<string, Set<string>>();
    for (const b of s.bills) {
      if (b.status !== "completed" || !b.customerPhone) continue;
      const m = shopDate(b.createdAt).slice(0, 7);
      const set = seen.get(m) ?? new Set();
      if (set.has(b.customerPhone)) continue;
      set.add(b.customerPhone);
      seen.set(m, set);
      const row = nr.get(m)!;
      if (firstMonth.get(b.customerPhone) === m) row.n++;
      else row.r++;
    }
    const nrRows = [...nr.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-12).map(([m, v]) => ({ label: monthLabel(m), a: v.n, b: v.r }));
    // the free-reward side: every reward ever given, and the ones used on bills (with what each took off)
    const names = new Map(members.map((c) => [c.id, c.name]));
    const billOff = new Map(s.bills.map((b) => [b.id, b.rewardDiscount]));
    const usedRewards = d.vouchers
      .filter((v) => v.status === "used")
      .sort((a, b) => (b.usedAt ?? 0) - (a.usedAt ?? 0))
      .map((v) => ({ id: v.id, name: v.name, who: names.get(v.customerId) ?? "—", invoice: v.invoiceNo ?? "", off: v.billId ? billOff.get(v.billId) ?? 0 : 0, cost: v.pointsCost }));
    const rewardCounts = { given: d.vouchers.length, used: usedRewards.length, waiting: d.vouchers.filter((v) => v.status === "issued").length, lapsed: d.vouchers.filter((v) => v.status === "expired" || v.status === "cancelled").length };
    const popularity = new Map<string, number>();
    for (const v of d.vouchers) if (v.status === "used") popularity.set(v.name, (popularity.get(v.name) ?? 0) + 1);
    return {
      members,
      active,
      newThisMonth: members.filter((c) => shopDate(c.createdAt).slice(0, 7) === thisMonth).length,
      repeat,
      usedRewards,
      rewardCounts,
      memberAov: memberOrders ? round2(memberSpend / memberOrders) : 0,
      otherAov: otherOrders ? round2(otherSpend / otherOrders) : 0,
      tiers,
      nrRows,
      popularity: [...popularity.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => ({ key: k, label: k, value: v })),
      topSpend: members.map((c) => ({ key: c.id, label: c.name, sub: c.phone, value: stats.get(c.phone)?.spent ?? 0 })).sort((a, b) => b.value - a.value).slice(0, 8),
      topVisits: members.map((c) => ({ key: c.id, label: c.name, sub: c.phone, value: stats.get(c.phone)?.visits ?? 0 })).sort((a, b) => b.value - a.value).slice(0, 8),
    };
  }, [d, stats, s.bills, cfg, thisMonth]);

  if (!d.customers.length)
    return (
      <Empty icon="star" title="No loyalty members yet">
        Enrol customers from Billing (type their mobile, then “Enrol”) or from the Members tab. Points start with their next paid bill.
      </Empty>
    );

  const months = d.months.slice(-12);
  return (
    <div className="space-y-5">
      {d.mismatched.length > 0 && (
        <p className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-semibold text-red-700">
          <Icon name="alert" size={16} /> {d.mismatched.length} member balance{d.mismatched.length === 1 ? " doesn't" : "s don't"} match the ledger. Check the audit log before adjusting.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Loyalty members" value={o.members.length} hint={`${o.active.length} active · ${o.newThisMonth} joined this month`} note="Customers enrolled in your loyalty programme. Only active members earn and use points." />
        <Stat label="Repeat members" value={o.repeat} hint="2 or more visits" note="Members who have come on 2 or more different days — a sign the programme is bringing people back." />
        <Stat
          label="Points earned"
          value={d.totals.earned.toLocaleString("en-IN")}
          hint={`${d.totals.redeemed.toLocaleString("en-IN")} used · ${d.totals.expired.toLocaleString("en-IN")} expired${d.totals.adjusted ? ` · ${d.totals.adjusted > 0 ? "+" : "−"}${Math.abs(d.totals.adjusted).toLocaleString("en-IN")} corrections` : ""}`}
          note={`All points ever given to members (bills, birthdays, referrals…). Earned − used − expired${d.totals.adjusted ? " ± corrections (points taken back for deleted or refunded bills, manual changes)" : ""} = the ${d.totals.outstanding.toLocaleString("en-IN")} points members hold now.`}
          tone="green"
        />
        <Stat label="Outstanding liability" value={rupee(pointsValue(d.totals.outstanding, cfg))} hint={`${d.totals.outstanding.toLocaleString("en-IN")} unspent points`} note="What members' unspent points are worth in rupees — what you would give away if every member used all their points." tone="amber" />
        <Stat label="Loyalty discounts given" value={rupee(d.totals.discounts + d.totals.rewardDiscounts)} hint={`${rupee(d.totals.discounts)} points · ${rupee(d.totals.rewardDiscounts)} rewards`} note="Money taken off completed bills because members used points or free rewards." tone="red" />
        <Stat label="Reward redemptions" value={d.totals.rewardRedemptions} hint={`${d.vouchers.filter((v) => v.status === "issued").length === 1 ? "1 reward waiting" : `${d.vouchers.filter((v) => v.status === "issued").length} rewards waiting`} to be used`} note="Free rewards (such as a birthday treat) that members have already used on a bill." />
        <Stat label="Member avg. bill" value={rupee(o.memberAov)} hint={`Non-members: ${rupee(o.otherAov)}`} note="Average bill of customers who are loyalty members (counting all bills on their mobile number), against customers who aren't." />
        <Stat label="Points expiring soon" value={d.expiringSoon.reduce((a, x) => a + x.points, 0)} hint={`within ${cfg.expiry.warnDays} days · ${d.expiringSoon.length} members`} note="Points that will run out within the warning period you set in Settings — a good moment to remind those members." />
      </div>

      <Card title="Points and rewards — what came in, what went out">
        <div className="grid gap-6 md:grid-cols-2 md:divide-x md:divide-slate-100">
          <section aria-label="Points" className="md:pr-6">
            <h4 className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-600">Points</h4>
            <p className="mb-3 text-[11.5px] text-slate-500">Earned by spending. 1 point = {rupee(cfg.redeem.pointValue)}.</p>
            <dl className="space-y-1.5 text-[13px]">
              <div className="flex justify-between">
                <dt className="text-slate-600">Earned</dt>
                <dd className="adm-num font-bold text-emerald-700">+{d.totals.earned.toLocaleString("en-IN")}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-600">Used as money off, or on rewards bought with points</dt>
                <dd className="adm-num font-bold">−{d.totals.redeemed.toLocaleString("en-IN")}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-600">Expired</dt>
                <dd className="adm-num font-bold">−{d.totals.expired.toLocaleString("en-IN")}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-600">Taken back (deleted / refunded bills) and manual changes</dt>
                <dd className="adm-num font-bold">{d.totals.adjusted < 0 ? "−" : d.totals.adjusted > 0 ? "+" : ""}{Math.abs(d.totals.adjusted).toLocaleString("en-IN")}</dd>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2 text-[14px]">
                <dt className="font-bold text-slate-900">Held by members now</dt>
                <dd className="adm-num font-extrabold text-amber-700">
                  {d.totals.outstanding.toLocaleString("en-IN")} pts · {rupee(pointsValue(d.totals.outstanding, cfg))}
                </dd>
              </div>
              <div className="flex justify-between text-[12px] text-slate-500">
                <dt>Money taken off bills with points</dt>
                <dd className="adm-num font-semibold">{rupee(d.totals.discounts)}</dd>
              </div>
            </dl>
          </section>

          <section aria-label="Rewards" className="md:pl-6">
            <h4 className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-600">Free rewards</h4>
            <p className="mb-3 text-[11.5px] text-slate-500">Birthday treats, visit-stamp rewards and campaign gifts. They take money off a bill without using points.</p>
            <dl className="space-y-1.5 text-[13px]">
              <div className="flex justify-between">
                <dt className="text-slate-600">Given to members</dt>
                <dd className="adm-num font-bold">{o.rewardCounts.given}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-600">Used on bills</dt>
                <dd className="adm-num font-bold text-emerald-700">{o.rewardCounts.used}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-600">Waiting to be used</dt>
                <dd className="adm-num font-bold">{o.rewardCounts.waiting}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-600">Expired or cancelled</dt>
                <dd className="adm-num font-bold">{o.rewardCounts.lapsed}</dd>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2 text-[14px]">
                <dt className="font-bold text-slate-900">Money taken off bills with rewards</dt>
                <dd className="adm-num font-extrabold text-red-700">{rupee(d.totals.rewardDiscounts)}</dd>
              </div>
            </dl>
            {o.usedRewards.length > 0 && (
              <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-100 text-[12.5px]">
                {o.usedRewards.slice(0, 6).map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0">
                      <b className="block truncate text-slate-800">{r.name}</b>
                      <span className="text-[11.5px] text-slate-500">
                        {r.who}
                        {r.invoice ? ` · ${r.invoice}` : ""}
                        {r.cost > 0 ? ` · cost ${r.cost} pts` : " · free"}
                      </span>
                    </span>
                    <span className="adm-num shrink-0 font-bold text-slate-900">{rupee(r.off)} off</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
          <b>Points side:</b> earned − used − expired ± corrections = held now. <b>Rewards side</b> is separate — a free reward never changes the points.
        </p>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Points earned vs redeemed (monthly)">
          <PairColumns data={months.map((m) => ({ label: monthLabel(m.month), a: m.earned, b: m.redeemed }))} a="Earned" b="Redeemed" />
        </Card>
        <Card title="New vs returning customers (monthly)">
          <PairColumns data={o.nrRows} a="New" b="Returning" />
        </Card>
        <Card title="Membership distribution">
          <BarList rows={o.tiers.map((t) => ({ ...t, sub: `${tierByKey(t.key, cfg).min}+ pts` }))} />
        </Card>
        <Card title="Monthly registrations">
          <BarList rows={months.map((m) => ({ key: m.month, label: monthLabel(m.month), value: m.registrations }))} empty="No registrations yet" />
        </Card>
        <Card title="Top members by spending">
          <BarList rows={o.topSpend} fmt={rupee} />
        </Card>
        <Card title="Top members by visits">
          <BarList rows={o.topVisits} fmt={(n) => `${n} visits`} />
        </Card>
        <Card title="Reward popularity">
          <BarList rows={o.popularity} fmt={(n) => `${n}×`} empty="No rewards redeemed yet" />
        </Card>
        <Card title="Campaign performance">
          <BarList rows={d.campaigns.map((c) => ({ key: c.id, label: c.name, sub: `${c.used} bills`, value: c.pointsGiven }))} fmt={(n) => `${n} pts`} empty="No campaigns yet" />
        </Card>
      </div>
    </div>
  );
}
