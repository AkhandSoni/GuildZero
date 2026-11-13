import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import "./globals.css";
import localFont from "next/font/local";
const geist = localFont({src:[{path:"./fonts/Geist-Regular.woff2",weight:"400",style:"normal"},{path:"./fonts/Geist-SemiBold.woff2",weight:"600",style:"normal"}],variable:"--font-geist",display:"swap"});
export const metadata: Metadata = {
  title: { default: "GuildZero", template: "%s · GuildZero" },
  description:
    "A marketplace for deterministic data services. NEAR testnet demonstration.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={geist.variable}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
