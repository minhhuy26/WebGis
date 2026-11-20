"""
train_monthly_forecast.py – Huấn luyện mô hình Random Forest theo bước THÁNG
cho cả 3 chỉ số (TVDI, LST_C, NDVI) từ dữ liệu Landsat 2017–2025 và sinh:
1. Kết quả dự báo AI 12 tháng tới (horizon_type='monthly_12m', is_simulated=False)
   lưu vào tvdi.tvdi_forecast, tvdi.ward_forecasts và tvdi.model_runs.
2. Kết quả giả lập 7 ngày tới (horizon_type='daily_7d', is_simulated=True)
   (do hệ thống dùng Landsat chu kỳ ~15 ngày, dự báo theo ngày là giả lập).

Chạy: python -m backend.scripts.train_monthly_forecast
"""
import json
import math
import os
import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import joblib
from psycopg2.extras import execute_values
from sqlalchemy import text

BASE_DIR = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(BASE_DIR))

from backend.app.database import engine
from backend.scripts import monthly_model
from backend.app.services import tvdi_service

MODELS_DIR = BASE_DIR / "backend" / "models"


def _drought_lvl(val: Optional[float]) -> Optional[int]:
    if val is None or (isinstance(val, float) and math.isnan(val)):
        return None
    v = max(0.0, min(1.0, float(val)))
    for idx, thr in enumerate((0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875), start=1):
        if v <= thr:
            return idx
    return 8


def _add_months(dt: date, months: int) -> date:
    """Trả về ngày đầu tháng (YYYY-MM-01) sau `months` tháng kể từ `dt`."""
    total_m = (dt.year * 12 + (dt.month - 1)) + months
    y, m0 = divmod(total_m, 12)
    return date(y, m0 + 1, 1)


