# Survey Dictionary

A searchable dictionary of every variable in the survey-country-year overview files
(`../Existing survey data/Overview files/*.RData`). Colleagues can:

1. search all question labels and variable names by keyword (optionally within one programme),
2. open a question to see **where it was asked**: a country × year coverage grid plus a table of every dataset,
3. click datasets or grid cells to compare **answer distributions** side by side.

It is a static website: plain HTML/JS with pre-built, gzipped JSON data. There is no server
process, so it opens quickly and costs almost nothing to host. Search runs in the browser
over ~75k questions, and a question's details (every place it was asked plus all its
distributions) are fetched only when someone opens it.

## Layout

```
build_data.R      R script: reads all overview .RData files -> site/data/
site/
  index.html, app.js, style.css   the app
  data/meta.json.gz               programmes, countries, list of datasets
  data/index.json.gz              one row per distinct question (for search)
  data/q/<n>.json.gz              question shards: occurrences + distributions
```

## Rebuilding the data

Run whenever new overview files have been added (a few minutes):

```
Rscript build_data.R
```

Test on a random subset first by setting `SD_SAMPLE=200`.

How questions are grouped: labels are lower-cased, and leading question codes
(`Q8T.`, `1.`, `QA11B`, `96PO:`) and punctuation are removed. Identical results form one
question. The label variants inside a group are listed on the question page. Variables
without a label are grouped by programme + variable name.

How distributions are stored:
- Variables with ≤ 25 value rows keep every row, including answer options nobody chose.
- Up to 60 non-empty values are listed in full.
- Beyond that, unlabelled numeric values (ages, IDs, weights, incomes) become a 20-bin
  histogram, and labelled codes (e.g. "Don't know") are still listed.
- Non-numeric, high-cardinality variables keep their 30 most common values.

## Running locally

```
python -m http.server 8765 --directory site
```

Then open http://localhost:8765. Opening `index.html` directly from disk will not work,
because browsers block `fetch` from `file://`.

## Hosting

- **App code:** this GitHub repository. GitHub Pages serves `site/` via the workflow in
  `.github/workflows/pages.yml` on every push to `main`.
- **Data:** the public GCS bucket `gs://survey-data-509608/data/` (project `survey-data-509608`,
  region `us-central1`). `site/config.js` points the published site there; on localhost it
  reads `site/data/` instead. The bucket allows cross-origin reads (CORS) from any site.

After a rebuild, upload the data (needs the Google Cloud CLI, logged in):

```
powershell -ExecutionPolicy Bypass -File deploy_data.ps1
```

The data files are gzipped and the app decompresses them itself, so no special object
metadata is needed. `meta.json.gz` is served with `no-cache`, and its build stamp versions
every other data file, so a new upload is visible immediately.

Links are shareable: the URL keeps the search text, programme filter and open question
(e.g. `index.html#s=trust&q=123`). Question ids change when the data is rebuilt.
