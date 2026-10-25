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

  // Short labels for the phone bottom dock. The full card titles ("Reported
  // throughput by facility", "Hong Kong-wide annual waste disposal") are far
  // too long to sit side by side in a tab bar.
  dockFacility: ["Facility", "設施"],
  dockLegend: ["Legend", "圖例"],
  dockTrend: ["Trend", "趨勢"],
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

  // Phone header: two disclosures, so the opening view is just the title.
  // `displayOptions` labels the pill that hides the font / map / language /
  // reset toolbar; `facilityFigures` labels the chevron that reveals the
  // Facilities / published-rate / no-figure counts.
  displayOptions: ["Display options", "顯示選項"],
  facilityFigures: ["Facility figures", "設施數字"],

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
    "deck.gl — WebGL data-visualisation layers. Draws the 3D facility pillars (height reflects published throughput where available; colour identifies each facility) and the selected-site pin.",
    "deck.gl — WebGL 數據可視化圖層。負責繪製 3D 設施柱狀標記（高度按已公布處理量顯示；顏色代表各設施）及所選設施圖釘。",
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
  colourByCategory: ["Pillar colour = each facility", "柱色＝各設施"],
  /**
   * The two lines above, run together. The legend is a panel over the map, so
   * every line of prose it carries costs map: one sentence doing the work of
   * two keeps the same information in half the height.
   */
  legendPillarNote: [
    "Pillar height = published throughput (short marker = no site figure); colour = each facility",
    "柱高＝已公布處理量（短柱＝未公布各站數據）；柱色＝各設施",
  ],
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
  officialWebsite: ["Official website", "官方網站"],
  close: ["Close", "關閉"],
  noFacilities: ["No facilities match this filter", "沒有符合篩選條件的設施"],
  language: ["Language", "語言"],
  mapStyle: ["Map style", "地圖樣式"],

  // Weighbridge records — measured station intake, a different source from the
  // EPD facility register. Kept in its own labelled block so the two are never
  // read as one.
  weighbridgeTitle: ["Weighbridge records", "地磅記錄"],
  weighbridgeSubtitle: ["Measured intake", "實測接收量"],
  weighbridgePeriod: ["Period", "期間"],

  // The Per day / Total switch rescales every figure in the block, so the tile
  // labels change with it rather than reading "total" next to an average.
  wbModePerDay: ["Per day", "每日"],
  wbModeTotal: ["Total", "總計"],
  wbMswTotal: ["Total received (MSW)", "總接收量（都市固體廢物）"],
  wbGtwTotal: ["Total received (GTW)", "總接收量（隔油池廢物）"],
  wbMswPerDay: ["MSW per day", "每日都市固體廢物"],
  wbGtwPerDay: ["GTW per day", "每日隔油池廢物"],

  // Date window. Every figure in the block is re-derived from it, so the
  // available range is stated rather than left for the reader to discover by
  // finding that the picker will not go back any further.
  wbFrom: ["From", "由"],
  wbTo: ["To", "至"],
  wbFullPeriod: ["Full period", "全期"],
  wbAvailable: ["Data available", "可用數據"],
  wbDaysShort: ["days", "日"],

  // The intake chart: one line per delivery stream, bucketed by period.
  weighbridgeDaily: ["Waste intake", "廢物接收量"],
  wbGranularity: ["Chart period", "圖表期間"],
  wbBucketDay: ["Day", "日"],
  wbBucketMonth: ["Month", "月"],
  wbBucketQuarter: ["Qtr", "季"],
  wbBucketYear: ["Year", "年"],
  wbNoData: ["No weigh-ins in this period.", "此期間沒有過磅記錄。"],
  wbCaptionDay: ["Tonnes per day, by delivery stream.", "每日接收量，按來源類別劃分。"],
  wbCaptionMonth: ["Tonnes per month, by delivery stream.", "每月接收量，按來源類別劃分。"],
  wbCaptionQuarter: ["Tonnes per quarter, by delivery stream.", "每季接收量，按來源類別劃分。"],
  wbCaptionYear: ["Tonnes per year, by delivery stream.", "每年接收量，按來源類別劃分。"],
  weighbridgeStreams: ["Who delivers it", "來源類別"],
  // Bar/pie switch on the streams block. Icons carry the meaning; these strings
  // are the accessible name and the hover tooltip.
  wbChartBar: ["Show as bars", "以柱狀顯示"],
  wbChartPie: ["Show as a pie", "以圓餅顯示"],
  // The pie is drawn over MSW only — grease trap waste is its own stream and
  // would otherwise be a second, unrelated quantity in the same proportions.
  wbPieMsw: ["MSW", "都市固體廢物"],
  wbPieExcludesGtw: [
    "Shares of MSW only — grease trap waste excluded.",
    "只計算都市固體廢物，不包括隔油池廢物。",
  ],
  weighbridgeWasteTypes: ["Waste type", "廢物類別"],
  weighbridgeDistricts: ["Source district", "來源地區"],
  weighbridgeGtwNote: [
    "WKTS is the only transfer station that takes grease trap waste.",
    "西九龍轉運站是唯一接收隔油池廢物的轉運站。",
  ],
  weighbridgeExcluded: [
    "Excluded: {n} cancelled or rejected weigh-ins.",
    "已剔除：{n} 筆取消或拒絕的過磅記錄。",
  ],
  streamPrivate: ["Private vehicles", "私人車"],
  streamPublic: ["FEHD / public", "食環署"],
  streamGtw: ["Grease trap waste", "隔油池廢物"],
  tonnes: ["tonnes", "公噸"],
  loadsUnit: ["loads", "車次"],
  loadsPerDayUnit: ["loads/d", "車次／日"],

  // Shown when the default drawer view has nothing to draw: the EPD figures
  // now live behind the Detail toggle, so without this the drawer body would
  // be blank for the 18 facilities that publish no weighbridge records.
  detailHint: [
    "Published throughput, design capacity and facility details are behind Detail.",
    "公布處理量、設計處理量及設施詳情收於「詳細資料」內。",
  ],

  // Vessel overlay. Off by default — this is a map of facilities first, so the
  // two ships in the harbour are something the user asks for rather than
  // something that lands on the map uninvited.
  vessels: ["Vessels", "船隻"],
  vesselsHint: [
    "Choose which vessels to show on the map",
    "選擇要在地圖上顯示的船隻",
  ],
  vesselsNone: ["No vessel shown", "未顯示船隻"],
  vesselsShowAll: ["Show all", "全部顯示"],
  /**
   * `vesselRoute` / `vesselRouteNeedsVessel` are no longer rendered: the route
   * is opened by clicking a ship, not by a switch in the legend. Kept because
   * the wording is still the right label for the feature if it ever needs one
   * again, and removing a key is a bigger change than leaving it.
   */
  vesselRoute: ["Last sailing route (AIS)", "上次航行航線 (AIS)"],
  vesselRouteNeedsVessel: [
    "Switch a vessel on first — the route is drawn only for the vessels you selected.",
    "請先開啟船隻：航線只會為你選取的船隻繪畫。",
  ],
  timeSearch: ["Time search", "時間搜尋"],
  timeFrom: ["From", "由"],
  timeTo: ["To", "至"],
  timeReset: ["Whole recording", "整段記錄"],
  timeEmpty: ["No AIS reports in this window", "此時間範圍內沒有 AIS 匯報"],
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
