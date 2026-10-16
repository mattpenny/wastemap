"use client";

import * as React from "react";
import {
  Building2,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Clock,
  Coins,
  ExternalLink,
  Factory,
  Layers,
  MapPin,
  Ruler,
  Settings,
  Trash2,
  Truck,
  Wrench,
  X,
} from "lucide-react";

import type { DetailLabelKey, FacilityProperties } from "@/data/waste-facilities";
import { CATEGORY_META } from "@/lib/categories";
import { pick, t, type Lang } from "@/lib/i18n";
import { cn, formatNumber } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

interface FacilityDetailDrawerProps {
  facility: FacilityProperties | null;
  isOpen: boolean;
  onClose: () => void;
  lang: Lang;
}

/** Icons for the optional EPD facility-page detail rows. */
const DETAIL_ICONS: Record<DetailLabelKey, React.ComponentType<{ className?: string }>> = {
  contractor: Building2,
  capitalCost: Coins,
  wasteDeliveredTo: Truck,
  wasteTypes: Trash2,
  area: Ruler,
  aftercare: Clock,
  majorPlant: Wrench,
  otherFacilities: Settings,
};

/** Compact label/value row used in the metadata block. */
function MetaRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/35" />
      <div className="min-w-0">
        <p className="text-[length:calc(10px*var(--fs))] uppercase tracking-wider text-white/40">{label}</p>
        <p className="text-[length:calc(13px*var(--fs))] leading-snug text-white/85">{value}</p>
      </div>
    </div>
  );
}

/** One headline data tile. */
function MetricTile({
  label,
  value,
  unit,
  accent,
  note,
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: string;
  note?: string | null;
}) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.04] px-3 py-2.5">
      <p className="text-[length:calc(10px*var(--fs))] uppercase tracking-wider text-white/40">{label}</p>
      <p
        className="mt-1 flex items-baseline gap-1 text-[length:calc(20px*var(--fs))] font-bold tabular-nums leading-none"
        style={accent ? { color: accent } : undefined}
      >
        {value}
        {unit && <span className="text-[length:calc(10px*var(--fs))] font-medium text-white/45">{unit}</span>}
      </p>
      {note && (
        <p className="mt-1.5 text-[length:calc(9.5px*var(--fs))] leading-snug text-white/40">
          {note}
        </p>
      )}
    </div>
  );
}

