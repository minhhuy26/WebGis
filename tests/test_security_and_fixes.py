import hashlib
import json
import time
import unittest
from datetime import date
from unittest.mock import MagicMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
import pandas as pd

from backend.app import main as main_app
from backend.app.database import get_db
from backend.app.routers import auth, bulletins, prediction, stats, tree_benefit
from backend.app.services import gee_service, tvdi_service
from backend.scripts import train_monthly_forecast, train_rf


def _make_result(rows=None, scalar_val=None):
    res = MagicMock()
    rows = rows or []
    res.fetchall.return_value = rows
    res.fetchone.return_value = rows[0] if rows else None
    res.scalar.return_value = scalar_val
    res.__iter__.side_effect = lambda: iter(rows)
    return res


def _build_client(db_mock):
    test_app = FastAPI()
    test_app.include_router(auth.router)
    test_app.include_router(bulletins.router)
    test_app.include_router(prediction.router)
    test_app.include_router(stats.router, prefix="/api")
    test_app.include_router(tree_benefit.router, prefix="/api")
    test_app.dependency_overrides[get_db] = lambda: db_mock
    return TestClient(test_app)


class AuthSecurityTest(unittest.TestCase):
    def test_password_hashing_and_legacy_upgrade(self):
        hashed = auth.hash_password("MySecret123")
        self.assertTrue(hashed.startswith("pbkdf2_sha256$"))
        ok, rehash = auth.verify_password("MySecret123", hashed)
        self.assertTrue(ok)
        self.assertFalse(rehash)

        ok_bad, _ = auth.verify_password("wrong", hashed)
        self.assertFalse(ok_bad)

        legacy = hashlib.sha256(b"admin123").hexdigest()
        ok_old, needs_rehash = auth.verify_password("admin123", legacy)
        self.assertTrue(ok_old)
        self.assertTrue(needs_rehash)

    def test_forged_token_for_missing_user_is_guest_and_rejected_by_admin(self):
        db = MagicMock()
        db.execute.return_value = _make_result([])
        forged = auth.create_token("ghost_admin", "admin")
        user = auth.get_current_user(authorization=f"Bearer {forged}", db=db)
        self.assertEqual(user["role"], "guest")
        self.assertFalse(user["is_admin"])
        with self.assertRaises(HTTPException) as ctx:
            auth.require_admin(user)
        self.assertEqual(ctx.exception.status_code, 403)

    def test_register_rejects_xss_characters_in_username(self):
        db = MagicMock()
        db.execute.return_value = _make_result([])
        client = _build_client(db)
        for bad_name in ["bad'user", 'bad"user', "bad<img", "has space"]:
            with self.subTest(bad_name=bad_name):
                res = client.post(
                    "/api/auth/register",
                    json={"username": bad_name, "password": "password123", "full_name": "Test"},
                )
                self.assertEqual(res.status_code, 400)

    def test_log_activity_requires_authentication(self):
        db = MagicMock()
        client = _build_client(db)
        res = client.post("/api/auth/log-activity", json={"action": "spam", "details": "test"})
        self.assertEqual(res.status_code, 401)

    def test_login_auto_upgrades_legacy_sha256_hash(self):
        legacy_hash = hashlib.sha256(b"admin123").hexdigest()
        user_row = ("admin", legacy_hash, "Quản trị viên", "admin", False, None, None)
        db = MagicMock()
        db.execute.side_effect = [
            _make_result([user_row]),
            _make_result([]),
            _make_result([]),
        ]
        client = _build_client(db)
        res = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body.get("username"), "admin")

        update_calls = [
            c for c in db.execute.call_args_list
            if "UPDATE tvdi.users" in str(c.args[0]) and "password_hash = :p" in str(c.args[0])
        ]
        self.assertEqual(len(update_calls), 1)
        new_hash = update_calls[0].args[1]["p"]
        self.assertTrue(new_hash.startswith("pbkdf2_sha256$"))
        ok, needs_rehash = auth.verify_password("admin123", new_hash)
        self.assertTrue(ok)
        self.assertFalse(needs_rehash)


class BulletinAuthorizationTest(unittest.TestCase):
    def test_create_and_delete_bulletin_enforce_auth_and_ownership(self):
        db = MagicMock()
        client = _build_client(db)

        payload = {
            "title": "Test",
            "bulletin_type": "observed",
            "period_start": "2025-03-01",
            "period_end": "2025-03-01",
            "summary_stats": {"avg_tvdi": 0.5},
        }
        res_guest_create = client.post("/api/bulletins", json=payload)
        self.assertEqual(res_guest_create.status_code, 401)

        res_guest_del = client.delete("/api/bulletins/1")
        self.assertEqual(res_guest_del.status_code, 401)

        # Authenticated non-admin user trying to delete another owner's bulletin -> 403
        user_row = ("alice", auth.hash_password("pass1234"), "Alice", "user", False, None, None)
        bulletin_row = (1, "Bản tin hệ thống", "system")
        db.execute.side_effect = [_make_result([user_row]), _make_result([bulletin_row])]
        alice_token = auth.create_token("alice", "user")
        res_forbidden = client.delete("/api/bulletins/1", headers={"Authorization": f"Bearer {alice_token}"})
        self.assertEqual(res_forbidden.status_code, 403)


