import unittest

from scripts.backfill_annual import parse_annual_html


class PublicAnnualGraphTests(unittest.TestCase):
    def test_years_come_from_bar_links_and_counts_from_text_not_pixel_heights(self):
        html = '''<a href="?cites=1">Cited by 1,005</a>
        <a class="gsc_oci_g_a" href="?as_ylo=2024&amp;as_yhi=2024" style="height:0px"><span>5</span></a>
        <a class="gsc_oci_g_a" href="?as_ylo=2025&amp;as_yhi=2025"><span>1,000</span></a>'''
        self.assertEqual(parse_annual_html(html), ({"2024": 5, "2025": 1000}, 1005))

    def test_missing_graph_access_challenges_and_inconsistent_counts_are_rejected(self):
        for html in ["captcha", "unusual traffic", "<a>Cited by 10</a>",
                     '<a>Cited by 1</a><a class="gsc_oci_g_a" href="?as_ylo=2026&amp;as_yhi=2026">2</a>']:
            with self.subTest(html=html), self.assertRaises(ValueError):
                parse_annual_html(html)


if __name__ == "__main__":
    unittest.main()
