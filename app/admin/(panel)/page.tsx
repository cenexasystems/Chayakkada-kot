import { redirect } from "next/navigation";
import { adminState } from "@/lib/ops";
import TabsPage from "../_ui/TabsPage";

export const metadata = { title: "Open tabs" };

/* Open tabs only exist when customer ordering is on and the shop takes tabs.
   A direct URL load otherwise drops you back on Billing. */
export default async function Page({ searchParams }: PageProps<"/admin">) {
  const s = await adminState();
  if (!s.settings.orderingEnabled || s.settings.walkInsOnly) redirect("/admin/billing");
  const { tab } = await searchParams;
  return <TabsPage focus={typeof tab === "string" ? tab : undefined} />;
}