def _sync_ward_forecasts(conn, target_dates: List[date], horizon_type: str, is_simulated: bool, model_run_id: Optional[int]):
    """Tính & lưu dự báo 3 chỉ số (LST, NDVI, TVDI) cho 167 phường/xã vào tvdi.ward_forecasts."""
    wards_rows = conn.execute(
        text("SELECT ward_id, name, district, province, type, lat, lon FROM tvdi.wards ORDER BY ward_id ASC")
    ).fetchall()
    if not wards_rows or not target_dates:
        return 0

    rows = conn.execute(
        text("""
            SELECT f.date, c.lon, c.lat, f.lst_pred, f.ndvi_pred, f.tvdi_pred, f.forecast_step, f.issued_date
            FROM tvdi.tvdi_forecast f
            JOIN tvdi.grid_cells c ON f.cell_id = c.cell_id
            WHERE f.date = ANY(:dates)
              AND f.horizon_type = :h
              AND f.satellite_source = 'LANDSAT'
              AND f.cell_id IS NOT NULL
        """),
        {"dates": target_dates, "h": horizon_type},
    ).fetchall()

    by_date: Dict[date, List[tuple]] = {}
    step_map: Dict[date, Tuple[Optional[int], Optional[date]]] = {}
    for r in rows:
        by_date.setdefault(r[0], []).append((r[1], r[2], r[3], r[4], r[5]))
        step_map[r[0]] = (r[6], r[7])

    ward_records = []
    for dt in target_dates:
        g_rows = by_date.get(dt, [])
        if not g_rows:
            continue
        fstep, issued = step_map.get(dt, (None, None))
        interp_list = tvdi_service.interpolate_wards_from_grid(wards_rows, g_rows)
        for w, vals in zip(wards_rows, interp_list):
            ward_records.append((
                dt,
                issued,
                int(w[0]),
                horizon_type,
                fstep,
                "LANDSAT",
                is_simulated,
                vals["lst_c"],
                vals["ndvi"],
                vals["tvdi"],
                _drought_lvl(vals["tvdi"]),
                model_run_id,
            ))

    if not ward_records:
        return 0

    conn.execute(
        text("""
            DELETE FROM tvdi.ward_forecasts
            WHERE target_date = ANY(:dates)
              AND horizon_type = :h
              AND satellite_source = 'LANDSAT'
        """),
        {"dates": target_dates, "h": horizon_type},
    )

    with conn.connection.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO tvdi.ward_forecasts (
                target_date, issued_date, ward_id, horizon_type, forecast_step,
                satellite_source, is_simulated, lst_pred, ndvi_pred, tvdi_pred,
                drought_level, model_run_id
            )
            VALUES %s
            """,
            ward_records,
            page_size=5000,
        )
    return len(ward_records)


def generate_daily_7d_simulated(start_date: Optional[date] = None) -> List[str]:
    """
    Sinh dữ liệu dự báo GIẢ LẬP theo ngày (7 ngày liên tiếp: ngày 1..7)
    cho cả 3 chỉ số (LST, NDVI, TVDI) từ nền dự báo tháng hiện tại + biến thiên khí tượng ngày.
    Áp dụng theo quy tắc: dùng ảnh Landsat -> dự báo theo ngày là dữ liệu giả lập.
    """
    if start_date is None:
        start_date = date.today()
    days = [start_date + timedelta(days=i) for i in range(7)]

    with engine.begin() as conn:
        # Lấy nền tháng hiện tại (ưu tiên từ monthly_12m, fallback sang trung bình lịch sử cùng tháng)
        month_anchor = date(start_date.year, start_date.month, 1)
        base_rows = conn.execute(
            text("""
                SELECT f.cell_id, c.lon, c.lat, f.lst_pred, f.ndvi_pred, f.tvdi_pred
                FROM tvdi.tvdi_forecast f
                JOIN tvdi.grid_cells c ON f.cell_id = c.cell_id
                WHERE f.date = :m
                  AND f.horizon_type = 'monthly_12m'
                  AND f.satellite_source = 'LANDSAT'
                  AND f.cell_id IS NOT NULL
                  AND c.geom_polygon IS NOT NULL
            """),
            {"m": month_anchor},
        ).fetchall()

        if not base_rows:
            base_rows = conn.execute(
                text("""
                    SELECT g.cell_id, c.lon, c.lat,
                           AVG(g.lst_c) AS lst_c, AVG(g.ndvi) AS ndvi, AVG(g.tvdi) AS tvdi
                    FROM tvdi.tvdi_grid g
                    JOIN tvdi.grid_cells c ON g.cell_id = c.cell_id
                    WHERE EXTRACT(MONTH FROM g.date) = :mnum
                      AND g.satellite_source = 'LANDSAT'
                      AND c.geom_polygon IS NOT NULL
                    GROUP BY g.cell_id, c.lon, c.lat
                """),
                {"mnum": start_date.month},
            ).fetchall()

        if not base_rows:
            return []

        # Đăng ký hoặc tái sử dụng model_run giả lập
        sim_run_id = conn.execute(
            text("""
                SELECT id FROM tvdi.model_runs
                WHERE horizon_type = 'daily_7d' AND satellite_source = 'LANDSAT' AND is_simulated = TRUE
                ORDER BY id DESC LIMIT 1
            """)
        ).scalar()
        if sim_run_id is None:
            sim_run_id = conn.execute(
                text("""
                    INSERT INTO tvdi.model_runs (
                        model_name, model_version, target_index, satellite_source,
                        horizon_type, is_simulated, notes, is_active
                    )
                    VALUES (
                        'Mô phỏng theo ngày (Landsat)', 'v1.0', 'MULTI', 'LANDSAT',
                        'daily_7d', TRUE,
                        'Dữ liệu giả lập 7 ngày (do ảnh Landsat chu kỳ ~15 ngày chưa đủ tần suất ngày)',
                        TRUE
                    )
                    RETURNING id
                """)
            ).scalar()

        # Xóa dữ liệu 7 ngày cũ trong cửa sổ này để ghi sạch
        conn.execute(
            text("""
                DELETE FROM tvdi.tvdi_forecast
                WHERE horizon_type = 'daily_7d'
                  AND satellite_source = 'LANDSAT'
                  AND date >= :s AND date <= :e
            """),
            {"s": days[0], "e": days[-1]},
        )

        records = []
        for step_idx, d_obj in enumerate(days, start=1):
            doy = d_obj.timetuple().tm_yday
            day_records = []
            lst_vals, ndvi_vals, tvdi_vals = [], [], []

            for r in base_rows:
                cid = int(r[0])
                b_lst = float(r[3]) if r[3] is not None else 34.0
                b_ndvi = float(r[4]) if r[4] is not None else 0.45
                b_tvdi = float(r[5]) if r[5] is not None else 0.50

                # Nhịp thời tiết ngày ổn định (deterministic theo ngày & vị trí ô)
                phase = (cid % 11) * 0.28
                wave = math.sin(2 * math.pi * (doy + step_idx * 0.15) / 5.5 + phase) + 0.4 * math.cos(
                    2 * math.pi * doy / 3.2 - phase
                )
                tvdi_d = round(max(0.03, min(0.97, b_tvdi + 0.032 * wave)), 3)
                lst_d = round(max(21.0, min(48.0, b_lst + 0.95 * wave)), 2)
                ndvi_d = round(max(-0.2, min(0.95, b_ndvi - 0.012 * wave)), 3)

                lst_vals.append(lst_d)
                ndvi_vals.append(ndvi_d)
                tvdi_vals.append(tvdi_d)

                day_records.append((
                    d_obj,
                    cid,
                    tvdi_d,
                    lst_d,
                    ndvi_d,
                    "daily_7d",
                    step_idx,
                    start_date,
                    "LANDSAT",
                    True,
                    "Mô phỏng 7 ngày (Landsat)",
                    sim_run_id,
                    _drought_lvl(tvdi_d),
                ))

            avg_tvdi = round(sum(tvdi_vals) / len(tvdi_vals), 3)
            avg_lst = round(sum(lst_vals) / len(lst_vals), 2)
            avg_ndvi = round(sum(ndvi_vals) / len(ndvi_vals), 3)
            day_records.append((
                d_obj,
                None,
                avg_tvdi,
                avg_lst,
                avg_ndvi,
                "daily_7d",
                step_idx,
                start_date,
                "LANDSAT",
                True,
                "Mô phỏng 7 ngày (Landsat)",
                sim_run_id,
                _drought_lvl(avg_tvdi),
            ))
            records.extend(day_records)

        with conn.connection.cursor() as cur:
            execute_values(
                cur,
                """
                INSERT INTO tvdi.tvdi_forecast (
                    date, cell_id, tvdi_pred, lst_pred, ndvi_pred,
                    horizon_type, forecast_step, issued_date, satellite_source,
                    is_simulated, model_name, model_run_id, drought_level
                )
                VALUES %s
                """,
                records,
                page_size=5000,
            )

        _sync_ward_forecasts(conn, days, "daily_7d", True, sim_run_id)

    return [d.strftime("%Y-%m-%d") for d in days]


def make_monthly_package(results, monthly, months):
    cells = sorted(results["tvdi"]["cell_preds_by_date"][months[0]])
    rows = []
    for step, dt in enumerate(months, 1):
        fields = [results[k]["cell_preds_by_date"][dt] for k in ("tvdi", "lst", "ndvi")]
        for cid in cells:
            tv, ls, nd = [float(f[cid]) for f in fields]
            rows.append([dt.isoformat(), int(cid), round(tv, 3), round(ls, 2), round(nd, 3), step, _drought_lvl(round(tv, 3))])
    return {
        "months": [d.isoformat() for d in months], "rows": rows,
        "evaluation": monthly_model.monthly_evaluation(results, monthly),
        "feature_importances": results["tvdi"]["feature_importances"],
    }


def fit_monthly_package(months):
    monthly = monthly_model.load_monthly(BASE_DIR / "data" / "TVDI_TPHCM_grid_2017_2025.csv")
    results = {k: monthly_model.train_index(monthly, k, months) for k in monthly_model.INDICES}
    for key, result in results.items():
        joblib.dump(result["model"], MODELS_DIR / f"rf_monthly_{key}.joblib")
    return make_monthly_package(results, monthly, months)


def write_json_atomic(path, data, **style):
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, encoding="utf-8", delete=False) as f:
        tmp = Path(f.name)
    try:
        tmp.write_bytes(json.dumps(data, ensure_ascii=False, allow_nan=False, **style).encode("utf-8"))
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def update_monthly_metrics(package):
    path = MODELS_DIR / "rf_metrics.json"
    metrics = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}
    evaluation = package["evaluation"]
    months = package["months"]
    metrics.update({
        "monthly_dates": months,
        "monthly_forecast_period": f"{months[0][:7]} đến {months[-1][:7]} (12 tháng)",
        "monthly_metrics": {f"{key}_{scope}": stats[scope] for key, stats in evaluation["indices"].items()
                            for scope in ("grid", "overall")},
        "monthly_feature_importances": package["feature_importances"],
        "monthly_evaluation": evaluation,
    })
    write_json_atomic(path, metrics, indent=2)


def train_and_populate_monthly_12m(
    start_month: Optional[date] = None,
    force_retrain: bool = False,
    seed_only: bool = False,
) -> Dict:
    start = (start_month or date.today()).replace(day=1)
    months = [_add_months(start, i) for i in range(12)]
    wanted = [d.isoformat() for d in months]
    seed_path = MODELS_DIR / "monthly_12m_seed.json"
    package = None
    if not force_retrain and seed_path.is_file():
        candidate = json.loads(seed_path.read_text(encoding="utf-8"))
        if candidate.get("evaluation", {}).get("version") == monthly_model.VERSION:
            cand_months = candidate.get("months") or []
            if seed_only or cand_months == wanted or any(m >= start.isoformat() for m in cand_months):
                package = candidate
                wanted = list(cand_months)
                months = [date.fromisoformat(m) for m in wanted]
    if seed_only and package is None:
        return {"monthly_dates": [], "daily_dates": []}
    trained = package is None
    if trained:
        package = fit_monthly_package(months)

    evaluation = package["evaluation"]
    tvdi = evaluation["indices"]["tvdi"]["grid"]
    issued = date.today()
    with engine.begin() as conn:
        conn.execute(text("SELECT pg_advisory_xact_lock(48231, 12)"))
        active = {r[0] for r in conn.execute(text("SELECT cell_id FROM tvdi.grid_cells WHERE geom_polygon IS NOT NULL"))}
        conn.execute(text("""UPDATE tvdi.model_runs SET is_active = FALSE
            WHERE horizon_type = 'monthly_12m' AND satellite_source = 'LANDSAT'"""))
        run_id = conn.execute(text("""
            INSERT INTO tvdi.model_runs (model_name, model_version, target_index, satellite_source,
                horizon_type, is_simulated, train_period, test_period, r2_score, rmse, mae,
                metrics_json, notes, is_active)
            VALUES ('Random Forest theo tháng', :version, 'MULTI', 'LANDSAT', 'monthly_12m', FALSE,
                :train, '01/2024–12/2025', :r2, :rmse, :mae, CAST(:metrics AS jsonb),
                'Kiểm định đệ quy theo 13 mốc phát hành, 12 tháng mỗi mốc', TRUE) RETURNING id
        """), dict(version=evaluation["version"], train=f"01/2017–{evaluation['last_observation'][:7]}",
                   r2=tvdi["r2_score"], rmse=tvdi["rmse"], mae=tvdi["mae"],
                   metrics=json.dumps(evaluation, allow_nan=False))).scalar_one()
        conn.execute(text("""DELETE FROM tvdi.tvdi_forecast
            WHERE horizon_type = 'monthly_12m' AND satellite_source = 'LANDSAT'"""))
        # Older windows must disappear from both the grid and the ward series in the same transaction.
        conn.execute(text("""DELETE FROM tvdi.ward_forecasts
            WHERE horizon_type = 'monthly_12m' AND satellite_source = 'LANDSAT'"""))
        records = []
        by_month = {d: [] for d in wanted}
        for dt, cid, tv, ls, nd, step, level in package["rows"]:
            if cid in active:
                by_month[dt].append((tv, ls, nd))
                records.append((dt, cid, tv, ls, nd, step, issued, run_id, level))
        for step, dt in enumerate(wanted, 1):
            values = by_month[dt]
            if not values:
                raise ValueError(f"Không có ô lưới hoạt động cho tháng {dt}")
            tv, ls, nd = (sum(v) / len(v) for v in zip(*values))
            records.append((dt, None, round(tv, 3), round(ls, 2), round(nd, 3), step, issued, run_id, _drought_lvl(round(tv, 3))))
        with conn.connection.cursor() as cur:
            execute_values(cur, """
                INSERT INTO tvdi.tvdi_forecast (date, cell_id, tvdi_pred, lst_pred, ndvi_pred,
                    forecast_step, issued_date, model_run_id, drought_level, horizon_type,
                    satellite_source, is_simulated, model_name) VALUES %s
                """, records, template="(%s,%s,%s,%s,%s,%s,%s,%s,%s,'monthly_12m','LANDSAT',FALSE,'Random Forest (Monthly AI)')",
                page_size=5000)
        _sync_ward_forecasts(conn, months, "monthly_12m", False, run_id)
    if trained:
        update_monthly_metrics(package)
    return {"monthly_dates": wanted, "daily_dates": generate_daily_7d_simulated(date.today())}


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--build-seed", type=date.fromisoformat, metavar="YYYY-MM-01",
                        help="Huấn luyện, kiểm định và tạo bộ dự báo cục bộ mà không cần PostGIS")
    args = parser.parse_args()
    if args.build_seed:
        start = args.build_seed.replace(day=1)
        package = fit_monthly_package([_add_months(start, i) for i in range(12)])
        write_json_atomic(MODELS_DIR / "monthly_12m_seed.json", package, separators=(",", ":"))
        update_monthly_metrics(package)
    else:
        train_and_populate_monthly_12m()
