"use client";

/* After something changes on a member's account — enrolment, points earned or used, a tier
   upgrade, an adjustment, a reward, a status change — this offers the message to send them on
   WhatsApp. It reads the member's live balance and tier, fills the wording set in Loyalty →
   Settings → WhatsApp messages, and lets staff tweak it before sending. A browser can't send
   WhatsApp by itself, so one tap opens the chat with the message ready. */

import { useEffect, useState } from "react";
import { shopToday } from "@/lib/money";
import { DEFAULT_CONFIG, type MessageKey } from "@/lib/loyalty/config";
import { tierByKey } from "@/lib/loyalty/engine";
import { fillMessage } from "@/lib/loyalty/messages";
import type { LoyaltyLookup } from "@/lib/loyalty/types";
import { useAdmin } from "../Store";
import { waLink } from "../receipt";
import { Btn, Field, Modal, WaIcon, cx, inputLineCls } from "../kit";
import { fetchLookup } from "./billing";

export type MemberNotice = {
  phone: string;
  name: string;
  kind: MessageKey;
  /** extra words for the template: points, reason, reward, ref, expires, status… */
  vars?: Record<string, string | number>;
  /** the member's tier before this bill — if it changed, the tier-upgrade message is used */
  tierBefore?: string;
};

export function MemberUpdate({ phone, name, kind, vars, tierBefore, onClose }: MemberNotice & { onClose: () => void }) {
  const { s } = useAdmin();
  const [lk, setLk] = useState<LoyaltyLookup | null | undefined>(undefined);
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchLookup(phone).then((x) => live && setLk(x));
    return () => {
      live = false;
    };
  }, [phone]);

  const cfg = lk?.config ?? DEFAULT_CONFIG;
  const off = lk !== undefined && !cfg.messages.enabled;
  useEffect(() => {
    if (off) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [off]);

  useEffect(() => {
    if (lk === undefined || off || text !== null) return;
    const c = lk?.customer;
    const tier = c ? tierByKey(c.tier, cfg) : null;
    const k: MessageKey = kind === "earned" && tierBefore && c && c.tier !== tierBefore ? "tier" : kind;
    const [y, m, d] = shopToday().split("-").map(Number);
    const base = (s.settings.publicUrl || (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/$/, "");
    setText(
      fillMessage(cfg.messages.templates[k], {
        name: (c?.name ?? name).split(" ")[0],
        shop: s.settings.shopName,
        date: `${d}/${m}/${y}`,
        balance: c?.available,
        tier: tier?.name,
        benefits: tier?.benefits,
        code: c?.code,
        wallet: c ? `${base}/w/${c.walletToken}` : "",
        ...vars,
      }),
    );
  }, [lk, off, text, kind, tierBefore, cfg, name, vars, s.settings.publicUrl, s.settings.shopName]);

  if (off) return null;
  return (
    <Modal open onClose={onClose} title={`Tell ${name.split(" ")[0] || "the member"} on WhatsApp`} footer={<Btn onClick={onClose}>Done</Btn>}>
      {text === null ? (
        <p className="py-6 text-center text-[13px] text-slate-400">Getting their latest points…</p>
      ) : (
        <div className="space-y-3">
          <Field label="Message" hint="Edit it if you like — the wording itself is set in Loyalty → Settings → WhatsApp messages.">
            <textarea className={cx(inputLineCls, "h-32 resize-y py-2.5 leading-relaxed")} value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} />
          </Field>
          <a href={waLink(phone, text)} target="_blank" rel="noopener noreferrer" className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#22c55e] px-5 text-[14px] font-bold text-white hover:bg-[#16a34a]">
            <WaIcon size={18} /> Send on WhatsApp
          </a>
        </div>
      )}
    </Modal>
  );
}
