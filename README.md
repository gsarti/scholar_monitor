# Scholar Monitor

A static website that mirrors your Google Scholar profile and adds features Scholar doesn't give you:

- **Date-range diff** — pick any two dates; see how many new citations each of your papers got and which specific papers cited them in that window.
- **Per-paper sparklines** — inline citation-count trajectories scaled to each paper’s own history.
- **Paper selection** — check or uncheck papers to recompute annual citation totals and projections.
- **Citation breakdown** — click the annual histogram for a larger chart stacked by paper, with a colour legend and segment details.
- **Current-year projection** — translucent overhang on the current-year bar showing the year-end projection.
- **Top citing authors & venues** — aggregated from all tracked citations.
- **Self-citation toggle** — exclude citations from you and your co-authors with one click.
- **Dark mode** — auto / light / dark, with no flash on load.
- **Weekly GitHub Issue digest** — a summary of new citations opened as an Issue every Sunday (email notification for free).

A GitHub Actions cron job scrapes your profile every day at midnight UTC via SerpAPI, commits a JSON snapshot, and redeploys GitHub Pages.

## Live example

The author's instance: **[gsarti.com/scholar_monitor](https://gsarti.com/scholar_monitor)**.

## Quick fork (one command)

After forking the repo and cloning it locally:

```bash
./setup.sh
```

