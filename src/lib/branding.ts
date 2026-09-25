import type { jsPDF } from "jspdf";
import { activeSettings } from "@/lib/settings";

/** The coach's logo as jsPDF wants it, or null when there is none it can draw. */
function logoOf(dataUrl: string | null): { data: string; format: "PNG" | "JPEG" } | null {
  if (!dataUrl) return null;
  const m = /^data:image\/(png|jpe?g);base64,/i.exec(dataUrl);
  if (!m) return null;
  return { data: dataUrl, format: m[1].toLowerCase() === "png" ? "PNG" : "JPEG" };
}

/** Whether there is anything to brand a document with. */
export function hasBranding(): boolean {
  const b = activeSettings().branding;
  return Boolean(b.name.trim() || b.header.trim() || logoOf(b.logo));
}

const LOGO_MAX_H = 44;
const LOGO_MAX_W = 180;

/** The logo's drawn size: as tall as allowed, unless that makes it too wide. */
function logoSize(doc: jsPDF, data: string): { w: number; h: number } | null {
  try {
    const { width, height } = doc.getImageProperties(data);
    if (!width || !height) return null;
    const h = Math.min(LOGO_MAX_H, (LOGO_MAX_W * height) / width);
    return { w: (width / height) * h, h };
  } catch {
    return null;
  }
}

/** How tall the brand block will be, so pages can be sized before it is drawn. */
export function brandBlockHeight(doc: jsPDF): number {
  if (!hasBranding()) return 0;
  const { name, header, logo } = activeSettings().branding;
  const image = logoOf(logo);
  const size = image ? logoSize(doc, image.data) : null;
  return (size ? size.h + 6 : 0) + (name.trim() ? 14 : 0) + (header.trim() ? 11 : 0) + 10;
}

/**
 * The coach's block at the top of a page, centred: logo, then their name, then their
 * header line. Drawn from `y` in a column `width` wide starting at `x`; returns where
 * the page continues.
 */
export function drawBrandBlock(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  colors: { ink: [number, number, number]; muted: [number, number, number] },
  safe: (s: string) => string,
): number {
  if (!hasBranding()) return y;
  const { name, header, logo } = activeSettings().branding;
  const center = x + width / 2;
  const image = logoOf(logo);
  const size = image ? logoSize(doc, image.data) : null;

  if (image && size) {
    try {
      doc.addImage(image.data, image.format, center - size.w / 2, y, size.w, size.h);
    } catch {
      // An unreadable logo shouldn't stop the export.
    }
    y += size.h + 6;
  }
  if (name.trim()) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...colors.ink);
    doc.text(safe(name.trim()), center, y + 10, { align: "center" });
    y += 14;
  }
  if (header.trim()) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...colors.muted);
    const line = (doc.splitTextToSize(safe(header.trim()), width) as string[])[0] ?? "";
    doc.text(line, center, y + 8, { align: "center" });
    y += 11;
  }
  return y + 10;
}

/** The coach's footer line, if they wrote one. */
export function footerText(): string {
  return activeSettings().branding.footer.trim();
}

/** "{athlete} - {program}" filled in, made safe for a file name. */
export function exportFileName(parts: { athlete: string; program: string; phase: string }): string {
  const pattern = activeSettings().fileName.trim() || "{athlete} - {program} - {phase}";
  const filled = pattern
    .replace(/\{athlete\}/g, parts.athlete)
    .replace(/\{program\}/g, parts.program)
    .replace(/\{phase\}/g, parts.phase)
    .replace(/\{date\}/g, new Date().toISOString().slice(0, 10));
  return filled.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "program";
}

/** Pixel size of a PNG or JPEG, read from its header — enough to keep a logo's proportions. */
export function imageSize(bytes: Buffer): { width: number; height: number } | null {
  // PNG: the IHDR chunk sits at a fixed offset.
  if (bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504e47) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  // JPEG: walk the markers to the first start-of-frame.
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      const length = bytes.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: bytes.readUInt16BE(i + 7), height: bytes.readUInt16BE(i + 5) };
      }
      i += 2 + length;
    }
  }
  return null;
}
