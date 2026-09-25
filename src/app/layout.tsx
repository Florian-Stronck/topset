import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { connection } from "next/server";
import { CommandCenter } from "@/components/CommandCenter";
import { SettingsProvider } from "@/components/SettingsProvider";
import { loadSettings } from "@/lib/coach-settings";
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
    <html lang={settings.language}>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <SettingsProvider settings={forClient(settings)}>
          {children}
          <CommandCenter />
        </SettingsProvider>
      </body>
    </html>
  );
}
