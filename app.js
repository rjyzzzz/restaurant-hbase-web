(function () {
  "use strict";

  // 28 个品类的语义区分色板（按编码顺序列前高频品类高亮色）
  const CATEGORY_COLORS = {
    "快餐": "#64748b",
    "甜点": "#f472b6",
    "美食": "#38bdf8",
    "浙菜": "#2dd4bf",
    "西餐": "#a78bfa",
    "啡厅": "#fbbf24",
    "川菜": "#f97316",
    "火锅": "#ef4444",
    "烧烤": "#fb923c",
    "本菜": "#10b981",
    "粤菜": "#0ea5e9",
    "海鲜": "#00e5ff",
    "湘菜": "#f43f5e",
    "北菜": "#84cc16",
    "龙虾": "#ff5722",
    "料理": "#fb7185",
    "常菜": "#22c55e",
    "蟹宴": "#eab308",
    "亚菜": "#c084fc",
    "助餐": "#34d399",
    "湾菜": "#60a5fa",
    "疆菜": "#facc15",
    "素菜": "#4ade80",
    "西菜": "#818cf8",
    "南菜": "#fdba74",
    "州菜": "#94a3b8",
    "面馆": "#cbd5e1",
    "午茶": "#e879f9",
  };

  const FALLBACK_PALETTE = [
    "#38bdf8", "#f472b6", "#34d399", "#fbbf24", "#a78bfa",
    "#fb7185", "#2dd4bf", "#f97316", "#84cc16", "#60a5fa",
  ];

  // UI 友好名称映射（* 表示结合截断规律、价位与空间分布推断；HBase Cell 原值保持不变）
  const CATEGORY_DISPLAY_MAP = {
    "啡厅": "咖啡厅 (啡厅)",
    "常菜": "家常菜 (常菜)",
    "助餐": "自助餐 (助餐)",
    "亚菜": "东南亚菜 (亚菜)",
    "湾菜": "台湾菜 (湾菜)",
    "疆菜": "新疆菜 (疆菜)",
    "午茶": "下午茶 (午茶)",
    "本菜": "日本菜* (本菜)",
    "料理": "韩国料理* (料理)",
    "浙菜": "本帮江浙菜* (浙菜)",
  };

  const CATEGORY_TOOLTIP_MAP = {
    "本菜": "原始截断值：本菜。据最后2字截断规则、人均中位111元及古北高集聚推断为「日本菜」",
    "料理": "原始截断值：料理。据虹泉路韩国街1.5km圈内占比15.95%(圈外2.24%)推断为「韩国料理」",
    "浙菜": "原始截断值：浙菜。据平台一级分类与本地占比特征推断包含「本帮江浙菜」",
    "北菜": "原始 2 字截断简写，含义待考（可能为东北菜/西北菜）",
    "西菜": "原始 2 字截断简写，含义待考（可能为江西菜/陕西菜/广西菜）",
    "南菜": "原始 2 字截断简写，含义待考（可能为云南菜/湖南菜）",
    "州菜": "原始 2 字截断简写，含义待考（可能为贵州菜/杭州菜/潮州菜）",
  };

  function displayCat(raw) {
    return CATEGORY_DISPLAY_MAP[raw] || raw;
  }

  // 原始数据集保留截断原值，搜索时补充全称与常见别名
  const CATEGORY_SEARCH_ALIASES = {
    "快餐": "小吃快餐",
    "甜点": "面包甜点",
    "美食": "其他美食",
    "浙菜": "本帮江浙菜 本帮菜 浙江菜",
    "啡厅": "咖啡 咖啡厅",
    "本菜": "日本菜 日料 日本料理",
    "北菜": "东北菜 西北菜",
    "龙虾": "小龙虾",
    "料理": "韩国料理 韩餐 韩国菜",
    "常菜": "家常菜",
    "亚菜": "东南亚菜",
    "助餐": "自助餐",
    "湾菜": "台湾菜",
    "疆菜": "新疆菜",
    "西菜": "江西菜 陕西菜 广西菜",
    "南菜": "云南菜 湖南菜",
    "州菜": "贵州菜 杭州菜 潮州菜",
    "午茶": "下午茶",
  };

  // 默认上海中心视野
  const DEFAULT_VIEW = { lng: 121.4737, lat: 31.2104, zoom: 10.6 };

  const state = {
    meta: null,
    districts: [],
    categories: [],
    priceLevels: [],
    districtCounts: [],
    categoryCounts: [],
    landmarks: [],
    records: [], // [rowkey, dIdx, cIdx, price, reviews, plIdx, usable, lng, lat]
    catColors: [],
    districtCentroids: [],

    // 过滤状态（空 Set 表示全部）
    selectedDistricts: new Set(),
    selectedCategories: new Set(),
    selectedPriceLevels: new Set(),
    minPrice: null,
    maxPrice: null,
    minReviews: null,
    usableOnly: false,

    // 显示选项
    displayMode: "highlight", // "highlight" | "only"
    autoFit: true,
    showLandmarks: true,
    showLabels: true,
    pointRadius: 3.0,
    basemap: "amap_dark",

    // 相机与交互
    view: { ...DEFAULT_VIEW },
    animTarget: null,
    dragging: false,
    dragMoved: false,
    lastMouse: { x: 0, y: 0 },
    hoverIdx: -1,
    selectedIdx: -1,
    isStaticHost: false,
    legendShowAll: false,

    // 缓存命中与屏幕坐标，供 O(N) 快速拾取与零开销投影
    matchedMask: null, // Uint8Array
    matchedCount: 0,
    normX: null, // Float64Array (z=0 归一化 X)
    normY: null, // Float64Array (z=0 归一化 Y)
    screenX: null, // Float32Array
    screenY: null, // Float32Array
    catBuckets: [],
    fgStamp: null,
    bgStamp: null,
    stampCap: 0,
    stampId: 0,
    isInteracting: false,
    interactTimer: 0,
    lastTileViewKey: "",
    tileCache: new Map(),
    tilesOfflineWarned: false,
  };

  const dom = {};

  function $(id) {
    return document.getElementById(id);
  }

  // ==================== 投影数学 (EPSG:3857) ====================
  function lngToWorldX(lng, zoom) {
    const scale = 256 * Math.pow(2, zoom);
    return ((lng + 180) / 360) * scale;
  }

  function latToWorldY(lat, zoom) {
    const clamped = Math.max(-85.0511, Math.min(85.0511, lat));
    const rad = (clamped * Math.PI) / 180;
    const s = Math.sin(rad);
    const scale = 256 * Math.pow(2, zoom);
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale;
  }

  function worldXToLng(wx, zoom) {
    const scale = 256 * Math.pow(2, zoom);
    return (wx / scale) * 360 - 180;
  }

  function worldYToLat(wy, zoom) {
    const scale = 256 * Math.pow(2, zoom);
    const n = Math.PI - (2 * Math.PI * wy) / scale;
    return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  }

  function metersPerPixel(lat, zoom) {
    return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
  }

  function inShanghaiBox(lng, lat) {
    return lng >= 120.8 && lng <= 122.2 && lat >= 30.6 && lat <= 31.9;
  }

  // 数据集与 4 处地标均为 WGS-84；高德底图使用 GCJ-02，绘制时自动纠偏对齐（原始 Cell 值保持不变）
  function wgs84ToGcj02(lng, lat) {
    if (lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271) {
      return [lng, lat];
    }
    const a = 6378245.0;
    const ee = 0.00669342162296594323;
    const x = lng - 105.0;
    const y = lat - 35.0;
    let dLat = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    dLat += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
    dLat += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
    dLat += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320.0 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;

    let dLng = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    dLng += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
    dLng += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
    dLng += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0;

    const radLat = (lat / 180.0) * Math.PI;
    let magic = Math.sin(radLat);
    magic = 1 - ee * magic * magic;
    const sqrtMagic = Math.sqrt(magic);
    dLat = (dLat * 180.0) / (((a * (1 - ee)) / (magic * sqrtMagic)) * Math.PI);
    dLng = (dLng * 180.0) / ((a / sqrtMagic) * Math.cos(radLat) * Math.PI);
    return [lng + dLng, lat + dLat];
  }

  function needsGcj02() {
    return state.basemap === "amap_dark" || state.basemap === "amap_light";
  }

  function toMapCoord(lng, lat) {
    return needsGcj02() ? wgs84ToGcj02(lng, lat) : [lng, lat];
  }

  function setMobileTab(tab) {
    document.body.dataset.mobileTab = tab;
    document.querySelectorAll(".mobile-tab-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === tab);
    });
    if (tab === "map") {
      requestDraw();
    }
  }

  function setLegendCollapsed(collapsed) {
    dom.legendItems.style.display = collapsed ? "none" : "flex";
    if (dom.mapLegend) dom.mapLegend.classList.toggle("is-collapsed", collapsed);
    if (dom.btnLegendToggle) dom.btnLegendToggle.textContent = collapsed ? "展开" : "收起";
    if (dom.btnLegendAll) dom.btnLegendAll.hidden = collapsed;
  }

  function hideMobileBanner() {
    const banner = $("mobile-pick-banner");
    if (banner) banner.hidden = true;
    if (dom.mapStage) dom.mapStage.classList.remove("has-pick-banner");
  }

  // ==================== 初始化 ====================
  async function init() {
    document.body.dataset.mobileTab = "map";
    cacheDom();
    bindEvents();

    if (window.innerWidth <= 900) {
      setLegendCollapsed(true);
    }

    try {
      let dataResp = await fetch("data/restaurants_compact.json").catch(() => null);
      if (!dataResp || !dataResp.ok) {
        dataResp = await fetch("/api/data.json");
      }
      if (!dataResp.ok) {
        throw new Error(`HTTP ${dataResp.status}`);
      }
      const isLocalHost =
        window.location.hostname === "127.0.0.1" ||
        window.location.hostname === "localhost";
      const statusResp = isLocalHost
        ? await fetch("/api/status").catch(() => null)
        : null;
      const payload = await dataResp.json();
      loadPayload(payload);

      if (statusResp && statusResp.ok) {
        state.isStaticHost = false;
        const st = await statusResp.json();
        updateHBaseStatus(st);
      } else {
        state.isStaticHost = true;
        dom.hbaseStatus.textContent = `静态托管快照 · ${state.records.length.toLocaleString()} 条`;
        const liveBtn = $("btn-live-get");
        if (liveBtn) {
          liveBtn.textContent = "仅支持快照";
          liveBtn.title = "当前为静态托管快照（hbase.wogress.site），仅在本地运行 server.py + HBase 时支持实时 Get";
        }
      }
    } catch (err) {
      dom.loadingOverlay.innerHTML = `<div style="color:#fda4af">加载失败：${err.message}</div>`;
      return;
    }

    dom.loadingOverlay.style.display = "none";
    resizeCanvas();
    applyFilters("none");
    // 默认选中一个典型点位（优先找宝山海鲜或有价格记录）方便右侧直接展示
    const demoIdx = state.records.findIndex(
      (r) => state.districts[r[1]] === "宝山区" && state.categories[r[2]] === "海鲜" && r[3] > 0
    );
    if (demoIdx >= 0) {
      selectRecord(demoIdx, false);
    } else if (state.records.length > 0) {
      selectRecord(0, false);
    }
    requestDraw();
  }

  function cacheDom() {
    dom.mapStage = $("map-stage");
    dom.tileCanvas = $("tile-canvas");
    dom.tileCtx = dom.tileCanvas.getContext("2d");
    dom.canvas = $("map-canvas");
    dom.ctx = dom.canvas.getContext("2d");
    dom.loadingOverlay = $("loading-overlay");
    dom.hbaseStatus = $("hbase-status");
    dom.basemapSelect = $("basemap-select");
    dom.districtList = $("district-list");
    dom.categoryList = $("category-list");
    dom.priceLevelList = $("price-level-list");
    dom.catSearch = $("cat-search");
    dom.inpMinPrice = $("inp-min-price");
    dom.inpMaxPrice = $("inp-max-price");
    dom.inpMinReviews = $("inp-min-reviews");
    dom.chkUsableOnly = $("chk-usable-only");
    dom.filterError = $("filter-error");
    dom.chkAutofit = $("chk-autofit");
    dom.chkLandmarks = $("chk-landmarks");
    dom.chkLabels = $("chk-labels");
    dom.rngPointSize = $("rng-point-size");
    dom.valPointSize = $("val-point-size");
    dom.hudMatched = $("hud-matched");
    dom.hudRatio = $("hud-ratio");
    dom.hudFilterDesc = $("hud-filter-desc");
    dom.hudTileNote = $("hud-tile-note");
    dom.mapLegend = $("map-legend");
    dom.legendItems = $("legend-items");
    dom.btnLegendAll = $("btn-legend-all");
    dom.btnLegendToggle = $("btn-legend-toggle");
    dom.tooltip = $("map-tooltip");
    dom.coordReadout = $("coord-readout");
    dom.scaleLabel = $("scale-label");
    dom.scaleLine = $("scale-line");
  }

  function loadPayload(payload) {
    state.meta = payload.meta || {};
    state.districts = payload.districts || [];
    state.categories = payload.categories || [];
    state.priceLevels = payload.priceLevels || [];
    state.districtCounts = payload.districtCounts || [];
    state.categoryCounts = payload.categoryCounts || [];
    state.landmarks = payload.landmarks || [];
    state.records = payload.records || [];

    const n = state.records.length;
    state.matchedMask = new Uint8Array(n);
    state.normX = new Float64Array(n);
    state.normY = new Float64Array(n);
    state.screenX = new Float32Array(n);
    state.screenY = new Float32Array(n);
    state.catBuckets = state.categories.map(() => []);

    recomputeProjectionCoords();
    updateBasemapClasses();

    state.catColors = state.categories.map(
      (c, i) => CATEGORY_COLORS[c] || FALLBACK_PALETTE[i % FALLBACK_PALETTE.length]
    );

    // 计算各区真实坐标中心（剔除上海框外极端点）
    const sumLng = new Float64Array(state.districts.length);
    const sumLat = new Float64Array(state.districts.length);
    const cnt = new Int32Array(state.districts.length);
    for (let i = 0; i < n; i++) {
      const r = state.records[i];
      if (inShanghaiBox(r[7], r[8])) {
        sumLng[r[1]] += r[7];
        sumLat[r[1]] += r[8];
        cnt[r[1]]++;
      }
    }
    state.districtCentroids = state.districts.map((name, i) => ({
      name,
      count: state.districtCounts[i] || 0,
      lng: cnt[i] ? sumLng[i] / cnt[i] : 121.47,
      lat: cnt[i] ? sumLat[i] / cnt[i] : 31.23,
    }));

    const outN = state.meta.outside_shanghai_coords || 0;
    dom.hudTileNote.textContent = `视野：上海市域（另有 ${outN} 条跨省漂移坐标）`;

    renderFilterChips();
    renderLegend();
  }

  function recomputeProjectionCoords() {
    const n = state.records.length;
    const useGcj = needsGcj02();
    for (let i = 0; i < n; i++) {
      const r = state.records[i];
      let lng = r[7];
      let lat = r[8];
      if (useGcj) {
        const g = wgs84ToGcj02(lng, lat);
        lng = g[0];
        lat = g[1];
      }
      state.normX[i] = (lng + 180) / 360;
      const clamped = Math.max(-85.0511, Math.min(85.0511, lat));
      const s = Math.sin((clamped * Math.PI) / 180);
      state.normY[i] = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
    }
  }

  function updateHBaseStatus(st) {
    const total = (st.meta && st.meta.total) || state.records.length;
    if (st.hbase && st.hbase.zk2181) {
      dom.hbaseStatus.textContent = `HBase 在线 · ${total.toLocaleString()} 条`;
      dom.hbaseStatus.classList.add("live");
    } else {
      dom.hbaseStatus.textContent = `HBase 导出快照 · ${total.toLocaleString()} 条`;
      dom.hbaseStatus.classList.remove("live");
    }
  }

  // ==================== 渲染筛选 Chips 与图例 ====================
  function renderFilterChips() {
    dom.districtList.innerHTML = "";
    state.districts.forEach((d, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip";
      btn.dataset.idx = idx;
      btn.innerHTML = `<span>${d}</span><span class="cnt">${state.districtCounts[idx].toLocaleString()}</span>`;
      btn.addEventListener("click", () => {
        toggleSetItem(state.selectedDistricts, idx);
        clearPresetActive();
        syncChipSelections();
        applyFilters(state.autoFit ? "auto" : "none");
      });
      dom.districtList.appendChild(btn);
    });

    renderCategoryChips();

    dom.priceLevelList.innerHTML = "";
    state.priceLevels.forEach((pl, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip";
      btn.dataset.idx = idx;
      btn.textContent = pl;
      btn.addEventListener("click", () => {
        toggleSetItem(state.selectedPriceLevels, idx);
        clearPresetActive();
        syncChipSelections();
        applyFilters("none");
      });
      dom.priceLevelList.appendChild(btn);
    });
  }

  function renderCategoryChips() {
    const q = dom.catSearch.value.trim().toLowerCase();
    dom.categoryList.innerHTML = "";
    state.categories.forEach((c, idx) => {
      const label = displayCat(c);
      const alias = CATEGORY_SEARCH_ALIASES[c] || "";
      if (q && !c.toLowerCase().includes(q) && !label.toLowerCase().includes(q) && !alias.toLowerCase().includes(q)) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip" + (state.selectedCategories.has(idx) ? " selected" : "");
      btn.dataset.idx = idx;
      if (CATEGORY_TOOLTIP_MAP[c]) btn.title = CATEGORY_TOOLTIP_MAP[c];
      btn.innerHTML = `<span class="color-dot" style="background:${state.catColors[idx]}"></span>` +
        `<span>${label}</span><span class="cnt">${state.categoryCounts[idx].toLocaleString()}</span>`;
      btn.addEventListener("click", () => {
        toggleSetItem(state.selectedCategories, idx);
        clearPresetActive();
        syncChipSelections();
        applyFilters(state.autoFit ? "auto" : "none");
      });
      dom.categoryList.appendChild(btn);
    });
  }

  function renderLegend() {
    dom.legendItems.innerHTML = "";
    const limit = state.legendShowAll ? state.categories.length : Math.min(14, state.categories.length);
    for (let idx = 0; idx < limit; idx++) {
      const raw = state.categories[idx];
      const item = document.createElement("span");
      item.className = "legend-item";
      item.dataset.idx = idx;
      if (CATEGORY_TOOLTIP_MAP[raw]) item.title = CATEGORY_TOOLTIP_MAP[raw];
      item.innerHTML = `<span class="color-dot" style="background:${state.catColors[idx]}"></span>${displayCat(raw)}`;
      item.addEventListener("click", () => {
        if (state.selectedCategories.size === 1 && state.selectedCategories.has(idx)) {
          state.selectedCategories.clear();
        } else {
          state.selectedCategories = new Set([idx]);
        }
        clearPresetActive();
        syncChipSelections();
        applyFilters("none");
      });
      dom.legendItems.appendChild(item);
    }
    if (dom.btnLegendAll) {
      dom.btnLegendAll.textContent = state.legendShowAll ? "仅前14类" : `全部${state.categories.length}类`;
    }
    syncChipSelections();
  }

  function syncChipSelections() {
    dom.districtList.querySelectorAll(".chip").forEach((el) => {
      el.classList.toggle("selected", state.selectedDistricts.has(Number(el.dataset.idx)));
    });
    dom.categoryList.querySelectorAll(".chip").forEach((el) => {
      el.classList.toggle("selected", state.selectedCategories.has(Number(el.dataset.idx)));
    });
    dom.priceLevelList.querySelectorAll(".chip").forEach((el) => {
      el.classList.toggle("selected", state.selectedPriceLevels.has(Number(el.dataset.idx)));
    });
    const hasCatFilter = state.selectedCategories.size > 0;
    dom.legendItems.querySelectorAll(".legend-item").forEach((el) => {
      const idx = Number(el.dataset.idx);
      el.classList.toggle("dim", hasCatFilter && !state.selectedCategories.has(idx));
    });
  }

  function toggleSetItem(set, val) {
    if (set.has(val)) set.delete(val);
    else set.add(val);
  }

  // ==================== 核心过滤与实时统计 ====================
  function applyFilters(fitMode = "none") {
    const useDist = state.selectedDistricts.size > 0;
    const useCat = state.selectedCategories.size > 0;
    const usePL = state.selectedPriceLevels.size > 0;
    const minP = state.minPrice;
    const maxP = state.maxPrice;
    const minR = state.minReviews;
    const usableOnly = state.usableOnly;

    const n = state.records.length;
    const mask = state.matchedMask;
    let count = 0;

    // 统计收集器
    const plBins = new Int32Array(state.priceLevels.length);
    const catHit = new Int32Array(state.categories.length);
    const distHit = new Int32Array(state.districts.length);
    const usablePrices = [];
    let usableSum = 0;
    let usableMax = 0;

    let minLng = 999, maxLng = -999, minLat = 999, maxLat = -999;
    let shBoxMatched = 0;
    let bestMatchedIdx = -1;
    let bestScore = -1;

    for (let i = 0; i < n; i++) {
      const r = state.records[i];
      if (useDist && !state.selectedDistricts.has(r[1])) { mask[i] = 0; continue; }
      if (useCat && !state.selectedCategories.has(r[2])) { mask[i] = 0; continue; }
      if (usePL && !state.selectedPriceLevels.has(r[5])) { mask[i] = 0; continue; }
      if (minP !== null && r[3] < minP) { mask[i] = 0; continue; }
      if (maxP !== null && (r[3] <= 0 || r[3] > maxP)) { mask[i] = 0; continue; }
      if (minR !== null && r[4] < minR) { mask[i] = 0; continue; }
      if (usableOnly && r[6] !== 1) { mask[i] = 0; continue; }

      mask[i] = 1;
      count++;
      plBins[r[5]]++;
      catHit[r[2]]++;
      distHit[r[1]]++;

      const score = (r[3] > 0 ? 1000000 : 0) + r[4];
      if (score > bestScore) {
        bestScore = score;
        bestMatchedIdx = i;
      }

      if (r[6] === 1 && r[3] > 0) {
        usablePrices.push(r[3]);
        usableSum += r[3];
        if (r[3] > usableMax) usableMax = r[3];
      }

      if (inShanghaiBox(r[7], r[8])) {
        shBoxMatched++;
        if (r[7] < minLng) minLng = r[7];
        if (r[7] > maxLng) maxLng = r[7];
        if (r[8] < minLat) minLat = r[8];
        if (r[8] > maxLat) maxLat = r[8];
      }
    }

    state.matchedCount = count;
    updateHudAndStats(count, plBins, catHit, distHit, usablePrices, usableSum, usableMax);

    // 若原选中点已被当前筛选排除，则同步切换详情面板并收起旧浮条
    if (state.selectedIdx < 0 || mask[state.selectedIdx] !== 1) {
      hideMobileBanner();
      if (bestMatchedIdx >= 0) {
        selectRecord(bestMatchedIdx, false);
      } else {
        state.selectedIdx = -1;
        $("inspector-empty").hidden = false;
        $("inspector-body").hidden = true;
      }
    }

    if (shBoxMatched > 0 && (fitMode === "force" || (fitMode === "auto" && count < n))) {
      fitBounds(minLng, minLat, maxLng, maxLat);
    }

    requestDraw();
  }

  function updateHudAndStats(count, plBins, catHit, distHit, usablePrices, usableSum, usableMax) {
    const total = state.records.length || 1;
    const pct = ((count / total) * 100).toFixed(count < 100 ? 2 : 1);
    dom.hudMatched.textContent = count.toLocaleString();
    dom.hudRatio.textContent = `/ ${total.toLocaleString()} 条 (${pct}%)`;

    const dDesc = state.selectedDistricts.size === 0 || state.selectedDistricts.size === state.districts.length
      ? "全部行政区"
      : [...state.selectedDistricts].map((i) => state.districts[i]).join("、");
    const cDesc = state.selectedCategories.size === 0 || state.selectedCategories.size === state.categories.length
      ? "全部菜系"
      : [...state.selectedCategories].map((i) => displayCat(state.categories[i])).join("、");
    const extraParts = [];
    if (state.selectedPriceLevels.size > 0 && state.selectedPriceLevels.size < state.priceLevels.length) {
      extraParts.push([...state.selectedPriceLevels].map((i) => state.priceLevels[i]).join("/"));
    }
    if (state.minPrice !== null || state.maxPrice !== null) {
      const lo = state.minPrice !== null ? state.minPrice : 0;
      const hi = state.maxPrice !== null ? state.maxPrice : "不限";
      extraParts.push(`人均${lo}~${hi}元`);
    }
    if (state.minReviews !== null) {
      extraParts.push(`点评≥${state.minReviews}`);
    }
    if (state.usableOnly) {
      extraParts.push("仅有效样本");
    }
    dom.hudFilterDesc.textContent = [dDesc, cDesc, ...extraParts].join(" · ");

    $("stat-count").textContent = count.toLocaleString();
    $("stat-share").textContent = `占全市 ${pct}%`;

    // 区位商 LQ：当选中特定区且选中单一菜系时精确计算
    const lqEl = $("stat-lq");
    const lqNote = $("stat-lq-note");
    if (state.selectedDistricts.size > 0 && state.selectedCategories.size === 1) {
      const cIdx = [...state.selectedCategories][0];
      let selDistTotal = 0;
      let selDistCat = 0;
      for (const dIdx of state.selectedDistricts) {
        selDistTotal += state.districtCounts[dIdx] || 0;
      }
      // 不受价格条件影响的原始区+菜系 LQ
      for (let i = 0; i < state.records.length; i++) {
        const r = state.records[i];
        if (state.selectedDistricts.has(r[1]) && r[2] === cIdx) selDistCat++;
      }
      const cityShare = (state.categoryCounts[cIdx] || 0) / total;
      const distShare = selDistTotal > 0 ? selDistCat / selDistTotal : 0;
      const lq = cityShare > 0 ? distShare / cityShare : 0;
      lqEl.textContent = `${lq.toFixed(2)}×`;
      lqNote.textContent = `区内 ${(distShare * 100).toFixed(2)}% ÷ 全市 ${(cityShare * 100).toFixed(2)}%`;
    } else {
      lqEl.textContent = "-";
      lqNote.textContent = "同时选「区 + 单一菜系」时计算";
    }

    // 有效样本统计
    const un = usablePrices.length;
    if (un > 0) {
      usablePrices.sort((a, b) => a - b);
      const mid = Math.floor(un / 2);
      const med = un % 2 === 1 ? usablePrices[mid] : Math.round((usablePrices[mid - 1] + usablePrices[mid]) / 2);
      $("stat-median").textContent = `${med} 元`;
      $("stat-usable-n").textContent = `有效样本 ${un.toLocaleString()} 条`;
      $("stat-mean").textContent = `${(usableSum / un).toFixed(1)} 元`;
      $("stat-max").textContent = `最高 ${usableMax.toLocaleString()} 元`;
    } else {
      $("stat-median").textContent = "-";
      $("stat-usable-n").textContent = "无有效消费记录";
      $("stat-mean").textContent = "-";
      $("stat-max").textContent = "-";
    }

    // 价位档条形图
    const maxPl = Math.max(1, ...plBins);
    const plHtml = state.priceLevels.map((name, idx) => {
      const v = plBins[idx];
      const w = (v / maxPl) * 100;
      return `<div class="bar-row"><span>${name}</span><div class="bar-track"><div class="bar-fill" style="width:${w}%;background:#22d3ee"></div></div><span class="bar-val">${v.toLocaleString()}</span></div>`;
    }).join("");
    $("chart-price-bars").innerHTML = plHtml;

    // 如果选了单一菜系、没选全部区，就展示按区分布；否则展示按品类 TOP 6
    const showDistTop = state.selectedCategories.size > 0 && state.selectedDistricts.size === 0;
    $("chart-top-title").textContent = showDistTop ? "命中行政区 TOP 6" : "命中菜系 TOP 6";

    const pairs = [];
    if (showDistTop) {
      for (let i = 0; i < state.districts.length; i++) {
        if (distHit[i] > 0) pairs.push({ name: state.districts[i], label: state.districts[i], val: distHit[i], color: "#38bdf8" });
      }
    } else {
      for (let i = 0; i < state.categories.length; i++) {
        if (catHit[i] > 0) {
          const raw = state.categories[i];
          pairs.push({ name: raw, label: displayCat(raw), val: catHit[i], color: state.catColors[i] });
        }
      }
    }
    pairs.sort((a, b) => b.val - a.val);
    const top6 = pairs.slice(0, 6);
    const maxTop = top6.length ? top6[0].val : 1;
    $("chart-top-bars").innerHTML = top6.length
      ? top6.map((p) => {
          const w = (p.val / maxTop) * 100;
          return `<div class="bar-row"><span title="${p.label}">${p.label}</span><div class="bar-track"><div class="bar-fill" style="width:${w}%;background:${p.color}"></div></div><span class="bar-val">${p.val.toLocaleString()}</span></div>`;
        }).join("")
      : `<div class="hint">暂无命中记录</div>`;
  }

  // ==================== 相机控制与平滑飞行 ====================
  function fitBounds(minLng, minLat, maxLng, maxLat) {
    const w = dom.canvas.clientWidth || window.innerWidth || 800;
    const h = dom.canvas.clientHeight || Math.round((window.innerHeight || 600) * 0.72);
    const padLng = Math.max(0.02, (maxLng - minLng) * 0.22);
    const padLat = Math.max(0.02, (maxLat - minLat) * 0.22);
    const [cLng, cLat] = toMapCoord((minLng + maxLng) / 2, (minLat + maxLat) / 2);

    let bestZ = 7.5;
    for (let z = 14; z >= 7.5; z -= 0.25) {
      const dx = lngToWorldX(maxLng + padLng, z) - lngToWorldX(minLng - padLng, z);
      const dy = latToWorldY(minLat - padLat, z) - latToWorldY(maxLat + padLat, z);
      if (dx <= w * 0.85 && dy <= h * 0.85) {
        bestZ = z;
        break;
      }
    }
    flyTo(cLng, cLat, Math.max(7.5, Math.min(13.8, bestZ)));
  }

  function flyTo(lng, lat, zoom) {
    state.animTarget = {
      startLng: state.view.lng,
      startLat: state.view.lat,
      startZoom: state.view.zoom,
      endLng: lng,
      endLat: lat,
      endZoom: zoom,
      t0: performance.now(),
      duration: 420,
    };
    requestDraw();
  }

  // ==================== 瓦片与 Canvas 地图渲染 ====================
  function tileUrl(provider, z, x, y) {
    if (provider === "amap_dark" || provider === "amap_light") {
      const s = ((x + y) % 4) + 1;
      return `https://webrd0${s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x=${x}&y=${y}&z=${z}`;
    }
    if (provider === "esri_street") {
      return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${z}/${y}/${x}`;
    }
    if (provider === "esri_dark") {
      return `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/${z}/${y}/${x}`;
    }
    if (provider === "esri_sat") {
      return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
    }
    return null;
  }

  function getTile(provider, z, x, y) {
    const key = `${provider}:${z}:${x}:${y}`;
    const cached = state.tileCache.get(key);
    if (cached) return cached;

    const url = tileUrl(provider, z, x, y);
    if (!url) return null;

    const entry = { img: new Image(), status: "loading" };
    entry.img.referrerPolicy = "no-referrer";
    entry.img.onload = () => {
      entry.status = "ok";
      state.lastTileViewKey = "";
      requestDraw();
    };
    entry.img.onerror = () => {
      entry.status = "err";
    };
    entry.img.src = url;

    if (state.tileCache.size > 600) {
      const firstKey = state.tileCache.keys().next().value;
      state.tileCache.delete(firstKey);
    }
    state.tileCache.set(key, entry);
    return entry;
  }

  function updateBasemapClasses() {
    if (!dom.mapStage || !dom.tileCanvas) return;
    const isLight = state.basemap === "amap_light" || state.basemap === "esri_street";
    dom.mapStage.classList.toggle("basemap-light", isLight);
    dom.tileCanvas.classList.toggle("dark-filter", state.basemap === "amap_dark");
    state.lastTileViewKey = "";
  }

  function ensureStampBuffers(gridLen) {
    if (state.stampCap < gridLen) {
      state.fgStamp = new Uint32Array(gridLen);
      state.bgStamp = new Uint32Array(gridLen);
      state.stampCap = gridLen;
      state.stampId = 0;
    }
    state.stampId++;
    if (state.stampId >= 0xfffffffe) {
      state.fgStamp.fill(0);
      state.bgStamp.fill(0);
      state.stampId = 1;
    }
    return state.stampId;
  }

  function markInteracting(autoEndMs = 0) {
    state.isInteracting = true;
    if (state.interactTimer) {
      clearTimeout(state.interactTimer);
      state.interactTimer = 0;
    }
    if (autoEndMs > 0) {
      state.interactTimer = setTimeout(() => {
        state.isInteracting = false;
        state.interactTimer = 0;
        requestDraw();
      }, autoEndMs);
    }
  }

  function maxTileZoom(provider) {
    if (provider === "esri_street") return 13;
    if (provider === "esri_dark") return 16;
    return 18;
  }

  let drawQueued = false;
  function requestDraw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(drawFrame);
  }

  function drawTilesLayer(w, h, dpr, z) {
    const tCanvas = dom.tileCanvas;
    const tCtx = dom.tileCtx;
    const targetW = Math.round(w * dpr);
    const targetH = Math.round(h * dpr);
    if (tCanvas.width !== targetW || tCanvas.height !== targetH) {
      tCanvas.width = targetW;
      tCanvas.height = targetH;
      state.lastTileViewKey = "";
    }

    const tileKey = `${state.basemap}:${w}:${h}:${dpr}:${state.view.lng.toFixed(5)}:${state.view.lat.toFixed(5)}:${z.toFixed(3)}`;
    if (state.lastTileViewKey === tileKey) return;
    state.lastTileViewKey = tileKey;

    tCtx.save();
    tCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    tCtx.clearRect(0, 0, w, h);

    if (state.basemap !== "offline") {
      const tz = Math.max(4, Math.min(maxTileZoom(state.basemap), Math.round(z)));
      const tileScale = Math.pow(2, z - tz);
      const tilePx = 256 * tileScale;
      const cTx = lngToWorldX(state.view.lng, tz);
      const cTy = latToWorldY(state.view.lat, tz);

      const minX = Math.floor((cTx - w / 2 / tileScale) / 256);
      const maxX = Math.floor((cTx + w / 2 / tileScale) / 256);
      const minY = Math.floor((cTy - h / 2 / tileScale) / 256);
      const maxY = Math.floor((cTy + h / 2 / tileScale) / 256);
      const maxTile = (1 << tz) - 1;

      for (let tx = minX; tx <= maxX; tx++) {
        if (tx < 0 || tx > maxTile) continue;
        for (let ty = minY; ty <= maxY; ty++) {
          if (ty < 0 || ty > maxTile) continue;
          const dx = w / 2 + (tx * 256 - cTx) * tileScale;
          const dy = h / 2 + (ty * 256 - cTy) * tileScale;
          const entry = getTile(state.basemap, tz, tx, ty);
          if (entry && entry.status === "ok") {
            tCtx.drawImage(entry.img, dx, dy, tilePx + 0.5, tilePx + 0.5);
          } else {
            // 新层瓦片加载中时用缓存的父级瓦片补位，避免缩放闪烁空白
            for (let dz = 1; dz <= 3 && tz - dz >= 4; dz++) {
              const pz = tz - dz;
              const div = 1 << dz;
              const pEntry = state.tileCache.get(`${state.basemap}:${pz}:${tx >> dz}:${ty >> dz}`);
              if (pEntry && pEntry.status === "ok") {
                const sub = 256 / div;
                const sx = (tx % div) * sub;
                const sy = (ty % div) * sub;
                tCtx.drawImage(pEntry.img, sx, sy, sub, sub, dx, dy, tilePx + 0.5, tilePx + 0.5);
                break;
              }
            }
          }
        }
      }
    }

    const cWx = lngToWorldX(state.view.lng, z);
    const cWy = latToWorldY(state.view.lat, z);
    drawGraticule(tCtx, w, h, z, cWx, cWy);
    tCtx.restore();
  }

  function drawFrame(now) {
    drawQueued = false;

    // 相机飞行动效
    if (state.animTarget) {
      const a = state.animTarget;
      const p = Math.min(1, (now - a.t0) / a.duration);
      const ease = 1 - Math.pow(1 - p, 3);
      state.view.lng = a.startLng + (a.endLng - a.startLng) * ease;
      state.view.lat = a.startLat + (a.endLat - a.startLat) * ease;
      state.view.zoom = a.startZoom + (a.endZoom - a.startZoom) * ease;
      if (p >= 1) state.animTarget = null;
      else requestDraw();
    }

    const canvas = dom.canvas;
    const ctx = dom.ctx;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;

    const targetW = Math.round(w * dpr);
    const targetH = Math.round(h * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    const z = state.view.zoom;
    drawTilesLayer(w, h, dpr, z);

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const worldScale = 256 * Math.pow(2, z);
    const cWx = lngToWorldX(state.view.lng, z);
    const cWy = latToWorldY(state.view.lat, z);
    const halfW = w * 0.5;
    const halfH = h * 0.5;
    const offX = halfW - cWx;
    const offY = halfH - cWy;

    // 4. 78,018 个餐饮点位绘制（预计算墨卡托 + 屏幕像素格网去重）
    const n = state.records.length;
    const mask = state.matchedMask;
    const normX = state.normX;
    const normY = state.normY;
    const sxArr = state.screenX;
    const syArr = state.screenY;
    const zoomBoost = Math.max(0.7, Math.min(1.8, (z - 9.5) * 0.22 + 0.85));
    const hiR = state.pointRadius * zoomBoost;
    const bgR = Math.max(1.0, 1.3 * zoomBoost);
    const hasFilter = state.matchedCount < n;
    const fastMode = state.isInteracting || state.animTarget !== null;

    // 屏幕格网分辨率：背景恒用 2px 格网；前景在点多或缩小/交互时启用去重
    const bgBin = 2;
    const bgGridW = Math.ceil(w / bgBin) + 1;
    const bgGridH = Math.ceil(h / bgBin) + 1;
    const fgBin = (state.matchedCount > 3000 || z < 11.2 || fastMode) ? (fastMode && state.matchedCount > 5000 ? 2 : 1) : 0;
    const fgGridW = fgBin > 0 ? Math.ceil(w / fgBin) + 1 : 1;
    const fgGridH = fgBin > 0 ? Math.ceil(h / fgBin) + 1 : 1;
    const stampId = ensureStampBuffers(Math.max(bgGridW * bgGridH, fgGridW * fgGridH));
    const bgStamp = state.bgStamp;
    const fgStamp = state.fgStamp;

    const buckets = state.catBuckets;
    for (let c = 0; c < buckets.length; c++) {
      buckets[c].length = 0;
    }

    const drawBg = state.displayMode === "highlight" && hasFilter;
    if (drawBg) {
      ctx.fillStyle = state.basemap === "amap_light" || state.basemap === "esri_street"
        ? "rgba(100, 116, 139, 0.14)"
        : "rgba(148, 163, 184, 0.13)";
      ctx.beginPath();
    }

    const rec = state.records;
    const bgHalf = bgR * 0.5;
    for (let i = 0; i < n; i++) {
      const sx = normX[i] * worldScale + offX;
      const sy = normY[i] * worldScale + offY;
      sxArr[i] = sx;
      syArr[i] = sy;

      if (sx < -8 || sx > w + 8 || sy < -8 || sy > h + 8) continue;

      if (mask[i] === 1) {
        if (fgBin > 0 && sx >= 0 && sx < w && sy >= 0 && sy < h) {
          const cell = ((sy / fgBin) | 0) * fgGridW + ((sx / fgBin) | 0);
          if (fgStamp[cell] === stampId) continue;
          fgStamp[cell] = stampId;
        }
        buckets[rec[i][2]].push(sx, sy);
      } else if (drawBg && sx >= 0 && sx < w && sy >= 0 && sy < h) {
        const cell = ((sy / bgBin) | 0) * bgGridW + ((sx / bgBin) | 0);
        if (bgStamp[cell] === stampId) continue;
        bgStamp[cell] = stampId;
        ctx.rect(sx - bgHalf, sy - bgHalf, bgR, bgR);
      }
    }
    if (drawBg) {
      ctx.fill();
    }

    const useGlow = !fastMode && hasFilter && state.matchedCount <= 6000;
    const useRect = fastMode || (hiR <= 2.2 && !hasFilter);
    for (let c = 0; c < buckets.length; c++) {
      const pts = buckets[c];
      if (pts.length === 0) continue;
      const color = state.catColors[c];

      if (useGlow) {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.22;
        ctx.beginPath();
        const glowR = hiR * 2.1;
        for (let k = 0; k < pts.length; k += 2) {
          ctx.moveTo(pts[k] + glowR, pts[k + 1]);
          ctx.arc(pts[k], pts[k + 1], glowR, 0, Math.PI * 2);
        }
        ctx.fill();
      }

      ctx.fillStyle = color;
      ctx.globalAlpha = hasFilter ? 0.92 : 0.76;
      ctx.beginPath();
      if (useRect) {
        const size = hiR * 1.45;
        const half = size * 0.5;
        for (let k = 0; k < pts.length; k += 2) {
          ctx.rect(pts[k] - half, pts[k + 1] - half, size, size);
        }
      } else {
        for (let k = 0; k < pts.length; k += 2) {
          ctx.moveTo(pts[k] + hiR, pts[k + 1]);
          ctx.arc(pts[k], pts[k + 1], hiR, 0, Math.PI * 2);
        }
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 5. 5 处地标与研究半径圈
    if (state.showLandmarks) {
      drawLandmarks(ctx, w, h, z, cWx, cWy);
    }

    // 6. 行政区标签
    if (state.showLabels) {
      drawDistrictLabels(ctx, w, h, z, cWx, cWy);
    }

    // 7. 选中/悬停圈
    if (state.selectedIdx >= 0) {
      drawFocusRing(ctx, sxArr[state.selectedIdx], syArr[state.selectedIdx], "#ffffff", hiR + 4);
    }
    if (state.hoverIdx >= 0 && state.hoverIdx !== state.selectedIdx) {
      drawFocusRing(ctx, sxArr[state.hoverIdx], syArr[state.hoverIdx], "#22d3ee", hiR + 3);
    }

    updateScaleBar(z);
    ctx.restore();
  }

  function drawGraticule(ctx, w, h, z, cWx, cWy) {
    ctx.save();
    ctx.strokeStyle = state.basemap === "offline" ? "rgba(56, 189, 248, 0.09)" : "rgba(148, 163, 184, 0.06)";
    ctx.lineWidth = 1;
    const step = z >= 12 ? 0.05 : 0.1;
    for (let lng = 120.8; lng <= 122.2; lng += step) {
      const x = w / 2 + (lngToWorldX(lng, z) - cWx);
      if (x < 0 || x > w) continue;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let lat = 30.6; lat <= 31.8; lat += step) {
      const y = h / 2 + (latToWorldY(lat, z) - cWy);
      if (y < 0 || y > h) continue;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawLandmarks(ctx, w, h, z, cWx, cWy) {
    ctx.save();
    state.landmarks.forEach((lm) => {
      const [mlng, mlat] = toMapCoord(lm.lng, lm.lat);
      const sx = w / 2 + (lngToWorldX(mlng, z) - cWx);
      const sy = h / 2 + (latToWorldY(mlat, z) - cWy);
      const rPx = (lm.radius_km * 1000) / metersPerPixel(mlat, z);

      ctx.strokeStyle = "rgba(251, 191, 36, 0.78)";
      ctx.fillStyle = "rgba(251, 191, 36, 0.06)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.arc(sx, sy, rPx, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);

      // 中心锚点
      ctx.fillStyle = "#fbbf24";
      ctx.beginPath();
      ctx.arc(sx, sy, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = "600 11px 'Microsoft YaHei', sans-serif";
      const label = `${lm.name} (${lm.radius_km}km)`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(11, 17, 32, 0.88)";
      ctx.strokeText(label, sx + 7, sy - 6);
      ctx.fillStyle = "#fde68a";
      ctx.fillText(label, sx + 7, sy - 6);
    });
    ctx.restore();
  }

  function drawDistrictLabels(ctx, w, h, z, cWx, cWy) {
    ctx.save();
    ctx.font = "600 11px 'Microsoft YaHei', sans-serif";
    ctx.textAlign = "center";
    state.districtCentroids.forEach((dc, idx) => {
      if (dc.count < 20 && z < 11.2) return;
      const [dlng, dlat] = toMapCoord(dc.lng, dc.lat);
      const sx = w / 2 + (lngToWorldX(dlng, z) - cWx);
      const sy = h / 2 + (latToWorldY(dlat, z) - cWy);
      if (sx < 20 || sx > w - 20 || sy < 20 || sy > h - 20) return;
      const isSelected = state.selectedDistricts.has(idx);
      const label = z >= 11.5 ? `${dc.name} (${dc.count})` : dc.name;
      ctx.fillStyle = "rgba(7, 13, 25, 0.72)";
      const tw = ctx.measureText(label).width;
      ctx.fillRect(sx - tw / 2 - 4, sy - 9, tw + 8, 16);
      ctx.fillStyle = isSelected ? "#7dd3fc" : "#cbd5e1";
      ctx.fillText(label, sx, sy + 3);
    });
    ctx.restore();
  }

  function drawFocusRing(ctx, x, y, color, r) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function updateScaleBar(zoom) {
    const mpp = metersPerPixel(state.view.lat, zoom);
    const targetM = mpp * 75;
    const steps = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
    let best = steps[0];
    for (const s of steps) {
      if (s <= targetM * 1.4) best = s;
    }
    dom.scaleLine.style.width = `${Math.round(best / mpp)}px`;
    dom.scaleLabel.textContent = best >= 1000 ? `${best / 1000} km` : `${best} m`;
  }

  // ==================== 拾取与 HBase 存储检视 ====================
  function pickPointAt(mx, my, extraTol = 0) {
    const n = state.records.length;
    const sxArr = state.screenX;
    const syArr = state.screenY;
    const mask = state.matchedMask;
    const tol = Math.max(7, state.pointRadius + 4) + extraTol;
    const tol2 = tol * tol;

    let bestIdx = -1;
    let bestD2 = tol2;

    // 第一遍优先拾取当前高亮/命中点
    for (let i = 0; i < n; i++) {
      if (mask[i] !== 1) continue;
      const dx = sxArr[i] - mx;
      const dy = syArr[i] - my;
      const d2 = dx * dx + dy * dy;
      if (d2 <= bestD2) {
        bestD2 = d2;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 || state.displayMode === "only") return bestIdx;

    // 第二遍再拾取背景压暗点
    for (let i = 0; i < n; i++) {
      if (mask[i] === 1) continue;
      const dx = sxArr[i] - mx;
      const dy = syArr[i] - my;
      const d2 = dx * dx + dy * dy;
      if (d2 <= bestD2) {
        bestD2 = d2;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  function selectRecord(idx, showMobileBanner = true) {
    state.selectedIdx = idx;
    const r = state.records[idx];
    if (!r) return;

    $("inspector-empty").hidden = true;
    $("inspector-body").hidden = false;
    $("live-hbase-box").hidden = true;

    const rk = r[0];
    const dName = state.districts[r[1]];
    const cName = state.categories[r[2]];
    const avgPrice = r[3];
    const reviews = r[4];
    const plName = state.priceLevels[r[5]];
    const usable = r[6];
    const lng = r[7];
    const lat = r[8];

    const dCode = rk.slice(0, 2);
    const cCode = rk.slice(2, 4);
    const revStr = rk.slice(4, 11);
    const seqStr = rk.slice(11, 15);

    $("rk-segments").innerHTML = `
      <span class="rk-seg rk-d" title="区码">${dCode}</span>
      <span class="rk-seg rk-c" title="类码">${cCode}</span>
      <span class="rk-seg rk-p" title="反转消费">${revStr}</span>
      <span class="rk-seg rk-s" title="同前缀序号">${seqStr}</span>
    `;

    const priceDesc = avgPrice > 0
      ? `9,999,998 − ${avgPrice} = ${revStr}（价格越高字典序越靠前）`
      : `价格缺失 → 固定 9,999,999（严格排在所有已知价格之后）`;
    const cLabel = displayCat(cName);
    $("rk-explain").textContent = `${dCode}=${dName} · ${cCode}=${cLabel} · ${priceDesc} · 序号 ${seqStr}`;

    // 计算预分区 SPLITS = ['04', '07', '10', '13']
    const dNum = parseInt(dCode, 10);
    let regionName = "Region #5 ([13, +∞))";
    if (dNum < 4) regionName = "Region #1 ((-∞, 04))";
    else if (dNum < 7) regionName = "Region #2 ([04, 07))";
    else if (dNum < 10) regionName = "Region #3 ([07, 10))";
    else if (dNum < 13) regionName = "Region #4 ([10, 13))";
    $("rk-region").textContent = `所属预分区：${regionName} · 整行共 3 个列族 / 11 个 Cell`;

    const cells = [
      ["info", "district", dName],
      ["info", "district_code", dCode],
      ["info", "category", cName],
      ["info", "category_code", cCode],
      ["info", "city", "上海市"],
      ["metric", "reviews", reviews.toLocaleString()],
      ["metric", "avg_price", avgPrice > 0 ? `${avgPrice} 元` : "0 (未知)"],
      ["metric", "price_level", plName],
      ["metric", "is_usable", String(usable)],
      ["geo", "lng", lng.toFixed(6)],
      ["geo", "lat", lat.toFixed(6)],
    ];
    $("cell-tbody").innerHTML = cells.map(([cf, cq, val]) => `
      <tr>
        <td><span class="cf-tag cf-${cf}">${cf}</span></td>
        <td><code>${cq}</code></td>
        <td>${val}</td>
      </tr>
    `).join("");

    const banner = $("mobile-pick-banner");
    const mpbInfo = $("mpb-info");
    if (banner && mpbInfo && showMobileBanner) {
      const priceText = avgPrice > 0 ? `${avgPrice}元` : "价未知";
      mpbInfo.textContent = `${dName} · ${cLabel} · ${priceText} (${rk})`;
      banner.hidden = false;
      if (dom.mapStage) dom.mapStage.classList.add("has-pick-banner");
    }

    requestDraw();
  }

  function stepMatchedRecord(delta) {
    const n = state.records.length;
    if (n === 0 || state.matchedCount === 0) return;
    const mask = state.matchedMask;
    const start = state.selectedIdx >= 0 ? state.selectedIdx : 0;
    for (let step = 1; step <= n; step++) {
      const idx = (start + delta * step + n) % n;
      if (mask[idx] === 1) {
        selectRecord(idx, false);
        return;
      }
    }
  }

  // ==================== 交互与事件绑定 ====================
  function bindEvents() {
    window.addEventListener("resize", resizeCanvas);

    const mobileTabs = $("mobile-tabs");
    if (mobileTabs) {
      mobileTabs.addEventListener("click", (e) => {
        const btn = e.target.closest(".mobile-tab-btn");
        if (!btn) return;
        setMobileTab(btn.dataset.tab);
      });
    }

    const mpbDetail = $("btn-mpb-detail");
    if (mpbDetail) {
      mpbDetail.addEventListener("click", () => setMobileTab("stats"));
    }

    const mpbClose = $("btn-mpb-close");
    if (mpbClose) {
      mpbClose.addEventListener("click", hideMobileBanner);
    }

    const prevRecBtn = $("btn-prev-record");
    if (prevRecBtn) {
      prevRecBtn.addEventListener("click", () => stepMatchedRecord(-1));
    }
    const nextRecBtn = $("btn-next-record");
    if (nextRecBtn) {
      nextRecBtn.addEventListener("click", () => stepMatchedRecord(1));
    }

    // 预设场景按钮
    $("presets").addEventListener("click", (e) => {
      const btn = e.target.closest(".preset-btn");
      if (!btn) return;
      applyPreset(btn.dataset.preset);
      document.querySelectorAll(".preset-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      if (window.innerWidth <= 900) setMobileTab("map");
    });

    dom.basemapSelect.addEventListener("change", () => {
      state.basemap = dom.basemapSelect.value;
      recomputeProjectionCoords();
      updateBasemapClasses();
      requestDraw();
    });

    $("btn-reset-view").addEventListener("click", () => {
      flyTo(DEFAULT_VIEW.lng, DEFAULT_VIEW.lat, DEFAULT_VIEW.zoom);
    });

    $("btn-fit-match").addEventListener("click", () => {
      applyFilters("force");
    });

    $("btn-zoom-in").addEventListener("click", () => {
      flyTo(state.view.lng, state.view.lat, Math.min(17, state.view.zoom + 0.8));
    });
    $("btn-zoom-out").addEventListener("click", () => {
      flyTo(state.view.lng, state.view.lat, Math.max(4, state.view.zoom - 0.8));
    });

    document.querySelectorAll('input[name="displayMode"]').forEach((el) => {
      el.addEventListener("change", () => {
        state.displayMode = el.value;
        requestDraw();
      });
    });

    dom.chkAutofit.addEventListener("change", () => { state.autoFit = dom.chkAutofit.checked; });
    dom.chkLandmarks.addEventListener("change", () => { state.showLandmarks = dom.chkLandmarks.checked; requestDraw(); });
    dom.chkLabels.addEventListener("change", () => { state.showLabels = dom.chkLabels.checked; requestDraw(); });

    dom.rngPointSize.addEventListener("input", () => {
      state.pointRadius = parseFloat(dom.rngPointSize.value);
      dom.valPointSize.textContent = `${state.pointRadius.toFixed(1)}px`;
      requestDraw();
    });

    $("btn-dist-all").addEventListener("click", () => {
      state.selectedDistricts = new Set(state.districts.map((_, i) => i));
      clearPresetActive();
      syncChipSelections();
      applyFilters("none");
    });
    $("btn-dist-clear").addEventListener("click", () => {
      state.selectedDistricts.clear();
      clearPresetActive();
      syncChipSelections();
      applyFilters("none");
    });
    $("btn-cat-all").addEventListener("click", () => {
      state.selectedCategories = new Set(state.categories.map((_, i) => i));
      clearPresetActive();
      syncChipSelections();
      applyFilters("none");
    });
    $("btn-cat-clear").addEventListener("click", () => {
      state.selectedCategories.clear();
      clearPresetActive();
      syncChipSelections();
      applyFilters("none");
    });

    dom.catSearch.addEventListener("input", renderCategoryChips);

    const clearNumericErrors = () => {
      dom.inpMinPrice.classList.remove("invalid");
      dom.inpMaxPrice.classList.remove("invalid");
      dom.inpMinReviews.classList.remove("invalid");
      if (dom.filterError) {
        dom.filterError.hidden = true;
        dom.filterError.textContent = "";
      }
    };

    const onNumericChange = () => {
      clearNumericErrors();
      const rawMinP = dom.inpMinPrice.value.trim();
      const rawMaxP = dom.inpMaxPrice.value.trim();
      const rawMinR = dom.inpMinReviews.value.trim();

      const errs = [];
      let minP = rawMinP === "" ? null : Number(rawMinP);
      let maxP = rawMaxP === "" ? null : Number(rawMaxP);
      let minR = rawMinR === "" ? null : Number(rawMinR);

      if (minP !== null && (Number.isNaN(minP) || minP < 0)) {
        dom.inpMinPrice.classList.add("invalid");
        errs.push("人均下限不能为负数（已忽略）");
        minP = null;
      }
      if (maxP !== null && (Number.isNaN(maxP) || maxP < 0)) {
        dom.inpMaxPrice.classList.add("invalid");
        errs.push("人均上限不能为负数（已忽略）");
        maxP = null;
      }
      if (minR !== null && (Number.isNaN(minR) || minR < 0)) {
        dom.inpMinReviews.classList.add("invalid");
        errs.push("点评数下限不能为负数（已忽略）");
        minR = null;
      }
      if (minP !== null && maxP !== null && minP > maxP) {
        dom.inpMinPrice.classList.add("invalid");
        dom.inpMaxPrice.classList.add("invalid");
        errs.push("人均消费下限不能大于上限");
      }

      if (errs.length > 0 && dom.filterError) {
        dom.filterError.textContent = errs.join("；");
        dom.filterError.hidden = false;
      }

      state.minPrice = minP;
      state.maxPrice = maxP;
      state.minReviews = minR;
      state.usableOnly = dom.chkUsableOnly.checked;
      clearPresetActive();
      applyFilters("none");
    };
    dom.inpMinPrice.addEventListener("input", onNumericChange);
    dom.inpMaxPrice.addEventListener("input", onNumericChange);
    dom.inpMinReviews.addEventListener("input", onNumericChange);
    dom.chkUsableOnly.addEventListener("change", onNumericChange);

    $("btn-filter-reset").addEventListener("click", () => {
      clearNumericErrors();
      applyPreset("all");
      document.querySelectorAll(".preset-btn").forEach((b) => {
        b.classList.toggle("active", b.dataset.preset === "all");
      });
    });

    if (dom.btnLegendAll) {
      dom.btnLegendAll.addEventListener("click", () => {
        state.legendShowAll = !state.legendShowAll;
        renderLegend();
      });
    }

    $("btn-legend-toggle").addEventListener("click", () => {
      const hidden = dom.legendItems.style.display === "none";
      setLegendCollapsed(!hidden);
    });

    $("btn-live-get").addEventListener("click", async () => {
      if (state.selectedIdx < 0) return;
      const rk = state.records[state.selectedIdx][0];
      const box = $("live-hbase-box");
      box.hidden = false;
      if (state.isStaticHost) {
        box.textContent = "[静态托管模式] 当前访问的是静态托管快照（hbase.wogress.site），无在线 HBase 后端服务。\n上方已完整展示该条记录从 HBase 导出的 RowKey 分段与 11 个 Cell 结构；在本地启动 server.py + HBase 后即可实时 Get。";
        return;
      }
      box.textContent = `正在向本地 HBase 查询 RowKey=${rk} ...`;
      try {
        const resp = await fetch(`/api/hbase/live-row?rowkey=${encodeURIComponent(rk)}`);
        if (!resp.ok) {
          box.textContent = "[提示] 当前为静态托管模式（hbase.wogress.site），无本地 HBase 后端服务。\n上方已完整展示该条记录从 HBase 导出的 RowKey 分段与 11 个 Cell 结构。";
          return;
        }
        const data = await resp.json();
        if (data.ok) {
          box.textContent = data.rawOutput;
        } else {
          box.textContent = `[提示] ${data.error}\n（若需实时 Get，请先运行 D:\\dsh\\hbase-setup\\启动HBase.bat）`;
        }
      } catch (err) {
        box.textContent = "[提示] 未连接到本地 HBase 服务（当前为静态托管或离线预览模式）。";
      }
    });

    // Canvas 拖拽、缩放、悬停与点击
    dom.canvas.addEventListener("mousedown", (e) => {
      state.animTarget = null;
      state.dragging = true;
      state.dragMoved = false;
      state.lastMouse = { x: e.clientX, y: e.clientY };
      markInteracting(0);
    });

    window.addEventListener("mousemove", (e) => {
      const rect = dom.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (state.dragging) {
        const dx = e.clientX - state.lastMouse.x;
        const dy = e.clientY - state.lastMouse.y;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) state.dragMoved = true;
        state.lastMouse = { x: e.clientX, y: e.clientY };

        const z = state.view.zoom;
        const cWx = lngToWorldX(state.view.lng, z) - dx;
        const cWy = latToWorldY(state.view.lat, z) - dy;
        state.view.lng = worldXToLng(cWx, z);
        state.view.lat = worldYToLat(cWy, z);
        dom.tooltip.hidden = true;
        requestDraw();
        return;
      }

      if (mx >= 0 && mx <= rect.width && my >= 0 && my <= rect.height) {
        const z = state.view.zoom;
        const wx = lngToWorldX(state.view.lng, z) + (mx - rect.width / 2);
        const wy = latToWorldY(state.view.lat, z) + (my - rect.height / 2);
        dom.coordReadout.textContent = `${worldXToLng(wx, z).toFixed(4)}°E, ${worldYToLat(wy, z).toFixed(4)}°N`;

        const hit = pickPointAt(mx, my);
        if (hit !== state.hoverIdx) {
          state.hoverIdx = hit;
          requestDraw();
        }
        if (hit >= 0) {
          showTooltip(hit, mx, my, rect.width, rect.height);
          dom.canvas.style.cursor = "pointer";
        } else {
          dom.tooltip.hidden = true;
          dom.canvas.style.cursor = "grab";
        }
      }
    });

    window.addEventListener("mouseup", (e) => {
      if (!state.dragging) return;
      state.dragging = false;
      state.isInteracting = false;
      if (!state.dragMoved) {
        const rect = dom.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        if (mx >= 0 && mx <= rect.width && my >= 0 && my <= rect.height) {
          const hit = pickPointAt(mx, my);
          if (hit >= 0) selectRecord(hit);
        }
      }
      requestDraw();
    });

    dom.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      state.animTarget = null;
      markInteracting(120);
      const rect = dom.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const oldZ = state.view.zoom;
      const delta = e.deltaY < 0 ? 0.55 : -0.55;
      const newZ = Math.max(4, Math.min(17, oldZ + delta));
      if (newZ === oldZ) return;

      // 以鼠标位置为中心缩放
      const targetWx = lngToWorldX(state.view.lng, oldZ) + (mx - rect.width / 2);
      const targetWy = latToWorldY(state.view.lat, oldZ) + (my - rect.height / 2);
      const anchorLng = worldXToLng(targetWx, oldZ);
      const anchorLat = worldYToLat(targetWy, oldZ);

      const newAnchorWx = lngToWorldX(anchorLng, newZ);
      const newAnchorWy = latToWorldY(anchorLat, newZ);
      state.view.lng = worldXToLng(newAnchorWx - (mx - rect.width / 2), newZ);
      state.view.lat = worldYToLat(newAnchorWy - (my - rect.height / 2), newZ);
      state.view.zoom = newZ;
      requestDraw();
    }, { passive: false });

    // 手机端单指拖拽 / 点选 + 双指捏合缩放
    const touchState = { mode: "none", x: 0, y: 0, moved: false, pinchDist: 0 };

    dom.canvas.addEventListener("touchstart", (e) => {
      state.animTarget = null;
      markInteracting(0);
      if (e.touches.length === 1) {
        const t = e.touches[0];
        touchState.mode = "pan";
        touchState.x = t.clientX;
        touchState.y = t.clientY;
        touchState.moved = false;
      } else if (e.touches.length === 2) {
        touchState.mode = "pinch";
        const t0 = e.touches[0], t1 = e.touches[1];
        touchState.pinchDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        touchState.x = (t0.clientX + t1.clientX) / 2;
        touchState.y = (t0.clientY + t1.clientY) / 2;
        touchState.moved = true;
      }
    }, { passive: true });

    dom.canvas.addEventListener("touchmove", (e) => {
      e.preventDefault();
      const rect = dom.canvas.getBoundingClientRect();
      if (touchState.mode === "pan" && e.touches.length === 1) {
        const t = e.touches[0];
        const dx = t.clientX - touchState.x;
        const dy = t.clientY - touchState.y;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) touchState.moved = true;
        touchState.x = t.clientX;
        touchState.y = t.clientY;

        const z = state.view.zoom;
        state.view.lng = worldXToLng(lngToWorldX(state.view.lng, z) - dx, z);
        state.view.lat = worldYToLat(latToWorldY(state.view.lat, z) - dy, z);
        requestDraw();
      } else if (e.touches.length === 2) {
        const t0 = e.touches[0], t1 = e.touches[1];
        const newDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        const midX = (t0.clientX + t1.clientX) / 2 - rect.left;
        const midY = (t0.clientY + t1.clientY) / 2 - rect.top;
        if (touchState.pinchDist > 0 && newDist > 0) {
          const oldZ = state.view.zoom;
          const dz = Math.log2(newDist / touchState.pinchDist);
          const newZ = Math.max(4, Math.min(17, oldZ + dz));
          const targetWx = lngToWorldX(state.view.lng, oldZ) + (midX - rect.width / 2);
          const targetWy = latToWorldY(state.view.lat, oldZ) + (midY - rect.height / 2);
          const anchorLng = worldXToLng(targetWx, oldZ);
          const anchorLat = worldYToLat(targetWy, oldZ);
          state.view.lng = worldXToLng(lngToWorldX(anchorLng, newZ) - (midX - rect.width / 2), newZ);
          state.view.lat = worldYToLat(latToWorldY(anchorLat, newZ) - (midY - rect.height / 2), newZ);
          state.view.zoom = newZ;
          requestDraw();
        }
        touchState.pinchDist = newDist;
        touchState.mode = "pinch";
      }
    }, { passive: false });

    dom.canvas.addEventListener("touchend", (e) => {
      if (touchState.mode === "pan" && !touchState.moved && e.changedTouches.length === 1) {
        const t = e.changedTouches[0];
        const rect = dom.canvas.getBoundingClientRect();
        const mx = t.clientX - rect.left;
        const my = t.clientY - rect.top;
        const hit = pickPointAt(mx, my, 8);
        if (hit >= 0) {
          selectRecord(hit);
        } else {
          hideMobileBanner();
        }
      }
      if (e.touches.length === 0) {
        touchState.mode = "none";
        touchState.pinchDist = 0;
        state.isInteracting = false;
        requestDraw();
      }
    });
  }

  function showTooltip(idx, mx, my, w, h) {
    const r = state.records[idx];
    const dName = state.districts[r[1]];
    const cName = displayCat(state.categories[r[2]]);
    const color = state.catColors[r[2]];
    const priceText = r[3] > 0 ? `${r[3]} 元 (${state.priceLevels[r[5]]})` : "人均未知";

    dom.tooltip.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;font-weight:700;margin-bottom:3px">
        <span class="color-dot" style="background:${color}"></span>
        <span>${dName} · ${cName}</span>
      </div>
      <div>人均消费：<b>${priceText}</b></div>
      <div>点评数量：${r[4].toLocaleString()}</div>
      <div style="color:#94a3b8;font-size:11px;margin-top:2px">RowKey: ${r[0]}（点击解剖 Cell）</div>
    `;
    dom.tooltip.hidden = false;
    const tipW = dom.tooltip.offsetWidth || 220;
    const tipH = dom.tooltip.offsetHeight || 96;
    let left = mx + 14 + tipW > w ? mx - tipW - 10 : mx + 14;
    let top = my + 14 + tipH > h ? my - tipH - 10 : my + 14;
    left = Math.max(8, Math.min(w - tipW - 8, left));
    top = Math.max(8, Math.min(h - tipH - 8, top));

    // 避让左下角菜系图例，避免盖住「收起/全部」按钮
    if (dom.mapLegend && dom.mapStage) {
      const sRect = dom.mapStage.getBoundingClientRect();
      const lRect = dom.mapLegend.getBoundingClientRect();
      const lx1 = lRect.left - sRect.left;
      const ly1 = lRect.top - sRect.top;
      const lx2 = lRect.right - sRect.left;
      const ly2 = lRect.bottom - sRect.top;
      const overlapsLegend = left < lx2 + 6 && left + tipW > lx1 - 6 && top < ly2 + 6 && top + tipH > ly1 - 6;
      if (overlapsLegend) {
        if (ly1 - tipH - 8 >= 8) {
          top = ly1 - tipH - 8;
        } else if (lx2 + 8 + tipW <= w - 8) {
          left = lx2 + 8;
        }
      }
    }

    dom.tooltip.style.left = `${left}px`;
    dom.tooltip.style.top = `${top}px`;
  }

  function clearPresetActive() {
    document.querySelectorAll(".preset-btn").forEach((b) => b.classList.remove("active"));
  }

  function applyPreset(name) {
    state.selectedDistricts.clear();
    state.selectedCategories.clear();
    state.selectedPriceLevels.clear();
    state.minPrice = null;
    state.maxPrice = null;
    state.minReviews = null;
    state.usableOnly = false;
    dom.inpMinPrice.value = "";
    dom.inpMaxPrice.value = "";
    dom.inpMinReviews.value = "";
    dom.chkUsableOnly.checked = false;
    dom.inpMinPrice.classList.remove("invalid");
    dom.inpMaxPrice.classList.remove("invalid");
    dom.inpMinReviews.classList.remove("invalid");
    if (dom.filterError) {
      dom.filterError.hidden = true;
      dom.filterError.textContent = "";
    }

    const dIdxOf = (n) => state.districts.indexOf(n);
    const cIdxOf = (n) => state.categories.indexOf(n);
    const plIdxOf = (n) => state.priceLevels.indexOf(n);

    if (name === "baoshan_seafood") {
      if (dIdxOf("宝山区") >= 0) state.selectedDistricts.add(dIdxOf("宝山区"));
      if (cIdxOf("海鲜") >= 0) state.selectedCategories.add(cIdxOf("海鲜"));
      state.showLandmarks = true;
      dom.chkLandmarks.checked = true;
    } else if (name === "huangpu_western") {
      if (dIdxOf("黄浦区") >= 0) state.selectedDistricts.add(dIdxOf("黄浦区"));
      if (cIdxOf("西餐") >= 0) state.selectedCategories.add(cIdxOf("西餐"));
      state.showLandmarks = true;
      dom.chkLandmarks.checked = true;
    } else if (name === "japanese_gubei") {
      if (dIdxOf("长宁区") >= 0) state.selectedDistricts.add(dIdxOf("长宁区"));
      if (cIdxOf("本菜") >= 0) state.selectedCategories.add(cIdxOf("本菜"));
      state.showLandmarks = true;
      dom.chkLandmarks.checked = true;
    } else if (name === "korean_hongquan") {
      if (dIdxOf("闵行区") >= 0) state.selectedDistricts.add(dIdxOf("闵行区"));
      if (cIdxOf("料理") >= 0) state.selectedCategories.add(cIdxOf("料理"));
      state.showLandmarks = true;
      dom.chkLandmarks.checked = true;
    } else if (name === "luxury") {
      if (plIdxOf("高档") >= 0) state.selectedPriceLevels.add(plIdxOf("高档"));
      if (plIdxOf("奢华") >= 0) state.selectedPriceLevels.add(plIdxOf("奢华"));
    }

    syncChipSelections();
    applyFilters(name !== "all" && state.autoFit ? "auto" : "none");
    if (name === "all" && state.autoFit) {
      flyTo(DEFAULT_VIEW.lng, DEFAULT_VIEW.lat, DEFAULT_VIEW.zoom);
    }
  }

  function resizeCanvas() {
    requestDraw();
  }

  window.addEventListener("DOMContentLoaded", init);
})();
