"use client";

import { subscribeChanges } from "@/lib/realtime";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type { AdminState, Order, Session } from "@/lib/types";
import type { Role } from "@/lib/auth";
import { round2 } from "@/lib/money";

/* ------------------------------------------------------------------
   Admin data store: one copy of the server state, kept fresh by a
   cheap version poll, plus toasts / confirm / print helpers.
   ------------------------------------------------------------------ */

export type Toast = { id: number; kind: "ok" | "err" | "order" | "bill" | "info"; title: string; body?: string; href?: string };
type ConfirmReq = { title: string; body?: React.ReactNode; ok?: string; danger?: boolean };
export type ActResult<T = unknown> = { ok: true; result: T } | { ok: false; error: string };
/** `optimistic` paints the expected result straight away and lets the server catch up in
    the background; if the server says no, the screen goes back to what the server has. */
export type ActOpts = { optimistic?: (s: AdminState) => AdminState };

/** One open tab, found by the customer's mobile. */
export type FloorTab = {
  session: Session;
  orders: Order[];
  total: number;
  items: number;
  fresh: number;
  cooking: number;
  billRequested: boolean;
};

type Ctx = {
  s: AdminState;
  /** Who's signed in — "admin" is the owner, "staff" is a cashier/cook. */
  role: Role;
  act: <T = unknown>(op: string, args?: Record<string, unknown>, opts?: ActOpts) => Promise<ActResult<T>>;
  refresh: () => Promise<void>;
  toast: (t: Omit<Toast, "id">) => void;
  toasts: Toast[];
  dismiss: (id: number) => void;
  confirm: (c: ConfirmReq) => Promise<boolean>;
  pending: ConfirmReq | null;
  answer: (v: boolean) => void;
  print: (node: React.ReactNode) => void;
  printNode: React.ReactNode;
  sound: boolean;
  setSound: (v: boolean) => void;
  base: string;
  now: number;
  floor: FloorTab[];
};

/** Who a tab, order or bill belongs to, as staff read it: name first, then mobile. */
export const whoIs = (x: { customerName: string; customerPhone: string }) => x.customerName || x.customerPhone || "Guest";

const C = createContext<Ctx | null>(null);

export function useAdmin() {
  const c = useContext(C);
  if (!c) throw new Error("useAdmin outside AdminProvider");
  return c;
}

const itemsText = (o: Order) => o.items.map((i) => `${i.qty}× ${i.name}`).join(", ");

/* the chime on/off switch lives in localStorage, read as an external store */
const soundSubs = new Set<() => void>();
const soundPref = {
  subscribe: (cb: () => void) => (soundSubs.add(cb), () => void soundSubs.delete(cb)),
  get: () => {
    try {
      return localStorage.getItem("clc-admin-sound") !== "0";
    } catch {
      return true;
    }
  },
  set: (v: boolean) => {
    try {
      localStorage.setItem("clc-admin-sound", v ? "1" : "0");
    } catch {}
    soundSubs.forEach((f) => f());
  },
};
const noop = () => () => {};

