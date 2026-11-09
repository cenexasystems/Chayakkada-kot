/* Products with variants ("Tea" → Regular, Masala, Ginger). The shared name is only a heading: what is sold, priced,
   counted and billed is always one of its variants. These helpers group a flat product list that way. */

type V = { id: string; name: string; family?: string; variant?: string };

const key = (s: string) => s.trim().toLowerCase();

/** Plain products that carry the same name as a variant family — a leftover "Tea" beside Tea (Masala), Tea (Ginger). */
export function shadowIds(items: V[]): Set<string> {
  const fams = new Set(items.filter((p) => p.family).map((p) => key(p.family!)));
  return new Set(items.filter((p) => !p.family && fams.has(key(p.name))).map((p) => p.id));
}

export type Entry<T> = { family: string; items: T[] } | { family: null; item: T };

/** One entry per ordinary product, one per family (its variants inside). A leftover plain product named like a family is left out. */
export function entries<T extends V>(items: T[]): Entry<T>[] {
  const shadow = shadowIds(items);
  const out: Entry<T>[] = [];
  const at = new Map<string, { family: string; items: T[] }>();
  for (const p of items) {
    if (shadow.has(p.id)) continue;
    if (!p.family) {
      out.push({ family: null, item: p });
      continue;
    }
    const k = key(p.family);
    const hit = at.get(k);
    if (hit) hit.items.push(p);
    else {
      const e = { family: p.family, items: [p] };
      at.set(k, e);
      out.push(e);
    }
  }
  return out;
}
