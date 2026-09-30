// Runs electron-builder without losing the data of an app run straight from the build
// output. electron-builder empties dist-desktop/win-unpacked before packaging, and the
// app keeps its database, backups and settings beside its exe — so they are moved aside
// for the build and put back afterwards, whether or not it succeeds. They are put back
// after the installer is written, so they never end up in it.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync } from "node:fs";
import { join } from "node:path";

const appDir = join("dist-desktop", "win-unpacked");
const held = join("dist-desktop", "kept-data");
const DATA = /^topset(\.db|-)/;

if (existsSync(held) && readdirSync(held).length) {
  console.error(
    `${held} still holds data from an earlier build that did not finish. ` +
      `Move it back into ${appDir} (or somewhere safe) and build again.`,
  );
  process.exit(1);
}

const data = existsSync(appDir) ? readdirSync(appDir).filter((name) => DATA.test(name)) : [];
if (data.length) {
  mkdirSync(held, { recursive: true });
  // All or nothing: with the app still open its database can't move, and data left half
  // in each folder would leave the running app without its backups or sign-in.
  const moved = [];
  try {
    for (const name of data) {
      renameSync(join(appDir, name), join(held, name));
      moved.push(name);
    }
  } catch (error) {
    for (const name of moved) renameSync(join(held, name), join(appDir, name));
    rmdirSync(held);
    console.error(`Couldn't move ${data[moved.length]} aside (${error.code}). Close Topset and build again.`);
    process.exit(1);
  }
  console.log(`kept aside for the build: ${data.join(", ")}`);
}

let status = 1;
try {
  // `--publish always` from desktop:release uploads to GitHub; a plain build never does.
  const publish = process.argv.includes("--publish") ? ["--publish", "always"] : ["--publish", "never"];
  status = spawnSync("npx", ["electron-builder", "--win", ...publish], { stdio: "inherit", shell: true }).status ?? 1;
} finally {
  if (data.length) {
    mkdirSync(appDir, { recursive: true });
    for (const name of data) renameSync(join(held, name), join(appDir, name));
    rmdirSync(held);
    console.log(`put back in ${appDir}: ${data.join(", ")}`);
  }
}
process.exit(status);
