import unittest
from unittest.mock import patch

import pandas as pd

from api.akshare_server import parse_base_nav


class TestNavFetch(unittest.TestCase):
    def test_parse_base_nav_uses_latest_date(self):
        df = pd.DataFrame(
            {
                "净值日期": ["2024-01-02", "2024-01-03"],
                "单位净值": [1.1, 1.2],
            }
        )
        with patch("api.akshare_server.ak.fund_open_fund_info_em", return_value=df):
            result = parse_base_nav("000001")
        self.assertIsNotNone(result)
        nav, nav_date, _ = result
        self.assertEqual(nav, 1.2)
        self.assertEqual(nav_date, "2024-01-03")

    def test_parse_base_nav_sorts_unsorted_dates(self):
        df = pd.DataFrame(
            {
                "净值日期": ["2024-01-03", "2024-01-02"],
                "单位净值": [1.2, 1.1],
            }
        )
        with patch("api.akshare_server.ak.fund_open_fund_info_em", return_value=df):
            result = parse_base_nav("000001")
        self.assertIsNotNone(result)
        nav, nav_date, _ = result
        self.assertEqual(nav, 1.2)
        self.assertEqual(nav_date, "2024-01-03")


if __name__ == "__main__":
    unittest.main()
