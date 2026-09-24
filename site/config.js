// Location of the data files built by build_data.R (must end with "/").
// When run locally the app reads site/data/; the published site reads from the GCS bucket.
window.SD_DATA_URL = ["localhost", "127.0.0.1"].includes(location.hostname)
  ? "data/"
  : "https://storage.googleapis.com/survey-data-509608/data/";
