import { redirect } from "next/navigation";
import { adminState } from "@/lib/ops";
import KitchenPage from "../../_ui/KitchenPage";

export const metadata = { title: "Kitchen" };

/* Kitchen is only reachable when the admin toggle is on; the nav link hides
   as well. A direct URL load drops you back on Billing. */
export default async function Page() {
  const s = await adminState();
  if (!s.settings.kotEnabled) redirect("/admin/billing");
  return <KitchenPage />;
}
