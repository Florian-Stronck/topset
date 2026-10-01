"use strict";

const { app, BrowserWindow, shell, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");
const { fork } = require("node:child_process");

const { migrate, ensureCoach } = require("./migrate");

const dev = !app.isPackaged;


/**
 * Where the training data lives: %APPDATA%\Topset, which installer updates never touch.
 * A folder from the old zip build that already has its database beside Topset.exe keeps
 * using it there. `PORTABLE_EXECUTABLE_DIR` is set by the even older single-file build,
 * whose exe ran from a temporary unpack directory.
 */
function beside() {
  return path.join(process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath("exe")), "topset.db");
}

function databaseFile() {
  if (dev) return path.join(app.getAppPath(), "dev.db");
  if (fs.existsSync(beside())) return beside();
  return path.join(app.getPath("appData"), "Topset", "topset.db");
}

/** A path inside the app's own code — the main process and what it loads directly. */
function appFile(...segments) {
  return path.join(app.getAppPath(), ...segments);
}

// The built site and its migrations live under dot-directories in the source tree, which
// the packager's file globs skip. Packaged, they are copied in beside the app instead.
const serverDir = app.isPackaged
  ? path.join(process.resourcesPath, "server")
  : appFile(".next", "standalone");

const migrationsDir = app.isPackaged
  ? path.join(process.resourcesPath, "migrations")
  : appFile("prisma", "migrations");

/**
 * The coach's sign-in to a Topset server, if any: kept beside the database file rather than
 * in it, so a backup never carries it.
 */
function cloudFile() {
  return path.join(path.dirname(databaseFile()), "topset-cloud.json");
}

/**
 * Before coach accounts, this file held the cloud database's own address and key. Nothing
 * reads those any more, and a key to every coach's data has no business on a desktop.
 */
function dropLegacyCloudKey() {
  try {
    const stored = JSON.parse(fs.readFileSync(cloudFile(), "utf8"));
    if (stored && stored.url && !stored.server) fs.rmSync(cloudFile(), { force: true });
  } catch {}
}

/** Zoom is remembered beside the database, so the app opens the size it was left at. */
function zoomFile() {
  return path.join(path.dirname(databaseFile()), "topset-settings.json");
}

function readZoom() {
  try {
    const { zoom } = JSON.parse(fs.readFileSync(zoomFile(), "utf8"));
    return typeof zoom === "number" ? zoom : 0;
  } catch {
    return 0;
  }
}

function writeZoom(zoom) {
  try {
    fs.writeFileSync(zoomFile(), JSON.stringify({ zoom }));
  } catch {}
}

/**
 * Ctrl +/-/0 and ctrl+wheel. The menu bar is removed, and its accelerators with it, so
 * the keys are read off the window itself.
 */
function applyZoom(window) {
  const contents = window.webContents;
  let level = readZoom();

  const set = (next) => {
    level = Math.max(-5, Math.min(7, next));
    contents.setZoomLevel(level);
    writeZoom(level);
  };

  // Every page load starts back at zero, so it is re-applied each time.
  contents.on("did-finish-load", () => contents.setZoomLevel(level));

  contents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || !(input.control || input.meta)) return;

    if (input.key === "0") set(0);
    else if (input.key === "-" || input.key === "_") set(level - 0.5);
    else if (input.key === "=" || input.key === "+") set(level + 0.5);
    else return;

    event.preventDefault();
  });

  contents.on("zoom-changed", (event, direction) => {
    set(level + (direction === "in" ? 0.5 : -0.5));
    event.preventDefault();
  });
}

/**
 * The page's localStorage (sidebar state, the tutorial having been seen) is kept per
 * origin, and the port is part of the origin — so the same port every launch, and a
 * random one only if something else already holds it.
 */
const PREFERRED_PORT = 47315;

function freePort(preferred = PREFERRED_PORT) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", (error) => {
      if (preferred !== 0) resolve(freePort(0));
      else reject(error);
    });
    server.listen(preferred, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function waitForServer(port, child, output, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    let exited = false;
    // A server that dies while starting — a cloud database it can't reach, say — says why
    // on its way out; waiting out the timeout would only hide that.
    child.once("exit", (code) => {
      exited = true;
      reject(new Error(`The app's server stopped while starting (exit ${code}).\n\n${output().slice(-2000)}`));
    });
    const attempt = () => {
      if (exited) return;
      const socket = net.connect(port, "127.0.0.1");
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error("The app's server did not start."));
        else setTimeout(attempt, 150);
      });
    };
    attempt();
  });
}

const BACKUP_DEFAULTS = { enabled: true, everyDays: 1, keep: 14, folder: null };

/**
 * The coach's backup settings, read straight from the database before anything else has
 * it open. A database from before settings existed simply gets the defaults.
 */
function backupSettings(db) {
  try {
    const row = db.prepare(`SELECT settings FROM "Coach" LIMIT 1`).get();
    const stored = row ? JSON.parse(row.settings || "{}").backup : null;
    return { ...BACKUP_DEFAULTS, ...(stored || {}) };
  } catch {
    return BACKUP_DEFAULTS;
  }
}

