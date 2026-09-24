# Builds the data files for the Survey Dictionary web app.
#
# Reads every survey-country-year overview (.RData) in the "Overview files"
# folder and writes gzipped JSON into site/data/:
#   meta.json.gz     survey programmes, countries and the list of overview files
#   index.json.gz    one entry per distinct question (normalised label) - used for search
#   q/<shard>.json.gz  for each question: every place it was asked + answer distributions
#
# Re-run whenever new overview files have been added. Takes a few minutes.

library(data.table)
library(stringi)

t_start <- Sys.time()
root <- if (requireNamespace("this.path", quietly = TRUE)) this.path::this.dir() else getwd()
overview_dir <- file.path(root, "..", "Existing survey data", "Overview files")
out_dir <- file.path(root, "site", "data")

# Tuning ---------------------------------------------------------------------
KEEP_ALL_ROWS_MAX <- 25   # variables with <= this many value rows keep zero-count rows too
LIST_ROWS_MAX <- 60       # above this many non-empty values, summarise instead of listing
HIST_BINS <- 20           # bins for the histogram of unlabelled numeric values
TOP_N_TEXT <- 30          # for non-numeric high-cardinality variables, keep the top N values
SHARD_TARGET_CHARS <- 1.5e6

# 1. Load all overview files ---------------------------------------------------
files <- sort(list.files(overview_dir, pattern = "\\.RData$"))
if (nzchar(Sys.getenv("SD_SAMPLE"))) {  # quick test build on a random subset
  set.seed(1); files <- sort(sample(files, as.integer(Sys.getenv("SD_SAMPLE"))))
}
message("Reading ", length(files), " overview files...")

read_overview <- function(f) {
  e <- new.env()
  n <- load(file.path(overview_dir, f), envir = e)
  x <- get(n[1], envir = e)
  list(
    vars = data.table(
      var = x[["Variable name"]],
      label = x[["Variable label"]],
      nonmiss = as.numeric(x[["Non missings"]]),
      nuniq = as.numeric(x[["Number of unique"]])
    ),
    vl = x[["Value labels"]],
    head = list(
      country = x[["Country name"]][1], iso = x[["Country code (ISO3+)"]][1],
      survey = x[["Survey name"]][1], year = x[["Year"]][1]
    )
  )
}

ov <- lapply(files, read_overview)
message("  loaded in ", round(as.numeric(Sys.time() - t_start, units = "secs")), "s")

# File table: programme code comes from the file name prefix (e.g. ESS_DEU_2018)
parts <- tstrsplit(sub("\\.RData$", "", files), "_", fixed = TRUE)
ftab <- data.table(
  fid = seq_along(files) - 1L,
  stem = sub("\\.RData$", "", files),
  prog = parts[[1]],
  iso = vapply(ov, function(o) as.character(o$head$iso), ""),
  country = vapply(ov, function(o) as.character(o$head$country), ""),
  survey = vapply(ov, function(o) as.character(o$head$survey), ""),
  year = vapply(ov, function(o) as.character(o$head$year), "")
)
ftab[is.na(iso) | iso == "", iso := parts[[2]][is.na(iso) | iso == ""]]
ftab[is.na(country) | country == "", country := iso]
ftab[is.na(year) | year == "", year := parts[[3]][is.na(year) | year == ""]]

progs <- ftab[, .(name = names(sort(table(survey), decreasing = TRUE))[1], nfiles = .N), by = prog][order(prog)]
ctys <- unique(ftab[, .(iso, country)], by = "iso")[order(country)]
ftab[, pidx := match(prog, progs$prog) - 1L]
ftab[, cidx := match(iso, ctys$iso) - 1L]

# 2. Variables table + question grouping ------------------------------------
vars <- rbindlist(lapply(seq_along(ov), function(i) ov[[i]]$vars[, fid := i - 1L]))
vars[, oid := .I]

