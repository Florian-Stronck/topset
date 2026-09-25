import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Packaged into an Electron app: the build has to carry its own server and
  // dependencies rather than expect a node_modules tree beside it.
  output: "standalone",
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
};

export default nextConfig;