class PredictionSafetyAndDateValidationTest(unittest.TestCase):
    def test_get_endpoints_do_not_trigger_retrain_or_out_of_window_writes(self):
        db = MagicMock()
        db.execute.return_value = _make_result([])
        client = _build_client(db)

        with patch.object(train_monthly_forecast, "train_and_populate_monthly_12m") as mock_train, \
             patch.object(train_monthly_forecast, "generate_daily_7d_simulated") as mock_sim:
            r1 = client.get("/api/prediction/series/12months?start_date=2028-01-01")
            r2 = client.get("/api/prediction/grid/2030-01-01?horizon=monthly_12m")
            r3 = client.get("/api/prediction/grid/2030-01-01?horizon=daily_7d")
            self.assertEqual(r1.status_code, 200)
            self.assertEqual(r1.json()["series"], [])
            self.assertEqual(r2.status_code, 404)
            self.assertEqual(r3.status_code, 404)
            mock_train.assert_not_called()
            mock_sim.assert_not_called()

    def test_seed_only_handles_december_2026_without_fitting(self):
        seed_data = json.loads(
            (train_monthly_forecast.MODELS_DIR / "monthly_12m_seed.json").read_text(encoding="utf-8")
        )
        active_rows = [(cid,) for cid in {r[1] for r in seed_data["rows"]}]
        with patch.object(train_monthly_forecast, "fit_monthly_package") as mock_fit, \
             patch.object(train_monthly_forecast, "generate_daily_7d_simulated", return_value=[]), \
             patch.object(train_monthly_forecast, "_sync_ward_forecasts", return_value=0), \
             patch.object(train_monthly_forecast, "engine") as mock_engine:
            conn = MagicMock()
            conn.execute.side_effect = [
                _make_result([]),  # advisory lock
                _make_result(active_rows),  # active cells from seed
                _make_result([]),  # deactivate model_runs
                MagicMock(scalar_one=MagicMock(return_value=99)),  # insert model_runs
                _make_result([]),  # delete tvdi_forecast
                _make_result([]),  # delete ward_forecasts
            ]
            mock_engine.begin.return_value.__enter__.return_value = conn
            with patch.object(train_monthly_forecast, "execute_values"):
                res = train_monthly_forecast.train_and_populate_monthly_12m(
                    start_month=date(2026, 12, 1), force_retrain=False, seed_only=True
                )
            mock_fit.assert_not_called()
            self.assertEqual(len(res["monthly_dates"]), 12)

    def test_invalid_date_params_return_400(self):
        db = MagicMock()
        client = _build_client(db)
        self.assertEqual(client.get("/api/stats/summary/not-a-date").status_code, 400)
        self.assertEqual(client.get("/api/prediction/grid/not-a-date").status_code, 400)


class GeeCacheWardsAndTreeTest(unittest.TestCase):
    def test_gee_tile_cache_ttl_and_max_size(self):
        image = MagicMock()
        image.select.return_value.visualize.return_value.getMapId.return_value = {
            "tile_fetcher": MagicMock(url_format="tiles_fresh")
        }
        expired_cache = {"LANDSAT_tvdi_2024-02-01_2024-02-16_0_1": ("tiles_old", time.monotonic() - 10)}
        with patch.object(gee_service, "_cached_tile_urls", expired_cache), \
             patch.object(gee_service, "init_earth_engine", return_value=True), \
             patch.object(gee_service, "get_region_geometry", return_value="region"), \
             patch.object(gee_service, "build_composite", return_value=image):
            url = gee_service.get_tile_url_for_date(None, "tvdi", "2024-02-01")
            self.assertEqual(url, "tiles_fresh")

        # Fill beyond max size and verify cap is enforced
        full_cache = {f"k{i}": (f"v{i}", time.monotonic() + 1000) for i in range(gee_service.TILE_CACHE_MAX_SIZE)}
        with patch.object(gee_service, "_cached_tile_urls", full_cache), \
             patch.object(gee_service, "init_earth_engine", return_value=True), \
             patch.object(gee_service, "get_region_geometry", return_value="region"), \
             patch.object(gee_service, "build_composite", return_value=image):
            gee_service.get_tile_url_for_date(None, "tvdi", "2024-03-01")
            self.assertLessEqual(len(full_cache), gee_service.TILE_CACHE_MAX_SIZE)

    def test_wards_ranking_includes_area_km2_with_7tuple_mock(self):
        db = MagicMock()
        db.execute.side_effect = [
            _make_result([]),
            _make_result([(106.7, 10.77, 34.5, 0.35, 0.55)]),
        ]
        with patch.object(tvdi_service, "get_wards_rows", return_value=[(1, "Phường Sài Gòn", "Quận 1", "TP.HCM", "Phường", 10.77, 106.7)]), \
             patch.object(tvdi_service, "load_wards_catalog", return_value=[{"ward_id": 1, "area_km2": 3.21}]):
            data = tvdi_service.get_wards_ranking(db, "2025-03-01", observation_only=True)
            self.assertEqual(data["wards"][0]["area_km2"], 3.21)

    def test_tree_ward_recommendation_runs_without_name_error(self):
        db = MagicMock()
        db.execute.return_value = _make_result([(0.22, 0.68)])
        out = tree_benefit.get_ward_tree_recommendation(ward_id=1, target_cover_pct=20.0, db=db)
        self.assertIn("recommendation", out)
        self.assertGreater(out["recommendation"]["suggested_n_trees"], 0)


