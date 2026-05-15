import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Providers } from "@/components/providers";
import { ExtensionErrorFilter } from "@/components/ExtensionErrorFilter";
import "./globals.css";

const geist = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "MediReach Dashboard",
  description: "Disaster Medical Intelligence System",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${geist.className} bg-gray-950 text-white`}>
        <ExtensionErrorFilter />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