function backupsDir(file, folder) {
  return folder && path.isAbsolute(folder) ? folder : path.join(path.dirname(file), "topset-backups");
}

function stamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

/** A consistent copy, WAL and all — a plain file copy could miss unflushed writes. */
function snapshotTo(db, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.rmSync(dest, { force: true });
  db.prepare("VACUUM INTO ?").run(dest);
}

/**
 * A restore uploaded from Settings waits beside the database as topset-restore.db. It is
 * swapped in here, before anything has the database open, and what it replaces is kept.
 */
function applyStagedRestore(Database, file) {
  const staged = path.join(path.dirname(file), "topset-restore.db");
  if (!fs.existsSync(staged)) return;

  if (fs.existsSync(file)) {
    const current = new Database(file);
    try {
      snapshotTo(current, path.join(backupsDir(file, backupSettings(current).folder), `topset-before-restore-${stamp()}.db`));
    } finally {
      current.close();
    }
  }

  for (const suffix of ["", "-wal", "-shm", "-journal"]) fs.rmSync(file + suffix, { force: true });
  fs.renameSync(staged, file);
}

/**
 * A copy every few days (daily by default), keeping as many as the coach asked for — in
 * their folder, or topset-backups beside the database. `write` makes the copy at the path
 * it is given; it is only called when one is due.
 */
async function rotateBackups(file, settings, write) {
  if (!settings.enabled) return;

  const dir = backupsDir(file, settings.folder);
  fs.mkdirSync(dir, { recursive: true });
  const dateOf = (f) => /^topset-(\d{4}-\d{2}-\d{2})\.db$/.exec(f)?.[1];
  const daily = () =>
    fs
      .readdirSync(dir)
      .filter((f) => dateOf(f))
      .sort((a, b) => dateOf(a).localeCompare(dateOf(b)));

  const newest = daily().at(-1);
  const every = Math.max(1, Number(settings.everyDays) || 1);
  const age = newest
    ? (Date.now() - new Date(dateOf(newest)).getTime()) / (24 * 60 * 60 * 1000)
    : Infinity;
  if (age >= every - 0.5) {
    const today = path.join(dir, `topset-${new Date().toISOString().slice(0, 10)}.db`);
    if (!fs.existsSync(today)) await write(today);
  }

  const keep = Math.max(1, Number(settings.keep) || 14);
  const all = daily();
  for (const old of all.slice(0, Math.max(0, all.length - keep))) {
    fs.rmSync(path.join(dir, old), { force: true });
  }
}

/** The local database's backup, taken before migrations run. */
function dailyBackup(db, file) {
  return rotateBackups(file, backupSettings(db), async (dest) => snapshotTo(db, dest));
}

/**
 * First start of an installed copy, with no data yet: offer to bring over a folder from the
 * zip build. It copies and never moves — the old folder stays exactly as it was, so it is
 * still there to go back to. The database goes through SQLite (WAL and all); everything
 * else beside it (sign-in, zoom, backups, videos, photos) is copied as is.
 */
async function offerImport(Database, file) {
  if (dev || fs.existsSync(file)) return;
  const { response } = await dialog.showMessageBox(window, {
    type: "question",
    buttons: ["Choose folder…", "Start empty"],
    defaultId: 0,
    cancelId: 1,
    message: "Bring over your data from an earlier Topset?",
    detail: "If you used Topset from an unzipped folder, pick that folder (the one with topset.db in it). It is copied, and the old folder is left as it is.",
  });
  if (response !== 0) return;

  for (;;) {
    const picked = await dialog.showOpenDialog(window, { title: "Folder with topset.db", properties: ["openDirectory"] });
    if (picked.canceled || !picked.filePaths[0]) return;
    const from = picked.filePaths[0];
    const source = path.join(from, "topset.db");
    if (!fs.existsSync(source)) {
      const again = await dialog.showMessageBox(window, {
        type: "warning",
        buttons: ["Pick another", "Start empty"],
        defaultId: 0,
        cancelId: 1,
        message: "There is no topset.db in that folder.",
      });
      if (again.response !== 0) return;
      continue;
    }

    fs.mkdirSync(path.dirname(file), { recursive: true });
    for (const name of fs.readdirSync(from)) {
      if (!/^topset-/.test(name) || name === "topset-error.log") continue;
      fs.cpSync(path.join(from, name), path.join(path.dirname(file), name), { recursive: true, force: false });
    }
    const db = new Database(source, { readonly: true, fileMustExist: true });
    try {
      // Last, so a copy that fails part-way leaves no database and the offer comes back.
      snapshotTo(db, file);
    } finally {
      db.close();
    }
    return;
  }
}

/**
 * The installer's finish page asks whether the tutorial should open on first start, and
 * leaves the answer ("0" or "1") in topset-tutorial beside the database (see
 * electron/installer.nsh). It becomes the coach's showTutorial setting, read once.
 */
