# Scholar Monitor

A static website that mirrors your Google Scholar profile and adds features Scholar doesn't give you:

- **Date-range diff** — pick any two dates; see how many new citations each of your papers got and which specific papers cited them in that window.
- **Per-paper sparklines** — inline citation-count trajectory next to each paper.
- **h-index over time** — small line chart of your h-index climb.
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
- **`data/papers.json`** — one entry per paper, with a `citation_count_history` time series (feeds the sparklines).
- **`data/citations.jsonl`** — one line per citing paper, with a `first_seen_date` timestamp (the day the scraper first saw it) and a `bootstrap` flag (true for pre-existing inventory).

The frontend filters `citations.jsonl` by `first_seen_date` against the range you pick, skipping `bootstrap: true` rows. Range is encoded in the URL (`?from=2026-01-01&to=2026-04-23&exclude_self=1`) so views are shareable.

## SerpAPI query budget

The scraper is delta-aware: only papers whose citation count changed since yesterday trigger a new cited-by fetch. Typical usage:

- **Daily profile fetch**: 1–2 queries.
- **Cited-by fetches**: only for papers with count changes (often zero per day).
- **First run** (one-time): one cited-by query per paper with citations, plus pagination for highly-cited ones.

A researcher with ~30 papers and modest citation velocity typically stays under 100 queries/month after bootstrap, fitting comfortably in SerpAPI's free tier.

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
