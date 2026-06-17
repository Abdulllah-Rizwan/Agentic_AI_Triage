import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import { ExtensionErrorFilter } from "@/components/ExtensionErrorFilter";
import "./globals.css";

export const metadata: Metadata = {
  title: "MediReach Dashboard",
  description: "Disaster Medical Intelligence System",
};

// Inline script injected before React hydrates to avoid flash of wrong theme.
// Reads localStorage and sets the .dark class on <html> synchronously.
const themeScript = `
(function() {
  try {
    var t = localStorage.getItem('medireach_theme');
    if (t !== 'light') { document.documentElement.classList.add('dark'); }
  } catch(e) {
    document.documentElement.classList.add('dark');
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* eslint-disable-next-line react/no-danger */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="bg-gray-950 text-white font-sans antialiased">
        <ExtensionErrorFilter />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
