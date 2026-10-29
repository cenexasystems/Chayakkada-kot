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
import Reports from "./Reports";
import SettingsTab from "./Settings";

type Tab = "overview" | "customers" | "rewards" | "campaigns" | "crm" | "reports" | "settings";

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
    const popularity = new Map<string, number>();
    for (const v of d.vouchers) if (v.status === "used") popularity.set(v.name, (popularity.get(v.name) ?? 0) + 1);
    return {
      members,
      active,
      newThisMonth: members.filter((c) => shopDate(c.createdAt).slice(0, 7) === thisMonth).length,
      repeat,
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
        <Stat label="Loyalty members" value={o.members.length} hint={`${o.active.length} active · ${o.newThisMonth} joined this month`} />
        <Stat label="Repeat members" value={o.repeat} hint="2 or more visits" />
        <Stat label="Points earned" value={d.totals.earned.toLocaleString("en-IN")} hint={`${d.totals.redeemed.toLocaleString("en-IN")} redeemed · ${d.totals.expired.toLocaleString("en-IN")} expired`} tone="green" />
        <Stat label="Outstanding liability" value={rupee(pointsValue(d.totals.outstanding, cfg))} hint={`${d.totals.outstanding.toLocaleString("en-IN")} unspent points`} tone="amber" />
        <Stat label="Loyalty discounts given" value={rupee(d.totals.discounts + d.totals.rewardDiscounts)} hint={`${rupee(d.totals.discounts)} points · ${rupee(d.totals.rewardDiscounts)} rewards`} tone="red" />
        <Stat label="Reward redemptions" value={d.totals.rewardRedemptions} hint={`${d.vouchers.filter((v) => v.status === "issued").length} rewards waiting to be used`} />
        <Stat label="Member avg. bill" value={rupee(o.memberAov)} hint={`Non-members: ${rupee(o.otherAov)}`} />
        <Stat label="Points expiring soon" value={d.expiringSoon.reduce((a, x) => a + x.points, 0)} hint={`within ${cfg.expiry.warnDays} days · ${d.expiringSoon.length} members`} />
      </div>

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
