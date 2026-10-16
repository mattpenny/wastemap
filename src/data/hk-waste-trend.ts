/**
 * Official territory-wide Hong Kong waste statistics (tonnes/year).
 *
 * These are annual totals from the EPD CSV resources linked by data.gov.hk.
 * They are deliberately kept separate from per-facility records: EPD does not
 * publish annual facility-level time series, so these values must never be
 * presented as the history of the facility selected in the map.
 *
 * Source coverage: 2009–2024. This is a published snapshot, not a live API feed.
 */
export interface HongKongWasteTrendPoint {
  year: number;
  mswGeneratedTonnes: number;
  totalDisposedTonnes: number;
  mswDisposedTonnes: number;
  constructionDisposedTonnes: number;
  specialDisposedTonnes: number;
}

export const HK_WASTE_TREND_SOURCE = {
  generation:
    "https://www.epd.gov.hk/epd/sites/default/files/epd/english/environmentinhk/waste/data/files/solid-waste-generation-quantity-en-2024.csv",
  disposal:
    "https://www.epd.gov.hk/epd/sites/default/files/epd/english/environmentinhk/waste/data/files/solid-waste-disposal-quantity-en-2024.csv",
  disposalByCategory:
    "https://www.epd.gov.hk/epd/sites/default/files/epd/english/environmentinhk/waste/data/files/solid-waste-disposal-quantity-by-category-en-2024.csv",
  dataGovHkPage:
    "https://data.gov.hk/en-data/dataset/hk-epd-statteam-solid-waste-generation-quantity",
  lastYear: 2024,
} as const;

export const HK_WASTE_TREND: HongKongWasteTrendPoint[] = [
  { year: 2009, mswGeneratedTonnes: 6452600, totalDisposedTonnes: 4864000, mswDisposedTonnes: 3271300, constructionDisposedTonnes: 1139000, specialDisposedTonnes: 453700 },
  { year: 2010, mswGeneratedTonnes: 6930100, totalDisposedTonnes: 5043200, mswDisposedTonnes: 3326700, constructionDisposedTonnes: 1308200, specialDisposedTonnes: 408400 },
  { year: 2011, mswGeneratedTonnes: 6302800, totalDisposedTonnes: 4912300, mswDisposedTonnes: 3283500, constructionDisposedTonnes: 1215900, specialDisposedTonnes: 412800 },
  { year: 2012, mswGeneratedTonnes: 5558500, totalDisposedTonnes: 5067000, mswDisposedTonnes: 3395700, constructionDisposedTonnes: 1258900, specialDisposedTonnes: 412400 },
  { year: 2013, mswGeneratedTonnes: 5493200, totalDisposedTonnes: 5223400, mswDisposedTonnes: 3484600, constructionDisposedTonnes: 1310800, specialDisposedTonnes: 428000 },
  { year: 2014, mswGeneratedTonnes: 5623600, totalDisposedTonnes: 5423400, mswDisposedTonnes: 3570400, constructionDisposedTonnes: 1438700, specialDisposedTonnes: 414300 },
  { year: 2015, mswGeneratedTonnes: 5740700, totalDisposedTonnes: 5512300, mswDisposedTonnes: 3707900, constructionDisposedTonnes: 1533000, specialDisposedTonnes: 271400 },
  { year: 2016, mswGeneratedTonnes: 5698800, totalDisposedTonnes: 5611700, mswDisposedTonnes: 3786400, constructionDisposedTonnes: 1618600, specialDisposedTonnes: 206600 },
  { year: 2017, mswGeneratedTonnes: 5748200, totalDisposedTonnes: 5663300, mswDisposedTonnes: 3917600, constructionDisposedTonnes: 1535600, specialDisposedTonnes: 210100 },
  { year: 2018, mswGeneratedTonnes: 5948700, totalDisposedTonnes: 5874900, mswDisposedTonnes: 4171100, constructionDisposedTonnes: 1489500, specialDisposedTonnes: 214300 },
  { year: 2019, mswGeneratedTonnes: 5674700, totalDisposedTonnes: 5707500, mswDisposedTonnes: 4035700, constructionDisposedTonnes: 1440100, specialDisposedTonnes: 231700 },
  { year: 2020, mswGeneratedTonnes: 5493700, totalDisposedTonnes: 5394700, mswDisposedTonnes: 3956000, constructionDisposedTonnes: 1251100, specialDisposedTonnes: 187600 },
  { year: 2021, mswGeneratedTonnes: 5986500, totalDisposedTonnes: 5669400, mswDisposedTonnes: 4145600, constructionDisposedTonnes: 1330600, specialDisposedTonnes: 193200 },
  { year: 2022, mswGeneratedTonnes: 5974700, totalDisposedTonnes: 5739800, mswDisposedTonnes: 4061900, constructionDisposedTonnes: 1506800, specialDisposedTonnes: 171100 },
  { year: 2023, mswGeneratedTonnes: 5941200, totalDisposedTonnes: 5760900, mswDisposedTonnes: 3972700, constructionDisposedTonnes: 1616100, specialDisposedTonnes: 172100 },
  { year: 2024, mswGeneratedTonnes: 5864700, totalDisposedTonnes: 5723100, mswDisposedTonnes: 3846800, constructionDisposedTonnes: 1718200, specialDisposedTonnes: 158200 },
];
