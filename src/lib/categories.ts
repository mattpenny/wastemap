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
    color: [249, 115, 22],
    hex: "#f97316",
    badgeClass: "bg-orange-500/15 text-orange-300 ring-orange-500/30",
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

