import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Instrument_Sans, Caveat, Sancreek } from "next/font/google";
import "./globals.css";

const fraunces = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
  axes: ["opsz"],
});

/* The wordmark's western face — used only for the shop name beside the logo, not for the rest of the app. */
const brand = Sancreek({
  variable: "--font-brand",
  subsets: ["latin"],
  weight: "400",
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
  // the 8:2 logo on a light tile (public/icon.png)
  icons: { icon: "/icon.png", apple: "/icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#6b7550",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${instrument.variable} ${caveat.variable} ${brand.variable} antialiased`}
    >
      <body>{children}</body>
    </html>
  );
}
