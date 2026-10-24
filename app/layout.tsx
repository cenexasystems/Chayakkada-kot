import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Instrument_Sans, Caveat } from "next/font/google";
import "./globals.css";

const fraunces = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
  axes: ["opsz"],
});

const instrument = Instrument_Sans({
  variable: "--font-body",
  subsets: ["latin"],
});

const caveat = Caveat({
  variable: "--font-hand",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "8:2's chayakkada | Thanjavur",
  description: "Order from your phone at 8:2's chayakkada — browse the menu, add to your tab and pay at the counter.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#1d1a18",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${instrument.variable} ${caveat.variable} antialiased`}
    >
      <body>{children}</body>
    </html>
  );
}
