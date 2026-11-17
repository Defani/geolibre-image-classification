# Image Classification for GeoLibre

Supervised land cover classification of raster layers inside GeoLibre, in one floating window with four steps.

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
python tools/serve.py 8098 . <band dir> <samples dir>                 # CORS + byte ranges for web.geolibre.app
```

In https://web.geolibre.app add `http://localhost:8098/plugin/plugin.json` under Settings → Manage plugins → Settings → Manifest URLs, then Plugins → Installed → Image Classification. After a rebuild, bump the version and remove/re-add the URL.
