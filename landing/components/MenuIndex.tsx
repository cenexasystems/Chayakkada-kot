"use client";

import { useEffect, useRef, useState } from "react";
import { Arrow } from "@/app/_components/bits";

const U = (id: string, w = 520) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=80`;

export const MENU = [
  {
    title: "Birthday Cakes",
    note: "Candles, sprinkles & one very loud wish.",
    img: U("1464349095431-e9a21285b5f3"),
    preset: { occasion: "Birthday", tiers: 1, sponge: "vanilla", finish: "buttercream", toppings: ["candles", "sprinkles"] },
  },
  {
    title: "Wedding Tiers",
    note: "Three storeys of quiet, buttery elegance.",
    img: U("1535141192574-5d4897c12636"),
    preset: { occasion: "Wedding", tiers: 3, sponge: "vanilla", finish: "buttercream", toppings: ["berries", "mint"] },
  },
  {
    title: "Chocolate Drip",
    note: "Our signature. Ganache, always ganache.",
    img: U("1578985545062-69928b1d9587"),
    preset: { occasion: "Just because", tiers: 2, sponge: "chocolate", finish: "chocolate", toppings: ["cherries"] },
  },
  {
    title: "Black Forest",
    note: "Cherries, cream & chocolate — done right.",
    img: U("1606890737304-57a1ca8a5b62"),
    preset: { occasion: "Birthday", tiers: 1, sponge: "chocolate", finish: "ganache", toppings: ["cherries"] },
  },
  {
    title: "Custom & Theme",
    note: "Your wildest idea, translated into sponge.",
    img: U("1621303837174-89787a7d4729"),
    preset: { occasion: "Just because", tiers: 2, sponge: "redvelvet", finish: "berry", toppings: ["macarons", "sprinkles", "stars"] },
  },
  {
    title: "Cupcakes & Jars",
    note: "Small joys for big tables.",
    img: U("1614707267537-b85aaf00c4b7"),
    preset: null,
  },
];

export default function MenuIndex() {
  const [active, setActive] = useState<number | null>(null);
  const floatRef = useRef<HTMLDivElement>(null);

  // floating preview follows the pointer and leans with its velocity
  useEffect(() => {
    const el = floatRef.current;
    if (!el) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    let tx = 0, ty = 0, x = 0, y = 0, raf = 0, first = true;
    const loop = () => {
      raf = 0;
      const px = x;
      x += (tx - x) * 0.14;
      y += (ty - y) * 0.14;
      const rot = Math.max(-16, Math.min(16, (x - px) * 0.6));
      el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) rotate(${rot.toFixed(2)}deg)`;
      if (Math.abs(tx - x) > 0.3 || Math.abs(ty - y) > 0.3) raf = requestAnimationFrame(loop);
    };
    const onMove = (e: PointerEvent) => {
      tx = e.clientX;
      ty = e.clientY;
      if (first) {
        x = tx;
        y = ty;
        first = false;
      }
      if (!raf) raf = requestAnimationFrame(loop);
    };
    const list = el.parentElement!;
    list.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      list.removeEventListener("pointermove", onMove);
    };
  }, []);

  return (
    <div className="mindex" onPointerLeave={() => setActive(null)}>
      <ol>
        {MENU.map((m, i) => (
          <li key={m.title} data-reveal="up" style={{ "--i": i } as React.CSSProperties}>
            <a
              href={m.preset ? "#lab" : "#visit"}
              className={`mi ${active === i ? "is-on" : ""}`}
              data-preset={m.preset ? JSON.stringify(m.preset) : undefined}
              data-cursor={m.preset ? "Design it" : "Order"}
              onPointerEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            >
              <span className="mi__n">{String(i + 1).padStart(2, "0")}</span>
              <span className="mi__t">
                {Array.from(m.title).map((ch, j) => (
                  <span key={j} style={{ "--j": j } as React.CSSProperties}>
                    {ch === " " ? " " : ch}
                  </span>
                ))}
              </span>
              <span className="mi__note">{m.note}</span>
              <img className="mi__thumb" src={m.img.replace("w=520", "w=200")} alt="" loading="lazy" decoding="async" />
              <span className="mi__go">
                <Arrow size={22} />
              </span>
            </a>
          </li>
        ))}
      </ol>

      <div className={`mfloat ${active !== null ? "is-on" : ""}`} ref={floatRef} aria-hidden="true">
        <div className="mfloat__card">
          {MENU.map((m, i) => (
            <img key={m.title} src={m.img} alt="" className={active === i ? "is-on" : ""} loading="lazy" decoding="async" />
          ))}
          <span className="mfloat__tag">{active !== null ? MENU[active].title : ""}</span>
        </div>
      </div>
    </div>
  );
}
