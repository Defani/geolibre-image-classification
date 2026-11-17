# Image Classification for GeoLibre

Supervised and unsupervised land cover classification of raster layers inside GeoLibre.

Since 0.4 the plugin opens as its own full window over GeoLibre: title bar, menu bar (File, Edit, View, Layers, Samples, Classify, Results, Analysis, Help), toolbar, a left dock with image sets and results, the workflow steps on the right, and centre tabs **Map · Split view · Charts · Accuracy · Change · Log**.

- **Image sets**: bands are grouped by scene (`PreFire_Band_B2` and `PreFire_Band_B3` form the set `PreFire_Band`), so a pre- and post-event image can sit side by side. A trained model can be applied to another set by band role.
- **Sensors**: Sentinel-2, Landsat 8/9, Landsat 5/7, PlanetScope, WorldView-2/3, SPOT/Pléiades, MODIS or custom roles; composites can be labelled by band number (B11 B8 B3) or name (SWIR1 NIR Green).
- **Unsupervised**: K-means (k-means++ seeding) and ISODATA (split, merge, drop), then label each cluster as a class.
- **Charts** on white cards (also in dark mode): matplotlib-style confusion matrix, class area donut, variable importance, journal-style spectral profile (wavelength axis, SD on a second axis), seaborn-style correlation heatmap.
- **Change**: change matrix (ha), Sankey diagram and gains/losses between two classified results.
- **Split view**: swipe or side by side, before/after.
- **Export** straight to a folder on the computer (GeoTIFF, polygons, CSV/XLSX, PNG/SVG charts); falls back to downloads where the browser has no folder access.

The steps on the right dock:

1. **Layers**: tick any raster bands on the map (or add GeoTIFF files), set each band's role (B2 … B12; guessed from the name, Sentinel-2 or Landsat 8/9), pick spectral indices or write your own expression, and choose the reference grid and cell size. Bands of different resolution are resampled (nearest) onto the reference grid; all inputs must share its CRS.
2. **Samples**: classes get their code automatically (1, 2, 3 …). Draw point, polygon, circle or rectangle samples on the map, import them from a vector layer (class field + optional name field), or save them as a layer. Class name and colour can come from the KLHK, MapBiomas or NLCD schemes. A spectral profile shows the mean value of every band per class and updates as you draw.
3. **Model**: Random Forest, Gradient Tree Boost or SVM (RBF, linear, polynomial, sigmoid), with training/testing split by pixel or by sample, max pixels per sample, seed, and an optional majority filter.
4. **Results**: overall accuracy, kappa, the test confusion matrix with producer's and user's accuracy, class areas and variable importance. The classified map is added to the map; **Export GeoTIFF** saves it (class codes, colour table, NoData 0) and **Download CSV** saves overall accuracy, kappa and the confusion matrix.

Defaults follow GEEDEF Land Cover Classification Tools (RF 500 trees, min leaf 1, bag 0.5; GTB 200 trees, shrinkage 0.05, sampling 0.7, 5 nodes; SVM RBF C 10, γ 0.5; 70/30 split; seed 42), and its 16 index formulas are used as written there. Everything runs in the browser: no data leaves the machine.

Differences from GEEDEF: no −5 % accuracy penalty, GTB uses multinomial deviance (no loss-function choice), and SVM gamma is per input (divided by the number of inputs) after standardising, trained on at most 2,000 stratified pixels.

## Build and test

```bash
node build.mjs                      # plugin/ and image-classification-<version>.zip (esbuild borrowed from a GeoLibre checkout)
node test/weda.mjs <stack.json> <stack.u16> <samples dir> <out.tif>   # core on a real Sentinel-2 stack
node test/unsup.mjs                                                       # K-means, ISODATA, correlation, change matrix
python tools/serve.py 8098 . <band dir> <samples dir>                 # CORS + byte ranges for web.geolibre.app
```

In https://web.geolibre.app add `http://localhost:8098/plugin/plugin.json` under Settings → Manage plugins → Settings → Manifest URLs, then Plugins → Installed → Image Classification. After a rebuild, bump the version and remove/re-add the URL.
