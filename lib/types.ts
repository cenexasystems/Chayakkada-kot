/* Shared shapes for the phone-number ordering system (server + client). */

export type Product = {
  id: string;
  name: string;
  category: string;
  price: number;
  /** null = not tracked (always available) */
  stock: number | null;
  /** warn in admin when stock falls to this or below */
  lowAt: number;
  description: string;
  image: string;
  eggless: boolean;
  tags: string[];
  /** hidden from the customer menu when false */
  active: boolean;
  createdAt: number;
  updatedAt: number;
};

export type SessionStatus = "open" | "closed" | "void";

/** One customer's tab, found by their mobile: opens with the first order, closes when the bill is paid. */
export type Session = {
  id: string;
  status: SessionStatus;
  openedAt: number;
  closedAt: number | null;
  customerName: string;
  customerPhone: string;
  billRequestedAt: number | null;
  billId: string | null;
  couponCode: string | null;
};

export type OrderItem = {
  productId: string | null;
  name: string;
  price: number;
  qty: number;
};

export type OrderStatus = "new" | "preparing" | "served" | "cancelled";

/** Who put the order in: the guest's phone, or staff at the counter. */
export type OrderSource = "customer" | "counter";

export type Order = {
  id: string;
  no: number;
  sessionId: string;
  items: OrderItem[];
  note: string;
  customerName: string;
  customerPhone: string;
  status: OrderStatus;
  source: OrderSource;
  subtotal: number;
  createdAt: number;
  updatedAt: number;
};

export type BillSource = "tab" | "counter";
/** "split" = part cash, part card; cashAmount / cardAmount on the bill say how much each. */
export type PayMethod = "cash" | "upi" | "card" | "split";
export type DiscountType = "amount" | "percent";
/** Who applied the coupon on a bill: the guest from their phone, or staff at billing. */
export type CouponSource = "guest" | "staff";

export type Bill = {
  id: string;
  invoiceNo: string;
  source: BillSource;
  sessionId: string | null;
  customerName: string;
  customerPhone: string;
  items: OrderItem[];
  itemCount: number;
  subtotal: number;
  couponCode: string | null;
  couponPercent: number;
  couponDiscount: number;
  couponSource: CouponSource | null;
  manualType: DiscountType;
  manualValue: number;
  manualDiscount: number;
  discount: number;
  extra: number;
  /** true = GST invoice (tax added on top); false = non-GST bill */
  isGst: boolean;
  gstPercent: number;
  /** amount GST is charged on: subtotal − discount + extra */
  taxableAmount: number;
  gstAmount: number;
  total: number;
  payment: PayMethod;
  /** How the total was tendered. Always sums to `total`, whichever method was used. */
  cashAmount: number;
  upiAmount: number;
  cardAmount: number;
  received: number;
  change: number;
  status: "completed" | "void";
  createdAt: number;
};

export type Coupon = {
  id: string;
  code: string;
  percent: number;
  minOrder: number;
  /** YYYY-MM-DD, valid through the end of that day */
  expiresAt: string | null;
  /** null = unlimited */
  limit: number | null;
  used: number;
  active: boolean;
  /** only the phones it was sent to can use it */
  restricted: boolean;
  /** 10-digit mobiles it was sent to */
  phones: string[];
  /** times sent on WhatsApp / as a PDF */
  sent: number;
  createdAt: number;
};

export type Expense = {
  id: string;
  title: string;
  category: string;
  amount: number;
  paymentMode: string;
  notes: string;
  /** YYYY-MM-DD */
  expenseDate: string;
  createdAt: number;
};

export type ExpenseCategory = {
  id: string;
  name: string;
  createdAt: number;
};

export type StockMoveType = "initial" | "added" | "removed" | "sale" | "cancelled_order" | "void_bill" | "adjustment";

/** One page of the stock ledger plus totals for the whole selected period. */
export type StockLedger = {
  rows: StockMovement[];
  total: number;
  page: number;
  pages: number;
  stats: { added: number; sold: number; removed: number; returned: number; adjusted: number; net: number };
  perProduct: { id: string; name: string; in: number; out: number; close: number | null }[];
  products: { id: string; name: string }[];
};

export type StockMovement = {
  id: string;
  productId: string;
  productName: string;
  type: StockMoveType;
  qty: number;
  balanceAfter: number;
  note: string;
  ref: string;
  createdAt: number;
};

/* ---------------- Raw-ingredient inventory ---------------- */

export type IngredientUnit = "g" | "ml";

export type Ingredient = {
  id: string;
  name: string;
  unit: IngredientUnit;
  /** How much is on hand right now (same unit as `unit`). */
  stock: number;
  /** Weighted-average rupees per gram / ml, kept up to date on each purchase. */
  costPerUnit: number;
  /** warn in admin when stock falls to this or below */
  lowAt: number;
  active: boolean;
  createdAt: number;
  updatedAt: number;
};

/** A reusable ingredient list for a product. Picking a recipe fills the batch
    logger with these rows (still editable) so a repeat run is one click. */
export type RecipeItem = { ingredientId: string; qty: number; note: string };
export type Recipe = {
  id: string;
  name: string;
  note: string;
  items: RecipeItem[];
  createdAt: number;
  updatedAt: number;
};