# Normalise a label into a grouping key: drop leading question codes such as
# "Q8T.", "1.", "QA11B", "96PO:", "M94_12", then lowercase and strip punctuation.
norm_label <- function(x) {
  y <- stri_trans_general(tolower(x), "Latin-ASCII")
  y <- stri_replace_first_regex(y, "^[\\s'\"`*\\[(]+", "")
  y <- stri_replace_first_regex(y, "^([a-z]{1,6}[0-9][a-z0-9_.()\\-]{0,10}|[0-9]+[a-z][a-z0-9_.()\\-]{0,8}|[0-9][0-9_.()\\-]{0,6}[.:)])[.:)\\-]?\\s+(?=\\S)", "")
  y <- stri_replace_all_regex(y, "[^a-z0-9]+", " ")
  stri_trim_both(y)
}

no_label <- is.na(vars$label) | stri_trim_both(vars$label) %in% c("", "NULL", "NA")
vars[, key := norm_label(label)]
vars[no_label | key == "", key := paste0("∅ ", ftab$prog[fid + 1L], " ", tolower(var))]
vars[no_label, label := NA_character_]

groups <- vars[, .(
  n = .N,
  display = {
    l <- label[!is.na(label)]
    if (length(l)) names(which.max(table(l))) else paste0("(no label) ", var[1])
  },
  nc = uniqueN(ftab$cidx[fid + 1L]),
  y0 = min(as.integer(substr(ftab$year[fid + 1L], 1, 4)), na.rm = TRUE),
  y1 = max(as.integer(substr(ftab$year[fid + 1L], 1, 4)), na.rm = TRUE),
  progs = paste(sort(unique(ftab$pidx[fid + 1L])), collapse = ","),
  varnames = paste(head(names(sort(table(tolower(var)), decreasing = TRUE)), 6), collapse = " ")
), by = key]
setorder(groups, -n, display)
groups[, gid := .I - 1L]
vars[groups, gid := i.gid, on = "key"]
message(nrow(vars), " variables in ", nrow(groups), " distinct questions")

# 3. Distributions -------------------------------------------------------------
esc <- function(x) {
  x <- stri_replace_all_fixed(x, "\\", "\\\\")
  x <- stri_replace_all_fixed(x, "\"", "\\\"")
  x <- stri_replace_all_regex(x, "[\\x00-\\x1f\\x7f]", " ")
  paste0("\"", x, "\"")
}
jstr <- function(x) ifelse(is.na(x), "null", esc(x))
jnum <- function(x) ifelse(is.na(x) | !is.finite(x), "null", as.character(signif(x, 8)))

# Summarise one variable's value table into a compact JSON distribution.
# Output: {"r":[[value,label,count],...]} for categorical variables,
# plus "h":[min,max,[bin counts]] for many unlabelled numeric values and "o": count of values left out.
dist_json <- function(d) {
  if (!is.data.frame(d) || nrow(d) == 0) return("null")
  obs <- as.numeric(d$observations); lab <- as.character(d$label); val <- as.character(d$recorded_value)
  if (nrow(d) > KEEP_ALL_ROWS_MAX) {
    keep <- obs > 0; obs <- obs[keep]; lab <- lab[keep]; val <- val[keep]
  }
  rows <- function(i) if (length(i)) paste0("[", jstr(val[i]), ",", jstr(lab[i]), ",", jnum(obs[i]), "]", collapse = ",") else ""
  if (length(obs) <= LIST_ROWS_MAX) return(paste0("{\"r\":[", rows(seq_along(obs)), "]}"))
  labelled <- which(!is.na(lab) & lab != val)
  rest <- setdiff(seq_along(obs), labelled)
  num <- suppressWarnings(as.numeric(val[rest]))
  if (length(rest) && all(!is.na(num))) {
    lo <- min(num); hi <- max(num)
    br <- if (hi > lo) seq(lo, hi, length.out = HIST_BINS + 1) else c(lo, lo + 1)
    b <- findInterval(num, br, rightmost.closed = TRUE, all.inside = TRUE)
    cnt <- vapply(split(obs[rest], factor(b, levels = seq_len(length(br) - 1L))), sum, 0)
    return(paste0("{\"r\":[", rows(labelled), "],\"h\":[", jnum(lo), ",", jnum(hi), ",[", paste(jnum(cnt), collapse = ","), "]]}"))
  }
  top <- labelled
  if (length(rest)) top <- c(top, rest[order(-obs[rest])][seq_len(min(TOP_N_TEXT, length(rest)))])
  top <- sort(top)
  paste0("{\"r\":[", rows(top), "],\"o\":", jnum(sum(obs[-top])), "}")
}

