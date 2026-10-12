const METADATA_URL = "data/metadata.json";
const HS2_BASE = "data/hs2";
const RISK_FILE_URL = "data/wgi-pv-risk-2024.json";
const {
  HITS_ITERATIONS, EU27_CODES, aggregateEuRows, buildAdjacency, l2norm,
  hitsIterative, computeRiskWeights, computeSupplierAnalysis, riskMapFromRecords,
} = TradeAnalysis;

let cy = null; // Global cytoscape instance

const REGION_COLORS = {
  Asia: "#F4B942",
  Africa: "#67B7AE",
  Oceania: "#E58AAA",
  Americas: "#A78BFA",
  "Europe (EU)": "#6EA8FE",
  "Europe (non-EU)": "#9CC7FF",
  Other: "#CBD5E1",
};

const EDGE_COLORS = {
  incoming: "rgba(37, 99, 235, 0.92)",
  outgoing: "rgba(147, 51, 234, 0.90)",
  other: "rgba(148, 163, 184, 0.55)",
  lowRisk: "rgba(0, 200, 0, 0.7)",
  moderateRisk: "rgba(255, 215, 0, 0.7)",
  highRisk: "rgba(255, 0, 0, 0.7)",
  unknownRisk: "rgba(59, 130, 246, 0.75)",
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
    analysisMode: "Trade only",
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
  analysisMode: document.querySelectorAll('input[name="analysisMode"]'),
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
  exposureSummary: document.getElementById("exposureSummary"),
  exposureWarning: document.getElementById("exposureWarning"),
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
  if (key === "asien" || key === "asia") return "Asia";
  if (key === "afrika" || key === "africa") return "Africa";
  if (key === "ozeanien" || key === "oceania") return "Oceania";
  if (key === "amerika" || key === "americas" || key === "america") return "Americas";
  if (["europa-eu", "europe-eu", "eu", "eu27", "europa eu", "europe eu", "europe (eu)"].includes(key)) return "Europe (EU)";
  if (["europa-rest", "europe-rest", "europa", "europe", "europe-other", "europe (non-eu)"].includes(key)) return "Europe (non-EU)";
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
  const riskData = await fetchJson(RISK_FILE_URL);
  if (riskData.observation_year !== 2024 || riskData.dimension !== "pv"
    || riskData.risk_scale !== "0-100" || !Array.isArray(riskData.records)) {
    throw new Error("Risk data must contain 2024 WGI Political Stability records.");
  }

  state.riskMap = riskMapFromRecords(riskData.records).map;
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

function rankImportPartners(rows, destinations) {
  const incoming = new Map();
  for (const row of rows) {
    const value = Number(row.value || 0);
    if (destinations.has(row.to) && row.from !== row.to && value > 0) {
      incoming.set(row.from, (incoming.get(row.from) || 0) + value);
    }
  }
  return [...incoming.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([country]) => country);
}

function computeRenderRows(rows, centerCountry) {
  const flowRows = rows.map((row) => {
    const base = Number(row.value || 0);
    const risk = row.ps_norm == null ? NaN : Number(row.ps_norm);
    // Fallback to 1.0 if ps_norm is NaN (unweighted), matching Python fillna(1.0)
    const normalizedRisk = Number.isFinite(risk) ? risk : 1.0;
    // Apply risk weighting when metricType is NOT 'Flows' (line 752 in phoenigs18_v6.py)
    const flow_weight =
      state.controls.metricType !== "Flows"
        ? base * normalizedRisk
        : base;
    return { ...row, flow_weight };
  });

  const partnerLimit = Math.max(0, state.controls.renderTopX - 1);
  const focusPartners = rankImportPartners(flowRows, new Set([centerCountry]));
  const innerCircle = focusPartners.slice(0, Math.min(state.controls.topNPartners, partnerLimit));
  const secondaryPartners = rankImportPartners(flowRows, new Set(innerCircle));
  const selectedNodes = [...new Set([...focusPartners, ...secondaryPartners])]
    .filter((node) => node !== centerCountry)
    .slice(0, partnerLimit);
  const renderNodes = [centerCountry, ...selectedNodes];
  const renderNodeSet = new Set(renderNodes);

  let filtered = flowRows.filter((row) => renderNodeSet.has(row.from) && renderNodeSet.has(row.to));

  if (state.controls.edgePercentile > 0 && filtered.length) {
    const values = filtered.map((row) => Number(row.flow_weight || 0)).sort((a, b) => a - b);
    const idx = Math.floor((state.controls.edgePercentile / 100) * (values.length - 1));
    const cutoff = values[Math.max(0, Math.min(values.length - 1, idx))];
    // Preserve all direct focus-country trade among the selected countries.
    filtered = filtered.filter((row) =>
      row.from === centerCountry || row.to === centerCountry ||
      Number(row.flow_weight || 0) >= cutoff
    );
  }

  if (state.controls.focusEdgesOnly) {
    filtered = filtered.filter((row) => row.from === centerCountry || row.to === centerCountry);
  }

  return { flowRows, renderRows: filtered, renderNodes, innerCircle };
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

function buildRingPositions(renderNodes, innerCircle, centerCountry) {
  const outerCircle = renderNodes.filter((n) => n !== centerCountry && !innerCircle.includes(n));

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
    ["Low", EDGE_COLORS.lowRisk, `&lt; ${low}`],
    ["Moderate", EDGE_COLORS.moderateRisk, `${low} to &lt; ${high}`],
    ["High", EDGE_COLORS.highRisk, `&ge; ${high}`],
    ["No risk data", EDGE_COLORS.unknownRisk, "fallback"],
  ]
    .map(
      ([name, color, range]) =>
        `<span class="legend-item"><span class="legend-dot" style="background:${color}"></span>${name} (${range})</span>`
    )
    .join("");
  const flowEntries = [
    ["Imports into focus country", EDGE_COLORS.incoming],
    ["Exports from focus country", EDGE_COLORS.outgoing],
    ["Other links (dimmed)", EDGE_COLORS.other],
  ]
    .map(
      ([name, color]) =>
        `<span class="legend-item"><span class="legend-dot" style="background:${color}"></span>${name}</span>`
    )
    .join("");
  const edgeLegend = state.controls.metricType === "Flows"
    ? `<span class="legend-title">Trade direction</span>${flowEntries}`
    : `<span class="legend-title">Risk thresholds</span>${riskEntries}<span class="legend-item">Non-focus links are dimmed</span>`;

  els.networkLegend.innerHTML = `
    <div class="legend-group"><span class="legend-title">Regions</span>${entries}</div>
    <div class="legend-group">${edgeLegend}</div>
  `;
}

function renderNetwork(renderRows, centerCountry, flowRows, renderNodes, innerCircle) {
  renderLegend();
  const { pos } = buildRingPositions(renderNodes, innerCircle, centerCountry);
  const nodes = renderNodes;

  const exporterTotals = new Map();
  const exporterToCenter = new Map();
  for (const row of flowRows) {
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
    const exporterRow = flowRows.find((r) => r.from === node);
    const importerRow = flowRows.find((r) => r.to === node);
    const sourceRegion = exporterRow?.ex_region || importerRow?.im_region || "Other";
    const region = EU27_CODES.has(node) ? "Europe (EU)" : regionBucket(sourceRegion);
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
        title: `${nameByIso3(node)} (${node})\nExports total (full product data): ${formatNumber(outgoing, 0)}\nExports to ${centerCountry}: ${formatNumber(toCenter, 0)}`,
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
    const risk = row.ps_norm == null ? NaN : Number(row.ps_norm);
    const width = 0.8 + (Math.log1p(weight) / Math.log1p(maxEdge)) * 8.0;

    let color = EDGE_COLORS.other;
    const touchesFocus = row.from === centerCountry || row.to === centerCountry;

    if (state.controls.metricType === "Flows") {
      if (row.to === centerCountry) color = EDGE_COLORS.incoming;
      else if (row.from === centerCountry) color = EDGE_COLORS.outgoing;
    } else if (state.controls.metricType === "Country risk traffic light") {
      if (Number.isFinite(risk)) {
        if (risk < state.controls.riskThresholdLow) color = EDGE_COLORS.lowRisk;
        else if (risk < state.controls.riskThresholdHigh) color = EDGE_COLORS.moderateRisk;
        else color = EDGE_COLORS.highRisk;
      } else {
        color = EDGE_COLORS.unknownRisk;
      }
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
      classes: touchesFocus ? "" : "muted-edge",
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

function scaleHeatmapColumns(values, normalized = state.controls.pairwiseScale === "Column-normalized") {
  if (normalized) {
    const sumDirect = values.reduce((acc, row) => acc + row[0], 0) || 1;
    const sumIndirect = values.reduce((acc, row) => acc + row[1], 0) || 1;
    return {
      z: values.map((row) => [(row[0] / sumDirect) * 100, (row[1] / sumIndirect) * 100]),
      zmax: 100,
    };
  }

  const max = Math.max(...values.flat(), 1);
  return { z: values, zmax: max };
}

function supplierHeatmapData(analysis, riskAdjusted, normalized) {
  const key = riskAdjusted ? "risk" : "raw";
  const exposureKey = riskAdjusted ? "riskExposure" : "rawExposure";
  const allNetwork = analysis.suppliers.map((supplier) => supplier[key]);
  const network = normalized ? scaleHeatmapColumns(allNetwork, true).z : allNetwork;
  const totalExposure = analysis.suppliers.reduce((sum, supplier) => sum + supplier[exposureKey], 0);
  const exposureDisplayed = [...analysis.suppliers]
    .sort((a, b) => b.importShare - a.importShare || a.country.localeCompare(b.country))
    .slice(0, 10);
  return {
    displayed: analysis.suppliers.slice(0, 10),
    exposureDisplayed,
    network: network.slice(0, 10),
    exposure: exposureDisplayed.map((supplier) => [
      supplier.importShare * (normalized ? 100 : 1),
      normalized
        ? (totalExposure > 0 ? supplier[exposureKey] / totalExposure * 100 : 0)
        : supplier[exposureKey],
    ]),
    totalExposure,
  };
}

function renderSupplierHeatmaps(analysis) {
  const riskAdjusted = state.controls.analysisMode === "Risk-adjusted";
  const normalized = state.controls.pairwiseScale === "Column-normalized";
  const data = supplierHeatmapData(analysis, riskAdjusted, normalized);
  const coverage = data.exposureDisplayed.reduce((sum, supplier) => sum + supplier.importShare, 0) * 100;
  const missingRisk = analysis.suppliers.filter((supplier) => supplier.missingRisk);
  els.exposureSummary.textContent = analysis.suppliers.length
    ? `Showing ${data.exposureDisplayed.length} of ${analysis.suppliers.length} suppliers, covering ${coverage.toFixed(1)}% of product imports.`
    : "No positive imports from external suppliers for this country and product.";
  const warnings = [];
  if (analysis.suppliers.length && data.totalExposure === 0) {
    warnings.push("Selected network exposure is zero; normalized exposure shares are undefined and shown as zero.");
  }
  if (missingRisk.length) {
    warnings.push(`Missing supplier risk: ${missingRisk.map((supplier) => supplier.country).join(", ")}; neutral multiplier 1 is used.`);
  }
  els.exposureWarning.textContent = warnings.join(" ");
  els.exposureWarning.hidden = !warnings.length;
  const layout = {
    height: 400,
    margin: { l: 65, r: 20, t: 30, b: 80 },
    xaxis: { tickangle: 0, automargin: true },
    yaxis: { autorange: "reversed" },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: "Space Grotesk, sans-serif", color: "#131313" },
    annotations: analysis.suppliers.length ? [] : [{
      text: "No suppliers for this country and product", showarrow: false,
      x: 0.5, y: 0.5, xref: "paper", yref: "paper",
    }],
  };
  const plot = (element, z, x, isExposure) => {
    const suppliers = isExposure ? data.exposureDisplayed : data.displayed;
    const customdata = suppliers.map((supplier) => [
      supplier.value, supplier.importShare * 100,
      supplier[riskAdjusted ? "risk" : "raw"][1],
    ]);
    const trace = {
      type: "heatmap", z, x,
      y: suppliers.map((supplier) => supplier.country),
      colorscale: riskAdjusted ? "Sunsetdark" : "YlOrBr",
      zmin: 0, zmax: normalized ? 100 : 1,
      customdata: z.map((row, i) => row.map((value) => [value, ...customdata[i]])),
      text: z.map((row) => row.map((value) => value.toFixed(normalized ? 2 : 6))),
      texttemplate: "%{text}",
      colorbar: { title: normalized ? "%" : isExposure ? "Raw score" : "Hub score" },
      hovertemplate: "%{y}<br>%{x}: %{customdata[0]:.6f}<br>Product exports to focus: %{customdata[1]:,.2f}<br>Import share: %{customdata[2]:.2f}%<br>Refined hub score: %{customdata[3]:.6f}<extra></extra>",
    };
    Plotly.newPlot(element, [trace], layout, { responsive: true, displaylogo: false });
  };
  plot(els.dependencyHeatmap, data.network, ["Direct", "Total"], false);
  plot(els.pairwiseHeatmap, data.exposure, ["Direct", "Total"], true);
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
  els.nraiRegime.textContent = regime === "-"
    ? "NRAI unavailable: no positive trade-only pairwise baseline."
    : `Overall regime: ${regime}`;
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

  if (els.nraiDrivers.closest?.("[hidden]")) return;

  Plotly.newPlot(
    els.nraiDrivers,
    [
      {
        type: "bar",
        orientation: "h",
        y: top.map((r) => `${r.country} - ${nameByIso3(r.country).slice(0, 18)}`),
        x: top.map((r) => r.direct),
        name: "Initial delta (1)",
        marker: { color: "rgba(37, 99, 235, 0.86)" },
      },
      {
        type: "bar",
        orientation: "h",
        y: top.map((r) => `${r.country} - ${nameByIso3(r.country).slice(0, 18)}`),
        x: top.map((r) => r.indirect),
        name: `Refined delta (${HITS_ITERATIONS})`,
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

function renderOverviewTable(analysis, centerCountry) {
  const normalized = state.controls.pairwiseScale === "Column-normalized";
  const unit = normalized ? "(%)" : "(raw)";
  const networkScores = (key) => {
    const totals = [0, 1].map((column) =>
      analysis.suppliers.reduce((sum, supplier) => sum + supplier[key][column], 0) || 1
    );
    return analysis.countries.map((country) => country[key].map((value, column) =>
      normalized ? value / totals[column] * 100 : value
    ));
  };
  const rawNetwork = networkScores("raw");
  const riskNetwork = networkScores("risk");
  const rawTotal = analysis.suppliers.reduce((sum, supplier) => sum + supplier.rawExposure, 0);
  const riskTotal = analysis.suppliers.reduce((sum, supplier) => sum + supplier.riskExposure, 0);
  const riskAdjusted = state.controls.analysisMode === "Risk-adjusted";
  const selectedNetwork = riskAdjusted ? riskNetwork : rawNetwork;
  const selectedExposureKey = riskAdjusted ? "riskExposure" : "rawExposure";
  const selectedExposureTotal = riskAdjusted ? riskTotal : rawTotal;
  const headers = [
    "Country",
    `Product exports to ${centerCountry} (source units)`,
    `Import share ${normalized ? "(%)" : "(fraction)"}`,
    "Exporter risk (0-1)",
    `Trade-only hub (1) ${unit}`,
    `Trade-only hub (${HITS_ITERATIONS}) ${unit}`,
    `Risk-adjusted hub (1) ${unit}`,
    `Risk-adjusted hub (${HITS_ITERATIONS}) ${unit}`,
    `Trade-only exposure ${unit}`,
    `Risk-adjusted exposure ${unit}`,
    `Global importance - Direct ${unit}`,
    `Global importance - Total ${unit}`,
    `Import Dependency - Direct ${normalized ? "(%)" : "(fraction)"}`,
    `Import Dependency - Total ${unit}`,
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

  const decimals = normalized ? 2 : 6;
  const exposure = (value, total) => normalized ? (total > 0 ? value / total * 100 : 0) : value;
  for (const [i, supplier] of analysis.countries.entries()) {
    const tr = document.createElement("tr");
    const vals = [
      `${supplier.country}: ${nameByIso3(supplier.country)}`,
      formatNumber(supplier.value, 2),
      formatNumber(supplier.importShare * (normalized ? 100 : 1), decimals),
      supplier.missingRisk ? "missing" : formatNumber(supplier.supplierRisk, 3),
      ...rawNetwork[i].map((value) => formatNumber(value, decimals)),
      ...riskNetwork[i].map((value) => formatNumber(value, decimals)),
      formatNumber(exposure(supplier.rawExposure, rawTotal), decimals),
      formatNumber(exposure(supplier.riskExposure, riskTotal), decimals),
      ...selectedNetwork[i].map((value) => formatNumber(value, decimals)),
      formatNumber(supplier.importShare * (normalized ? 100 : 1), decimals),
      formatNumber(exposure(supplier[selectedExposureKey], selectedExposureTotal), decimals),
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

function clearProductAnalysis(centerCountry, productCol, productCode) {
  renderSupplierHeatmaps(computeSupplierAnalysis([], centerCountry));
  renderNrai(NaN, NaN, new Map());
  els.tableHead.innerHTML = "";
  els.tableBody.innerHTML = "";
  if (cy) {
    cy.destroy();
    cy = null;
  }
}

function runComputations() {
  const [productCol, productCode] = selectedProductKey();
  let productRows = state.currentHs2Rows.filter((row) => String(row[productCol]) === String(productCode));

  if (!productRows.length) {
    clearProductAnalysis(state.controls.focusCountry, productCol, productCode);
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

  const { flowRows, renderRows, renderNodes, innerCircle } = computeRenderRows(productRows, centerCountry);
  els.topNPartnersValue.textContent = innerCircle.length === state.controls.topNPartners
    ? String(state.controls.topNPartners)
    : `${state.controls.topNPartners} (showing ${innerCircle.length})`;
  const analysis = computeSupplierAnalysis(productRows, centerCountry);
  const { adjacency, hitsRaw, hitsRisk } = analysis;
  const centerIdx = adjacency.idxByNode.get(centerCountry);
  if (centerIdx === undefined) {
    clearProductAnalysis(centerCountry, productCol, productCode);
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
  renderNetwork(renderRows, centerCountry, flowRows, renderNodes, innerCircle);

  const iLastRaw = HITS_ITERATIONS - 1;
  const iLastRisk = HITS_ITERATIONS - 1;


  const directRawScores = computeCenterPairwiseScores(adjacency.matrix, hitsRaw[0].hub, hitsRaw[0].authority, centerIdx);
  const indirectRawScores = computeCenterPairwiseScores(adjacency.matrix, hitsRaw[iLastRaw].hub, hitsRaw[iLastRaw].authority, centerIdx);
  const directRiskScores = computeCenterPairwiseScores(adjacency.matrix, hitsRisk[0].hub, hitsRisk[0].authority, centerIdx);
  const indirectRiskScores = computeCenterPairwiseScores(adjacency.matrix, hitsRisk[iLastRisk].hub, hitsRisk[iLastRisk].authority, centerIdx);

  const sum = (arr) => arr.reduce((acc, x) => acc + x, 0);
  // Compare risk-weighted and trade-only pairwise totals on the same trade matrix.
  const rawDirectTotal = sum(directRawScores);
  const rawIndirectTotal = sum(indirectRawScores);
  const nraiDirect = rawDirectTotal > 0 ? sum(directRiskScores) / rawDirectTotal : NaN;
  const nraiIndirect = rawIndirectTotal > 0 ? sum(indirectRiskScores) / rawIndirectTotal : NaN;

  renderSupplierHeatmaps(analysis);

  const deltas = new Map();
  for (let i = 0; i < adjacency.nodes.length; i += 1) {
    deltas.set(adjacency.nodes[i], {
      direct: directRiskScores[i] - directRawScores[i],
      indirect: indirectRiskScores[i] - indirectRawScores[i],
    });
  }
  renderNrai(nraiDirect, nraiIndirect, deltas);

  renderOverviewTable(analysis, centerCountry);

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

  els.analysisMode.forEach((radio) => {
    radio.addEventListener("change", (event) => {
      state.controls.analysisMode = event.target.value;
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
