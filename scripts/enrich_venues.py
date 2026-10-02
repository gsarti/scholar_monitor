#!/usr/bin/env python3
"""Recover shortened Scholar venue names from public publication metadata.

Cache successes and retry unavailable metadata after seven days. Original
citation records stay unchanged; no SerpAPI requests are used.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from urllib.parse import quote, unquote, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
USER_AGENT = "ScholarMonitor/1.0 (https://github.com/gsarti/scholar_monitor)"


def incomplete(name):
    return not name or bool(re.search(r"…|\.{3}|\b(?:of|of the|on|on the|in|in the)$", name.strip(), re.I))


class VenueMetadataParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.venues = {}

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        key = attrs.get("name", "").lower()
        if tag == "meta" and key in ("citation_journal_title", "citation_conference_title"):
            name = " ".join(attrs.get("content", "").split())
            if not incomplete(name):
                self.venues[key] = name

    @property
    def venue(self):
        return self.venues.get("citation_journal_title") or self.venues.get("citation_conference_title")


def metadata_url(link):
    url = urlparse(link)
    if url.scheme != "https" or not url.hostname or url.username or url.password:
        return None, None
    if url.hostname == "aclanthology.org":
        # Both old anthology-files/pdf links and ordinary PDF URLs identify the
        # same article landing page, which exposes full citation metadata.
        article = url.path.rstrip("/").rsplit("/", 1)[-1].removesuffix(".pdf")
        if re.fullmatch(r"(?:\d{4}\.[\w-]+\.\d+|[A-Z]\d{2}-\d+)", article):
            return f"https://aclanthology.org/{article}/", "html"
    doi = re.search(r"10\.\d{4,9}/[^?#]+", unquote(url.path))
    if doi:
        return f"https://api.crossref.org/works/{quote(doi[0].removesuffix('.pdf'), safe='/')}", "crossref"
    if url.path.lower().endswith(".pdf") or url.hostname in {"openreview.net", "books.google.com", "www.researchgate.net"}:
        return None, None
    return link, "html"


def fetch_venue(link):
    url = urlparse(link)
    if url.hostname == "arxiv.org" and url.path.startswith(("/abs/", "/pdf/")):
        return {"name": "arXiv", "source": link}
    source, kind = metadata_url(link)
    if not source:
        return {"name": None}
    try:
        request = Request(source, headers={"User-Agent": USER_AGENT, "Accept": "application/json" if kind == "crossref" else "text/html"})
        with urlopen(request, timeout=12) as response:
            if kind == "html" and "html" not in response.headers.get("Content-Type", "").lower():
                return {"name": None, "source": source}
            body = response.read(2_000_001)
            if len(body) > 2_000_000:
                return {"name": None, "source": source}
            text = body.decode("utf-8", errors="replace")
        if kind == "crossref":
            titles = json.loads(text).get("message", {}).get("container-title", [])
            name = next((" ".join(title.split()) for title in titles if isinstance(title, str) and not incomplete(title)), None)
        else:
            parser = VenueMetadataParser()
            parser.feed(text)
            name = parser.venue
        return {"name": name, "source": source}
    except Exception as exc:
        # Failed lookups never replace known names or block the daily scrape.
        return {"name": None, "source": source, "error": type(exc).__name__}


def enrich(rows, cache, today, workers=3):
    retry_before = (datetime.fromisoformat(today) - timedelta(days=7)).date().isoformat()
    links = set()
    for row in rows:
        name = row.get("citing_venue", "").strip()
        link = row.get("citing_link", "")
        if not link or name.lower().startswith("arxiv preprint") or not incomplete(name):
            continue
        saved = cache.get(link, {})
        if saved.get("name") or saved.get("checked_at", "") > retry_before:
            continue
        links.add(link)
    with ThreadPoolExecutor(max_workers=workers) as executor:
        pending = {executor.submit(fetch_venue, link): link for link in sorted(links)}
        for future in as_completed(pending):
            link = pending[future]
            cache[link] = {**future.result(), "checked_at": today}
    return len(links)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workers", type=int, default=3, choices=range(1, 5))
    args = parser.parse_args()
    data = ROOT / "data"
    rows = [json.loads(line) for line in (data / "citations.jsonl").read_text().splitlines() if line]
    path = data / "venues.json"
    cache = json.loads(path.read_text()) if path.exists() else {}
    today = datetime.now(timezone.utc).date().isoformat()
    print("Recovering venue names from public publication metadata…", flush=True)
    attempted = enrich(rows, cache, today, args.workers)
    path.write_text(json.dumps(cache, indent=2, ensure_ascii=False, sort_keys=True) + "\n")
    print(f"Checked {attempted} publication links; {sum(bool(v.get('name')) for v in cache.values())} full venue names cached.")


if __name__ == "__main__":
    main()
