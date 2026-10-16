/**
 * i18n dictionary + helpers.
 *
 * Kept intentionally small: a flat map of keys to `[English, 中文]` tuples so
 * both languages live next to each other and can never drift apart.
 */

export type Lang = "en" | "zh";

const DICT = {
  appTitle: ["Hong Kong Waste Management 3D Map", "香港廢物管理 3D 地圖"],
  appSubtitle: ["EPD Facility Data", "環保署設施數據"],
  loading: ["Loading facility data…", "正在載入設施數據…"],
  loadError: ["Could not load facility data", "無法載入設施數據"],
  retry: ["Retry", "重試"],
  facilities: ["Facilities", "設施"],
  intakeRanking: ["Reported throughput by facility", "各設施公布處理量"],
  publishedRates: ["With published rate", "有公布處理量"],
  noSiteRate: ["No site figure", "無各站數據"],
  notPublished: ["N/A", "未公布"],
  reportedThroughput: ["Published throughput", "公布處理量"],
  notPublishedPerFacility: ["No per-facility figure is published.", "環保署並無公布各設施的處理量。"],
  remainingVoidCapacity: ["Remaining landfill void", "堆填區剩餘容量"],
  voidNotThroughput: ["Remaining void volume; not a daily tonnage.", "剩餘堆填空間體積，並非每日處理量。"],
  designCapacityNote: ["Published design treatment capacity.", "公布的設計處理量。"],
  openingHours: ["Opening hours", "開放時間"],
  coordinates: ["Coordinates", "座標"],
  collapse: ["Collapse", "收起"],
  expand: ["Expand", "展開"],

  // Group quick-filters on the intake card
  groupAll: ["All", "全部"],
  groupLandfills: ["Landfills", "堆填區"],
  groupRts: ["RTS", "轉運站"],
  groupParks: ["Parks", "公園設施"],

  // Font-size control
  fontSmaller: ["Decrease font size", "縮小字體"],
  fontLarger: ["Increase font size", "放大字體"],

  // OITF group row in the intake card
  oitfShort: ["Outlying Islands Transfer Facilities", "離島廢物轉運設施"],
  oitfStations: ["stations", "個轉運設施"],
  expandGroup: ["Show substations", "展開各轉運設施"],
  collapseGroup: ["Hide substations", "收起各轉運設施"],

  // "i" info popover
  infoTitle: ["About this map", "關於此地圖"],
  infoOpen: ["Map information", "地圖資訊"],
  infoMapData: ["Map data", "地圖數據"],
  infoTech: ["Technology", "技術"],
  infoData: ["Data", "數據"],
  infoMapLibre: [
    "MapLibre GL — open-source map renderer. Draws the basemap and handles panning, zooming and the tilted 3D camera.",
    "MapLibre GL — 開源地圖渲染引擎。負責繪製底圖，以及平移、縮放與 3D 傾斜視角。",
  ],
  infoDeckGl: [
    "deck.gl — WebGL data-visualisation layers. Draws the 3D facility pillars (height reflects published throughput where available; colour identifies facility type) and the selected-site pin.",
    "deck.gl — WebGL 數據可視化圖層。負責繪製 3D 設施柱狀標記（高度按已公布處理量顯示；顏色代表設施類別）及所選設施圖釘。",
  ],
  infoAttributionSatellite: [
    "Imagery © Esri, Maxar, Earthstar Geographics",
    "影像 © Esri、Maxar、Earthstar Geographics",
  ],
  infoAttributionOfficial: [
    "© Lands Department, HKSAR Government",
    "© 香港特別行政區政府地政總署",
  ],
  infoDataNote: [
    "Facility coordinates, names, addresses and published throughput are from EPD. Seven OITF sites have no per-site rate; the group row shows EPD's combined ~90 tpd. Historical chart is territory-wide annual data, not facility history.",
    "設施位置、名稱、地址及已公布處理量取自環保署。七個離島設施均無各站處理量；群組列顯示環保署公布的合計約每日 90 公噸。歷史圖表為全港年度數據，並非個別設施紀錄。",
  ],
  territoryTrend: ["Hong Kong-wide annual waste disposal", "全港年度廢物棄置量"],
  hkWideTrendSub: [
    "All of Hong Kong combined — every landfill, transfer station and recovery facility. Not any single facility's data.",
    "全港合計——包括所有堆填區、轉運站及回收設施，並非個別設施的數據。",
  ],
  territoryTrendNote: ["Territory-wide EPD data, not facility-level history · 2009–2024", "環保署全港數據，並非個別設施歷史 · 2009–2024年"],
  mswGenerated: ["MSW generated", "都市固體廢物產生量"],
  mswDisposed: ["Municipal solid waste", "都市固體廢物"],
  constructionDisposed: ["Construction waste", "建築廢物"],
  specialDisposed: ["Special waste", "特殊廢物"],
  tonnesPerYear: ["tonnes/year", "公噸／年"],
  noFacilityHistory: ["EPD does not publish annual throughput history by facility.", "環保署並無公布個別設施的年度處理量歷史數據。"],
  tpd: ["tpd", "公噸／日"],
  satellite: ["Satellite", "衛星圖"],
  officialMap: ["Official", "官方"],
  officialMapFull: [
    "Lands Department Official Map",
    "地政總署官方地圖",
  ],
  oitfGroup: ["Outlying Islands Transfer Facilities", "離島廢物轉運設施"],
  layers: ["Layers", "圖層"],
  filters: ["Filter", "篩選"],
  all: ["All", "全部"],
  legend: ["Legend", "圖例"],
  showLegend: ["Show legend", "顯示圖例"],
  hideLegend: ["Hide legend", "隱藏圖例"],
  heightByThroughput: ["Pillar height = published throughput; short marker = no site figure", "柱高＝已公布處理量；短柱＝未公布各站數據"],
  colourByCategory: ["Pillar colour = facility type", "柱色＝設施類別"],
  clickHint: ["Click a pillar for facility detail", "點擊柱狀標記查看設施詳情"],
  resetView: ["Reset view", "重設視角"],
  designCapacity: ["Design capacity", "設計處理量"],
  year: ["Year", "年份"],
  location: ["Location", "位置"],
  operator: ["Operator", "營運機構"],
  commissioned: ["Commissioned", "啟用年份"],
  operationalNote: ["Operational note", "運作備註"],
  detail: ["Detail", "詳細資料"],
  showDetail: ["Show facility detail", "顯示設施詳情"],
  hideDetail: ["Hide facility detail", "收起設施詳情"],
  facilityDetails: ["Facility detail", "設施詳情"],
  contractor: ["Contractor", "承建商"],
  capitalCost: ["Initial capital cost", "最初造價"],
  wasteDeliveredTo: ["Waste delivered to", "廢物運往"],
  wasteTypes: ["Waste types received", "接收廢物類別"],
  area: ["Area", "面積"],
  aftercare: ["Aftercare period", "後期護理期"],
  majorPlant: ["Major plant / equipment", "主要機器及設備"],
  otherFacilities: ["Other facilities", "其他設施"],
  epdFacilityPage: ["EPD facility page", "環保署設施頁面"],
  close: ["Close", "關閉"],
  dataNote: ["Data note", "數據說明"],
  noFacilities: ["No facilities match this filter", "沒有符合篩選條件的設施"],
  language: ["Language", "語言"],
  mapStyle: ["Map style", "地圖樣式"],
} as const;

export type DictKey = keyof typeof DICT;

export function t(key: DictKey, lang: Lang): string {
  const entry = DICT[key];
  return lang === "zh" ? entry[1] : entry[0];
}

/** Pick the right field off a bilingual record. */
export function pick(
  lang: Lang,
  en: string | undefined,
  zh: string | undefined
): string {
  if (lang === "zh") return zh || en || "";
  return en || zh || "";
}
