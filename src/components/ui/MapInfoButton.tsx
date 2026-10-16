"use client";

import * as React from "react";
import { Info, Layers, Map as MapIcon, X } from "lucide-react";

import type { MapStyleId } from "@/components/map/mapStyles";
import { t, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface MapInfoButtonProps {
  lang: Lang;
  /** Determines which imagery credit is shown. */
  mapStyle: MapStyleId;
  className?: string;
}

/**
 * Collapsed "i" affordance holding everything that used to be permanently on
 * screen: the map attribution and the "deck.gl / MapLibre" tech badge.
 *
 * Both were taking up space in the chrome for information almost nobody needs
 * at a glance, but the attribution still has to be *available* — which is
 * exactly the pattern Mapbox, MapLibre and Google Maps all use for credits.
 */
export default function MapInfoButton({
  lang,
  mapStyle,
  className,
}: MapInfoButtonProps) {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  // Click-away and Escape both dismiss, as with any popover.
  React.useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const attribution =
    mapStyle === "satellite"
      ? t("infoAttributionSatellite", lang)
      : t("infoAttributionOfficial", lang);

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {/* Popover — opens upward from the button. */}
      {open && (
        <div
          role="dialog"
          aria-label={t("infoTitle", lang)}
          className="absolute bottom-full left-0 mb-2 w-[min(22rem,calc(100vw-1.5rem))] origin-bottom-left animate-fade-in overflow-hidden rounded-2xl border border-white/12 bg-slate-900/95 shadow-2xl backdrop-blur-xl"
        >
          <div className="flex items-center justify-between border-b border-white/10 px-3.5 py-2.5">
            <h2 className="text-[length:calc(11px*var(--fs))] font-semibold uppercase tracking-wider text-white/70">
              {t("infoTitle", lang)}
            </h2>
            <button
              onClick={() => setOpen(false)}
              aria-label={t("close", lang)}
              className="grid h-6 w-6 place-items-center rounded-full text-white/45 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="thin-scrollbar max-h-[min(60vh,26rem)] space-y-3.5 overflow-y-auto px-3.5 py-3.5">
            {/* Map data / attribution */}
            <section>
              <h3 className="mb-1.5 flex items-center gap-1.5 text-[length:calc(10px*var(--fs))] font-semibold uppercase tracking-wider text-emerald-400/85">
                <MapIcon className="h-3 w-3" />
                {t("infoMapData", lang)}
              </h3>
              <p className="text-[length:calc(11.5px*var(--fs))] leading-relaxed text-white/75">
                {attribution}
              </p>
            </section>

            {/* Technology */}
            <section>
              <h3 className="mb-1.5 flex items-center gap-1.5 text-[length:calc(10px*var(--fs))] font-semibold uppercase tracking-wider text-sky-400/85">
                <Layers className="h-3 w-3" />
                {t("infoTech", lang)}
              </h3>
              <ul className="space-y-2">
                <li className="text-[length:calc(11.5px*var(--fs))] leading-relaxed text-white/70">
                  {t("infoMapLibre", lang)}
                </li>
                <li className="text-[length:calc(11.5px*var(--fs))] leading-relaxed text-white/70">
                  {t("infoDeckGl", lang)}
                </li>
              </ul>
            </section>

            {/* Data provenance */}
            <section className="rounded-lg border border-white/8 bg-white/[0.03] px-2.5 py-2">
              <h3 className="mb-1 text-[length:calc(10px*var(--fs))] font-semibold uppercase tracking-wider text-white/45">
                {t("infoData", lang)}
              </h3>
              <p className="text-[length:calc(11px*var(--fs))] leading-relaxed text-white/55">
                {t("infoDataNote", lang)}
              </p>
            </section>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t("infoOpen", lang)}
        title={t("infoOpen", lang)}
        className={cn(
          "grid h-7 w-7 place-items-center rounded-full border shadow-lg backdrop-blur-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60",
          open
            ? "border-emerald-400/40 bg-emerald-500 text-slate-950"
            : "border-white/12 bg-slate-900/85 text-white/60 hover:bg-white/10 hover:text-white"
        )}
      >
        <Info className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
