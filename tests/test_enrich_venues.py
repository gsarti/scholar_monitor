import unittest
from unittest.mock import patch

from scripts import enrich_venues as venues


class VenueEnrichmentTests(unittest.TestCase):
    def test_full_venue_metadata_is_used_instead_of_article_titles(self):
        parser = venues.VenueMetadataParser()
        parser.feed('<meta name="citation_title" content="An article"><meta name="citation_conference_title" content="Findings of the Association for Computational Linguistics: EACL 2026">')
        self.assertEqual(parser.venue, "Findings of the Association for Computational Linguistics: EACL 2026")
        shortened = venues.VenueMetadataParser()
        shortened.feed('<meta name="citation_conference_title" content="Proceedings of the …">')
        self.assertIsNone(shortened.venue)

    def test_pdf_links_resolve_to_exact_article_metadata_not_title_searches(self):
        self.assertEqual(venues.metadata_url("https://aclanthology.org/anthology-files/pdf/findings/2025.findings-emnlp.514.pdf"), ("https://aclanthology.org/2025.findings-emnlp.514/", "html"))
        self.assertEqual(venues.metadata_url("https://dl.acm.org/doi/abs/10.1145/3772318.3791013"), ("https://api.crossref.org/works/10.1145/3772318.3791013", "crossref"))
        self.assertEqual(venues.metadata_url("https://example.org/paper.pdf"), (None, None))

    def test_duplicate_links_and_cached_names_do_not_trigger_repeated_lookups(self):
        row = {"citing_link": "https://example.org/paper", "citing_venue": "Proceedings of the …"}
        cache = {}
        with patch.object(venues, "fetch_venue", return_value={"name": "Full Conference Name", "source": row["citing_link"]}) as fetch:
            self.assertEqual(venues.enrich([row, row], cache, "2026-10-02"), 1)
            self.assertEqual(venues.enrich([row], cache, "2026-10-03"), 0)
            fetch.assert_called_once()
        self.assertEqual(row["citing_venue"], "Proceedings of the …")
        self.assertEqual(cache[row["citing_link"]]["name"], "Full Conference Name")

    def test_failed_names_are_retried_after_seven_days_without_fabricating_a_venue(self):
        row = {"citing_link": "https://example.org/paper", "citing_venue": "Proceedings of the"}
        cache = {}
        with patch.object(venues, "fetch_venue", return_value={"name": None}) as fetch:
            venues.enrich([row], cache, "2026-10-02")
            venues.enrich([row], cache, "2026-10-03")
            venues.enrich([row], cache, "2026-10-09")
            self.assertEqual(fetch.call_count, 2)
        self.assertIsNone(cache[row["citing_link"]]["name"])


if __name__ == "__main__":
    unittest.main()
