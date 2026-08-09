import type { Metadata } from "next";
import "./globals.css";

// Fonts are deliberately not loaded yet. DESIGN.md section 3 calls for Inter
// and IBM Plex Mono, and they get set up with the design tokens in the next
// step. create-next-app's Geist fonts have been removed rather than left to
// linger.

export const metadata: Metadata = {
  title: "Amzai Operations",
  description: "Internal operations platform. Staff only.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-GB" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
