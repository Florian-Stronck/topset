// Draws the app icon and packs it into a .ico.
//
// The mark is the grid the app is: a sheet of cells with the top row filled in, in the
// same accent the workspace uses. Run it again after changing the SVG below.
import { writeFile } from "node:fs/promises";
import sharp from "sharp";

const BG = "#141418";
const ACCENT = "#e5365a";
const CELL = "#2a2a33";

/** Sizes Windows picks between, from the taskbar up to the large icon view. */
const SIZES = [16, 24, 32, 48, 64, 128, 256];

function svg(size) {
  const pad = Math.round(size * 0.16);
  const inner = size - pad * 2;
  const gap = Math.max(1, Math.round(size * 0.035));
  const cols = 3;
  const rows = 3;
  const cw = (inner - gap * (cols - 1)) / cols;
  const ch = (inner - gap * (rows - 1)) / rows;
  const radius = Math.max(1, Math.round(size * 0.02));

  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = pad + c * (cw + gap);
      const y = pad + r * (ch + gap);
      // The top row is the week being written; the rest is the sheet under it.
      const fill = r === 0 ? ACCENT : CELL;
      const opacity = r === 0 ? 1 : 1 - r * 0.18;
      cells.push(
        `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cw.toFixed(2)}" height="${ch.toFixed(2)}" rx="${radius}" fill="${fill}" opacity="${opacity.toFixed(2)}"/>`,
      );
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${Math.round(size * 0.18)}" fill="${BG}"/>
    ${cells.join("")}
  </svg>`;
}

const pngs = await Promise.all(
  SIZES.map((size) => sharp(Buffer.from(svg(size))).png().toBuffer()),
);

// ICO: a header, one directory entry per image, then the PNG payloads themselves.
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // 1 = icon
header.writeUInt16LE(SIZES.length, 4);

let offset = 6 + SIZES.length * 16;
const entries = [];

for (const [i, size] of SIZES.entries()) {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0); // 0 means 256
  entry.writeUInt8(size >= 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2); // palette
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // colour planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(pngs[i].length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += pngs[i].length;
  entries.push(entry);
}

await writeFile("electron/icon.ico", Buffer.concat([header, ...entries, ...pngs]));
console.log(`icon.ico written (${SIZES.join(", ")}px)`);

// The installer's welcome and finish pages show a 164×314 bitmap down their left side:
// the mark and the name on the app's own background. NSIS reads only BMP, which sharp
// cannot write, so the raw pixels are wrapped in a 24-bit BMP here.
const SIDEBAR_W = 164;
const SIDEBAR_H = 314;
const sidebar = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIDEBAR_W}" height="${SIDEBAR_H}">
  <rect width="100%" height="100%" fill="#0a0a0c"/>
  <g transform="translate(20 28)">${svg(56).replace(/<\/?svg[^>]*>/g, "")}</g>
  <text x="20" y="122" font-family="Segoe UI, sans-serif" font-size="26" font-weight="700" fill="#e8e8ec" letter-spacing="-0.5"><tspan fill="${ACCENT}">T</tspan>opset</text>
  <text x="20" y="144" font-family="Segoe UI, sans-serif" font-size="12" fill="#8b8b98">Programming for</text>
  <text x="20" y="160" font-family="Segoe UI, sans-serif" font-size="12" fill="#8b8b98">strength coaches</text>
  <rect x="20" y="262" width="96" height="5" rx="2" fill="${CELL}"/>
  <rect x="20" y="274" width="72" height="5" rx="2" fill="${CELL}"/>
  <rect x="20" y="286" width="84" height="5" rx="2" fill="${ACCENT}"/>
</svg>`;
const { data: rgb } = await sharp(Buffer.from(sidebar)).removeAlpha().raw().toBuffer({ resolveWithObject: true });

const stride = Math.ceil((SIDEBAR_W * 3) / 4) * 4;
const bmp = Buffer.alloc(54 + stride * SIDEBAR_H);
bmp.write("BM", 0);
bmp.writeUInt32LE(bmp.length, 2);
bmp.writeUInt32LE(54, 10); // pixel data offset
bmp.writeUInt32LE(40, 14); // info header size
bmp.writeInt32LE(SIDEBAR_W, 18);
bmp.writeInt32LE(SIDEBAR_H, 22); // positive: rows run bottom to top
bmp.writeUInt16LE(1, 26); // planes
bmp.writeUInt16LE(24, 28); // bits per pixel
bmp.writeUInt32LE(stride * SIDEBAR_H, 34);
for (let y = 0; y < SIDEBAR_H; y++) {
  const row = 54 + (SIDEBAR_H - 1 - y) * stride;
  for (let x = 0; x < SIDEBAR_W; x++) {
    const i = (y * SIDEBAR_W + x) * 3;
    bmp[row + x * 3] = rgb[i + 2];
    bmp[row + x * 3 + 1] = rgb[i + 1];
    bmp[row + x * 3 + 2] = rgb[i];
  }
}
await writeFile("electron/installer-sidebar.bmp", bmp);
console.log(`installer-sidebar.bmp written (${SIDEBAR_W}×${SIDEBAR_H}px)`);
