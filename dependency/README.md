# Dependency Dashboard

Static GitHub Pages dashboard for country-product dependency analysis.

## Network selection

The spider chart uses direct trade data for the selected product (after EU
aggregation, when enabled). Countries are selected using raw trade values,
not risk-weighted values or worldwide trade strength:

1. Place the focus country at the center.
2. Place its largest suppliers by exports to the focus country in the inner
   ring (five by default).
3. Add its remaining suppliers in descending trade-value order to the outer ring.
4. Fill any remaining slots with suppliers to the inner-ring countries, ranked
   by their combined exports to those countries. Deduplicate countries and
   exclude the focus country.

Top X is a strict country limit including the focus country. The inner ring
therefore contains at most Top X minus one countries, and can be smaller when
fewer suppliers exist. Self-trade and zero-value flows do not create suppliers.
Equal trade values are ordered by country code.
The chart can contain fewer than Top X countries when the eligible supplier
network is exhausted; unrelated countries are not added just to fill the limit.

Edge filtering does not rerank or remove selected countries. The percentile
filter always preserves all imports into and exports from the focus country
among selected countries, including outer-ring suppliers. Only links between
non-focus countries can be hidden by the percentile filter. The
percentile cutoff is calculated before the focus-only toggle is applied, so
that toggle only hides links between other countries and never adds links.
Node hover totals
use the full selected product data, not the displayed edge subset.

The rendering controls do not restrict the full product network used for HITS,
pairwise scores, or NRAI. These are network-derived indices, not bilateral
import-value rankings. Analytical weighting is independent of the network's
Flows / Country risk traffic light color control.

## Link colors

In Flows mode, blue links are imports into the focus country, violet links are
exports from it, and all links between other countries are light gray and
dimmed, including links involving inner-ring partners.

In risk mode, all links retain their exporter risk category color
(green/yellow/red, or blue for missing risk data). Links not touching the focus
country have lower opacity. The legend reflects the active mode.

## Interpreting the heatmaps

- **Global importance of suppliers** shows Direct (initial, iteration 1) and Total
  (refined, iteration 30) HITS hub scores for actual suppliers to the focus country.
  HITS runs exactly thirty iterations, without a convergence-based early exit,
  on the full raw-trade-value product adjacency.
- **Import Dependency** compares actual import share with
  network-adjusted exposure: import share as a fraction times the refined hub
  score. It no longer repeats the pairwise hub-authority-flow score.
  Its columns are Direct (actual import share) and Total (network-adjusted
  exposure). Total is not a sum of direct and indirect imports.

Each plot includes concise How to read, Direct / Total, and Scale and risk notes.
The first describes our suppliers' positions in the global product network;
the second describes our sourcing concentration with and without network
adjustment. Neither estimates substitutability or actual indirect shipments.

Both plots show the same top ten suppliers ordered by bilateral product
exports. The second plot independently sorts its own Direct (import-share)
column in descending order, with country-code tie breaking. Self-trade and zero
imports are excluded from supplier selection. Country/product selection is
shown in the network panel rather than repeated as heatplot subtitles.
Top-ten import coverage and hover details clarify scope.

The independent Supplier analysis control selects trade-only or risk-adjusted
HITS. Risk adjustment retains the Python-style country multipliers on hub and
authority updates; risk is not also multiplied into the analytical adjacency
or applied again to exposure. Missing country risk uses multiplier 1; missing
supplier risks are disclosed below the exposure plot. Genuine zero risk
remains zero.

Normalized (%) divides each network-score column or exposure contribution by
its total across **all** actual suppliers, before displaying the top ten.
The displayed scores therefore need not sum to 100%. Actual import shares
are fractions in Raw mode and percentages in Normalized mode, and are
unaffected by analytical mode. Raw scores
show the underlying L2-normalized hubs and composite exposure values, without
the old x10 hub display multiplier. The raw exposure plot uses a shared 0-1
color scale matching cell and hover values: Direct is the import-share fraction
without multiplying by 100; Total is raw exposure. Normalized mode retains a
shared 0-100% scale. Hover details additionally report actual import percentages.

Exposure shares are composite indicators, not import shares, monetary amounts,
substitutability measures, or disruption probabilities. Since HITS itself is
L2-normalized, raw exposure is not an absolute risk level. The summary shows
only supplier count and import coverage. Missing-risk and zero-exposure warnings
appear separately when applicable.

The NRAI section is temporarily hidden for later review; its implementation
is retained. NRAI continues to compare risk-weighted and trade-only hub-authority-flow
pairwise totals, now at iterations 1 and 30 on the same raw trade adjacency.
Its own normalization control is unchanged.

## Country and supplier details table

