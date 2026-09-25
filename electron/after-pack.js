"use strict";

const { cp, rm } = require("node:fs/promises");
const path = require("node:path");

/**
 * Copies the built site and its migrations into the packaged app.
 *
 * The packager will not do it: its file globs skip dot-directories, which is where the
 * build output lives, and it strips `node_modules` out of anything copied as a resource
 * — but the standalone server is exactly a server plus the modules it traced.
 */
exports.default = async function afterPack({ appOutDir }) {
  const resources = path.join(appOutDir, "resources");

  for (const [from, to] of [
    [path.join(".next", "standalone"), "server"],
    [path.join("prisma", "migrations"), "migrations"],
  ]) {
    const target = path.join(resources, to);
    await rm(target, { recursive: true, force: true });
    await cp(from, target, { recursive: true });
  }
};
