import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { connection } from "next/server";
import { CommandCenter } from "@/components/CommandCenter";
import { SettingsProvider } from "@/components/SettingsProvider";
import { loadSettings } from "@/lib/coach-settings";
import { THEME_SCRIPT } from "@/lib/theme-script";
import { forClient } from "@/lib/settings";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Topset — Coach Workspace",
  description: "Powerlifting programming that exports straight to a sheet.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Settings live in the database, so nothing is prerendered at build time — the hosted
  // build has no database to read, and a page baked then would miss later changes anyway.
  await connection();
  const settings = await loadSettings();

  return (
    // The theme script below sets data-theme before React hydrates, so <html> may differ.
    <html lang={settings.language} data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <SettingsProvider settings={forClient(settings)}>
          {children}
          <CommandCenter />
        </SettingsProvider>
      </body>
    </html>
  );
}
