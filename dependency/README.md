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

In Flows mode, blue links are imports into the focus country, red links are
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