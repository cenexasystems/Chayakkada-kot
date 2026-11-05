import type { Bill, ShopDetails } from "@/lib/types";
import { payLabel, payParts, rupee } from "@/lib/money";
import { fmtDateTime } from "./kit";


/** Public link to the printable invoice page. */
export const invoiceUrl = (b: Bill, publicUrl = "") => `${(publicUrl || (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/$/, "")}/invoice/${b.id}`;

export function billText(b: Bill, shop: string, publicUrl = "") {
  const L = [
    `*${shop}*`,
    `Invoice: ${b.invoiceNo}`,
    `Date: ${fmtDateTime(b.createdAt)}`,
    b.source === "tab" ? "Order from phone" : "Counter bill",
    b.customerName ? `Customer: ${b.customerName}` : "",
    "------------------------------",
    ...b.items.map((i) => `${i.qty} × ${i.name} — ${rupee(i.price * i.qty)}`),
    "------------------------------",
    `Subtotal (${b.itemCount} items): ${rupee(b.subtotal)}`,
    b.couponDiscount ? `Coupon ${b.couponCode} (${b.couponPercent}%): -${rupee(b.couponDiscount)}` : "",
    b.manualDiscount ? `Discount: -${rupee(b.manualDiscount)}` : "",
    b.rewardDiscount ? `Reward ${b.rewardName ?? ""}: -${rupee(b.rewardDiscount)}` : "",
    b.pointsDiscount ? `Loyalty points (${b.pointsRedeemed} pts): -${rupee(b.pointsDiscount)}` : "",
    b.extra ? `Extra charges: ${rupee(b.extra)}` : "",
    b.isGst ? `GST (${b.gstPercent}%) on ${rupee(b.taxableAmount)}: ${rupee(b.gstAmount)}` : "",
    `*Grand total: ${rupee(b.total)}*`,
    `Paid by ${payLabel(b)}`,
    b.payment === "split" ? `  ${payParts(b).map(([m, n]) => `${m} ${rupee(n)}`).join(" · ")}` : "",
    b.pointsEarned ? `You earned ${b.pointsEarned} loyalty points on this bill.` : "",
    "",
    `View your invoice: ${invoiceUrl(b, publicUrl)}`,
    "",
    "Thank you for visiting — see you again soon!",
  ];
  return L.filter((l, i) => l !== "" || i >= L.length - 4).join("\n");
}

export const waLink = (phone: string, text: string) => `https://wa.me/${phone.length === 10 ? `91${phone}` : phone}?text=${encodeURIComponent(text)}`;

/* ---------- print formats ---------- */
/** Thermal rolls are named by width (2" ≈ 58mm paper, 3" ≈ 80mm paper); sheets by paper size. */
export type PrintFormat = { kind: "thermal"; roll: 2 | 3 } | { kind: "sheet"; size: "A3" | "A4" | "A5" };

export const THERMAL_ROLLS = [2, 3] as const;
export const SHEET_SIZES = ["A3", "A4", "A5"] as const;
export const DEFAULT_FORMAT: PrintFormat = { kind: "thermal", roll: 3 };

/* [paper width, printable width] in mm — the printable strip is narrower than the
   roll so nothing is clipped by the printer's own margins. */
const ROLL_MM = { 2: [58, 48], 3: [80, 72] } as const;

const pageCss = (f: PrintFormat) =>
  f.kind === "thermal"
    ? `@page{size:${ROLL_MM[f.roll][0]}mm 297mm;margin:2mm 0}`
    : `@page{size:${f.size};margin:${f.size === "A3" ? 16 : f.size === "A4" ? 12 : 8}mm}`;

/** The shop's printed header lines, built from Settings. */
export function headerLines(d?: ShopDetails): string[] {
  if (!d) return [];
  const addr = (t: string) => t.split("\n").filter(Boolean).join(", ");
  const lines = [addr(d.address)].filter(Boolean);
  const contact = [d.customerCare && `Ph: ${d.customerCare}`, d.email].filter(Boolean).join(" · ");
  return contact ? [...lines, contact] : lines;
}

