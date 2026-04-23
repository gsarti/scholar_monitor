# Scholar Monitor

A static website that mirrors your Google Scholar profile and adds one thing Scholar doesn't give you: **pick any two dates and see how many new citations each of your papers got — and which specific papers cited them — in that window.**

A GitHub Actions cron job scrapes your profile every day at midnight UTC via SerpAPI, commits a JSON snapshot to the repo, and redeploys to GitHub Pages.

## Live example

The author's instance is at **[gsarti.com/citations](https://gsarti.com/citations)**.

## Fork it for yourself

1. **Fork this repo.** You can keep the name `scholar_monitor` or rename it (see the deployment section below).
2. **Edit `config.json`**:

   ```json
   {
     "scholar_id": "YOUR_SCHOLAR_ID",
     "display_name": "Your Name",
     "base_path": "/scholar_monitor"
   }
   ```

   Your Scholar ID is the `user=` parameter on your profile URL (e.g. in `scholar.google.com/citations?user=sK0B_08AAAAJ`, the ID is `sK0B_08AAAAJ`). Set `base_path` to match your repo name with a leading slash (for a repo named `citations`, use `/citations`; for a fork kept at `scholar_monitor`, use `/scholar_monitor`).
3. **Add a `SERPAPI_KEY` secret.** Get a free key from [serpapi.com](https://serpapi.com) (100 queries/month). In your fork: Settings → Secrets and variables → Actions → New repository secret, name `SERPAPI_KEY`.
4. **Enable Pages.** Settings → Pages → Source: **GitHub Actions**.
5. **Bootstrap the data.** Actions tab → "Scrape + Deploy" → "Run workflow". First run fetches the full citing-paper list for each of your papers — expect ~1 query per paper plus a few for pagination. Subsequent daily runs only re-fetch papers whose citation count changed, so the free tier is enough for most researchers.

After the first run succeeds, the site is live at `https://<your-github-username>.github.io/<repo-name>/`.

## Deploying at a subpath of a custom domain

GitHub Pages serves project repositories at `<user>.github.io/<reponame>`. If you already have a user site (`<user>.github.io`) on a custom domain like `yourdomain.com`, **project repos are automatically served at `yourdomain.com/<reponame>`** — no CNAME juggling required.

So to host this at `gsarti.com/citations`:

1. Rename the fork to `citations` (Settings → General → Rename).
2. Set `"base_path": "/citations"` in `config.json`.
3. Push. Done.

## How the date-range feature works

The scraper stores three files in `data/`:

- **`data/profile.json`** — profile header plus daily snapshots of total citations / h-index / i10-index.
- **`data/papers.json`** — one entry per paper, including a `citation_count_history` time series.
- **`data/citations.jsonl`** — one line per citing paper, with a `first_seen_date` timestamp — the day the scraper first observed that paper in your "Cited by" list.

The frontend loads these files and filters `citations.jsonl` by `first_seen_date` against the dates you pick. No backend, no database. The date range is encoded in the URL (`?from=2026-01-01&to=2026-04-23`) so ranges are shareable.

## SerpAPI query budget

The scraper is delta-aware to stay inside SerpAPI's free tier:

- **Daily profile fetch**: 1–2 queries (pagination kicks in past 100 papers).
- **Cited-by fetches**: only for papers whose count changed since yesterday.
- **First run** (one-time): one cited-by query per paper that has citations, plus pagination for highly-cited ones.

A researcher with ~30 papers and modest citation velocity will typically use **well under 100 queries/month** after bootstrap. If you have many more papers or are hitting the limit, upgrade your SerpAPI plan or reduce the cron frequency in `.github/workflows/scrape.yml`.

## Running locally

```bash
pip install -r scripts/requirements.txt
export SERPAPI_KEY=your_key_here
python scripts/scrape.py     # fetch & write data/
python scripts/build.py      # assemble dist/

# Serve dist/ locally. base_path in config.json must match the URL path.
# For local dev, set "base_path": "" and serve dist/ at the root:
cd dist && python -m http.server 8000
# open http://localhost:8000
```

## Project layout

```text
.
├── config.json                 your settings (scholar_id, base_path)
├── scripts/
│   ├── scrape.py               SerpAPI delta-aware scraper
│   ├── build.py                static-site assembler (no Node required)
│   └── requirements.txt
├── site/                       source for the static frontend
│   ├── index.html
│   └── assets/ {app.js, styles.css, chart.js}
├── data/                       committed JSON snapshots (written by scrape.py)
└── .github/workflows/
    ├── scrape.yml              daily cron: scrape → commit → build → deploy
    └── deploy.yml              on-push: rebuild & deploy (no scrape)
```

## Credits

Built with [SerpAPI](https://serpapi.com). No Google Scholar account or API access required — just a scholar profile ID.
