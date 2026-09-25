/**
 * The icons a check-in question can wear, drawn as 24×24 outlines. Stored by name on the
 * question, so an unknown name (from a newer copy of the app) falls back to the tick.
 */

type Shape = { paths: string[]; circles?: [number, number, number][]; rects?: [number, number, number, number, number][] };

export const CHECKIN_ICONS: Record<string, Shape> = {
  check: { paths: ["m9 12 2 2 4-4"], circles: [[12, 12, 10]] },
  flame: {
    paths: [
      "M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z",
    ],
  },
  moon: { paths: ["M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"] },
  bed: { paths: ["M2 4v16", "M2 8h18a2 2 0 0 1 2 2v10", "M2 17h20", "M6 8v9"] },
  gauge: { paths: ["m12 14 4-4", "M3.34 19a10 10 0 1 1 17.32 0"] },
  bandage: {
    paths: ["M10 10.01h.01", "M10 14.01h.01", "M14 10.01h.01", "M14 14.01h.01", "M18 6v12", "M6 6v12"],
    rects: [[2, 6, 20, 12, 2]],
  },
  zap: { paths: ["M13 2 3 14h9l-1 8 10-12h-9l1-8z"] },
  footprints: {
    paths: [
      "M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z",
      "M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z",
      "M16 17h4",
      "M4 13h4",
    ],
  },
  droplet: { paths: ["M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"] },
  venus: { paths: ["M12 15v7", "M9 19h6"], circles: [[12, 9, 6]] },
  pill: { paths: ["m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z", "m8.5 8.5 7 7"] },
  note: { paths: ["M4 6h16", "M4 12h16", "M4 18h9", "m17 16 3 3-3 3"] },
  heart: {
    paths: [
      "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z",
    ],
  },
  dumbbell: { paths: ["m6.5 6.5 11 11", "m21 21-1-1", "m3 3 1 1", "m18 22 4-4", "m2 6 4-4", "m3 10 7-7", "m14 21 7-7"] },
  thermometer: { paths: ["M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"] },
  clock: { paths: ["M12 6v6l4 2"], circles: [[12, 12, 10]] },
  chart: { paths: ["M3 3v18h18", "m19 9-5 5-4-4-3 3"] },
  smile: { paths: ["M8 14s1.5 2 4 2 4-2 4-2", "M9 9h.01", "M15 9h.01"], circles: [[12, 12, 10]] },
  coffee: {
    paths: ["M10 2v2", "M14 2v2", "M6 2v2", "M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"],
  },
  leaf: {
    paths: [
      "M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z",
      "M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12",
    ],
  },
  sun: {
    paths: ["M12 2v2", "M12 20v2", "m4.93 4.93 1.41 1.41", "m17.66 17.66 1.41 1.41", "M2 12h2", "M20 12h2", "m6.34 17.66-1.41 1.41", "m19.07 4.93-1.41 1.41"],
    circles: [[12, 12, 4]],
  },
  weight: { paths: ["M8 9a4 4 0 0 1 8 0", "m12 9 1.5-2.5"], rects: [[3, 3, 18, 18, 3]] },
  star: { paths: ["M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"] },
};

export const ICON_NAMES = Object.keys(CHECKIN_ICONS);

export function CheckinIcon({ name, size = 18, className }: { name: string; size?: number; className?: string }) {
  const shape = CHECKIN_ICONS[name] ?? CHECKIN_ICONS.check;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {shape.paths.map((d) => (
        <path key={d} d={d} />
      ))}
      {shape.circles?.map(([cx, cy, r]) => <circle key={`${cx}-${cy}-${r}`} cx={cx} cy={cy} r={r} />)}
      {shape.rects?.map(([x, y, w, h, rx]) => <rect key={`${x}-${y}`} x={x} y={y} width={w} height={h} rx={rx} />)}
    </svg>
  );
}

/** A trophy, for a set flagged as a personal record. */
export function Trophy({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  );
}
