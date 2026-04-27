#!/usr/bin/env python3
"""Delta-aware Google Scholar scraper backed by SerpAPI.

Reads config.json for the scholar_id. Writes:
  data/profile.json   - profile header + daily totals time series
  data/papers.json    - one entry per paper, with citation-count history
  data/citations.jsonl - append-only log of citing papers (first-seen dated)

To stay under SerpAPI's free tier, cited-by lists are only re-fetched for
papers whose total citation count changed since the last run.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import sys
from datetime import date
from pathlib import Path
from typing import Any

from serpapi import GoogleSearch

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("scrape")

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config.json"
DATA_DIR = ROOT / "data"
PROFILE_PATH = DATA_DIR / "profile.json"
PAPERS_PATH = DATA_DIR / "papers.json"
CITATIONS_PATH = DATA_DIR / "citations.jsonl"

TODAY = date.today().isoformat()
SAFETY_PAGES = 1  # extra pages of cited-by to fetch beyond the expected new count
CITED_BY_PAGE_SIZE = 20  # SerpAPI default is 10; we request 20 (max)


def require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        log.error("missing required environment variable: %s", name)
        sys.exit(1)
    return value


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with path.open() as f:
        return json.load(f)


def save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def load_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open() as f:
        return [json.loads(line) for line in f if line.strip()]


def append_jsonl(path: Path, rows: list[dict]) -> None:
    if not rows:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def stable_id(seed: str) -> str:
    return hashlib.sha1(seed.encode("utf-8")).hexdigest()[:16]


# Parse "A Author, B Author - Venue, 2024 - Publisher" into (authors, venue, year).
PUB_INFO_RE = re.compile(r"^(?P<authors>[^-]+?)\s-\s(?P<rest>.+)$")
YEAR_RE = re.compile(r"\b(19|20)\d{2}\b")


def parse_publication_info(summary: str) -> tuple[str, str, int | None]:
    if not summary:
        return "", "", None
    m = PUB_INFO_RE.match(summary)
    if not m:
        return summary, "", None
    authors = m.group("authors").strip()
    rest = m.group("rest")
    # Split off trailing " - Publisher" if present.
    parts = rest.rsplit(" - ", 1)
    venue_chunk = parts[0].strip()
    year_match = YEAR_RE.search(venue_chunk)
    year = int(year_match.group(0)) if year_match else None
    # Strip trailing ", YYYY" from venue if present.
    if year:
        venue = re.sub(r",?\s*" + str(year) + r"\b.*$", "", venue_chunk).strip(" ,")
    else:
        venue = venue_chunk
    return authors, venue, year


def fetch_author(api_key: str, scholar_id: str) -> dict:
    """Fetch the full profile, paginating over the articles list."""
    log.info("fetching profile for %s", scholar_id)
    all_articles: list[dict] = []
    first_response: dict | None = None
    start = 0
    while True:
        params = {
            "engine": "google_scholar_author",
            "author_id": scholar_id,
            "hl": "en",
            "num": 100,
            "start": start,
            "api_key": api_key,
        }
        response = GoogleSearch(params).get_dict()
        if "error" in response:
            raise RuntimeError(f"SerpAPI error: {response['error']}")
        if first_response is None:
            first_response = response
        articles = response.get("articles", []) or []
        all_articles.extend(articles)
        log.info("  fetched %d articles (total %d)", len(articles), len(all_articles))
        if len(articles) < 100:
            break
        start += 100
    assert first_response is not None
    first_response["articles"] = all_articles
    return first_response


def fetch_cited_by(
    api_key: str, cites_id: str, needed: int
) -> list[dict]:
    """Fetch citing papers for a given cites_id, newest first.

    `needed` is the number of *new* citations we expect. We fetch enough pages
    to cover that many results plus SAFETY_PAGES extra.
    """
    pages_to_fetch = max(1, (needed + CITED_BY_PAGE_SIZE - 1) // CITED_BY_PAGE_SIZE) + SAFETY_PAGES
    results: list[dict] = []
    for page_idx in range(pages_to_fetch):
        params = {
            "engine": "google_scholar",
            "cites": cites_id,
            "hl": "en",
            "scisbd": 1,  # sort by date, newest first
            "num": CITED_BY_PAGE_SIZE,
            "start": page_idx * CITED_BY_PAGE_SIZE,
            "api_key": api_key,
        }
        response = GoogleSearch(params).get_dict()
        if "error" in response:
            log.warning("  cited-by error for %s page %d: %s", cites_id, page_idx, response["error"])
            break
        organic = response.get("organic_results", []) or []
        results.extend(organic)
        if len(organic) < CITED_BY_PAGE_SIZE:
            break
    return results


def build_profile(response: dict, scholar_id: str, previous: dict | None) -> dict:
    author = response.get("author") or {}
    cited_by = response.get("cited_by") or {}
    table = cited_by.get("table") or []
    prev = previous or {}

    def pick(key: str) -> dict:
        for row in table:
            if key in row:
                return row[key]
        return {}

    citations_row = pick("citations")
    h_row = pick("h_index")
    i10_row = pick("i10_index")

    graph = {str(row.get("year")): row.get("citations", 0) for row in (cited_by.get("graph") or [])}

    history = list(prev.get("totals_history", []))
    todays_entry = {
        "date": TODAY,
        "citations": citations_row.get("all"),
        "citations_recent": citations_row.get("since_2021") or citations_row.get("since_2020"),
        "h_index": h_row.get("all"),
        "h_index_recent": h_row.get("since_2021") or h_row.get("since_2020"),
        "i10_index": i10_row.get("all"),
        "i10_index_recent": i10_row.get("since_2021") or i10_row.get("since_2020"),
    }
    metric_keys = ("citations", "citations_recent", "h_index", "h_index_recent", "i10_index", "i10_index_recent")
    if any(todays_entry[k] is not None for k in metric_keys):
        # Replace today's entry if we're re-running on the same day.
        history = [h for h in history if h.get("date") != TODAY] + [todays_entry]
    else:
        # SerpAPI sometimes returns an empty cited_by table; preserve prior history rather than
        # appending an all-null row that breaks the dashboard.
        log.warning("response had no totals; keeping previous totals_history unchanged")

    new_labels = [i.get("title", "") for i in (author.get("interests") or [])]

    return {
        "scholar_id": scholar_id,
        "name": author.get("name") or prev.get("name", ""),
        "affiliation": author.get("affiliations") or prev.get("affiliation", ""),
        "email": author.get("email") or prev.get("email", ""),
        "homepage": author.get("website") or prev.get("homepage", ""),
        "thumbnail": author.get("thumbnail") or prev.get("thumbnail", ""),
        "labels": new_labels or prev.get("labels", []),
        "totals_history": history,
        "citations_per_year": graph or prev.get("citations_per_year", {}),
    }


def update_papers(
    response: dict, existing: list[dict]
) -> tuple[list[dict], list[tuple[dict, int]]]:
    """Merge the fresh article list into existing paper records.

    Returns the updated papers list and a queue of (paper, new_count_delta) for which
    we should fetch cited-by. A delta of -1 means "bootstrap, fetch everything".
    """
    by_id = {p["id"]: p for p in existing}
    queue: list[tuple[dict, int]] = []
    seen_ids: set[str] = set()

    for article in response.get("articles", []) or []:
        citation_id = article.get("citation_id") or stable_id(article.get("title", ""))
        seen_ids.add(citation_id)
        cited_by = article.get("cited_by") or {}
        count = int(cited_by.get("value") or 0)
        cites_id = cited_by.get("cites_id") or ""

        paper = by_id.get(citation_id)
        if paper is None:
            paper = {
                "id": citation_id,
                "title": article.get("title", ""),
                "authors": article.get("authors", ""),
                "venue": article.get("publication", ""),
                "year": int(article["year"]) if (article.get("year") or "").isdigit() else None,
                "link": article.get("link", ""),
                "cites_id": cites_id,
                "first_seen": TODAY,
                "citation_count_history": [],
            }
            by_id[citation_id] = paper
            if cites_id and count > 0:
                queue.append((paper, -1))  # bootstrap: fetch everything we reasonably can
        else:
            # Refresh mutable metadata (title/authors/venue can change).
            paper["title"] = article.get("title", paper.get("title", ""))
            paper["authors"] = article.get("authors", paper.get("authors", ""))
            paper["venue"] = article.get("publication", paper.get("venue", ""))
            paper["link"] = article.get("link", paper.get("link", ""))
            if cites_id:
                paper["cites_id"] = cites_id
            prior_counts = paper.get("citation_count_history") or []
            prior_count = prior_counts[-1]["count"] if prior_counts else 0
            if count > prior_count and cites_id:
                queue.append((paper, count - prior_count))

        # Append today's count (replace if re-running same day).
        history = [h for h in (paper.get("citation_count_history") or []) if h.get("date") != TODAY]
        history.append({"date": TODAY, "count": count})
        paper["citation_count_history"] = history

    # Keep papers that disappeared from the profile (e.g. temporary hiccups), but don't update their counts.
    # Sort stably: by most recent count desc, then year desc, then title.
    ordered = sorted(
        by_id.values(),
        key=lambda p: (
            -(p["citation_count_history"][-1]["count"] if p.get("citation_count_history") else 0),
            -(p.get("year") or 0),
            p.get("title", ""),
        ),
    )
    return ordered, queue


def extract_citing_row(paper_id: str, result: dict, bootstrap: bool) -> dict:
    result_id = result.get("result_id") or stable_id(result.get("title", "") + paper_id)
    pub_info = (result.get("publication_info") or {}).get("summary", "") or ""
    authors, venue, year = parse_publication_info(pub_info)
    return {
        "paper_id": paper_id,
        "citing_id": result_id,
        "citing_title": result.get("title", ""),
        "citing_authors": authors,
        "citing_venue": venue,
        "citing_year": year,
        "citing_link": result.get("link", ""),
        "first_seen_date": TODAY,
        "bootstrap": bootstrap,
    }


def migrate_bootstrap_flag(citations: list[dict], papers: list[dict]) -> tuple[list[dict], bool]:
    """Back-stamp a `bootstrap` flag onto pre-existing rows that lack it.

    Heuristic: a citing paper fetched on the same day its parent paper was first
    added to the profile was part of the initial inventory, not a truly new citation.
    """
    if not citations or any("bootstrap" in row for row in citations):
        return citations, False
    first_seen_by_paper = {p["id"]: p.get("first_seen") for p in papers}
    migrated: list[dict] = []
    for row in citations:
        is_bootstrap = row.get("first_seen_date") == first_seen_by_paper.get(row["paper_id"])
        migrated.append({**row, "bootstrap": is_bootstrap})
    return migrated, True


def rewrite_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def main() -> int:
    api_key = require_env("SERPAPI_KEY")
    config = load_json(CONFIG_PATH, {})
    scholar_id = config.get("scholar_id")
    if not scholar_id:
        log.error("config.json is missing scholar_id")
        return 1

    existing_profile = load_json(PROFILE_PATH, None)
    existing_papers = load_json(PAPERS_PATH, [])
    existing_citations = load_jsonl(CITATIONS_PATH)

    # One-shot migration for pre-flag data: add bootstrap=True/False to legacy rows.
    existing_citations, migrated = migrate_bootstrap_flag(existing_citations, existing_papers)
    if migrated:
        log.info("migrating %d legacy citation rows with bootstrap flag", len(existing_citations))
        rewrite_jsonl(CITATIONS_PATH, existing_citations)

    known_by_paper: dict[str, set[str]] = {}
    for row in existing_citations:
        known_by_paper.setdefault(row["paper_id"], set()).add(row["citing_id"])

    try:
        author_response = fetch_author(api_key, scholar_id)
    except Exception as e:
        log.exception("failed to fetch author profile: %s", e)
        return 1

    profile = build_profile(author_response, scholar_id, existing_profile)
    papers, queue = update_papers(author_response, existing_papers)

    log.info("profile updated: %d papers, %d queued for cited-by fetch", len(papers), len(queue))

    new_citation_rows: list[dict] = []
    for paper, delta in queue:
        paper_id = paper["id"]
        cites_id = paper.get("cites_id")
        if not cites_id:
            continue
        is_bootstrap = delta == -1
        needed = delta if delta > 0 else (paper["citation_count_history"][-1]["count"] if paper.get("citation_count_history") else 0)
        log.info("  fetching cited-by for %s (needed=%d, bootstrap=%s) %s", paper_id, needed, is_bootstrap, paper.get("title", "")[:80])
        try:
            results = fetch_cited_by(api_key, cites_id, needed)
        except Exception as e:
            log.warning("  cited-by fetch failed: %s", e)
            continue
        known = known_by_paper.setdefault(paper_id, set())
        for result in results:
            row = extract_citing_row(paper_id, result, bootstrap=is_bootstrap)
            if row["citing_id"] in known:
                continue
            known.add(row["citing_id"])
            new_citation_rows.append(row)

    save_json(PROFILE_PATH, profile)
    save_json(PAPERS_PATH, papers)
    append_jsonl(CITATIONS_PATH, new_citation_rows)

    log.info("wrote %d new citation rows; profile/papers snapshots updated", len(new_citation_rows))
    return 0


if __name__ == "__main__":
    sys.exit(main())
