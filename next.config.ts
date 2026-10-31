import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev only: other devices allowed to load the dev server, e.g. a phone on the same Wi-Fi
  // (TOPSET_DEV_ORIGINS=192.168.1.20). Without it Next refuses their dev requests.
  allowedDevOrigins: process.env.TOPSET_DEV_ORIGINS?.split(",").filter(Boolean),
  // Packaged into an Electron app: the build has to carry its own server and
  // dependencies rather than expect a node_modules tree beside it.
  output: "standalone",
  // A tab the athlete just visited answers from the phone for 30 s instead of a server
  // round trip. Writes drop it (`WriteSync`); the coach app's actions revalidate their pages.
  experimental: { staleTimes: { dynamic: 30 } },
  // Native modules — they must be required at runtime, not bundled.
  serverExternalPackages: [
    "better-sqlite3",
    "@prisma/adapter-better-sqlite3",
    "@libsql/client",
    "@prisma/adapter-libsql",
    "libsql",
  ],
  // Never ship build output or anyone's data inside the app.
  outputFileTracingExcludes: {
    "*": [
      "./dist-desktop/**",
      "./release/**",
      "./topset-backups/**",
      "./*.db",
      "./*.db-*",
      "./*.db.backup-*",
      "./topset-cloud.json",
      "./topset-videos/**",
      "./.env*",
    ],
  },
  // No page is ever meant to sit inside another site's, and a file is only what its type says.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;
