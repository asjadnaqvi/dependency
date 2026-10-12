# Country-Product Dependency Dashboard

Static dashboard for exploring country-level trade networks by product. It
shows a focus country's suppliers, their position in the wider product network,
and an import-share-based exposure measure.

## Data Sources

- **Trade:** BACI HS22, 2024. Trade flows are shown in source units.
- **Country risk:** World Bank Worldwide Governance Indicators, 2026 release,
  observation year 2024, Political Stability (`pv`). Risk is calculated as
  `1 - governance score / 100`. This is a political-instability proxy, not a
  probability of trade disruption. Countries without a score use a neutral
  multiplier of 1; observed zero risk remains zero.

## Dashboard Options

- **HS digit level and product selectors:** Choose a chapter (HS2), heading
  (HS4), or product (HS6). Lower-level selectors depend on the selected code.
- **Aggregate EU:** Combine EU member countries into one EU27 network node.
- **Focus country:** Select the country at the center of the network and whose
  imports define the supplier list.
- **Trade linkages:** Choose **Flows** to color imports blue and exports violet,
  or **Country risk traffic light** to color links by exporter risk category.
- **Top X countries:** Limit the network size, including the focus country.
  Suppliers to the focus country are selected first, then suppliers to its
  inner-ring partners, using raw trade values.
- **Top import partners in inner ring:** Set the maximum number of the focus
  country's largest suppliers shown in the inner ring.
- **Only edges touching focus country:** Hide links that do not touch the focus
  country.
- **Min edge weight percentile:** Hide weaker links between non-focus
  countries. Links to or from the focus country remain visible.
- **Risk thresholds:** Set the low/moderate and moderate/high boundaries used
  by the risk traffic-light colors.
- **Supplier analysis:** Choose trade-only or risk-adjusted network scores.
  This setting affects the analysis views, not link colors.
- **Heatmap scaling:** Show raw scores or normalize each score column across
  all suppliers. Normalized percentages are score shares, not import shares.
- **Download raw data:** Export the selected product's underlying trade rows.

## Dashboard Views

- **Network:** Displays the selected country's product network. Nodes are
  colored by region; links show trade direction or exporter risk, depending on
  the selected linkage mode.
- **Global importance of suppliers:** Compares each supplier's initial HITS hub
  score (iteration 1) with its refined score (iteration 30).
- **Import Dependency:** Compares actual import share with network-adjusted
  exposure, calculated as import share multiplied by the supplier's refined
  hub score. Exposure is an index, not indirect imports or a disruption
  probability.
- **Country and supplier details:** Lists countries in the selected product
  network, supplier risk, import share, hub scores, and exposure values.