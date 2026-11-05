"use client";

import { useEffect, useState } from "react";
import { shopDate } from "@/lib/loyalty/engine";
import { useAdmin } from "../Store";
import { Btn, Page, PageHead, Tabs } from "../kit";
import { Stat, useLoyaltyState } from "./shared";
import Customers from "./Customers";
import Crm from "./Crm";
import Dashboard from "./Dashboard";
import RewardRecords from "./RewardRecords";
import Rewards from "./Rewards";
import SettingsTab from "./Settings";

type Tab = "dashboard" | "customers" | "rewards" | "records" | "crm" | "settings";

/* Loyalty: Dashboard, Customers, Free Gifts & Rewards, Rewards earned, Customer CRM and Settings. Staff see Customers (look up, register, see points and rewards); the owner also sets up the
   gifts and the settings. */
export default function LoyaltyPage() {
  const { role, act } = useAdmin();
  const admin = role === "admin";
  const [tab, setTab] = useState<Tab>(admin ? "dashboard" : "customers");
  const { data, error, reload } = useLoyaltyState();

  // housekeeping once a day per browser: tidy the records of bills that were deleted
  useEffect(() => {
    const k = "clc-loyalty-maintain-3";
    const today = shopDate(Date.now());
    try {
      if (localStorage.getItem(k) === today) return;
      localStorage.setItem(k, today);
    } catch {}
    void act("loyalty.maintain");
  }, [act]);

  const tabs: { v: Tab; t: string }[] = admin
    ? [
        { v: "dashboard", t: "Dashboard" },
        { v: "customers", t: "Customers" },
        { v: "rewards", t: "Free Gifts & Rewards" },
        { v: "records", t: "Rewards earned" },
        { v: "crm", t: "Customer CRM" },
        { v: "settings", t: "Settings" },
      ]
    : [{ v: "customers", t: "Customers" }];

  return (
    <Page>
      <PageHead
        title="Loyalty"
        sub={data ? (data.config.enabled ? "Points, free gifts and rewards for your regular customers." : "The programme is switched off — turn it on in Settings.") : "Loading…"}
        right={
          <Btn icon="refresh" onClick={reload} className="h-10">
            Refresh
          </Btn>
        }
      />
      {error && !data && <p className="rounded-xl bg-red-50 px-4 py-3 text-[13px] font-semibold text-red-700">{error}</p>}
      {!data && !error && <p className="py-16 text-center text-[13px] text-slate-400">Loading loyalty data…</p>}
      {data && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Loyalty customers" value={data.customers.length.toLocaleString("en-IN")} />
            <Stat label="Points earned" value={data.totals.earned.toLocaleString("en-IN")} tone="green" />
            <Stat label="Points redeemed" value={data.totals.redeemed.toLocaleString("en-IN")} tone="red" />
            <Stat label="Available points" value={data.totals.outstanding.toLocaleString("en-IN")} tone="amber" hint="held by customers now" />
            <Stat label="Free gifts given" value={data.totals.giftsGiven.toLocaleString("en-IN")} hint="on paid bills" />
          </div>
          {data.mismatched.length > 0 && <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-[13px] font-semibold text-red-700">{data.mismatched.length} customer balance(s) don&apos;t match their points history — please tell your developer.</p>}
          {tabs.length > 1 && <Tabs value={tab} options={tabs} onChange={setTab} />}
          {admin && tab === "dashboard" && <Dashboard d={data} onOpen={setTab} />}
          {tab === "customers" && <Customers d={data} reload={reload} />}
          {admin && tab === "rewards" && <Rewards d={data} />}
          {admin && tab === "records" && <RewardRecords d={data} />}
          {admin && tab === "crm" && <Crm d={data} />}
          {admin && tab === "settings" && <SettingsTab d={data} />}
        </>
      )}
    </Page>
  );
}