/** Receipt for the chosen printer, rendered into the print area. */
export function Receipt({ b, shop, details, fmt = DEFAULT_FORMAT }: { b: Bill; shop: string; details?: ShopDetails; fmt?: PrintFormat }) {
  return (
    <>
      <style>{pageCss(fmt)}</style>
      {fmt.kind === "thermal" ? <Thermal b={b} shop={shop} logo={details?.logoUrl} lines={headerLines(details)} roll={fmt.roll} /> : <Sheet b={b} shop={shop} logo={details?.logoUrl} lines={headerLines(details)} size={fmt.size} />}
    </>
  );
}

/** Full-page invoice for A3 / A4 / A5 — one layout, scaled by the paper size. */
function Sheet({ b, shop, logo, lines, size }: { b: Bill; shop: string; logo?: string; lines: string[]; size: "A3" | "A4" | "A5" }) {
  return (
    <div className={`inv inv--${size.toLowerCase()}`}>
      <header className="inv__head">
        <div>
          {logo && <img src={logo} alt="" style={{ height: 56, width: "auto", maxWidth: "100%", objectFit: "contain", marginBottom: 6, display: "block" }} />}
          <h1>{shop}</h1>
          {lines.map((l, i) => <p key={i}>{l}</p>)}
        </div>
        <div className="inv__meta">
          <h2>{b.isGst ? "TAX INVOICE" : "INVOICE"}</h2>
          <p>
            <b>{b.invoiceNo}</b>
          </p>
          <p>{fmtDateTime(b.createdAt)}</p>
        </div>
      </header>

      <section className="inv__to">
        <div>
          <span>Billed to</span>
          <b>{b.customerName || "Walk-in customer"}</b>
          {b.customerPhone && <p>{b.customerPhone}</p>}
        </div>
        <div className="inv__r">
          <span>{b.source === "tab" ? "Customer" : "Counter"}</span>
          <b>{b.customerPhone || "Walk-in"}</b>
          <p>Paid by {payLabel(b)}</p>
        </div>
      </section>

      <table className="inv__tbl">
        <thead>
          <tr>
            <th>#</th>
            <th>Item</th>
            <th className="n">Qty</th>
            <th className="n">Rate</th>
            <th className="n">Amount</th>
          </tr>
        </thead>
        <tbody>
          {b.items.map((i, k) => (
            <tr key={k}>
              <td>{k + 1}</td>
              <td>{i.name}</td>
              <td className="n">{i.qty}</td>
              <td className="n">{rupee(i.price)}</td>
              <td className="n">{rupee(i.qty * i.price)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="inv__sum">
        <div>
          <dt>Subtotal ({b.itemCount} items)</dt>
          <dd>{rupee(b.subtotal)}</dd>
        </div>
        {b.couponDiscount > 0 && (
          <div>
            <dt>
              Coupon {b.couponCode} ({b.couponPercent}%)
            </dt>
            <dd>-{rupee(b.couponDiscount)}</dd>
          </div>
        )}
        {b.manualDiscount > 0 && (
          <div>
            <dt>Discount</dt>
            <dd>-{rupee(b.manualDiscount)}</dd>
          </div>
        )}
        {b.rewardDiscount > 0 && (
          <div>
            <dt>Reward {b.rewardName}</dt>
            <dd>-{rupee(b.rewardDiscount)}</dd>
          </div>
        )}
        {b.pointsDiscount > 0 && (
          <div>
            <dt>Loyalty points ({b.pointsRedeemed} pts)</dt>
            <dd>-{rupee(b.pointsDiscount)}</dd>
          </div>
        )}
        {b.extra > 0 && (
          <div>
            <dt>Extra charges</dt>
            <dd>{rupee(b.extra)}</dd>
          </div>
        )}
        {b.isGst && (
          <div>
            <dt>GST ({b.gstPercent}%) on {rupee(b.taxableAmount)}</dt>
            <dd>{rupee(b.gstAmount)}</dd>
          </div>
        )}
        <div className="inv__tot">
          <dt>Grand total</dt>
          <dd>{rupee(b.total)}</dd>
        </div>
        {b.payment === "split" ? (
          payParts(b).map(([m, n]) => (
            <div key={m}>
              <dt>Received · {m}</dt>
              <dd>{rupee(n)}</dd>
            </div>
          ))
        ) : (
          <div>
            <dt>Received · {payLabel(b)}</dt>
            <dd>{rupee(b.received)}</dd>
          </div>
        )}
        {b.change > 0 && (
          <div>
            <dt>Change</dt>
            <dd>{rupee(b.change)}</dd>
          </div>
        )}
      </dl>

      <footer className="inv__foot">Thank you for visiting — see you again soon!</footer>
    </div>
  );
}

function Thermal({ b, shop, logo, lines, roll }: { b: Bill; shop: string; logo?: string; lines: string[]; roll: 2 | 3 }) {
  return (
    <div className={`rcpt rcpt--${roll}`} style={{ width: `${ROLL_MM[roll][1]}mm` }}>
      {logo && <img src={logo} alt="" style={{ height: 44, width: "auto", maxWidth: "100%", objectFit: "contain", margin: "0 auto 4px", display: "block" }} />}
      <h1>{shop}</h1>
      {lines.map((l, i) => <p className="c" key={i}>{l}</p>)}
      <hr />
      {b.isGst && <p className="c">TAX INVOICE</p>}
      <div className="row">
        <span>{b.invoiceNo}</span>
        <span>{b.source === "tab" ? "Customer tab" : "Counter"}</span>
      </div>
      <div>{fmtDateTime(b.createdAt)}</div>
      {b.customerName && <div>{b.customerName}{b.customerPhone ? ` · ${b.customerPhone}` : ""}</div>}
      <hr />
      {b.items.map((i, k) => (
        <div key={k}>
          <div>{i.name}</div>
          <div className="row">
            <span>
              {i.qty} × {rupee(i.price)}
            </span>
            <span>{rupee(i.qty * i.price)}</span>
          </div>
        </div>
      ))}
      <hr />
      <div className="row">
        <span>Subtotal ({b.itemCount})</span>
        <span>{rupee(b.subtotal)}</span>
      </div>
      {b.couponDiscount > 0 && (
        <div className="row">
          <span>
            {b.couponCode} ({b.couponPercent}%)
          </span>
          <span>-{rupee(b.couponDiscount)}</span>
        </div>
      )}
      {b.manualDiscount > 0 && (
        <div className="row">
          <span>Discount</span>
          <span>-{rupee(b.manualDiscount)}</span>
        </div>
      )}
      {b.rewardDiscount > 0 && (
        <div className="row">
          <span>Reward {b.rewardName}</span>
          <span>-{rupee(b.rewardDiscount)}</span>
        </div>
      )}
      {b.pointsDiscount > 0 && (
        <div className="row">
          <span>Loyalty points ({b.pointsRedeemed} pts)</span>
          <span>-{rupee(b.pointsDiscount)}</span>
        </div>
      )}
      {b.extra > 0 && (
        <div className="row">
          <span>Extra charges</span>
          <span>{rupee(b.extra)}</span>
        </div>
      )}
      {b.isGst && (
        <div className="row">
          <span>GST ({b.gstPercent}%)</span>
          <span>{rupee(b.gstAmount)}</span>
        </div>
      )}
      <hr />
      <div className="row big">
        <span>TOTAL</span>
        <span>{rupee(b.total)}</span>
      </div>
      {b.payment === "split" ? (
        payParts(b).map(([m, n]) => (
          <div key={m} className="row">
            <span>Paid · {m}</span>
            <span>{rupee(n)}</span>
          </div>
        ))
      ) : (
        <div className="row">
          <span>Paid · {payLabel(b)}</span>
          <span>{rupee(b.received)}</span>
        </div>
      )}
      {b.change > 0 && (
        <div className="row">
          <span>Change</span>
          <span>{rupee(b.change)}</span>
        </div>
      )}
      <hr />
      <p className="c">thank you — come again</p>
    </div>
  );
}
