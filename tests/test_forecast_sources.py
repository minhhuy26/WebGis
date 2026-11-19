import json
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np

from backend.app.routers.prediction import get_12month_forecast_series
from backend.app.services.tvdi_service import get_wards_ranking
from backend.app.services import gee_service, tvdi_service
from backend.scripts.monthly_model import evaluate, forecast


class WardDatesTest(unittest.TestCase):
    def setUp(self):
        self.db = MagicMock()
        self.wards = patch.object(tvdi_service, "get_wards_rows", return_value=[(1, "A", "B", "C", "Xã", 11, 106)])
        self.wards.start()
        self.addCleanup(self.wards.stop)

    def respond(self, rows):
        result = MagicMock()
        result.fetchall.return_value = rows
        result.fetchone.return_value = rows[0] if rows else None
        return result

    def test_nearest_date_survives_filters(self):
        self.db.execute.side_effect = [
            self.respond([]), self.respond([]), self.respond([(date(2025, 12, 12),)]),
            self.respond([(106., 11., 32., .45, .6)])]
        data = get_wards_ranking(self.db, "2025-12-14", observation_only=True, min_tvdi=.9)
        self.assertEqual((data["requested_date"], data["actual_date"]), ("2025-12-14", "2025-12-12"))
        self.assertEqual(data["matching_wards"], 0)

    def test_forecast_and_aggregate_do_not_substitute_an_observed_day(self):
        self.db.execute.return_value = self.respond([])
        for params in (dict(horizon="monthly_12m"), dict(start_str="2026-01-01", end_str="2026-01-31")):
            with self.subTest(params=params):
                result = get_wards_ranking(self.db, "2026-01-01", **params)
                self.assertIsNone(result["actual_date"])
                self.assertEqual(result["wards"], [])
        self.assertFalse(any("ORDER BY ABS" in str(call.args[0]) for call in self.db.execute.call_args_list))

    def test_actual_range_and_monthly_series_version(self):
        self.db.execute.return_value = self.respond([(106., 11., 32., .45, .6, date(2025, 1, 2), date(2025, 1, 17))])
        result = get_wards_ranking(self.db, "2025-01-01", start_str="2025-01-01", end_str="2025-01-31")
        self.assertEqual((result["actual_date"], result["actual_start"], result["actual_end"]),
                         (None, "2025-01-02", "2025-01-17"))
        run = MagicMock()
        run.scalar.return_value = {"version": "test", "indices": {"tvdi": {}}}
        self.db.execute.side_effect = [self.respond([(date(2026, 11, 1), .6, 32, .45, 8)]), run]
        series = get_12month_forecast_series("overall", start_date="2026-11-01", db=self.db)
        self.assertEqual(series["monthly_evaluation"]["version"], "test")


class MonthlyForecastTest(unittest.TestCase):
    def test_recursion_uses_its_own_predictions(self):
        class Increment:
            def predict(self, x):
                return x[:, 0] + 1
        y = np.zeros((24, 2))
        months = np.tile(np.arange(1, 13), 2)
        pred = forecast(Increment(), y, months, np.zeros((2, 2)), 12, (0, 20), 1)
        np.testing.assert_array_equal(pred[:, 0], np.arange(1, 13))

    def test_unobserved_cells_are_excluded_at_both_scales(self):
        y = np.array([[[1., np.nan]], [[2., 4.]]])
        pred = np.array([[[1., 20.]], [[2., 4.]]])
        result = evaluate(y, pred)
        self.assertEqual(result["grid"]["test_samples"], 3)
        self.assertEqual(result["overall"]["test_samples"], 2)
        self.assertEqual(result["overall"]["mae"], 0)

    def test_seed_and_metrics_describe_the_same_forecasts(self):
        models = Path(__file__).resolve().parents[1] / "backend/models"
        seed = json.loads((models / "monthly_12m_seed.json").read_text(encoding="utf8"))
        metrics = json.loads((models / "rf_metrics.json").read_text(encoding="utf8"))
        self.assertEqual(metrics["monthly_evaluation"], seed["evaluation"])
        self.assertEqual(len(set(seed["months"])), 12)
        self.assertEqual({r[0] for r in seed["rows"]}, set(seed["months"]))
        for index in seed["evaluation"]["indices"].values():
            self.assertEqual([r["lead"] for r in index["by_lead"]], list(range(1, 13)))
            self.assertTrue(all(r["overall"]["test_samples"] == 13 for r in index["by_lead"]))

    def test_gee_includes_last_day_without_padding(self):
        image = MagicMock()
        image.select.return_value.visualize.return_value.getMapId.return_value = {
            "tile_fetcher": MagicMock(url_format="tiles")}
        with patch.object(gee_service, "_cached_tile_urls", {}), patch.object(gee_service, "init_earth_engine", return_value=True), \
             patch.object(gee_service, "get_region_geometry", return_value="region"), \
             patch.object(gee_service, "build_composite", return_value=image) as build:
            url = gee_service.get_tile_url_for_date(None, "lst", "2024-02-16", end_date_str="2024-02-29")
            self.assertEqual(url, "tiles")
            build.assert_called_once_with("2024-02-16", "2024-03-01", "region", satellite_source="LANDSAT", window_days=15)
