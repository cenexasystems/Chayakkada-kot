import { requireAdmin } from "@/lib/auth";
import SuppliersPage from "../../_ui/SuppliersPage";

export const metadata = { title: "Suppliers" };

export default async function Page() {
  await requireAdmin("/admin/billing");
  return <SuppliersPage />;
}
