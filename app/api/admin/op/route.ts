import { getRole } from "@/lib/auth";
import { body, handle } from "@/lib/http";
import { adminOp } from "@/lib/ops";
import { ApiError } from "@/lib/store";

/* Ops staff may NOT trigger — the owner-only writes. Everything the staff
   console actually surfaces (orders, bill.create, product.stock, tabs) is
   open to them; the admin-only pages are already blocked server-side. */
const ADMIN_ONLY_OPS = new Set([
  "settings.update",
  "user.promote",
  "user.demote",
  "coupon.save",
  "coupon.send",
  "coupon.delete",
  "expense.save",
  "expense.delete",
  "expcat.save",
  "expcat.delete",
  "product.delete",
  "category.rename",
  "bill.delete",
  "bill.void",
  "ingredient.delete",
  "recipe.delete",
  // loyalty: staff may look up, enrol, redeem and issue rewards; settings and corrections are the owner's
  "loyalty.update",
  "loyalty.status",
  "loyalty.adjust",
  "loyalty.cancelVoucher",
  "loyalty.refund",
  "loyalty.grant",
  "loyalty.config",
  "loyalty.reward.save",
  "loyalty.reward.delete",
  "loyalty.campaign.save",
  "loyalty.campaign.delete",
]);

/* POST {op, ...args} → {result} */
export async function POST(req: Request) {
  return handle(async () => {
    const role = await getRole();
    if (!role) throw new ApiError("You've been signed out. Please sign in again.", 401);
    const { op, ...args } = await body(req);
    const name = String(op);
    if (role !== "admin" && ADMIN_ONLY_OPS.has(name)) throw new ApiError("Only the admin can do that.", 403);
    return { result: await adminOp(name, args, role) };
  });
}