/** A production run (e.g. "Chocolate cake × 2"), with the uses that fed it. */
export type Batch = {
  id: string;
  name: string;
  note: string;
  /** Sum of the `cost` of all uses booked to this batch. */
  totalCost: number;
  createdAt: number;
};

export type IngredientMoveType = "purchase" | "use" | "waste" | "adjust";

export type IngredientMove = {
  id: string;
  ingredientId: string;
  ingredientName: string;
  unit: IngredientUnit;
  /** signed: + into stock, − out of it */
  qty: number;
  type: IngredientMoveType;
  /** rupee value of this line, always ≥ 0 */
  cost: number;
  balanceAfter: number;
  batchId: string | null;
  /** Human-readable name of the batch this line came from, when a batch produced it. */
  batchName: string;
  note: string;
  createdAt: number;
};

/** One page of the ingredient ledger, plus period totals and per-ingredient summary. */
export type IngredientLedger = {
  rows: IngredientMove[];
  total: number;
  page: number;
  pages: number;
  stats: {
    purchased: { qty: number; cost: number };
    used: { qty: number; cost: number };
    wasted: { qty: number; cost: number };
    adjusted: { qty: number };
  };
  perIngredient: { id: string; name: string; unit: IngredientUnit; in: number; used: number; wasted: number; close: number }[];
  ingredients: { id: string; name: string; unit: IngredientUnit }[];
};

/* Guests never hold an account — they order from the shop's QR code and are known
   by the mobile they leave with the order. So every stored user is someone who has
   been given admin access, keyed by that same mobile, which is what lets a regular
   be promoted straight from the Users page. */
export type StaffUser = {
  id: string;
  name: string;
  /** 10-digit mobile: the identity this app actually collects */
  mobile: string;
  email: string;
  passwordHash: string;
  createdAt: number;
};

/** A user as the admin panel sees one — never the hash. */
export type PublicUser = Omit<StaffUser, "passwordHash">;

/** Shop details printed on receipts and invoices. */
export type ShopDetails = {
  ownerName: string;
  location: string;
  /** postal address, one line per row */
  address: string;
  email: string;
  /** second branch's postal address, one line per row (blank if none) */
  address2: string;
  /** 10-digit WhatsApp numbers, one per branch (blank if none) */
  whatsapp1: string;
  whatsapp2: string;
  customerCare: string;
  /** Google Maps link for the shop */
  mapsUrl: string;
  /** image URL; blank falls back to the built-in icon */
  logoUrl: string;
};

export type Settings = ShopDetails & {
  shopName: string;
  /** origin printed into QR codes, e.g. https://order.cheflovingcakes.in */
  publicUrl: string;
  /** When true, POS Billing is counter-only — the customer-tab flow is hidden. */
  walkInsOnly: boolean;
  /** When false, the on-screen kitchen ticket queue (KOT) hides for everyone. */
  kotEnabled: boolean;
  /** When false the customer site is menu-only (no cart, no tabs) and the admin's
      "Open tabs" page + Billing's "Customer tab" mode hide too. */
  orderingEnabled: boolean;
  adminHash: string | null;
  secret: string;
};

export type DB = {
  version: number;
  seq: { order: number };
  settings: Settings;
  products: Product[];
  sessions: Session[];
  orders: Order[];
  bills: Bill[];
  coupons: Coupon[];
  users: StaffUser[];
  expenses: Expense[];
  expenseCategories: ExpenseCategory[];
  ingredients: Ingredient[];
  batches: Batch[];
  recipes: Recipe[];
};

/** What the admin panel receives (no secrets). */
export type AdminState = Omit<DB, "settings" | "users"> & {
  settings: ShopDetails & { shopName: string; publicUrl: string; walkInsOnly: boolean; kotEnabled: boolean; orderingEnabled: boolean };
  users: PublicUser[];
};

/** A tab that closed in the last few minutes — "paid" once it was billed, "cleared"
    if staff wiped it without taking payment. Lets the guest's phone close the loop
    and reset itself for the next visit. */
export type TabClose = {
  kind: "paid" | "cleared";
  invoiceNo: string | null;
  total: number;
  itemCount: number;
  name: string;
  at: number;
};

/** What a customer receives: the menu, plus their tab when their mobile has one open. */
export type TabView = {
  shopName: string;
  /** public shop details — contact info and logo for the menu page */
  details: ShopDetails;
  /** Mirrors Settings.orderingEnabled — when false the menu renders without
      cart / tab / ordering controls. */
  orderingEnabled: boolean;
  menu: MenuItem[];
  closed: TabClose | null;
  tab: {
    orders: { no: number; items: OrderItem[]; status: OrderStatus; subtotal: number; createdAt: number }[];
    total: number;
    billRequested: boolean;
    /** first name only — a phone number is not a password */
    name: string;
    /** the coupon this guest applied, with what it saves right now */
    coupon: { code: string; percent: number; discount: number; ok: boolean; reason: string } | null;
    /** what the guest should expect to pay: total minus the coupon */
    payable: number;
  } | null;
};

export type MenuItem = Pick<Product, "id" | "name" | "category" | "price" | "description" | "image" | "tags"> & {
  soldOut: boolean;
  left: number | null;
};