class LeakageTransparencyAndCacheTest(unittest.TestCase):
    def test_train_rf_features_have_no_future_leakage(self):
        train_dates = pd.date_range("2022-01-01", periods=32, freq="15D")
        test_dates = pd.date_range("2024-01-15", periods=8, freq="15D")
        all_dates = list(train_dates) + list(test_dates)

        def _make_df(test_tvdi_value):
            rows = []
            for cid, base in ((1, 0.42), (2, 0.58)):
                for idx, dt in enumerate(all_dates):
                    is_test = dt >= pd.Timestamp("2024-01-01")
                    tv = test_tvdi_value if is_test else (None if idx in (18, 28) else base + 0.01 * (idx % 5))
                    rows.append({
                        "date": dt.strftime("%Y-%m-%d"),
                        "cell_id": cid,
                        "lon": 106.7 + 0.01 * cid,
                        "lat": 10.8 + 0.01 * cid,
                        "TVDI": tv,
                    })
            return pd.DataFrame(rows)

        clean_low, seas_low, gmean_low = train_rf.prepare_grid_features_no_leakage(_make_df(0.10))
        clean_high, seas_high, gmean_high = train_rf.prepare_grid_features_no_leakage(_make_df(0.99))

        self.assertAlmostEqual(gmean_low, gmean_high, places=8)
        pd.testing.assert_frame_equal(seas_low, seas_high)

        tr_low = clean_low[clean_low["date"] < "2024-01-01"].reset_index(drop=True)
        tr_high = clean_high[clean_high["date"] < "2024-01-01"].reset_index(drop=True)
        feature_cols = [
            "lag1", "lag2", "lag3", "lag24", "diff_lag", "rolling_mean3",
            "sin_period", "cos_period", "month", "cell_mean", "cell_seasonal_mean",
        ]
        pd.testing.assert_frame_equal(tr_low[feature_cols], tr_high[feature_cols])

    def test_bulletin_non_admin_keeps_simulation_disclosure(self):
        draft = {
            "title": "BẢN TIN DỰ BÁO KHÔ HẠN 7 NGÀY (Giả lập · Landsat 8/9)",
            "satellite_source": "LANDSAT",
            "highlights": "Cập nhật từ mô hình Random Forest và Landsat.",
            "recommendations": "Số liệu dự báo 7 ngày được mô phỏng giả lập theo đặc trưng Landsat 8/9 để phục vụ theo dõi ngắn hạn.",
        }
        sanitized = bulletins._sanitize_bulletin_for_non_admin(draft)
        self.assertIn("Mô phỏng tham khảo", sanitized["title"])
        self.assertIn("mô phỏng tham khảo", sanitized["recommendations"].lower())
        self.assertNotIn("Landsat", sanitized["title"] + sanitized["highlights"] + sanitized["recommendations"])
        self.assertNotIn("Random Forest", sanitized["highlights"])

    def test_static_cache_headers_for_rasters_and_versioned_assets(self):
        client = TestClient(main_app.app)
        res_css = client.get("/static/css/style.css?v=12.4")
        self.assertEqual(res_css.status_code, 200)
        self.assertIn("max-age=604800", res_css.headers.get("cache-control", ""))

        res_png = client.get("/static/data/raster/LST/LST_2017_04.png")
        self.assertEqual(res_png.status_code, 200)
        self.assertIn("max-age=604800", res_png.headers.get("cache-control", ""))

        res_index = client.get("/")
        self.assertEqual(res_index.status_code, 200)
        cc_idx = res_index.headers.get("cache-control", "")
        self.assertIn("no-cache", cc_idx)
        self.assertNotIn("no-store", cc_idx)

    def test_prediction_max_date_advances_dynamically(self):
        class FakeDate(date):
            @classmethod
            def today(cls):
                return date(2027, 6, 15)

        with patch.object(prediction, "date", FakeDate):
            self.assertEqual(prediction._max_forecast_date_str(), "2029-12-31")
