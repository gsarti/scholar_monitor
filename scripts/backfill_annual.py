#!/usr/bin/env python3
"""Backfill annual paper counts from public Scholar pages, without an API key.

The regular SerpAPI scraper maintains these counts afterwards. Stop on access
blocks or unexpected HTML, retaining successfully fetched paper graphs.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import time
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent


class AnnualGraphParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.graph = {}
        self.total = None
        self.anchor = None

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self.anchor = {"attrs": dict(attrs), "text": ""}

    def handle_data(self, data):
        if self.anchor is not None:
            self.anchor["text"] += data

    def handle_endtag(self, tag):
        if tag != "a" or self.anchor is None:
            return
        attrs, text = self.anchor["attrs"], self.anchor["text"].strip()
        self.anchor = None
        total_match = re.fullmatch(r"Cited by ([\d,]+)", text)
        if total_match and self.total is None:
            self.total = int(total_match[1].replace(",", ""))
        if "gsc_oci_g_a" not in attrs.get("class", "").split():
            return
        query = parse_qs(urlparse(attrs.get("href", "")).query)
        year = query.get("as_ylo", [""])[0]
        if not re.fullmatch(r"\d{4}", year) or query.get("as_yhi") != [year]:
            raise ValueError("Annual graph has an invalid year range")
        if not re.fullmatch(r"[\d,]+", text) or year in self.graph:
            raise ValueError("Annual graph has an invalid or repeated citation count")
        self.graph[year] = int(text.replace(",", ""))


def parse_annual_html(html):
    if "unusual traffic" in html.lower() or "captcha" in html.lower():
        raise ValueError("Scholar presented an access challenge; stopping")
    parser = AnnualGraphParser()
    parser.feed(html)
    if parser.total is None or not parser.graph:
        raise ValueError("Scholar page did not contain a complete annual graph")
    if sum(parser.graph.values()) > parser.total:
        raise ValueError("Annual counts exceed the paper's total citations")
    return parser.graph, parser.total


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument("--delay", type=float, default=1.0, help="Seconds between page requests (default: 1)")
    options = args.parse_args()
    if options.delay < 0:
        args.error("--delay must be nonnegative")
    path = ROOT / "data" / "papers.json"
    papers = json.loads(path.read_text())
    today = datetime.now(timezone.utc).date().isoformat()
    fetched = 0

    def save():
        path.write_text(json.dumps(papers, indent=2, ensure_ascii=False) + "\n")

    for paper in papers:
        history = paper.get("citation_count_history") or []
        count = history[-1]["count"] if history else 0
        if "citations_per_year" in paper and paper.get("citations_per_year_count") == count:
            continue
        if count == 0:
            graph, total = {}, 0
        else:
            link = paper.get("link", "")
            url = urlparse(link)
            if url.scheme != "https" or url.hostname != "scholar.google.com":
                raise ValueError(f"No public Scholar page for {paper['id']}")
            if fetched:
                time.sleep(options.delay)
            request = Request(link, headers={"User-Agent": "Mozilla/5.0"})
            with urlopen(request, timeout=20) as response:
                html = response.read().decode("utf-8")
            graph, total = parse_annual_html(html)
            fetched += 1
        paper["citations_per_year"] = graph
        paper["citations_per_year_count"] = total
        paper["citations_per_year_updated"] = today
        save()
        status = "current" if total == count else f"source total {total}, snapshot total {count}"
        print(f"{paper['id']}: {len(graph)} years, {sum(graph.values())} dated citations ({status})", flush=True)
    print(f"Annual counts ready for {len(papers)} papers; fetched {fetched} public pages.")


if __name__ == "__main__":
    main()
