import type { FacilityCategory } from "@/data/waste-facilities";

export interface CategoryMeta {
  category: FacilityCategory;
  labelEn: string;
  labelZh: string;
  /** Marker / pillar colour. */
  color: [number, number, number];
  /** Same colour as a CSS hex string, for the DOM overlay. */
  hex: string;
  /** Tailwind classes for the badge in the drawer. */
  badgeClass: string;
  descriptionEn: string;
  descriptionZh: string;
}

export const CATEGORY_META: Record<FacilityCategory, CategoryMeta> = {
  Landfill: {
    category: "Landfill",
    labelEn: "Strategic Landfill",
    labelZh: "策略性堆填區",
    color: [220, 38, 38],
    hex: "#dc2626",
    badgeClass: "bg-red-500/15 text-red-300 ring-red-500/30",
    descriptionEn: "Bulk waste disposal by landfilling",
    descriptionZh: "以堆填方式大量處置廢物",
  },
  RTS: {
    category: "RTS",
    labelEn: "Refuse Transfer Station",
    labelZh: "垃圾轉運站",
    color: [59, 130, 246],
    hex: "#3b82f6",
    badgeClass: "bg-blue-500/15 text-blue-300 ring-blue-500/30",
    descriptionEn: "Compaction and bulk transfer of refuse",
    descriptionZh: "廢物壓縮及批量轉運",
  },
  "I-PARK": {
    category: "I-PARK",
    labelEn: "Waste-to-Energy (I·PARK)",
    labelZh: "轉廢為能設施",
    color: [16, 185, 129],
    hex: "#10b981",
    badgeClass: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
    descriptionEn: "Incineration with electricity recovery",
    descriptionZh: "焚化並回收電力",
  },
  "O-PARK": {
    category: "O-PARK",
    labelEn: "Organic Recovery (O·PARK)",
    labelZh: "有機資源回收",
    color: [245, 158, 11],
    hex: "#f59e0b",
    badgeClass: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
    descriptionEn: "Food waste digestion and composting",
    descriptionZh: "廚餘消化及堆肥",
  },
  "Y-PARK": {
    category: "Y-PARK",
    labelEn: "Yard Waste (Y·PARK)",
    labelZh: "園林廢物回收",
    color: [139, 92, 246],
    hex: "#8b5cf6",
    badgeClass: "bg-violet-500/15 text-violet-300 ring-violet-500/30",
    descriptionEn: "Yard waste recycling into wood products",
    descriptionZh: "園林廢物回收再造成木製品",
  },
};

export const CATEGORY_ORDER: FacilityCategory[] = [
  "Landfill",
  "RTS",
  "I-PARK",
  "O-PARK",
  "Y-PARK",
];

// ---------------------------------------------------------------------------
// Per-facility colour
// ---------------------------------------------------------------------------
/**
 * Hue band per category, in degrees.
 *
 * Every facility gets its own colour so no two sites share a marker, but each
 * stays inside its category's band — the three landfills run magenta through
 * plum, the thirteen transfer stations run teal through blue to indigo, and the
 * parks keep the single hues that already told them apart. That keeps the legend
 * honest ("the colour family is the facility type") while making the sites
 * themselves distinguishable, which one flat colour per category could not do.
 *
 * Red is deliberately avoided for both landfills and transfer stations, at the
 * user's request, which is why the landfill band sits opposite them in the
 * wheel rather than below them.
 */
const CATEGORY_HUE_BAND: Record<FacilityCategory, [number, number]> = {
  Landfill: [292, 322],
  RTS: [180, 258],
  "I-PARK": [160, 170],
  "O-PARK": [36, 44],
  "Y-PARK": [266, 276],
};

/**
 * Colour for the collapsed OITF group row in the ranking card.
 *
 * It stands for seven facilities, not one, so it gets a colour no facility is
 * assigned — neutral slate. The six standalone stations beside it still each
 * carry their own shade, which is what makes the seven rows distinguishable.
 */
export const OITF_GROUP_HEX = "#94a3b8";

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

const hexOf = ([r, g, b]: [number, number, number]) =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

export interface FacilityColor {
  hex: string;
  rgb: [number, number, number];
}

/**
 * Colour per facility id, derived from the order of the facility register.
 *
 * Keyed off the full list rather than whatever is on screen, so a site keeps
 * its colour when the category filter changes. Memoised on the array identity,
 * which is stable for the life of a page load.
 */
const colorCache = new WeakMap<readonly { id: string; category: FacilityCategory }[], Map<string, FacilityColor>>();

export function facilityColorMap(
  facilities: readonly { id: string; category: FacilityCategory }[]
): Map<string, FacilityColor> {
  const cached = colorCache.get(facilities);
  if (cached) return cached;

  const byCategory = new Map<FacilityCategory, string[]>();
  for (const facility of facilities) {
    const ids = byCategory.get(facility.category) ?? [];
    ids.push(facility.id);
    byCategory.set(facility.category, ids);
  }

  const colors = new Map<string, FacilityColor>();
  for (const [category, ids] of byCategory) {
    const [from, to] = CATEGORY_HUE_BAND[category];
    ids.forEach((id, i) => {
      const t = ids.length === 1 ? 0.5 : i / (ids.length - 1);
      const hue = from + (to - from) * t;
      // Alternate the lightness as well as the hue: thirteen transfer stations
      // spread over 78° leaves only ~6° a step, which neighbouring rows could
      // not tell apart on hue alone.
      const lightness = i % 2 === 0 ? 0.5 : 0.62;
      const rgb = hslToRgb(hue, 0.72, lightness);
      colors.set(id, { hex: hexOf(rgb), rgb });
    });
  }

  colorCache.set(facilities, colors);
  return colors;
}

