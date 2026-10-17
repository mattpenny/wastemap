import type { FacilityCategory, FacilityProperties } from "@/data/waste-facilities";
import { CATEGORY_META } from "@/lib/categories";

/**
 * Per-facility colours.
 * -------------------------------------------------------------------------
 * The map used to colour everything by *category* — every Landfill red, every
 * RTS blue. That is fine for the single-site "Parks" (I·PARK / O·PARK / Y·PARK,
 * each already its own category), but it made the multi-site Landfills and RTS
 * impossible to tell apart on the map. We now give every Landfill and every RTS
 * its own hue, while keeping the category colour as a fallback for anything not
 * listed here (so a newly added facility never renders black).
 *
 * The seven Outlying Islands Transfer Facilities are one operational system and
 * already collapse into a single group row in the UI, so they share one
 * (distinct) teal rather than seven near-identical shades.
 */
const FACILITY_HEX: Record<string, string> = {
  // Landfills — distinct red / orange / pink.
  "landfill-went": "#dc2626",
  "landfill-nent": "#ea580c",
  "landfill-sent": "#db2777",

  // RTS — six standalone stations, distinct blue / indigo / teal / cyan / violet.
  "rts-island-east": "#3b82f6",
  "rts-island-west": "#0ea5e9",
  "rts-west-kowloon": "#6366f1",
  "rts-shatin": "#a855f7",
  "rts-north-lantau": "#06b6d4",
  "rts-nwnt": "#22d3ee",

  // OITF — one operational group, shared teal.
  "rts-oitf-mui-wo": "#0d9488",
  "rts-oitf-cheung-chau": "#0d9488",
  "rts-oitf-peng-chau": "#0d9488",
  "rts-oitf-hei-ling-chau": "#0d9488",
  "rts-oitf-yung-shue-wan": "#0d9488",
  "rts-oitf-sok-kwu-wan": "#0d9488",
  "rts-oitf-ma-wan": "#0d9488",
};

export interface FacilityColourRef {
  id: string;
  category: FacilityCategory;
}

/** Hex string for a facility, falling back to its category colour. */
export function facilityHex(f: FacilityColourRef): string {
  return FACILITY_HEX[f.id] ?? CATEGORY_META[f.category].hex;
}

/** `[r, g, b]` for deck.gl accessors, falling back to the category colour. */
export function facilityRgb(f: FacilityColourRef): [number, number, number] {
  return hexToRgb(facilityHex(f));
}

/** `rgba(r, g, b, a)` helper for translucent DOM fills (dots, badges). */
export function rgbaFor(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Inline badge style tinted with a facility's colour. */
export function facilityBadgeStyle(f: FacilityColourRef): React.CSSProperties {
  const hex = facilityHex(f);
  return {
    borderColor: rgbaFor(hex, 0.4),
    color: hex,
    backgroundColor: rgbaFor(hex, 0.15),
  };
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
