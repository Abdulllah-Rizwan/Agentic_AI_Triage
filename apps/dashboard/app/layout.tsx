import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import { ExtensionErrorFilter } from "@/components/ExtensionErrorFilter";
import "./globals.css";

export const metadata: Metadata = {
  title: "MediReach Dashboard",
  description: "Disaster Medical Intelligence System",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-gray-950 text-white font-sans antialiased">
        <ExtensionErrorFilter />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
