import unittest
from unittest.mock import patch

from scripts import scrape


class AnnualTotalsTests(unittest.TestCase):
    def test_fetch_parses_the_author_citation_table(self):
        response = {"citation": {"total_citations": {"table": [
            {"year": 2025, "citations": "1,200"}, {"year": 2026, "citations": "50"},
        ]}}}
        with patch.object(scrape, "GoogleSearch") as search:
            search.return_value.get_dict.return_value = response
            self.assertEqual(scrape.fetch_paper_years("test-key", "author:paper"), {"2025": 1200, "2026": 50})
            self.assertEqual(search.call_args.args[0]["view_op"], "view_citation")
            self.assertEqual(search.call_args.args[0]["citation_id"], "author:paper")

    def test_missing_or_invalid_table_is_not_treated_as_zero_citations(self):
        for response in [{}, {"error": "quota exceeded"}, {"citation": {"total_citations": {"table": [{"year": None, "citations": 2}]}}}]:
            with self.subTest(response=response), patch.object(scrape, "GoogleSearch") as search:
                search.return_value.get_dict.return_value = response
                with self.assertRaises((ValueError, RuntimeError)):
                    scrape.fetch_paper_years("test-key", "author:paper")

    def test_backfill_and_count_changes_fetch_once_then_use_cached_counts(self):
        paper = {"id": "a", "citation_count_history": [{"count": 10}]}
        with patch.object(scrape, "fetch_paper_years", return_value={"2026": 10}) as fetch:
            scrape.refresh_paper_years("test-key", [paper], {"a"})
            scrape.refresh_paper_years("test-key", [paper], {"a"})
            fetch.assert_called_once()
            paper["citation_count_history"].append({"count": 9})
            fetch.return_value = {"2026": 9}
            scrape.refresh_paper_years("test-key", [paper], {"a"})
            self.assertEqual(fetch.call_count, 2)
            self.assertEqual(paper["citations_per_year_count"], 9)

    def test_failed_refresh_preserves_counts_and_retries_next_run(self):
        paper = {"id": "a", "citation_count_history": [{"count": 11}], "citations_per_year": {"2026": 10}, "citations_per_year_count": 10}
        with patch.object(scrape, "fetch_paper_years", side_effect=[RuntimeError("temporary failure"), {"2026": 11}]) as fetch:
            scrape.refresh_paper_years("test-key", [paper], {"a"})
            self.assertEqual(paper["citations_per_year"], {"2026": 10})
            self.assertEqual(paper["citations_per_year_count"], 10)
            scrape.refresh_paper_years("test-key", [paper], {"a"})
            self.assertEqual(paper["citations_per_year"], {"2026": 11})
            self.assertEqual(fetch.call_count, 2)

    def test_uncited_and_absent_papers_do_not_spend_queries(self):
        zero = {"id": "a", "citation_count_history": [{"count": 0}]}
        absent = {"id": "b", "citation_count_history": [{"count": 10}]}
        with patch.object(scrape, "fetch_paper_years") as fetch:
            scrape.refresh_paper_years("test-key", [zero, absent], {"a"})
            fetch.assert_not_called()
        self.assertEqual(zero["citations_per_year"], {})
        self.assertNotIn("citations_per_year", absent)


if __name__ == "__main__":
    unittest.main()