function applyInstallerChoices(db, file) {
  const choice = path.join(path.dirname(file), "topset-tutorial");
  let value;
  try {
    value = fs.readFileSync(choice, "utf8").trim();
  } catch {
    return;
  }
  try {
    const row = db.prepare(`SELECT id, settings FROM "Coach" LIMIT 1`).get();
    if (row) {
      const settings = { ...JSON.parse(row.settings || "{}"), showTutorial: value !== "0" };
      db.prepare(`UPDATE "Coach" SET settings = ? WHERE id = ?`).run(JSON.stringify(settings), row.id);
    }
  } finally {
    fs.rmSync(choice, { force: true });
  }
}

/** Brings the database up to the schema this build expects before anything reads it. */
async function prepareDatabase(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const Database = require(appFile("node_modules", "better-sqlite3"));
  await offerImport(Database, file);
  applyStagedRestore(Database, file);

  const existed = fs.existsSync(file);
  const db = new Database(file);
  try {
    if (existed) {
      try {
        await dailyBackup(db, file);
      } catch (error) {
        // A failed backup must not keep the app from opening.
        console.error("[topset] backup failed", error);
      }
    }
    // WAL sticks to the file. The app and the background sync each hold a connection, and
    // in WAL a read no longer waits on a write (or the other way round).
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    migrate(db, migrationsDir);
    ensureCoach(db);
    applyInstallerChoices(db, file);
  } finally {
    db.close();
  }
}

let server = null;
let window = null;

/** The window, on screen immediately, with the splash in it. */
function openWindow() {
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: true,
    backgroundColor: "#0a0a0c",
    title: "Topset",
    icon: path.join(__dirname, "icon.ico"),
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  window.removeMenu();
  applyZoom(window);

  // Anything aimed off the app — an export, a link — belongs in the real browser. Only
  // web links, though: a program file from someone else can carry any URL, and the OS
  // would happily open a file:// share or a protocol handler for it.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  return window;
}

async function start() {
  openWindow();

  // Window is on screen (backgroundColor painted) the instant it's created; the splash
  // loads into it after. Waiting on show() first would leave the screen empty for as
  // long as the site takes to boot, which reads as nothing having happened at all.
  await window.loadFile(path.join(__dirname, "splash.html"));

  const file = databaseFile();
  await prepareDatabase(file);
  dropLegacyCloudKey();

  const port = await freePort();

  // The standalone build is a plain Node server; Electron runs it as one rather than
  // shipping a second copy of Node beside it.
  server = fork(path.join(serverDir, "server.js"), [], {
    cwd: serverDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      DATABASE_URL: `file:${file}`,
      TOPSET_DESKTOP: "1",
      // Sent with every sync, so the server can turn away a copy too old for it.
      TOPSET_APP_VERSION: app.getVersion(),
      TOPSET_CLOUD_FILE: cloudFile(),
      // A desktop app never works on the server's database, whatever the shell has set.
      TURSO_DATABASE_URL: "",
      TURSO_AUTH_TOKEN: "",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });

  let output = "";
  server.stdout?.on("data", (d) => {
    output = (output + d).slice(-8000);
    process.stdout.write(`[topset] ${d}`);
  });
  server.stderr?.on("data", (d) => {
    output = (output + d).slice(-8000);
    process.stderr.write(`[topset] ${d}`);
  });

  await waitForServer(port, server, () => output);
  await window.loadURL(`http://127.0.0.1:${port}/programming`);

  watchForUpdates();
}

const UPDATE_EVERY_MS = 4 * 60 * 60 * 1000;

/**
 * Installed copies download new releases from GitHub in the background and ask to restart
 * once one is ready; "Later" installs it the next time Topset closes. Only an installed copy
 * has app-update.yml, so dev and the old zip folders never check.
 */
function watchForUpdates() {
  if (dev || !fs.existsSync(path.join(process.resourcesPath, "app-update.yml"))) return;
  const { autoUpdater } = require("electron-updater");
  let asked = false;

  autoUpdater.on("error", (error) => console.error("[topset] update check failed", error));
  autoUpdater.on("update-downloaded", async ({ version }) => {
    if (asked) return;
    asked = true;
    const { response } = await dialog.showMessageBox(window, {
      type: "info",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
      message: `Topset ${version} is ready`,
      detail: "Restart to update now, or it installs the next time you close Topset.",
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });

  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  // Coaches leave it open for days.
  setInterval(check, UPDATE_EVERY_MS);
}

app.whenReady().then(() =>
  start().catch((error) => {
    const detail = String(error?.stack || error);
    // Written as well as shown: a dialog is gone the moment it is dismissed, and this
    // is the only account of what happened on someone else's machine.
    try {
      fs.writeFileSync(
        path.join(path.dirname(databaseFile()), "topset-error.log"),
        `${new Date().toISOString()}\n${detail}\n`,
      );
    } catch {}
    dialog.showErrorBox("Topset could not start", detail);
    app.quit();
  }),
);

app.on("window-all-closed", () => app.quit());
app.on("quit", () => server?.kill());