export function AdminProvider({ initial, role, children }: { initial: AdminState; role: Role; children: React.ReactNode }) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pending, setPending] = useState<ConfirmReq | null>(null);
  const [printNode, setPrintNode] = useState<React.ReactNode>(null);
  const [printTick, setPrintTick] = useState(0);
  const sound = useSyncExternalStore(soundPref.subscribe, soundPref.get, () => true);
  const origin = useSyncExternalStore(noop, () => window.location.origin, () => "");
  const [now, setNow] = useState(() => Date.now());
  const version = useRef(initial.version);
  /* Optimistic writes in flight, and a counter that moves each time one starts. A poll
     that began before a write, or lands while one is still pending, carries older data
     than the screen shows — applying it would flick the number back and forth. */
  const writes = useRef(0);
  const writeGen = useRef(0);
  const reload = useRef(false);
  const resolver = useRef<((v: boolean) => void) | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const tid = useRef(0);

  /* ---------- toasts ---------- */
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = ++tid.current;
      setToasts((list) => [...list.slice(-3), { ...t, id }]);
      setTimeout(() => dismiss(id), t.kind === "order" || t.kind === "bill" ? 12000 : t.kind === "err" ? 7000 : 4000);
    },
    [dismiss],
  );

  /* ---------- sound ---------- */
  useEffect(() => {
    const unlock = () => {
      try {
        audio.current ??= new AudioContext();
        if (audio.current.state === "suspended") audio.current.resume();
      } catch {}
    };
    window.addEventListener("pointerdown", unlock);
    const clock = setInterval(() => setNow(Date.now()), 30000);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      clearInterval(clock);
    };
  }, []);

  const setSound = useCallback((v: boolean) => soundPref.set(v), []);

  const chime = useCallback(() => {
    const c = audio.current;
    if (!soundPref.get() || !c || c.state !== "running") return;
    const t = c.currentTime;
    [988, 1319, 1568].forEach((f, i) => {
      const o = c.createOscillator();
      const g = c.createGain();
      const at = t + i * 0.12;
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.22, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
      o.connect(g).connect(c.destination);
      o.start(at);
      o.stop(at + 0.5);
    });
  }, []);

  /* ---------- sync ---------- */
  const poll = useCallback(
    async (force = false) => {
      const gen = writeGen.current;
      try {
        const r = await fetch(`/api/admin/state?since=${force ? 0 : version.current}`, { cache: "no-store" });
        if (r.status === 401) return router.replace("/admin/login");
        if (!r.ok) return;
        const d = await r.json();
        if (d.same) return;
        if (writes.current > 0 || gen !== writeGen.current) return; // stale next to what's on screen; the last write re-polls
        version.current = d.version;
        setS(d);
      } catch {}
    },
    [router],
  );

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      t = setTimeout(async () => {
        await poll();
        loop();
      }, document.visibilityState === "visible" ? 20000 : 60000);
    };
    loop();
    const onVis = () => document.visibilityState === "visible" && poll();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [poll]);

  /* Live signal: the server nudges every open screen after each write, so a new
     order shows up at once. The timer above is only the safety net. */
  useEffect(() => subscribeChanges(() => void poll()), [poll]);

  const act = useCallback(
    async <T,>(op: string, args: Record<string, unknown> = {}, opts: ActOpts = {}): Promise<ActResult<T>> => {
      const fast = !!opts.optimistic;
      if (opts.optimistic) {
        writes.current++;
        writeGen.current++;
        setS(opts.optimistic);
      }
      let ok = false;
      try {
        const r = await fetch("/api/admin/op", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...args, op }) });
        const d = await r.json().catch(() => ({}));
        if (r.status === 401) {
          router.replace("/admin/login");
          return { ok: false, error: d.error ?? "Signed out" };
        }
        if (!r.ok) {
          toast({ kind: "err", title: d.error ?? "Something went wrong." });
          return { ok: false, error: d.error ?? "error" };
        }
        ok = true;
        if (!fast) await poll();
        return { ok: true, result: d.result as T };
      } catch {
        toast({ kind: "err", title: "Network problem — check the connection and try again." });
        return { ok: false, error: "network" };
      } finally {
        if (fast) {
          if (!ok) reload.current = true;
          /* the last write out puts the screen back in line with the server — in the
             background, so the next click never waits on it */
          if (--writes.current === 0) {
            const force = reload.current;
            reload.current = false;
            void poll(force);
          }
        }
      }
    },
    [poll, router, toast],
  );

  /* ---------- live alerts: new orders, bill requests ---------- */
  const seen = useRef({
    orders: new Set(initial.orders.map((o) => o.id)),
    bills: new Set(initial.sessions.filter((x) => x.billRequestedAt).map((x) => x.id)),
  });
  useEffect(() => {
    let ring = false;
    for (const o of s.orders) {
      if (seen.current.orders.has(o.id)) continue;
      seen.current.orders.add(o.id);
      if (o.status !== "new") continue;
      ring = true;
      toast({ kind: "order", title: `New order #${o.no} · ${whoIs(o)}`, body: itemsText(o), href: "/admin" });
    }
    for (const x of s.sessions) {
      if (!x.billRequestedAt || x.status !== "open" || seen.current.bills.has(x.id)) continue;
      seen.current.bills.add(x.id);
      ring = true;
      toast({ kind: "bill", title: `${whoIs(x)} asked for the bill`, body: `${x.customerName || "A guest"} is ready to pay.`, href: `/admin/billing?tab=${x.id}` });
    }
    if (ring) chime();
  }, [s, toast, chime]);

  /* ---------- confirm ---------- */
  const confirm = useCallback((c: ConfirmReq) => {
    setPending(c);
    return new Promise<boolean>((res) => (resolver.current = res));
  }, []);
  const answer = useCallback((v: boolean) => {
    resolver.current?.(v);
    resolver.current = null;
    setPending(null);
  }, []);

  /* ---------- print ---------- */
  const print = useCallback((node: React.ReactNode) => {
    setPrintNode(node);
    setPrintTick((n) => n + 1);
  }, []);
  useEffect(() => {
    if (!printTick) return;
    const r = requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
    return () => cancelAnimationFrame(r);
  }, [printTick]);

  /* ---------- derived floor: every open tab, oldest first ---------- */
  const floor = useMemo<FloorTab[]>(() => {
    return s.sessions
      .filter((session) => session.status === "open")
      .map((session) => {
        const orders = s.orders.filter((o) => o.sessionId === session.id);
        const live = orders.filter((o) => o.status !== "cancelled");
        return {
          session,
          orders,
          total: round2(live.reduce((a, o) => a + o.subtotal, 0)),
          items: live.reduce((a, o) => a + o.items.reduce((b, i) => b + i.qty, 0), 0),
          fresh: orders.filter((o) => o.status === "new").length,
          cooking: orders.filter((o) => o.status === "preparing").length,
          billRequested: !!session.billRequestedAt,
        };
      });
  }, [s.sessions, s.orders]);

  const base = (s.settings.publicUrl || origin).replace(/\/+$/, "");

  const value: Ctx = {
    s,
    role,
    act,
    refresh: poll,
    toast,
    toasts,
    dismiss,
    confirm,
    pending,
    answer,
    print,
    printNode,
    sound,
    setSound,
    base,
    now,
    floor,
  };
  return <C.Provider value={value}>{children}</C.Provider>;
}
