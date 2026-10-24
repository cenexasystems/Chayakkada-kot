import type { Metadata } from "next";
import { Lexend } from "next/font/google";
import "./admin.css";

const lexend = Lexend({ subsets: ["latin"], variable: "--font-adm-num" });

export const metadata: Metadata = {
  title: { default: "Admin · 8:2's chayakkada", template: "%s · Admin · 8:2's chayakkada" },
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return <div className={`adm ${lexend.variable}`}>{children}</div>;
}
