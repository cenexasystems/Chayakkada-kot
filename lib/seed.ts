import { randomBytes } from "crypto";
import type { Coupon, Product } from "./types";

/* First-run data: the café menu and one example coupon.
   Everything here is editable from /admin. */

const U = (id: string) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=640&q=75`;

type P = [name: string, category: string, price: number, stock: number | null, img: string, description: string, eggless: boolean, tags?: string[]];

const MENU: P[] = [
  ["Black Forest Slice", "Cake Slices", 140, 16, "1606890737304-57a1ca8a5b62", "Cherries, whipped cream and dark chocolate shavings — done right.", false, ["bestseller"]],
  ["Chocolate Truffle Slice", "Cake Slices", 160, 16, "1578985545062-69928b1d9587", "Our signature. Dense sponge under a glossy ganache drip.", false, ["bestseller"]],
  ["Red Velvet Slice", "Cake Slices", 170, 12, "1586788680434-30d324b2d46f", "Cocoa-tinged velvet sponge with cream-cheese frosting.", false],
  ["Raspberry Layer Slice", "Cake Slices", 180, 10, "1565958011703-44f9829ba187", "Vanilla chiffon, raspberry compote, fresh berries on top.", true],
  ["Cookies & Cream Slice", "Cake Slices", 160, 10, "1557925923-cd4648e211a0", "Crushed cookie crumb folded through vanilla cream.", true],
  ["Chocolate Mousse Cake", "Cake Slices", 190, 8, "1602351447937-745cb720612f", "Three-layer mousse, sprinkle crown, very little restraint.", true],
  ["Blueberry Cheesecake", "Cake Slices", 220, 10, "1533134242443-d4fd215305ad", "Baked New York style with a Kodai blueberry topping.", false, ["new"]],
  ["Tiramisu", "Cake Slices", 240, 8, "1571877227200-a0d98ea607e9", "Espresso-soaked sponge, mascarpone, cocoa dust.", false],

  ["Butter Croissant", "Bakes & Treats", 110, 20, "1555507036-ab1f4038808a", "Laminated by hand every morning. Flaky, buttery, warm.", false],
  ["Fudge Brownie", "Bakes & Treats", 120, 24, "1606313564200-e75d5e30476c", "Crackly top, gooey middle. Ask us to warm it up.", true, ["bestseller"]],
  ["Glazed Donut", "Bakes & Treats", 90, 18, "1551024601-bec78aea704b", "Soft yeasted donut, chocolate glaze and sprinkles.", false],
  ["Choco-chip Cookies (3)", "Bakes & Treats", 120, 30, "1499636136210-6f4ee915583e", "Brown-butter dough, dark chocolate chunks, sea salt.", true],
  ["Vanilla Cupcake", "Bakes & Treats", 80, 24, "1519869325930-281384150729", "Madagascar vanilla sponge with a buttercream swirl.", true],
  ["French Macarons (6)", "Bakes & Treats", 360, 10, "1569864358642-9d1684040f43", "Pistachio, rose, salted caramel, raspberry, coffee, vanilla.", false],

  ["Grilled Veg Sandwich", "Savoury", 150, null, "1528735602780-2552fd46c7af", "Pressed on our house bread with mint chutney and cheese.", true],
  ["House Bread Loaf", "Savoury", 90, 12, "1509440159596-0249088772ff", "Seeded country loaf, baked at dawn. Takeaway favourite.", true],

  ["Cappuccino", "Hot Drinks", 130, null, "1509042239860-f550ce710b93", "Double shot, silky foam.", true],
  ["Café Latte", "Hot Drinks", 140, null, "1495474472287-4d71bcdd2085", "Mellow espresso with plenty of steamed milk.", true],
  ["Masala Chai", "Hot Drinks", 50, null, "1544787219-7f47ccb76574", "Ginger, cardamom, a little clove. Hill-station essential.", true],
  ["Kodai Hot Chocolate", "Hot Drinks", 160, null, "1542990253-0d0f5be5f0ed", "Melted dark chocolate, whole milk, a pinch of cinnamon.", true, ["bestseller"]],
  ["Nilgiri Black Tea", "Hot Drinks", 60, null, "1571934811356-5cc061b6821f", "Single-estate leaf from just over the hills.", true],

  ["Iced Coffee", "Cold Drinks", 150, null, "1461023058943-07fcbe16d735", "Cold espresso over milk and ice.", true],
  ["Oreo Shake", "Cold Drinks", 180, null, "1572490122747-3968b75cc699", "Thick, blended, crowned with cream.", true],
  ["Citrus Cooler", "Cold Drinks", 110, null, "1523371054106-bbf80586c38c", "Fresh orange and lime with a sprig of rosemary.", true],
];

export const uid = (n = 10) => randomBytes(n).toString("base64url").replace(/[-_]/g, "").slice(0, n) || randomBytes(4).toString("hex");

const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const code = (n: number) => Array.from(randomBytes(n), (b) => ALPHA[b % ALPHA.length]).join("");

export function seedData(): { products: Product[]; coupons: Coupon[]; shopName: string } {
  const now = Date.now();

  /* Fixed ids keep the menu stable if the database is ever re-seeded. Records
     created at runtime use the random uid()/code() above. */
  const products: Product[] = MENU.map(([name, category, price, stock, img, description, eggless, tags = []], i) => ({
    id: `sp${i + 1}`,
    name,
    category,
    price,
    stock,
    lowAt: 4,
    description,
    image: U(img),
    eggless,
    tags,
    active: true,
    createdAt: now + i,
    updatedAt: now + i,
  }));

  return {
    shopName: "8:2's chayakkada",
    products,
    coupons: [
      { id: "scoupon1", code: "KODAI10", percent: 10, minOrder: 500, expiresAt: null, limit: 100, used: 0, active: true, createdAt: now },
    ],
  };
}
