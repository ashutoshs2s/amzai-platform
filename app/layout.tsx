import type { Metadata } from "next";
import { IBM_Plex_Mono, Montserrat } from "next/font/google";

import "./globals.css";

// DESIGN.md section 3. Montserrat for the interface, IBM Plex Mono for time
// and quantity. Loaded through next/font so they are self-hosted and there is
// no request to Google at run time.
const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-montserrat",
  display: "swap",
});

// Plex Mono is not a variable font, so the weights we use are listed. 400 for
// time and counts, 500 for large metrics.
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Amzai Operations",
  description: "Internal operations platform. Staff only.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en-GB"
      className={`${montserrat.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
