// Readies the standalone build for packaging.
//
// `next build` writes a server that expects two things beside it that the trace does not
// copy: the static assets and `public`.
//
// The traced `node_modules` is left alone. better-sqlite3 is a native module, but the
// one it carries is the Node-API build, which Electron loads as happily as Node does —
// and keeping it there means the server resolves it beside itself rather than reaching
// for a copy that only exists on the machine that built it.
import { cp, rm, access, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";

const standalone = join(".next", "standalone");

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(join(standalone, "server.js")))) {
  console.error("No standalone build found — run `next build` first.");
  process.exit(1);
}

await cp(join(".next", "static"), join(standalone, ".next", "static"), { recursive: true });
if (await exists("public")) {
  await cp("public", join(standalone, "public"), { recursive: true });
}

// The build copies the developer's .env in with it. The packaged app is told where its
// database is by the Electron process, and must not be able to read a stale path here.
await rm(join(standalone, ".env"), { force: true });

// The trace also drags in whatever it finds at the project root — including an earlier
// packaged app, with the developer's backups beside it — whatever next.config excludes.
for (const leftover of ["dist-desktop", "release", "topset-backups", "topset-videos"]) {
  await rm(join(standalone, leftover), { recursive: true, force: true });
}

// Server-external packages are required under hashed aliases (`better-sqlite3-90e2…`),
// which the build makes symlinks in .next/node_modules — absolute ones, into this
// machine's node_modules. The portable exe follows them and ships the full dev copies
// (all of @prisma/client's runtimes, better-sqlite3's C++ sources): ~100 MB unpacked on
// every launch. The traced copies can't stand in (tracing went through the link and kept
// only the ESM half), so each link becomes a real copy minus what never runs here.
const UNUSED = [
  /\.(js|mjs)\.map$/,
  /\.d\.m?ts$/,
  // Prisma's query compilers for every database; the app is only ever SQLite.
  /[\\/]runtime[\\/][^\\/]*\.(mysql|postgresql|cockroachdb|sqlserver)\./,
  // better-sqlite3's SQLite and C++ sources, and its binaries for other platforms.
  /better-sqlite3[^\\/]*[\\/](deps|src)([\\/]|$)/,
  /better-sqlite3[^\\/]*[\\/]prebuilds[\\/](?!win32-x64\.node$)./,
];

async function unlinkAliases(dir) {
  if (!(await exists(dir))) return;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      const real = await realpath(path);
      await rm(path, { recursive: true, force: true });
      await cp(real, path, {
        recursive: true,
        dereference: true,
        filter: (from) => !UNUSED.some((pattern) => pattern.test(from)),
      });
    } else if (entry.isDirectory()) {
      await unlinkAliases(path);
    }
  }
}
await unlinkAliases(join(standalone, ".next", "node_modules"));

// Next's image optimiser is never used; sharp and its libvips binaries are dead weight.
for (const unused of ["sharp", "@img"]) {
  await rm(join(standalone, "node_modules", unused), { recursive: true, force: true });
}

// And nothing that is anyone's data may leave in the app: refuse to package if any remains.
const PRIVATE = /(\.db($|-|\.backup-)|^topset-(cloud|settings)\.json$|^\.env)/;
const found = [];
async function scan(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await scan(path);
    else if (PRIVATE.test(entry.name)) found.push(path);
  }
}
await scan(standalone);
if (found.length) {
  console.error("Private files in the standalone build — not packaging:\n  " + found.join("\n  "));
  process.exit(1);
}

console.log("standalone build ready for packaging");