message("Summarising distributions...")
t1 <- Sys.time()
vars[, dist := unlist(lapply(ov, function(o) vapply(o$vl, dist_json, "")), use.names = FALSE)]
message("  done in ", round(as.numeric(Sys.time() - t1, units = "secs")), "s")
rm(ov); invisible(gc())

# 4. Write question shards -----------------------------------------------------
# Each occurrence: [fileId, varName, rawLabel or 0 if same as display, nonMissing, dist]
vars[groups, display := i.display, on = "gid"]
vars[, occ := paste0("[", fid, ",", jstr(var), ",",
                     ifelse(is.na(label) | label == display, "0", jstr(label)), ",",
                     jnum(nonmiss), ",", dist, "]")]
setorder(vars, gid, fid)
gjson <- vars[, .(j = paste0("[", paste(occ, collapse = ","), "]")), by = gid]

sizes <- nchar(gjson$j, type = "bytes")
shard <- integer(nrow(gjson)); cur <- 0L; acc <- 0
for (i in seq_along(sizes)) {
  if (acc > 0 && acc + sizes[i] > SHARD_TARGET_CHARS) { cur <- cur + 1L; acc <- 0 }
  shard[i] <- cur; acc <- acc + sizes[i]
}
gjson[, shard := shard]
groups[gjson, shard := i.shard, on = "gid"]

write_gz <- function(txt, path) {
  con <- gzfile(path, "wb", compression = 6)
  writeChar(enc2utf8(txt), con, eos = NULL, useBytes = TRUE)
  close(con)
}

qdir <- file.path(out_dir, "q")
unlink(qdir, recursive = TRUE); dir.create(qdir, recursive = TRUE, showWarnings = FALSE)
message("Writing ", max(shard) + 1L, " question shards...")
for (s in unique(gjson$shard)) {
  g <- gjson[shard == s]
  write_gz(paste0("{", paste0("\"", g$gid, "\":", g$j, collapse = ","), "}"), file.path(qdir, paste0(s, ".json.gz")))
}

# 5. Search index + meta -------------------------------------------------------
arr <- function(x) paste0("[", paste(x, collapse = ","), "]")
index <- paste0(
  "{\"label\":", arr(jstr(groups$display)),
  ",\"n\":", arr(groups$n),
  ",\"nc\":", arr(groups$nc),
  ",\"y0\":", arr(jnum(groups$y0)),
  ",\"y1\":", arr(jnum(groups$y1)),
  ",\"progs\":", arr(paste0("[", groups$progs, "]")),
  ",\"vars\":", arr(jstr(groups$varnames)),
  ",\"shard\":", arr(groups$shard), "}"
)
write_gz(index, file.path(out_dir, "index.json.gz"))

meta <- paste0(
  "{\"built\":", jstr(format(Sys.time(), "%Y-%m-%d %H:%M")),
  ",\"progs\":", arr(paste0("[", jstr(progs$prog), ",", jstr(progs$name), ",", progs$nfiles, "]")),
  ",\"countries\":", arr(paste0("[", jstr(ctys$iso), ",", jstr(ctys$country), "]")),
  ",\"files\":", arr(paste0("[", ftab$pidx, ",", ftab$cidx, ",", jstr(ftab$year), "]")), "}"
)
write_gz(meta, file.path(out_dir, "meta.json.gz"))

sz <- sum(file.info(list.files(out_dir, recursive = TRUE, full.names = TRUE))$size)
message(sprintf("Done: %d files, %d variables, %d questions, %.1f MB of data, %.1f min.",
                nrow(ftab), nrow(vars), nrow(groups), sz / 1e6,
                as.numeric(Sys.time() - t_start, units = "mins")))
