const METADATA_URL = "data/metadata.json";
const HS2_BASE = "data/hs2";
const RISK_FILE_URL = "data/gew_riskindi.xlsx";

let cy = null; // Global cytoscape instance

const EU27_CODES = new Set([
  "AUT", "BEL", "BGR", "HRV", "CYP", "CZE", "DNK", "ESP", "EST", "FIN", "FRA",
  "DEU", "GRC", "HUN", "IRL", "ITA", "LVA", "LTU", "LUX", "MLT", "NLD", "POL",
  "PRT", "ROU", "SVK", "SVN", "SWE",
]);

const REGION_COLORS = {
  Asien: "#F4B942",
  Afrika: "#67B7AE",
  Ozeanien: "#E58AAA",
  Amerika: "#A78BFA",
  "Europa-EU": "#6EA8FE",
  "Europa-Rest": "#9CC7FF",
  Other: "#CBD5E1",
};

const state = {
  metadata: null,
  riskMap: new Map(),
  hs2Cache: new Map(),
  currentHs2Rows: [],
  controls: {
    hsDigitLevel: "2-digit",
    hs2Code: "",
    hs4Code: "",
    hs6Code: "",
    aggregateEu: false,
    focusCountry: "AUT",
    metricType: "Flows",
    renderTopX: 25,
    topNPartners: 5,
    focusEdgesOnly: false,
    edgePercentile: 35,
    pairwiseScale: "Column-normalized",
    nraiScale: "Raw",
    riskThresholdLow: 0.35,
    riskThresholdHigh: 0.55,
  },
};

const els = {
  metaInfo: document.getElementById("metaInfo"),
  networkTitle: document.getElementById("networkTitle"),
  networkProduct: document.getElementById("networkProduct"),
  networkLegend: document.getElementById("networkLegend"),

  hsDigitLevel: document.querySelectorAll('input[name="hsDigitLevel"]'),
  hs2Code: document.getElementById("hs2Code"),
  hs4Code: document.getElementById("hs4Code"),
  hs6Code: document.getElementById("hs6Code"),
  aggregateEu: document.getElementById("aggregateEu"),
  focusCountry: document.getElementById("focusCountry"),
  metricType: document.querySelectorAll('input[name="metricType"]'),
  renderTopX: document.getElementById("renderTopX"),
  renderTopXValue: document.getElementById("renderTopXValue"),
  topNPartners: document.getElementById("topNPartners"),
  topNPartnersValue: document.getElementById("topNPartnersValue"),
  focusEdgesOnly: document.getElementById("focusEdgesOnly"),
  edgePercentile: document.getElementById("edgePercentile"),
  edgePercentileValue: document.getElementById("edgePercentileValue"),
  riskThresholdLow: document.getElementById("riskThresholdLow"),
  riskThresholdLowValue: document.getElementById("riskThresholdLowValue"),
  riskThresholdHigh: document.getElementById("riskThresholdHigh"),
  riskThresholdHighValue: document.getElementById("riskThresholdHighValue"),
  pairwiseScale: document.querySelectorAll('input[name="pairwiseScale"]'),
  nraiScale: document.querySelectorAll('input[name="nraiScale"]'),

  dependencyHeatmap: document.getElementById("dependencyHeatmap"),
  pairwiseHeatmap: document.getElementById("pairwiseHeatmap"),
  nraiDirect: document.getElementById("nraiDirect"),
  nraiIndirect: document.getElementById("nraiIndirect"),
  nraiRegime: document.getElementById("nraiRegime"),
  nraiDrivers: document.getElementById("nraiDrivers"),

  tableHead: document.querySelector("#overviewTable thead"),
  tableBody: document.querySelector("#overviewTable tbody"),
  downloadRawData: document.getElementById("downloadRawData"),

  cyRoot: document.getElementById("cyRoot"),
};

function formatNumber(value, maxFractionDigits = 2) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: maxFractionDigits }).format(value);
}

function regionBucket(value) {
  if (!value) return "Other";
  const key = String(value).trim().toLowerCase().replaceAll("_", "-");
  if (key === "asien" || key === "asia") return "Asien";
  if (key === "afrika" || key === "africa") return "Afrika";
  if (key === "ozeanien" || key === "oceania") return "Ozeanien";
  if (key === "amerika" || key === "americas" || key === "america") return "Amerika";
  if (["europa-eu", "europe-eu", "eu", "eu27", "europa eu", "europe eu"].includes(key)) return "Europa-EU";
  if (["europa-rest", "europe-rest", "europa", "europe", "europe-other"].includes(key)) return "Europa-Rest";
  return "Other";
}

function nameByIso3(iso3) {
  const match = state.metadata?.countries?.find((c) => c.iso3 === iso3);
  return match?.name || iso3;
}

function setSelectOptions(selectEl, options, selectedValue, valueKey = "code", labelBuilder = null) {
  selectEl.innerHTML = "";
  for (const option of options) {
    const value = option[valueKey];
    const label = labelBuilder ? labelBuilder(option) : String(value);
    const opt = document.createElement("option");
    opt.value = String(value);
    opt.textContent = label;
    if (String(value) === String(selectedValue)) {
      opt.selected = true;
    }
    selectEl.append(opt);
  }
}

function closest(array, value, fallback) {
  if (!array.length) return fallback;
  if (array.includes(value)) return value;
  return array[0];
}

function baseHs2Code(code) {
  return String(code).split("_")[0];
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.json();
}