export default function FacilityDetailDrawer({
  facility,
  isOpen,
  onClose,
  lang,
}: FacilityDetailDrawerProps) {
  /** The default drawer is just the headline figures; metadata sits behind this. */
  const [detailOpen, setDetailOpen] = React.useState(false);

  React.useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  // Collapse the detail section whenever a different facility opens.
  React.useEffect(() => {
    setDetailOpen(false);
  }, [facility?.id]);

  if (!isOpen || !facility) return null;

  const meta = CATEGORY_META[facility.category];
  const throughputValue =
    facility.throughputTonnesPerDay === null
      ? t("notPublished", lang)
      : formatNumber(facility.throughputTonnesPerDay);
  const capacityValue =
    facility.designCapacityTonnesPerDay !== null
      ? formatNumber(facility.designCapacityTonnesPerDay)
      : facility.voidCapacityMillionM3 !== null
        ? formatNumber(facility.voidCapacityMillionM3)
        : t("notPublished", lang);
  const capacityUnit =
    facility.designCapacityTonnesPerDay !== null
      ? t("tpd", lang)
      : facility.voidCapacityMillionM3 !== null
        ? "Mm³"
        : undefined;
  const capacityLabel =
    facility.voidCapacityMillionM3 !== null
      ? t("remainingVoidCapacity", lang)
      : t("designCapacity", lang);

  // EPD facility pages usually give a month; fall back to the year.
  const commissionedValue =
    pick(lang, facility.commissionedDateEn, facility.commissionedDateZh) ||
    String(facility.commissionedYear);

  return (
    <>
      <div
        className="fixed inset-0 z-40 animate-fade-in bg-slate-950/60 backdrop-blur-[2px] md:hidden"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        role="dialog"
        aria-modal="false"
        aria-label={pick(lang, facility.nameEn, facility.nameZh)}
        className={cn(
          "fixed z-50 flex flex-col overflow-hidden border-white/10 bg-slate-900/95 shadow-2xl backdrop-blur-2xl",
          "inset-x-0 bottom-0 max-h-[85vh] animate-slide-in-bottom rounded-t-3xl border-t",
          "md:inset-y-0 md:right-0 md:left-auto md:w-[26rem] md:max-h-none md:animate-slide-in-right md:rounded-none md:border-l md:border-t-0"
        )}
      >
        <div className="flex justify-center pt-2.5 md:hidden">
          <span className="h-1 w-10 rounded-full bg-white/25" />
        </div>

        <header className="shrink-0 border-b border-white/10 px-5 pb-4 pt-3 md:pt-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Badge tone={meta.badgeClass} className="mb-2">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.hex }} />
                {pick(lang, meta.labelEn, meta.labelZh)}
              </Badge>
              <h2 className="text-lg font-bold leading-tight text-white md:text-xl">
                {lang === "zh" ? facility.nameZh : facility.nameEn}
              </h2>
              <p className="mt-0.5 text-xs text-white/45">
                {lang === "zh" ? facility.nameEn : facility.nameZh}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {/* Detail toggle — sits next to the facility name. */}
              <button
                onClick={() => setDetailOpen((v) => !v)}
                aria-expanded={detailOpen}
                aria-label={t(detailOpen ? "hideDetail" : "showDetail", lang)}
                title={t(detailOpen ? "hideDetail" : "showDetail", lang)}
                className={cn(
                  "flex items-center gap-1 rounded-full border px-2.5 py-1 text-[length:calc(10.5px*var(--fs))] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60",
                  detailOpen
                    ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-200"
                    : "border-white/15 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
                )}
              >
                {detailOpen ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
                {t("detail", lang)}
              </button>
              <button
                onClick={onClose}
                aria-label={t("close", lang)}
                title={t("close", lang)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/50 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </header>

        <div className="thin-scrollbar flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* Official facility figures — the default view. */}
          <section className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <MetricTile
                label={t("reportedThroughput", lang)}
                value={throughputValue}
                unit={facility.throughputTonnesPerDay === null ? undefined : t("tpd", lang)}
                accent={facility.throughputTonnesPerDay === null ? "#94a3b8" : meta.hex}
                note={
                  facility.throughputNoteEn
                    ? pick(lang, facility.throughputNoteEn, facility.throughputNoteZh ?? undefined)
                    : t("notPublishedPerFacility", lang)
                }
              />
              <MetricTile
                label={capacityLabel}
                value={capacityValue}
                unit={capacityUnit}
                accent={facility.designCapacityTonnesPerDay !== null ? meta.hex : undefined}
                note={
                  facility.voidCapacityMillionM3 !== null
                    ? t("voidNotThroughput", lang)
                    : facility.designCapacityTonnesPerDay !== null
                      ? t("designCapacityNote", lang)
                      : t("notPublished", lang)
                }
              />
            </div>

            {facility.groupThroughputTonnesPerDay !== undefined && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-400/15 bg-amber-400/[0.06] px-3 py-2.5">
                <Layers className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300/80" />
                <p className="text-[length:calc(10.5px*var(--fs))] leading-relaxed text-amber-100/75">
                  {pick(
                    lang,
                    facility.groupThroughputNoteEn,
                    facility.groupThroughputNoteZh
                  )}
                </p>
              </div>
            )}
          </section>

          {/* Everything else is one tap away behind the Detail toggle. */}
          {detailOpen && (
            <>
              <section className="space-y-3 rounded-xl border border-white/8 bg-white/[0.03] px-3.5 py-3.5">
                {facility.groupEn && (
                  <MetaRow
                    icon={Layers}
                    label={t("oitfGroup", lang)}
                    value={pick(lang, facility.groupEn, facility.groupZh)}
                  />
                )}
                <MetaRow
                  icon={MapPin}
                  label={t("location", lang)}
                  value={pick(lang, facility.addressEn, facility.addressZh)}
                />
                <MetaRow
                  icon={CalendarClock}
                  label={t("commissioned", lang)}
                  value={commissionedValue}
                />
                {facility.openingHoursEn && (
                  <MetaRow
                    icon={Clock}
                    label={t("openingHours", lang)}
                    value={pick(lang, facility.openingHoursEn, facility.openingHoursZh ?? undefined)}
                  />
                )}
                <MetaRow
                  icon={Building2}
                  label={t("operator", lang)}
                  value={pick(lang, facility.operatorEn, facility.operatorZh)}
                />
                {/* Official detail transcribed from EPD's facility page. */}
                {facility.detail?.map((row) => {
                  const Icon = DETAIL_ICONS[row.label] ?? Building2;
                  return (
                    <MetaRow
                      key={row.label}
                      icon={Icon}
                      label={t(row.label, lang)}
                      value={pick(lang, row.valueEn, row.valueZh)}
                    />
                  );
                })}
                <MetaRow
                  icon={Factory}
                  label={t("coordinates", lang)}
                  value={`${facility.coordinates[1].toFixed(4)}°N, ${facility.coordinates[0].toFixed(4)}°E`}
                />
              </section>

              {/* Operational note */}
              <section className="rounded-xl border border-emerald-500/15 bg-emerald-500/[0.06] px-3.5 py-3">
                <p className="mb-1 text-[length:calc(10px*var(--fs))] font-semibold uppercase tracking-wider text-emerald-300/80">
                  {t("operationalNote", lang)}
                </p>
                <p className="text-[length:calc(12px*var(--fs))] leading-relaxed text-white/70">
                  {pick(lang, facility.noteEn, facility.noteZh)}
                </p>
              </section>

              {facility.detailSourceUrl && (
                <a
                  href={facility.detailSourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-[length:calc(10px*var(--fs))] text-emerald-300/70 transition-colors hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
                >
                  <ExternalLink className="h-3 w-3" />
                  {t("epdFacilityPage", lang)}
                </a>
              )}
            </>
          )}

          {/* Provenance */}
          <p className="pb-1 text-[length:calc(10px*var(--fs))] leading-relaxed text-white/30">
            {t("dataNote", lang)}: {t("infoDataNote", lang)}
          </p>
        </div>
      </aside>
    </>
  );
}
