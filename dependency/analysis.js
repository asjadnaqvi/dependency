(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TradeAnalysis = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const HITS_ITERATIONS = 30;
  const EU27_CODES = new Set([
    "AUT", "BEL", "BGR", "HRV", "CYP", "CZE", "DNK", "ESP", "EST", "FIN", "FRA",
    "DEU", "GRC", "HUN", "IRL", "ITA", "LVA", "LTU", "LUX", "MLT", "NLD", "POL",
    "PRT", "ROU", "SVK", "SVN", "SWE",
  ]);

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
          from: row.from, to: row.to, value: 0, weightedSum: 0, weightBase: 0,
          ex_region: row.from === "EU27" ? "EU27" : row.ex_region,
          im_region: row.to === "EU27" ? "EU27" : row.im_region,
          ex_name: row.from === "EU27" ? "EU27" : row.ex_name,
          im_name: row.to === "EU27" ? "EU27" : row.im_name,
          eu: Boolean(row.eu),
        });
      }
      const agg = map.get(key);
      const v = Number(row.value || 0);
      const risk = row.ps_norm == null ? NaN : Number(row.ps_norm);
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
        from: agg.from, to: agg.to, value: agg.value,
        ps_norm: agg.weightBase > 0 ? agg.weightedSum / agg.weightBase : null,
        ex_region: agg.ex_region, im_region: agg.im_region,
        ex_name: agg.ex_name, im_name: agg.im_name, eu: agg.eu,
      });
    }
    const center = EU27_CODES.has(focusCountry) ? "EU27" : focusCountry;
    return { rows: out, centerCountry: center };
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

  function hitsIterative(adj, nodeWeights = null, maxIter = HITS_ITERATIONS) {
    const n = adj.length;
    let h = new Array(n).fill(1);
    let a = new Array(n).fill(1);
    const w = nodeWeights && nodeWeights.length === n ? nodeWeights : new Array(n).fill(1);
    const history = [];
    for (let iter = 0; iter < maxIter; iter += 1) {
      const aNew = new Array(n).fill(0);
      for (let i = 0; i < n; i += 1) {
        for (let j = 0; j < n; j += 1) aNew[j] += adj[i][j] * h[i];
      }
      for (let j = 0; j < n; j += 1) aNew[j] *= w[j];
      const aNorm = l2norm(aNew) || 1;
      for (let j = 0; j < n; j += 1) aNew[j] /= aNorm;
      const hNew = new Array(n).fill(0);
      for (let i = 0; i < n; i += 1) {
        for (let j = 0; j < n; j += 1) hNew[i] += adj[i][j] * aNew[j];
      }
      for (let i = 0; i < n; i += 1) hNew[i] *= w[i];
      const hNorm = l2norm(hNew) || 1;
      for (let i = 0; i < n; i += 1) hNew[i] /= hNorm;
      history.push({ hub: hNew.slice(), authority: aNew.slice() });
      h = hNew;
      a = aNew;
    }
    return history;
  }

  function computeRiskWeights(flowRows, nodes) {
    const stats = new Map();
    for (const row of flowRows) {
      const key = row.from;
      if (!stats.has(key)) stats.set(key, { sum: 0, count: 0 });
      const risk = row.ps_norm == null ? NaN : Number(row.ps_norm);
      if (Number.isFinite(risk)) {
        const cur = stats.get(key);
        cur.sum += risk;
        cur.count += 1;
      }
    }
    return nodes.map((n) => {
      const s = stats.get(n);
      if (!s || !s.count) return 1.0;
      const avgRisk = s.sum / s.count;
      return Number.isFinite(avgRisk) ? avgRisk : 1.0;
    });
  }

  function riskMapFromRecords(records) {
    const map = new Map();
    const seen = new Set();
    let missingValues = 0;
    for (const row of records) {
      const country = String(row.iso3 ?? "").trim().toUpperCase();
      const missing = row.risk == null || String(row.risk).trim() === "";
      if (!country && missing) continue;
      if (!/^[A-Z]{3}$/.test(country)) throw new Error(`Invalid risk ISO3 code: ${country}`);
      if (seen.has(country)) throw new Error(`Duplicate risk country: ${country}`);
      seen.add(country);
      if (missing) {
        missingValues += 1;
        continue;
      }
      const risk = Number(row.risk);
      if (!Number.isFinite(risk) || risk < 0 || risk > 100) {
        throw new Error(`Invalid percentage risk: ${country}`);
      }
      map.set(country, risk / 100);
    }
    if (!map.size) throw new Error("No observed country risks");
    return { map, missingValues };
  }

  function computeSupplierAnalysis(rows, centerCountry) {
    const tradeRows = rows.map((row) => ({ ...row, flow_weight: Number(row.value || 0) }));
    const adjacency = buildAdjacency(tradeRows);
    const riskWeights = computeRiskWeights(tradeRows, adjacency.nodes);
    const hitsRaw = hitsIterative(adjacency.matrix);
    const hitsRisk = hitsIterative(adjacency.matrix, riskWeights);
    const imports = new Map();
    for (const row of tradeRows) {
      if (row.to === centerCountry && row.from !== centerCountry && row.value > 0) {
        imports.set(row.from, (imports.get(row.from) || 0) + Number(row.value));
      }
    }
    const totalImports = [...imports.values()].reduce((sum, value) => sum + value, 0);
    const suppliers = [...imports].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([country, value]) => {
        const idx = adjacency.idxByNode.get(country);
        const importShare = value / totalImports;
        const raw = [hitsRaw[0].hub[idx], hitsRaw[HITS_ITERATIONS - 1].hub[idx]];
        const risk = [hitsRisk[0].hub[idx], hitsRisk[HITS_ITERATIONS - 1].hub[idx]];
        return {
          country, value, importShare, raw, risk,
          rawExposure: importShare * raw[1],
          riskExposure: importShare * risk[1],
          supplierRisk: riskWeights[idx],
          missingRisk: !tradeRows.some((row) =>
            row.from === country && row.ps_norm != null && Number.isFinite(Number(row.ps_norm))
          ),
        };
      });
    const supplierByCountry = new Map(suppliers.map((supplier) => [supplier.country, supplier]));
    const countries = adjacency.nodes.map((country, idx) => supplierByCountry.get(country) || {
      country, value: 0, importShare: 0,
      raw: [hitsRaw[0].hub[idx], hitsRaw[HITS_ITERATIONS - 1].hub[idx]],
      risk: [hitsRisk[0].hub[idx], hitsRisk[HITS_ITERATIONS - 1].hub[idx]],
      rawExposure: 0, riskExposure: 0,
      supplierRisk: riskWeights[idx],
      missingRisk: !tradeRows.some((row) =>
        row.from === country && row.ps_norm != null && Number.isFinite(Number(row.ps_norm))
      ),
    }).sort((a, b) => b.importShare - a.importShare || a.country.localeCompare(b.country));
    return { adjacency, hitsRaw, hitsRisk, suppliers, countries, totalImports };
  }

  return { HITS_ITERATIONS, EU27_CODES, aggregateEuRows, buildAdjacency, l2norm,
    hitsIterative, computeRiskWeights, computeSupplierAnalysis, riskMapFromRecords };
});