async function loadRiskMap() {
  if (!window.XLSX) {
    throw new Error("The XLSX parser did not load.");
  }

  const response = await fetch(RISK_FILE_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${RISK_FILE_URL}: ${response.status}`);
  }

  const workbook = window.XLSX.read(await response.arrayBuffer(), { type: "array" });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = window.XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: null });
  const headers = (rows[0] || []).map((value) => String(value ?? "").trim().toLowerCase());
  const iso3Index = headers.indexOf("iso3");
  const riskIndex = headers.indexOf("risk");

  if (iso3Index < 0 || riskIndex < 0) {
    throw new Error("Risk workbook must contain iso3 and risk columns.");
  }

  const riskMap = new Map();
  for (const row of rows.slice(1)) {
    const iso3 = String(row[iso3Index] ?? "").trim().toUpperCase();
    const risk = Number(row[riskIndex]);
    if (iso3 && Number.isFinite(risk)) {
      riskMap.set(iso3, risk / 100);
    }
  }

  if (!riskMap.size) {
    throw new Error("Risk workbook contains no numeric risk values.");
  }

  state.riskMap = riskMap;
}

function attachRiskValues(records) {
  return records.map((row) => {
    const exporter = String(row.from ?? "").trim().toUpperCase();
    const risk = state.riskMap.get(exporter);
    return risk === undefined ? row : { ...row, ps_norm: risk };
  });
}

function enrichRecords(records, hs2Code) {
  const countryRegions = state.metadata?.country_regions || {};
  return records.map((row) => {
    // Compact payloads omit labels that are available in metadata lookups.
    const from = String(row.from ?? "").trim().toUpperCase();
    const to = String(row.to ?? "").trim().toUpperCase();
    return {
      ...row,
      from,
      to,
      code2: row.code2 ?? hs2Code,
      ex_name: row.ex_name ?? nameByIso3(from),
      im_name: row.im_name ?? nameByIso3(to),
      ex_region: row.ex_region ?? countryRegions[from] ?? "Other",
      im_region: row.im_region ?? countryRegions[to] ?? "Other",
      eu: row.eu ?? (EU27_CODES.has(from) || EU27_CODES.has(to) ? 1 : 0),
    };
  });
}

async function loadMetadata() {
  const [metadata] = await Promise.all([fetchJson(METADATA_URL), loadRiskMap()]);
  state.metadata = metadata;

  const hs2Options = state.metadata.hs2_options || [];
  if (!hs2Options.length) {
    throw new Error("metadata.json has no hs2_options.");
  }

  state.controls.hs2Code = hs2Options[0].code;
  const hs4Options = state.metadata.hs4_by_hs2?.[state.controls.hs2Code] || [];
  state.controls.hs4Code = hs4Options[0]?.code || state.controls.hs2Code;
  const hs6Options = state.metadata.hs6_by_hs4?.[state.controls.hs4Code] || [];
  state.controls.hs6Code = hs6Options[0]?.code || state.controls.hs4Code;
}

async function loadHs2Data(hs2Code) {
  if (state.hs2Cache.has(hs2Code)) {
    return state.hs2Cache.get(hs2Code);
  }
  const baseCode = baseHs2Code(hs2Code);
  const urls = hs2Code === "84"
    ? [`${HS2_BASE}/84_1.json`, `${HS2_BASE}/84_2.json`]
    : [`${HS2_BASE}/${hs2Code}.json`];
  const payloads = await Promise.all(urls.map((url) => fetchJson(url)));
  const payload = {
    ...payloads[0],
    row_count: payloads.reduce((total, part) => total + Number(part.row_count || part.records?.length || 0), 0),
    records: payloads.flatMap((part) => part.records || []),
  };
  const enrichedPayload = {
    ...payload,
    records: attachRiskValues(enrichRecords(payload.records || [], baseCode)),
  };
  state.hs2Cache.set(hs2Code, enrichedPayload);
  return enrichedPayload;
}

function refreshMetaInfo() {
  const metadata = state.metadata?.metadata || {};
  const currentRows = state.currentHs2Rows.length;
  els.metaInfo.textContent = `Version ${metadata.dataset_version || "n/a"} | Generated ${metadata.generated_at || "n/a"} | HS2 ${state.controls.hs2Code} rows: ${currentRows.toLocaleString()}`;
}

function refreshOptionControls() {
  const hs2Options = (state.metadata.hs2_options || []).map((option) => (
    option.code === "84"
      ? { ...option, desc: `${option.desc || ""} (combined)` }
      : option
  ));
  const metadataHs2Code = baseHs2Code(state.controls.hs2Code);
  setSelectOptions(
    els.hs2Code,
    hs2Options,
    state.controls.hs2Code,
    "code",
    (opt) => `${opt.code}: ${opt.desc || ""}`
  );

  const hs4Options = state.metadata.hs4_by_hs2?.[metadataHs2Code] || [];
  state.controls.hs4Code = closest(hs4Options.map((o) => o.code), state.controls.hs4Code, hs4Options[0]?.code || metadataHs2Code);
  setSelectOptions(
    els.hs4Code,
    hs4Options,
    state.controls.hs4Code,
    "code",
    (opt) => `${opt.code}: ${opt.desc || ""}`
  );

  const hs6Options = state.metadata.hs6_by_hs4?.[state.controls.hs4Code] || [];
  state.controls.hs6Code = closest(hs6Options.map((o) => o.code), state.controls.hs6Code, hs6Options[0]?.code || state.controls.hs4Code);
  setSelectOptions(
    els.hs6Code,
    hs6Options,
    state.controls.hs6Code,
    "code",
    (opt) => `${opt.code}: ${opt.desc || ""}`
  );

  const activeLevel = state.controls.hsDigitLevel;
  els.hs2Code.disabled = !(activeLevel === "2-digit" || activeLevel === "4-digit" || activeLevel === "6-digit");
  els.hs4Code.disabled = !(activeLevel === "4-digit" || activeLevel === "6-digit");
  els.hs6Code.disabled = activeLevel !== "6-digit";

  const isoSet = new Set();
  for (const row of state.currentHs2Rows) {
    isoSet.add(row.from);
    isoSet.add(row.to);
  }
  const codes = [...isoSet].sort();
  const withEu = state.controls.aggregateEu ? ["EU27", ...codes.filter((c) => c !== "EU27")] : codes;

  state.controls.focusCountry = closest(withEu, state.controls.focusCountry, withEu[0] || "AUT");
  setSelectOptions(
    els.focusCountry,
    withEu.map((iso3) => ({ iso3 })),
    state.controls.focusCountry,
    "iso3",
    (opt) => `${opt.iso3}: ${nameByIso3(opt.iso3)}`
  );

  const maxTopX = Math.max(5, withEu.length || 25);
  els.renderTopX.max = String(maxTopX);
  state.controls.renderTopX = Math.min(state.controls.renderTopX, maxTopX);
  els.renderTopX.value = String(state.controls.renderTopX);
  els.renderTopXValue.textContent = String(state.controls.renderTopX);
  els.riskThresholdLow.value = String(state.controls.riskThresholdLow);
  els.riskThresholdLowValue.textContent = state.controls.riskThresholdLow.toFixed(2);
  els.riskThresholdHigh.value = String(state.controls.riskThresholdHigh);
  els.riskThresholdHighValue.textContent = state.controls.riskThresholdHigh.toFixed(2);
}

function selectedProductKey() {
  const level = state.controls.hsDigitLevel;
  if (level === "2-digit") return ["code2", baseHs2Code(state.controls.hs2Code)];
  if (level === "4-digit") return ["code4", state.controls.hs4Code];
  return ["code6", state.controls.hs6Code];
}

function selectedProductDescription(productCol, productCode) {
  let options = state.metadata?.hs2_options || [];
  if (productCol === "code4") {
    options = state.metadata?.hs4_by_hs2?.[baseHs2Code(state.controls.hs2Code)] || [];
  } else if (productCol === "code6") {
    options = state.metadata?.hs6_by_hs4?.[state.controls.hs4Code] || [];
  }
  const selected = options.find((option) => String(option.code) === String(productCode));
  return selected?.desc || "Product description unavailable";
}

function aggregateEuRows(rows, focusCountry) {
  const collapsed = rows.map((row) => {
    const from = EU27_CODES.has(row.from) ? "EU27" : row.from;
    const to = EU27_CODES.has(row.to) ? "EU27" : row.to;
    return { ...row, from, to };
  });

  const map = new Map();
  for (const row of collapsed) {
    const key = `${row.from}__${row.to}`;
    if (!map.has(key)) {
      map.set(key, {
        from: row.from,
        to: row.to,
        value: 0,
        weightedSum: 0,
        weightBase: 0,
        ex_region: row.from === "EU27" ? "EU27" : row.ex_region,
        im_region: row.to === "EU27" ? "EU27" : row.im_region,
        ex_name: row.from === "EU27" ? "EU27" : row.ex_name,
        im_name: row.to === "EU27" ? "EU27" : row.im_name,
        eu: Boolean(row.eu),
      });
    }
    const agg = map.get(key);
    const v = Number(row.value || 0);
    const risk = Number(row.ps_norm);
    agg.value += v;
    if (Number.isFinite(risk) && v > 0) {
      agg.weightedSum += risk * v;
      agg.weightBase += v;
    }
    agg.eu = agg.eu || Boolean(row.eu) || row.from === "EU27" || row.to === "EU27";
  }

  const out = [];
  for (const agg of map.values()) {
    if (agg.from === "EU27" && agg.to === "EU27") continue;
    out.push({
      from: agg.from,
      to: agg.to,
      value: agg.value,
      ps_norm: agg.weightBase > 0 ? agg.weightedSum / agg.weightBase : null,
      ex_region: agg.ex_region,
      im_region: agg.im_region,
      ex_name: agg.ex_name,
      im_name: agg.im_name,
      eu: agg.eu,
    });
  }

  const center = EU27_CODES.has(focusCountry) ? "EU27" : focusCountry;
  return { rows: out, centerCountry: center };
}

function computeRenderRows(rows, centerCountry) {
  const flowRows = rows.map((row) => {
    const base = Number(row.value || 0);
    const risk = Number(row.ps_norm);
    // Fallback to 1.0 if ps_norm is NaN (unweighted), matching Python fillna(1.0)
    const normalizedRisk = Number.isFinite(risk) ? risk : 1.0;
    // Apply risk weighting when metricType is NOT 'Flows' (line 752 in phoenigs18_v6.py)
    const flow_weight =
      state.controls.metricType !== "Flows"
        ? base * normalizedRisk
        : base;
    return { ...row, flow_weight };
  });

  const strengthMap = new Map();
  for (const row of flowRows) {
    strengthMap.set(row.from, (strengthMap.get(row.from) || 0) + Number(row.value || 0));
    strengthMap.set(row.to, (strengthMap.get(row.to) || 0) + Number(row.value || 0));
  }

  const rankedNodes = [...strengthMap.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0]);
  const selectedNodes = rankedNodes.filter((n) => n !== centerCountry).slice(0, Math.max(0, state.controls.renderTopX - 1));
  const renderNodeSet = new Set([centerCountry, ...selectedNodes]);

  let filtered = flowRows.filter((row) => renderNodeSet.has(row.from) && renderNodeSet.has(row.to));

  if (state.controls.focusEdgesOnly) {
    filtered = filtered.filter((row) => row.from === centerCountry || row.to === centerCountry);
  }

  if (state.controls.edgePercentile > 0 && filtered.length) {
    const values = filtered.map((row) => Number(row.flow_weight || 0)).sort((a, b) => a - b);
    const idx = Math.floor((state.controls.edgePercentile / 100) * (values.length - 1));
    const cutoff = values[Math.max(0, Math.min(values.length - 1, idx))];
    filtered = filtered.filter((row) => Number(row.flow_weight || 0) >= cutoff);
  }

  if (!filtered.length) {
    filtered = flowRows.filter((row) => renderNodeSet.has(row.from) && renderNodeSet.has(row.to));
  }

  return { flowRows, renderRows: filtered };
}

function buildAdjacency(rows) {
  const nodes = [...new Set(rows.flatMap((r) => [r.from, r.to]))].sort();
  const idxByNode = new Map(nodes.map((n, i) => [n, i]));
  const n = nodes.length;
  const matrix = Array.from({ length: n }, () => Array(n).fill(0));

  for (const row of rows) {
    const i = idxByNode.get(row.from);
    const j = idxByNode.get(row.to);
    if (i === undefined || j === undefined) continue;
    matrix[i][j] += Number(row.flow_weight || 0);
  }

  return { nodes, matrix, idxByNode };
}

function l2norm(vec) {
  let sum = 0;
  for (const x of vec) sum += x * x;
  return Math.sqrt(sum);
}

function hitsIterative(adj, nodeWeights = null, maxIter = 5, tol = 1e-6) {
  const n = adj.length;
  let h = new Array(n).fill(1);
  let a = new Array(n).fill(1);
  const w = nodeWeights && nodeWeights.length === n ? nodeWeights : new Array(n).fill(1);
  const history = [];

  for (let iter = 0; iter < maxIter; iter += 1) {
    const aNew = new Array(n).fill(0);
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        aNew[j] += adj[i][j] * h[i];
      }
    }
    for (let j = 0; j < n; j += 1) aNew[j] *= w[j];
    const aNorm = l2norm(aNew) || 1;
    for (let j = 0; j < n; j += 1) aNew[j] /= aNorm;

    const hNew = new Array(n).fill(0);
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        hNew[i] += adj[i][j] * aNew[j];
      }
    }
    for (let i = 0; i < n; i += 1) hNew[i] *= w[i];
    const hNorm = l2norm(hNew) || 1;
    for (let i = 0; i < n; i += 1) hNew[i] /= hNorm;

    history.push({ hub: hNew.slice(), authority: aNew.slice() });

    let diff = 0;
    for (let i = 0; i < n; i += 1) diff += Math.abs(hNew[i] - h[i]) + Math.abs(aNew[i] - a[i]);
    h = hNew;
    a = aNew;
    if (diff < tol) break;
  }

  return history;
}

function computeCenterPairwiseScores(adj, hubs, auth, centerIdx) {
  const n = adj.length;
  const out = new Array(n).fill(0);
  if (centerIdx < 0 || centerIdx >= n) return out;
  const centerAuth = auth[centerIdx] || 0;
  for (let i = 0; i < n; i += 1) {
    const flow = adj[i][centerIdx] || 0;
    out[i] = (hubs[i] || 0) * centerAuth * flow * 100;
  }
  return out;
}

function polarToCartesian(radius, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: radius * Math.cos(rad), y: radius * Math.sin(rad) };
}

function buildRingPositions(rows, centerCountry) {
  const incoming = new Map();
  for (const row of rows) {
    if (row.to === centerCountry) {
      incoming.set(row.from, (incoming.get(row.from) || 0) + Number(row.value || 0));
    }
  }

  const topN = Math.max(1, Number(state.controls.topNPartners || 5));
  const innerCircle = [...incoming.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map((x) => x[0]);

  const allFrom = [...new Set(rows.map((r) => r.from))];
  const outerCircle = allFrom.filter((n) => n !== centerCountry && !innerCircle.includes(n));
  const allNodes = [...new Set(rows.flatMap((r) => [r.from, r.to]))].sort();

  const pos = new Map();
  pos.set(centerCountry, { x: 0, y: 0 });
  innerCircle.forEach((node, i) => {
    const p = polarToCartesian(1.5, (360 * i) / Math.max(1, innerCircle.length));
    pos.set(node, p);
  });
  outerCircle.forEach((node, i) => {
    const p = polarToCartesian(3.0, (360 * i) / Math.max(1, outerCircle.length));
    pos.set(node, p);
  });

  const remaining = allNodes.filter((n) => !pos.has(n));
  remaining.forEach((node, i) => {
    const p = polarToCartesian(4.2, (360 * i) / Math.max(1, remaining.length));
    pos.set(node, p);
  });

  return { pos, innerCircle };
}

function renderLegend() {
  const entries = Object.entries(REGION_COLORS)
    .map(
      ([name, color]) =>
        `<span class="legend-item"><span class="legend-dot" style="background:${color}"></span>${name}</span>`
    )
    .join("");
  const low = state.controls.riskThresholdLow.toFixed(2);
  const high = state.controls.riskThresholdHigh.toFixed(2);
  const riskEntries = [
    ["Low", "rgba(0, 200, 0, 0.7)", `&lt; ${low}`],
    ["Moderate", "rgba(255, 215, 0, 0.7)", `${low} to &lt; ${high}`],
    ["High", "rgba(255, 0, 0, 0.7)", `&ge; ${high}`],
    ["No risk data", "rgba(59, 130, 246, 0.75)", "fallback"],
  ]
    .map(
      ([name, color, range]) =>
        `<span class="legend-item"><span class="legend-dot" style="background:${color}"></span>${name} (${range})</span>`
    )
    .join("");

  els.networkLegend.innerHTML = `
    <div class="legend-group"><span class="legend-title">Regions</span>${entries}</div>
    <div class="legend-group"><span class="legend-title">Risk thresholds</span>${riskEntries}</div>
  `;
}

function renderNetwork(renderRows, centerCountry) {
  renderLegend();
  const { pos, innerCircle } = buildRingPositions(renderRows, centerCountry);
  const nodes = [...new Set(renderRows.flatMap((r) => [r.from, r.to]))];

  const exporterTotals = new Map();
  const exporterToCenter = new Map();
  for (const row of renderRows) {
    exporterTotals.set(row.from, (exporterTotals.get(row.from) || 0) + Number(row.value || 0));
    if (row.to === centerCountry) {
      exporterToCenter.set(row.from, (exporterToCenter.get(row.from) || 0) + Number(row.value || 0));
    }
  }

  const sizeBaseMax = Math.max(1, ...nodes.map((n) => exporterToCenter.get(n) || 0));
  const nodeElements = [];

  for (const node of nodes) {
    const p = pos.get(node) || { x: 0, y: 0 };
    const outgoing = exporterTotals.get(node) || 0;
    const toCenter = exporterToCenter.get(node) || 0;
    const exporterRow = renderRows.find((r) => r.from === node);
    const importerRow = renderRows.find((r) => r.to === node);
    const sourceRegion = exporterRow?.ex_region || importerRow?.im_region || "Other";
    const region = EU27_CODES.has(node) ? "Europa-EU" : regionBucket(sourceRegion);
    const baseColor = node === centerCountry ? "#F87171" : REGION_COLORS[region] || REGION_COLORS.Other;
    const labelColor = node === centerCountry ? "#111827" : "#172033";
    const size = 50 + (Math.log1p(toCenter) / Math.log1p(sizeBaseMax)) * 70;

    nodeElements.push({
      data: {
        id: node,
        label: node,
        size,
        fill: baseColor,
        labelColor,
        title: `${nameByIso3(node)} (${node})\nExports total: ${formatNumber(outgoing, 0)}\nExports to ${centerCountry}: ${formatNumber(toCenter, 0)}`,
      },
      position: { x: p.x * 170, y: -p.y * 170 },
      classes: node === centerCountry ? "focus-node" : "",
    });
  }

  const maxEdge = renderRows.reduce(
    (maximum, row) => Math.max(maximum, Number(row.flow_weight || 0)),
    1
  );
  const edgeElements = renderRows.map((row) => {
    const weight = Number(row.flow_weight || 0);
    const risk = Number(row.ps_norm);
    const width = 0.8 + (Math.log1p(weight) / Math.log1p(maxEdge)) * 8.0;

    let color = "rgba(148, 163, 184, 0.55)";
    const relevant = row.from === centerCountry || row.to === centerCountry || innerCircle.includes(row.from) || innerCircle.includes(row.to);

    // Match Python logic: phoenigs18_v6.py lines 1134-1158
    if (state.controls.metricType === "Flows") {
      // Flows mode: color by flow direction
      if (relevant && row.to === centerCountry) color = "rgba(37, 99, 235, 0.92)"; // flow incoming
      else if (relevant && row.from === centerCountry) color = "rgba(225, 29, 72, 0.90)"; // flow outgoing
      else if (relevant) color = "rgba(59, 130, 246, 0.75)"; // other relevant
      else color = "rgba(148, 163, 184, 0.55)"; // dimmed
    } else if (state.controls.metricType === "Country risk traffic light") {
      // Traffic light mode: color by risk threshold
      if (Number.isFinite(risk) && relevant) {
        if (risk < state.controls.riskThresholdLow) color = "rgba(0, 200, 0, 0.7)"; // green: low risk
        else if (risk < state.controls.riskThresholdHigh) color = "rgba(255, 215, 0, 0.7)"; // yellow: moderate risk
        else color = "rgba(255, 0, 0, 0.7)"; // red: high risk
      } else if (relevant) {
        color = "rgba(59, 130, 246, 0.75)"; // relevant but no risk data
      }
      // else: keep default gray for non-relevant edges
    }

    return {
      data: {
        id: `${row.from}__${row.to}`,
        source: row.from,
        target: row.to,
        width,
        color,
        title: `${row.from} -> ${row.to} | Value: ${formatNumber(Number(row.value || 0), 0)} | Risk: ${Number.isFinite(risk) ? risk.toFixed(2) : "N/A"}`,
      },
      classes: relevant ? "" : "muted-edge",
    };
  });

  // Destroy old cytoscape instance if it exists
  if (cy) {
    cy.destroy();
  }

  // Create new cytoscape instance and store in global variable
  cy = window.cytoscape({
    container: els.cyRoot,
    elements: [...nodeElements, ...edgeElements],
    layout: { name: "preset", fit: true, padding: 35 },
    wheelSensitivity: 0.15,
    minZoom: 0.25,
    maxZoom: 2.5,
    style: [
      {
        selector: "node",
        style: {
          label: "data(label)",
          width: "data(size)",
          height: "data(size)",
          "font-size": 13,
          color: "data(labelColor)",
          "text-valign": "center",
          "text-halign": "center",
          "background-color": "data(fill)",
          "border-width": 1,
          "border-color": "#334155",
        },
      },
      {
        selector: "node.focus-node",
        style: {
          "border-width": 2.4,
          "border-color": "#ffffff",
          "shadow-color": "#ef4444",
          "shadow-opacity": 0.35,
          "shadow-blur": 10,
        },
      },
      {
        selector: "edge",
        style: {
          "curve-style": "bezier",
          "target-arrow-shape": "triangle",
          "arrow-scale": 0.75,
          "line-color": "data(color)",
          "target-arrow-color": "data(color)",
          width: "data(width)",
          opacity: 0.6,
        },
      },
      {
        selector: "edge.muted-edge",
        style: {
          "z-index": -1,
          opacity: 0.2,
        },
      },
    ],
  });

  cy.on("mouseover", "node, edge", (evt) => {
    const title = evt.target.data("title");
    if (title) els.cyRoot.title = title;
  });
  cy.on("mouseout", "node, edge", () => {
    els.cyRoot.title = "";
  });
}

function toMap(nodes, values) {
  const map = new Map();
  for (let i = 0; i < nodes.length; i += 1) map.set(nodes[i], values[i] || 0);
  return map;
}

function classifyRegime(direct, indirect) {
  if (direct > 1 && indirect > 1) return "Amplification";
  if (direct < 1 && indirect < 1) return "Dampening";
  return "Mixed";
}

function computeRiskWeights(flowRows, nodes) {
  // Compute mean ps_norm per exporting country (line 1402-1403 in phoenigs18_v6.py)
  const stats = new Map();
  for (const row of flowRows) {
    const key = row.from;
    if (!stats.has(key)) stats.set(key, { sum: 0, count: 0 });
    const risk = Number(row.ps_norm);
    if (Number.isFinite(risk)) {
      const cur = stats.get(key);
      cur.sum += risk;
      cur.count += 1;
    }
  }

  // Fallback to 1.0 for countries with no finite ps_norm (line 1409 in phoenigs18_v6.py)
  return nodes.map((n) => {
    const s = stats.get(n);
    if (!s || !s.count) return 1.0;
    const avgRisk = s.sum / s.count;
    return Number.isFinite(avgRisk) ? avgRisk : 1.0;
  });
}

function scaleHeatmapColumns(values) {
  if (state.controls.pairwiseScale === "Column-normalized") {
    const sumDirect = values.reduce((acc, row) => acc + row[0], 0) || 1;
    const sumIndirect = values.reduce((acc, row) => acc + row[1], 0) || 1;
    return {
      z: values.map((row) => [(row[0] / sumDirect) * 10, (row[1] / sumIndirect) * 10]),
      zmax: 10,
    };
  }

  const max = Math.max(...values.flat(), 1);
  return { z: values, zmax: max };
}

function renderDependencyHeatmap(countryNames, hubsDirect, hubsIndirect, centerCountry, metricType) {
  const topCountries = countryNames
    .filter((c) => c !== centerCountry)
    .sort((a, b) => (hubsDirect.get(b) || 0) - (hubsDirect.get(a) || 0))
    .slice(0, 10);

  const rawZ = topCountries.map((c) => [10 * (hubsDirect.get(c) || 0), 10 * (hubsIndirect.get(c) || 0)]);
  const { z, zmax } = scaleHeatmapColumns(rawZ);

  Plotly.newPlot(
    els.dependencyHeatmap,
    [
      {
        type: "heatmap",
        z,
        x: ["Direct", "Indirect"],
        y: topCountries,
        colorscale: metricType === "Flows" ? "YlOrBr" : "Sunsetdark",
        zmin: 0,
        zmax,
        text: z.map((row) => row.map((v) => v.toFixed(3))),
        texttemplate: "%{text}",
        hovertemplate: "%{y} %{x}: %{z:.3f}<extra></extra>",
      },
    ],
    {
      margin: { l: 80, r: 20, t: 20, b: 20 },
      yaxis: { autorange: "reversed" },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: "Space Grotesk, sans-serif", color: "#131313" },
    },
    { responsive: true, displaylogo: false }
  );
}

function renderPairwiseHeatmap(countryNames, autDirect, autIndirect, centerCountry, metricType) {
  const pairs = countryNames
    .filter((c) => c !== centerCountry)
    .map((c) => ({ country: c, direct: autDirect.get(c) || 0, indirect: autIndirect.get(c) || 0 }))
    .sort((a, b) => b.direct - a.direct)
    .slice(0, 10);

  const rawZ = pairs.map((p) => [p.direct, p.indirect]);
  let { z, zmax } = scaleHeatmapColumns(rawZ);
  let zmin = 0;

  Plotly.newPlot(
    els.pairwiseHeatmap,
    [
      {
        type: "heatmap",
        z,
        x: ["Direct", "Indirect"],
        y: pairs.map((p) => p.country),
        colorscale: metricType === "Flows" ? "YlOrBr" : "Sunsetdark",
        zmin,
        zmax,
        text: z.map((row) => row.map((v) => v.toFixed(3))),
        texttemplate: "%{text}",
        hovertemplate: "%{y} %{x}: %{z:.3f}<extra></extra>",
      },
    ],
    {
      margin: { l: 80, r: 20, t: 20, b: 20 },
      yaxis: { autorange: "reversed" },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: "Space Grotesk, sans-serif", color: "#131313" },
    },
    { responsive: true, displaylogo: false }
  );
}

function renderNrai(direct, indirect, deltas) {
  const directValue = Number.isFinite(direct) ? direct : NaN;
  const indirectValue = Number.isFinite(indirect) ? indirect : NaN;
  const displayValue = (value) => state.controls.nraiScale === "Normalized" && Number.isFinite(value)
    ? value / (1 + value)
    : value;
  const directDisplayValue = displayValue(directValue);
  const indirectDisplayValue = displayValue(indirectValue);
  const directColor = "#2563eb";
  const indirectColor = "#d97706";
  els.nraiDirect.textContent = Number.isFinite(directDisplayValue) ? directDisplayValue.toFixed(3) : "-";
  els.nraiIndirect.textContent = Number.isFinite(indirectDisplayValue) ? indirectDisplayValue.toFixed(3) : "-";
  els.nraiDirect.style.color = Number.isFinite(directDisplayValue) ? directColor : "#64748b";
  els.nraiIndirect.style.color = Number.isFinite(indirectDisplayValue) ? indirectColor : "#64748b";

  const regime = Number.isFinite(directValue) && Number.isFinite(indirectValue) ? classifyRegime(directValue, indirectValue) : "-";
  els.nraiRegime.textContent = `Overall regime: ${regime}`;
  els.nraiRegime.style.color = "#6b4f2a";

  const totalAbsoluteDelta = [...deltas.values()].reduce(
    (total, value) => total + Math.abs(value.direct) + Math.abs(value.indirect),
    0
  ) || 1;
  const displayDelta = (value) => state.controls.nraiScale === "Normalized"
    ? value / totalAbsoluteDelta
    : value;
  const top = [...deltas.entries()]
    .map(([country, val]) => ({
      country,
      direct: displayDelta(val.direct),
      indirect: displayDelta(val.indirect),
      abs: Math.abs(val.direct) + Math.abs(val.indirect),
    }))
    .sort((a, b) => b.abs - a.abs)
    .slice(0, 10)
    .reverse();

  Plotly.newPlot(
    els.nraiDrivers,
    [
      {
        type: "bar",
        orientation: "h",
        y: top.map((r) => `${r.country} - ${nameByIso3(r.country).slice(0, 18)}`),
        x: top.map((r) => r.direct),
        name: "Direct delta",
        marker: { color: "rgba(37, 99, 235, 0.86)" },
      },
      {
        type: "bar",
        orientation: "h",
        y: top.map((r) => `${r.country} - ${nameByIso3(r.country).slice(0, 18)}`),
        x: top.map((r) => r.indirect),
        name: "Indirect delta",
        marker: { color: "rgba(217, 119, 6, 0.86)" },
      },
    ],
    {
      barmode: "relative",
      margin: { l: 170, r: 20, t: 20, b: 30 },
      yaxis: { automargin: true },
      xaxis: {
        title: state.controls.nraiScale === "Normalized"
          ? "Relative contribution (share of total absolute change)"
          : "Weighted - Unweighted contribution",
        zeroline: true,
        zerolinecolor: "#6b7280",
      },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: "Space Grotesk, sans-serif", color: "#131313" },
      showlegend: false,
    },
    { responsive: true, displaylogo: false }
  );
}

function renderOverviewTable(displayRows, hubsRawDirect, hubsRawIndirect, hubsRiskDirect, hubsRiskIndirect, centerCountry, autScoresDirect, autScoresIndirect) {
  const nodes = [...new Set(displayRows.flatMap((r) => [r.from, r.to]))].sort();

  const headers = [
    "Country",
    "Trade value",
    "Risk-weighted value",
    "Unweighted Hub Direct",
    "Unweighted Hub Indirect",
    "Weighted Hub Direct",
    "Weighted Hub Indirect",
    "Focus country score direct",
    "Focus country score indirect",
  ];

  els.tableHead.innerHTML = "";
  els.tableBody.innerHTML = "";

  const hr = document.createElement("tr");
  for (const h of headers) {
    const th = document.createElement("th");
    th.textContent = h;
    hr.append(th);
  }
  els.tableHead.append(hr);

  const incomingValue = new Map();
  const incomingWeighted = new Map();
  for (const row of displayRows) {
    const v = Number(row.value || 0);
    incomingValue.set(row.to, (incomingValue.get(row.to) || 0) + v);

    const risk = Number(row.ps_norm);
    const weighted = Number.isFinite(risk) ? v * risk : v;
    incomingWeighted.set(row.to, (incomingWeighted.get(row.to) || 0) + weighted);
  }

  for (const node of nodes.slice(0, 60)) {
    const tr = document.createElement("tr");
    const vals = [
      `${node}: ${nameByIso3(node)}`,
      formatNumber(incomingValue.get(node) || 0, 0),
      formatNumber(incomingWeighted.get(node) || 0, 0),
      formatNumber(10 * (hubsRawDirect.get(node) || 0), 3),
      formatNumber(10 * (hubsRawIndirect.get(node) || 0), 3),
      formatNumber(10 * (hubsRiskDirect.get(node) || 0), 3),
      formatNumber(10 * (hubsRiskIndirect.get(node) || 0), 3),
      formatNumber(autScoresDirect.get(node) || 0, 3),
      formatNumber(autScoresIndirect.get(node) || 0, 3),
    ];

    for (const v of vals) {
      const td = document.createElement("td");
      td.textContent = v;
      tr.append(td);
    }
    els.tableBody.append(tr);
  }
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadRawData() {
  const [productCol, productCode] = selectedProductKey();
  const rows = state.currentHs2Rows.filter((row) => String(row[productCol]) === String(productCode));
  if (!rows.length) return;

  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const csv = [
    columns.map(csvCell).join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ].join("\r\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `raw_${productCode}_${state.controls.hsDigitLevel}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function runComputations() {
  const [productCol, productCode] = selectedProductKey();
  let productRows = state.currentHs2Rows.filter((row) => String(row[productCol]) === String(productCode));

  if (!productRows.length) {
    els.networkTitle.textContent = `No rows for ${productCol}=${productCode}`;
    els.networkProduct.textContent = "";
    return;
  }

  let centerCountry = state.controls.focusCountry;

  if (state.controls.aggregateEu) {
    const agg = aggregateEuRows(productRows, centerCountry);
    productRows = agg.rows;
    centerCountry = agg.centerCountry;
  }

  const { flowRows, renderRows } = computeRenderRows(productRows, centerCountry);
  const adjacency = buildAdjacency(flowRows);
  const centerIdx = adjacency.idxByNode.get(centerCountry);
  if (centerIdx === undefined) {
    els.networkTitle.textContent = `Focus country ${centerCountry} is not available for this product.`;
    els.networkProduct.textContent = "";
    return;
  }

  // Debug: Check ps_norm values
  const psNormValues = flowRows
    .map((r) => Number(r.ps_norm))
    .filter((v) => Number.isFinite(v));
  const psNormMin = psNormValues.length ? psNormValues.reduce((minimum, value) => Math.min(minimum, value), Infinity) : "N/A";
  const psNormMax = psNormValues.length ? psNormValues.reduce((maximum, value) => Math.max(maximum, value), -Infinity) : "N/A";
  const nullCount = flowRows.filter((r) => r.ps_norm === null || r.ps_norm === undefined).length;
  console.log(`DEBUG: ps_norm - min: ${psNormMin}, max: ${psNormMax}, null count: ${nullCount}/${flowRows.length}`);
  renderNetwork(renderRows, centerCountry);

  const riskWeights = computeRiskWeights(flowRows, adjacency.nodes);
  const hitsRaw = hitsIterative(adjacency.matrix, null, 5, 1e-6);
  const hitsRisk = hitsIterative(adjacency.matrix, riskWeights, 5, 1e-6);
  const iLastRaw = Math.min(4, hitsRaw.length - 1);
  const iLastRisk = Math.min(4, hitsRisk.length - 1);

  const hubsRawDirect = toMap(adjacency.nodes, hitsRaw[0].hub);
  const hubsRawIndirect = toMap(adjacency.nodes, hitsRaw[iLastRaw].hub);
  const hubsRiskDirect = toMap(adjacency.nodes, hitsRisk[0].hub);
  const hubsRiskIndirect = toMap(adjacency.nodes, hitsRisk[iLastRisk].hub);

  const directRawScores = computeCenterPairwiseScores(adjacency.matrix, hitsRaw[0].hub, hitsRaw[0].authority, centerIdx);
  const indirectRawScores = computeCenterPairwiseScores(adjacency.matrix, hitsRaw[iLastRaw].hub, hitsRaw[iLastRaw].authority, centerIdx);
  const directRiskScores = computeCenterPairwiseScores(adjacency.matrix, hitsRisk[0].hub, hitsRisk[0].authority, centerIdx);
  const indirectRiskScores = computeCenterPairwiseScores(adjacency.matrix, hitsRisk[iLastRisk].hub, hitsRisk[iLastRisk].authority, centerIdx);

  const sum = (arr) => arr.reduce((acc, x) => acc + x, 0);
  // NRAI formula: ratio of risk-weighted to unweighted authority scores (line 1436-1437 in phoenigs18_v6.py)
  const eps = 1e-12;
  const nraiDirect = sum(directRiskScores) / (sum(directRawScores) + eps);
  const nraiIndirect = sum(indirectRiskScores) / (sum(indirectRawScores) + eps);

  const autScoresDirectMap = toMap(adjacency.nodes, directRawScores);
  const autScoresIndirectMap = toMap(adjacency.nodes, indirectRawScores);

  renderDependencyHeatmap(
    adjacency.nodes,
    state.controls.metricType === "Flows" ? hubsRawDirect : hubsRiskDirect,
    state.controls.metricType === "Flows" ? hubsRawIndirect : hubsRiskIndirect,
    centerCountry,
    state.controls.metricType
  );

  renderPairwiseHeatmap(
    adjacency.nodes,
    state.controls.metricType === "Flows" ? autScoresDirectMap : toMap(adjacency.nodes, directRiskScores),
    state.controls.metricType === "Flows" ? autScoresIndirectMap : toMap(adjacency.nodes, indirectRiskScores),
    centerCountry,
    state.controls.metricType
  );

  const deltas = new Map();
  for (let i = 0; i < adjacency.nodes.length; i += 1) {
    deltas.set(adjacency.nodes[i], {
      direct: directRiskScores[i] - directRawScores[i],
      indirect: indirectRiskScores[i] - indirectRawScores[i],
    });
  }
  renderNrai(nraiDirect, nraiIndirect, deltas);

  renderOverviewTable(
    renderRows,
    hubsRawDirect,
    hubsRawIndirect,
    hubsRiskDirect,
    hubsRiskIndirect,
    centerCountry,
    autScoresDirectMap,
    autScoresIndirectMap
  );

  els.networkTitle.textContent = `Direct and indirect trade linkages (${state.controls.metricType})`;
  els.networkProduct.textContent = `${productCode}: ${selectedProductDescription(productCol, productCode)}`;
}

async function refreshHs2Data() {
  const payload = await loadHs2Data(state.controls.hs2Code);
  state.currentHs2Rows = payload.records || [];
}

async function render() {
  await refreshHs2Data();
  refreshMetaInfo();
  refreshOptionControls();
  runComputations();
}

function wireControls() {
  els.downloadRawData.addEventListener("click", downloadRawData);

  els.hsDigitLevel.forEach((radio) => {
    radio.addEventListener("change", (event) => {
      state.controls.hsDigitLevel = event.target.value;
      refreshOptionControls();
      runComputations();
    });
  });

  const defaultHsDigitLevel = document.querySelector('input[name="hsDigitLevel"][value="2-digit"]');
  if (defaultHsDigitLevel) {
    defaultHsDigitLevel.checked = true;
    state.controls.hsDigitLevel = "2-digit";
  }

  els.hs2Code.addEventListener("change", async (event) => {
    state.controls.hs2Code = event.target.value;
    const metadataHs2Code = baseHs2Code(state.controls.hs2Code);
    const hs4Options = state.metadata.hs4_by_hs2?.[metadataHs2Code] || [];
    state.controls.hs4Code = hs4Options[0]?.code || metadataHs2Code;
    const hs6Options = state.metadata.hs6_by_hs4?.[state.controls.hs4Code] || [];
    state.controls.hs6Code = hs6Options[0]?.code || state.controls.hs4Code;
    els.metaInfo.textContent = `Loading HS2 ${state.controls.hs2Code}...`;
    els.networkProduct.textContent = "Loading selected data...";
    try {
      await render();
    } catch (error) {
      console.error(error);
      els.metaInfo.textContent = `Loading failed: ${error.message}`;
      els.networkProduct.textContent = "";
    }
  });

  els.hs4Code.addEventListener("change", (event) => {
    state.controls.hs4Code = event.target.value;
    const hs6Options = state.metadata.hs6_by_hs4?.[state.controls.hs4Code] || [];
    state.controls.hs6Code = hs6Options[0]?.code || state.controls.hs4Code;
    refreshOptionControls();
    runComputations();
  });

  els.hs6Code.addEventListener("change", (event) => {
    state.controls.hs6Code = event.target.value;
    runComputations();
  });

  els.aggregateEu.addEventListener("change", (event) => {
    state.controls.aggregateEu = event.target.checked;
    refreshOptionControls();
    runComputations();
  });

  els.focusCountry.addEventListener("change", (event) => {
    state.controls.focusCountry = event.target.value;
    runComputations();
  });

  els.metricType.forEach((radio) => {
    radio.addEventListener("change", (event) => {
      state.controls.metricType = event.target.value;
      runComputations();
    });
  });

  const defaultMetricType = document.querySelector('input[name="metricType"][value="Flows"]');
  if (defaultMetricType) {
    defaultMetricType.checked = true;
    state.controls.metricType = "Flows";
  }

  els.renderTopX.addEventListener("input", (event) => {
    state.controls.renderTopX = Number(event.target.value || 25);
    els.renderTopXValue.textContent = String(state.controls.renderTopX);
    runComputations();
  });

  els.topNPartners.addEventListener("input", (event) => {
    state.controls.topNPartners = Number(event.target.value || 5);
    els.topNPartnersValue.textContent = String(state.controls.topNPartners);
    runComputations();
  });

  els.focusEdgesOnly.addEventListener("change", (event) => {
    state.controls.focusEdgesOnly = event.target.checked;
    runComputations();
  });

  els.edgePercentile.addEventListener("input", (event) => {
    state.controls.edgePercentile = Number(event.target.value || 35);
    els.edgePercentileValue.textContent = String(state.controls.edgePercentile);
    runComputations();
  });

  els.pairwiseScale.forEach((radio) => {
    radio.addEventListener("change", (event) => {
      state.controls.pairwiseScale = event.target.value;
      runComputations();
    });
  });

  els.nraiScale.forEach((radio) => {
    radio.addEventListener("change", (event) => {
      state.controls.nraiScale = event.target.value;
      runComputations();
    });
  });

  els.riskThresholdLow.addEventListener("input", (event) => {
    state.controls.riskThresholdLow = parseFloat(event.target.value);
    if (state.controls.riskThresholdLow > state.controls.riskThresholdHigh) {
      state.controls.riskThresholdHigh = state.controls.riskThresholdLow;
      els.riskThresholdHigh.value = String(state.controls.riskThresholdHigh);
      els.riskThresholdHighValue.textContent = state.controls.riskThresholdHigh.toFixed(2);
    }
    els.riskThresholdLowValue.textContent = state.controls.riskThresholdLow.toFixed(2);
    runComputations();
  });

  els.riskThresholdHigh.addEventListener("input", (event) => {
    state.controls.riskThresholdHigh = parseFloat(event.target.value);
    if (state.controls.riskThresholdHigh < state.controls.riskThresholdLow) {
      state.controls.riskThresholdLow = state.controls.riskThresholdHigh;
      els.riskThresholdLow.value = String(state.controls.riskThresholdLow);
      els.riskThresholdLowValue.textContent = state.controls.riskThresholdLow.toFixed(2);
    }
    els.riskThresholdHighValue.textContent = state.controls.riskThresholdHigh.toFixed(2);
    runComputations();
  });
}

async function init() {
  try {
    wireControls();
    await loadMetadata();
    await render();
  } catch (error) {
    console.error(error);
    els.metaInfo.textContent = `Initialization failed: ${error.message}`;
  }
}

init();