The script uses the [GitHub CLI](https://cli.github.com/) (`gh`) to:

1. Write your Scholar ID, display name, and base path into `config.json`.
2. Set the `SERPAPI_KEY` repository secret.
3. Enable GitHub Pages with Actions as the source.
4. Commit and push `config.json`.
5. Trigger the first scrape run.

You need `gh` authenticated (`gh auth login`) and a SerpAPI key ([free tier, 100 queries/month](https://serpapi.com)). After the first run succeeds, your site is live at `https://<user>.github.io/<repo-name>/`.

## Manual fork

If you'd rather skip the script:

1. **Fork the repo** on GitHub. You can keep the name `scholar_monitor` or rename it.
2. **Edit `config.json`**:

   ```json
   {
     "scholar_id": "YOUR_SCHOLAR_ID",
     "display_name": "Your Name",
     "base_path": "/scholar_monitor",
     "weekly_digest": true
   }
   ```

   Your Scholar ID is the `user=` parameter on your profile URL (in `scholar.google.com/citations?user=sK0B_08AAAAJ`, it's `sK0B_08AAAAJ`). Set `base_path` to your repo name with a leading slash.
3. **Add a `SERPAPI_KEY` secret** — Settings → Secrets and variables → Actions → New repository secret.
4. **Enable Pages** — Settings → Pages → Source: **GitHub Actions**.
5. **Bootstrap the data** — Actions tab → "Scrape + Deploy" → "Run workflow".

## Deploying at a subpath of a custom domain (e.g. `yourdomain.com/scholar_monitor`)

GitHub Pages serves project repositories at `<user>.github.io/<reponame>`. If you already have a user site (`<user>.github.io`) pointed at a custom domain, **project repos are automatically served at `yourdomain.com/<reponame>`** — no CNAME changes needed.

So to host this at `gsarti.com/scholar_monitor`:

1. Rename the fork to `scholar_monitor` (Settings → General → Rename).
2. Set `"base_path": "/scholar_monitor"` in `config.json`.

## Weekly digest

On by default (`weekly_digest: true` in `config.json`). Every Sunday at 08:00 UTC, `.github/workflows/digest.yml` runs `scripts/digest.py` to summarize the last 7 days of non-bootstrap citations and opens a GitHub Issue labeled `digest`. You'll get an email from GitHub (if notifications are enabled) each time a new issue is created.

To opt out: set `"weekly_digest": false` in `config.json` and push. The workflow still runs, but exits without opening an issue.

## How the date-range feature works

Three files in `data/` power the frontend:

- **`data/profile.json`** — profile header, daily totals (citations, h-index, i10), citations per year.
- **`data/papers.json`** — one entry per paper, with a `citation_count_history` time series (feeds the sparklines) and `citations_per_year` annual totals (feeds both histograms).
- **`data/citations.jsonl`** — one line per citing paper, with a `first_seen_date` timestamp (the day the scraper first saw it) and a `bootstrap` flag (true for pre-existing inventory).

The frontend filters `citations.jsonl` by `first_seen_date` against the range you pick, skipping `bootstrap: true` rows. Range is encoded in the URL (`?from=2026-01-01&to=2026-04-23&exclude_self=1`) so views are shareable. The **New Cit.** column shows clickable new counts; the separate **New Cit. %** column shows each count as a percentage of the paper’s latest total (200 / 800 is 25%). Both columns are sortable. Percentage sorting uses the unrounded fraction, with undefined percentages for uncited papers placed last.

Paper checkboxes affect both annual histograms and their projections, plus the current and projected statistics in the **All** column; all papers are selected when the page loads. The date range and self-citation filter apply to tracked citation records as before. The **Since 2021** column retains the reported Scholar profile statistics. The expanded histogram supports hover, focus, or tap for segment details, and closes with its close button, Escape, or a click outside.

The **All** column shows current values and year-end estimates for total citations, h-index and i10-index. Each paper's projected additional citations use the same annual rate and rounding as its histogram segment; these additions are added to its lifetime total before recomputing h-index and counting papers with at least 10 citations. Checking or unchecking papers immediately recalculates both current and projected values for the selection, subtracting excluded papers' lifetime citations and omitting them from both sets of indices. Selecting none shows zeros; selecting all restores the reported profile values and full profile estimates. Missing or stale per-paper annual data leaves the projected indices unavailable until refreshed, while current statistics can still be calculated from lifetime counts.

Annual paper totals are fetched from the [SerpAPI author citation endpoint](https://serpapi.com/google-scholar-author-citation). Existing snapshots are backfilled on the next scrape. Until annual paper totals are available, the histograms preserve the saved profile’s complete annual totals and label missing attribution as “Paper breakdown pending”. Incomplete cited-by inventories are never substituted for annual counts. Excluding a paper whose annual totals are missing or stale shows an unavailable message, rather than silently displaying an undercount. Once annual totals are refreshed, filtering and the per-paper colour breakdown work fully. A failed refresh keeps the previous annual counts, marks them as awaiting refresh when the paper total differs, and retries on the next scrape.

For a local backfill without an API key, run `python scripts/backfill_annual.py`. This reads the annual graphs from public Scholar paper pages, waits between requests, saves successful results, and stops if Scholar blocks access or returns unexpected content. Subsequent regular scraper runs maintain the annual counts. After rebuilding the site, checkbox changes sum the loaded per-paper counts immediately in the browser, without new requests. Scholar citations without an assigned year remain part of lifetime totals but do not appear in annual bars.

Venue names in Scholar snippets are often shortened before scraping. `python scripts/enrich_venues.py` recovers full names from ACL Anthology citation metadata, exact Crossref DOI records, and publisher citation metadata, storing names and source URLs in `data/venues.json` without changing the original citation records. The daily workflow also runs this step; successful lookups are cached and unavailable metadata is retried after seven days. This uses public metadata and no SerpAPI credits. The venue panel groups arXiv preprints under **arXiv**, uses recovered full names, wraps long names, and reports how many citations were omitted because their venue name is still incomplete. It never combines unrelated venues merely because Scholar gave them the same shortened snippet.

## SerpAPI query budget

The scraper is delta-aware: only papers whose citation count changed since yesterday trigger a new cited-by fetch. Typical usage:

- **Daily profile fetch**: 1–2 queries.
- **Annual paper totals**: one additional query per cited paper on the first run after upgrading, then one per paper whose total changes (including decreases). Failed fetches are retried; unchanged and uncited papers need no additional annual-total queries.
- **Cited-by fetches**: only for papers with count increases (often zero per day).
- **First run** (one-time): one cited-by query per paper with citations, plus pagination for highly-cited ones.

The initial annual-count backfill and subsequent refreshes add to the existing query budget; total usage depends on how many papers change each day.

## Running locally

```bash
pip install -r scripts/requirements.txt
export SERPAPI_KEY=your_key_here
python scripts/scrape.py     # fetch & write data/
python scripts/build.py      # assemble dist/

# Serve dist/ locally. Set "base_path": "" in config.json for root-relative serving:
cd dist && python -m http.server 8000
# open http://localhost:8000
```

## Validation

```bash
node --test tests/*.test.mjs
python -m unittest discover -s tests -p 'test_*.py'
BASE_PATH="" python scripts/build.py
```

The Python tests use the dependencies in `scripts/requirements.txt` and mock API responses; no API key or paid requests are needed.

## Project layout

```text
.
├── config.json                 your settings (scholar_id, base_path, weekly_digest)
├── setup.sh                    one-shot fork configuration via gh CLI
├── scripts/
│   ├── scrape.py               SerpAPI delta-aware scraper
│   ├── digest.py               weekly-digest markdown generator
│   ├── build.py                static-site assembler (no Node required)
│   └── requirements.txt
├── site/                       source for the static frontend
│   ├── index.html
│   └── assets/ {app.js, styles.css, chart.js}
├── data/                       committed JSON snapshots (written by scrape.py)
└── .github/workflows/
    ├── scrape.yml              daily cron: scrape → commit → build → deploy
    ├── deploy.yml              on-push: rebuild & deploy (skips data-only commits)
    └── digest.yml              weekly cron: open GitHub Issue with new citations
```

## Credits

Built with [SerpAPI](https://serpapi.com). No Google Scholar API access required — just a profile ID.
