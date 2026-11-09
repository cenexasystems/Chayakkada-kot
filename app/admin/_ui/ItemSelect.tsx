"use client";

import { useMemo, useState } from "react";
import { rupee } from "@/lib/money";
import { entries } from "@/lib/variants";
import { Icon, Modal, SearchBox, cx, inputLineCls } from "./kit";

export type PickItem = { id: string; name: string; category: string; price?: number; family?: string; variant?: string };

/** The menu-item chooser used wherever an item is picked from a dropdown: choose a category first (or search), then the
    item. Items are grouped by category, so a long menu is easy to scan. */
export function ItemPickerModal({ products, value, onPick, onClose, title = "Pick an item", clear }: { products: PickItem[]; value?: string; onPick: (id: string) => void; onClose: () => void; title?: string; clear?: string }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [openFam, setOpenFam] = useState<string | null>(null);
  const cats = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of products) m.set(p.category || "Other", (m.get(p.category || "Other") ?? 0) + 1);
    return [...m].sort((a, b) => a[0].localeCompare(b[0]));
  }, [products]);
  const groups = useMemo(() => {
    const t = q.trim().toLowerCase();
    const by = new Map<string, PickItem[]>();
    for (const p of products) {
      const c = p.category || "Other";
      if ((cat && c !== cat) || (t && !`${p.name} ${c}`.toLowerCase().includes(t))) continue;
      by.set(c, [...(by.get(c) ?? []), p]);
    }
    return [...by].sort((a, b) => a[0].localeCompare(b[0])).map(([c, list]) => [c, list.sort((a, b) => a.name.localeCompare(b.name))] as const);
  }, [products, q, cat]);
  const total = groups.reduce((a, [, l]) => a + entries(l).length, 0);

  return (
    <Modal open onClose={onClose} title={title}>
      <div className="space-y-3">
        <SearchBox value={q} onChange={setQ} placeholder="Search items…" className="h-11 w-full rounded-xl" />
        <div className="adm-scroll -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {[["", "All", products.length] as const, ...cats.map(([c, n]) => [c, c, n] as const)].map(([c, label, n]) => (
            <button key={label} type="button" onClick={() => setCat(c)} className={cx("h-8 shrink-0 rounded-full border px-3 text-[12.5px] font-semibold transition", cat === c ? "border-red-600 bg-red-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50")}>
              {label} <span className={cx("ml-0.5 text-[11px]", cat === c ? "text-white/80" : "text-slate-400")}>{n}</span>
            </button>
          ))}
        </div>
        <div className="adm-scroll max-h-[52vh] overflow-y-auto rounded-xl border border-slate-100">
          {clear && (
            <button type="button" onClick={() => onPick("")} className="flex w-full items-center justify-between border-b border-slate-100 px-3.5 py-2.5 text-left text-[13.5px] font-semibold text-slate-500 hover:bg-slate-50">
              {clear}
            </button>
          )}
          {!total ? (
            <p className="py-8 text-center text-[13px] text-slate-400">No item matches.</p>
          ) : (
            groups.map(([c, list]) => (
              <div key={c}>
                {!cat && <p className="sticky top-0 bg-slate-50 px-3.5 py-1.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{c}</p>}
                {entries(list).map((e) => {
                  const row = (p: PickItem, label: string, nested = false) => (
                    <button key={p.id} type="button" onClick={() => onPick(p.id)} className={cx("flex w-full items-center justify-between gap-3 border-b border-slate-50 py-2.5 pr-3.5 text-left text-[13.5px] hover:bg-slate-50", nested ? "bg-slate-50/60 pl-9" : "pl-3.5", value === p.id && "bg-red-50")}>
                      <span className="min-w-0 truncate font-semibold text-slate-900">{label}</span>
                      <span className="flex shrink-0 items-center gap-2 text-slate-500">
                        {p.price !== undefined && rupee(p.price)}
                        {value === p.id && <Icon name="check" size={14} className="text-red-600" />}
                      </span>
                    </button>
                  );
                  if (e.family === null) return row(e.item, e.item.name);
                  const shown = !!q.trim() || openFam === e.family || e.items.some((v) => v.id === value);
                  return (
                    <div key={`f:${e.family}`}>
                      <button type="button" onClick={() => setOpenFam(openFam === e.family ? null : e.family)} aria-expanded={shown} className="flex w-full items-center justify-between gap-3 border-b border-slate-50 px-3.5 py-2.5 text-left text-[13.5px] hover:bg-slate-50">
                        <span className="min-w-0 truncate font-semibold text-slate-900">{e.family}</span>
                        <span className="flex shrink-0 items-center gap-2 text-[12px] text-slate-500">
                          {e.items.length} kinds
                          <Icon name="chevron" size={14} className={cx("text-slate-400 transition-transform", shown && "rotate-90")} />
                        </span>
                      </button>
                      {shown && e.items.map((v) => row(v, v.variant || "Regular", true))}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}

/** A dropdown-looking box that opens the category-first item chooser. */
export function ItemSelect({ products, value, onChange, none = "Pick an item from your menu…", clear, title, className }: { products: PickItem[]; value: string; onChange: (id: string) => void; none?: string; clear?: string; title?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const cur = products.find((p) => p.id === value);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cx(inputLineCls, "flex items-center justify-between gap-2 text-left", className)}>
        <span className={cx("min-w-0 truncate", cur ? "text-slate-900" : "text-slate-400")}>
          {cur ? (
            <>
              {cur.name}
              <span className="ml-1.5 text-[12px] text-slate-500">
                {cur.category}
                {cur.price !== undefined && ` · ${rupee(cur.price)}`}
              </span>
            </>
          ) : (
            none
          )}
        </span>
        <Icon name="chevron" size={14} className="shrink-0 rotate-90 text-slate-400" />
      </button>
      {open && <ItemPickerModal products={products} value={value} title={title} clear={clear} onClose={() => setOpen(false)} onPick={(id) => (onChange(id), setOpen(false))} />}
    </>
  );
}