The table includes every country in the selected product network, without a
row cap. Suppliers appear first, sorted by import share; remaining countries
(including the focus country) appear alphabetically with zero bilateral
exports to the focus country, import share and exposure. It shows
bilateral product exports in source units, import share, supplier risk, hub
scores at iterations 1 and 30, and refined exposure for both analytical
weightings. Scores follow the heatmap scaling control, with no x10 multiplier;
normalized denominators include every supplier, matching the heatplots.
Non-supplier hub scores use the same supplier-based denominators, so the
full-country hub columns need not sum to 100%. Missing risk is labeled rather
than displayed as an observed risk of 1, using the label "missing" (the neutral
multiplier remains 1 in calculations). The final four columns reproduce Direct
and Total from Global importance and Import Dependency using the selected
analytical weighting and scale. Network rendering filters do not affect the
table. The CSV button still downloads underlying product records.

## Regression tests

Run `node --test dependency\app.test.cjs` from the repository root. Tests include
Austria's crude-oil imports (HS 270900) in the bundled data.

## Paper calculations: 2024 cross-section

The browser loads `analysis.js` before `app.js`. The shared module exports the
same EU aggregation, adjacency, HITS, risk-weighting and supplier calculations
to Node.js. There is no separate implementation of these formulas for the paper.

From the repository root, run:

```powershell
node scripts\analyze_paper.cjs
node --test dependency\app.test.cjs scripts\analyze_paper.test.cjs
```

The batch reads the provisional HS6 selection in
[`products.json`](../dependency%20paper/products.json), the dashboard metadata
and chapter files, and the local `baci_hs22_2024.csv`. It checks every selected
country-pair value and record count against that source before writing results.
The local source CSV is required and is not bundled with the deployed website.

[`results/`](../dependency%20paper/results/) contains full-precision supplier
and product CSVs, the provisional crosswalk, directly included LaTeX tables,
and a manifest with input/code hashes. Outputs include HHI, effective supplier
counts, exporter-size benchmarks, tied-rank correlations, a 1000-iteration
convergence diagnostic, and an EU-excluded centrality comparison using fixed
EU sourcing shares. Undefined rank correlations are blank, not zero.
The dashboard-compatible baseline remains exactly 30 iterations.

The main baseline is **trade-only**. The appendix additionally exports
`robustness.csv`, `robustness_suppliers.csv`, and generated `appendix.tex`.
It compares HS4 hubs using fixed HS6 sourcing shares, separately reports full
HS4 concentration, retains separate EU member-state nodes as a boundary test,
and compares iterations 1, 10, 30, 100 and 1000. All codes observed in the
selected parent headings are reconciled with the source, including a check
for source codes absent from the dashboard.

Paper robustness results are **conditional local-workbook scenarios**, not
validated 2024 risk estimates. They use the legacy manual workbook, read by a
Windows PowerShell OpenXML reader (`scripts\read_paper_risk.ps1`). The browser
dashboard separately uses the official WGI 2024 Political Stability proxy
described below. The shared country-risk parser distinguishes blank cells
from observed zero; blanks use the existing neutral multiplier rather than
being coerced to zero. Malformed values and duplicate countries fail
explicitly. The appendix compares stored risk/100 with attenuated multipliers
`0.5 + 0.5w`, median imputation of missing country inputs, and 30 versus 1000
iterations for both risk weightings. Import-value-weighted risk coverage is
reported independently of supplier counts.

Risk-indicator provenance and observation year, the material-to-code crosswalk,
independent trade corroboration, source monetary units and upstream
transformations still require external validation before policy interpretation.
The material selection and manuscript results are explicitly provisional;
no time-series estimates are produced.

Compile [`paper.tex`](../dependency%20paper/paper.tex) from its own directory
after running the batch. Its generated tables must exist for compilation.

### Official WGI construction audit

`node scripts\audit_wgi.cjs` audits the downloaded official WGI 2026 workbook
and methodology under `dependency paper\inputs\wgi`. It extracts the 2024
Political Stability (`pv`) absolute governance score, constructs
`risk = 1 - score / 100`, reverses the published uncertainty-interval endpoints,
and checks the common linear relationship between estimates and scores.
The current release calls this dimension Political Stability; it should not
be silently labeled using the older definition.

Outputs include `pv-risk-2024.csv`, `dashboard-comparison.csv`, a hashed
`audit.json`, `results\wgi-audit.tex`, and
`dependency/data/wgi-pv-risk-2024.json`, which is the browser dashboard's
runtime risk input. The JSON stores risk on the dashboard's expected 0-100
scale. Blank or absent country values stay out of the risk map and retain the
neutral multiplier of 1.0; observed zero remains a real zero. The audit
compares WGI values with the legacy manual workbook and examines cached
formulas in other local inputs. It does not independently re-estimate the
World Bank's Unobserved Components Model or rerun the manuscript's existing
conditional-risk scenarios using WGI.

The audit requires the two official files referenced by their URLs in
`scripts\audit_wgi.cjs` and pre-existing local comparison workbooks. The
Windows OpenXML inspection uses `scripts\inspect_wgi_workbook.ps1`.
Test its transformations with `node --test scripts\audit_wgi.test.cjs`.