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
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import joblib
import numpy as np
import pandas as pd
from psycopg2.extras import execute_values
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sqlalchemy import text

BASE_DIR = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(BASE_DIR))

from backend.app.database import SessionLocal, engine
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


def _load_monthly_dataset() -> Tuple[pd.DataFrame, pd.DataFrame]:
    """Đọc dữ liệu 2017–2025, làm sạch ngoại lai và tổng hợp theo tháng (cell & toàn vùng)."""
    grid_csv = BASE_DIR / "data" / "TVDI_TPHCM_grid_2017_2025.csv"
    df = pd.read_csv(grid_csv)
    df["date"] = pd.to_datetime(df["date"])
    df["ym"] = df["date"].dt.to_period("M")

    # Làm sạch các ngoại lai do mây/mặt nước trước khi lấy trung bình tháng
    df["LST_C"] = df["LST_C"].where((df["LST_C"] >= 18.0) & (df["LST_C"] <= 55.0))
    df["NDVI"] = df["NDVI"].where((df["NDVI"] >= -0.25) & (df["NDVI"] <= 0.98))
    df["TVDI"] = df["TVDI"].where((df["TVDI"] >= 0.0) & (df["TVDI"] <= 1.0))

    monthly = (
        df.groupby(["cell_id", "ym"], as_index=False)
        .agg(
            lon=("lon", "first"),
            lat=("lat", "first"),
            LST_C=("LST_C", "mean"),
            NDVI=("NDVI", "mean"),
            TVDI=("TVDI", "mean"),
        )
    )
    monthly["date"] = monthly["ym"].dt.to_timestamp()

    # Bảo đảm lưới đủ 108 tháng liên tục (01/2017–12/2025) cho mọi cell_id
    all_months = pd.date_range("2017-01-01", "2025-12-01", freq="MS")
    cells_meta = monthly[["cell_id", "lon", "lat"]].drop_duplicates("cell_id")
    full_idx = pd.MultiIndex.from_product(
        [cells_meta["cell_id"].values, all_months], names=["cell_id", "date"]
    )
    monthly = (
        monthly.set_index(["cell_id", "date"])
        .reindex(full_idx)
        .reset_index()
        .drop(columns=["lon", "lat", "ym"], errors="ignore")
        .merge(cells_meta, on="cell_id", how="left")
        .sort_values(["cell_id", "date"])
        .reset_index(drop=True)
    )

    monthly["month"] = monthly["date"].dt.month
    for col in ("TVDI", "LST_C", "NDVI"):
        # Điền khuyết bằng nội suy theo thời gian và trung bình tháng của chính ô đó
        cell_month_med = monthly.groupby(["cell_id", "month"])[col].transform("median")
        monthly[col] = monthly[col].fillna(cell_month_med)
        monthly[col] = monthly.groupby("cell_id")[col].transform(
            lambda g: g.interpolate(method="linear").bfill().ffill()
        )
        monthly[col] = monthly[col].fillna(monthly[col].median())

    monthly["sin_m"] = np.sin(2 * np.pi * monthly["month"] / 12.0)
    monthly["cos_m"] = np.cos(2 * np.pi * monthly["month"] / 12.0)

    overall = (
        monthly.groupby("date", as_index=False)
        .agg(LST_C=("LST_C", "mean"), NDVI=("NDVI", "mean"), TVDI=("TVDI", "mean"))
        .sort_values("date")
        .reset_index(drop=True)
    )
    overall["month"] = overall["date"].dt.month
    overall["sin_m"] = np.sin(2 * np.pi * overall["month"] / 12.0)
    overall["cos_m"] = np.cos(2 * np.pi * overall["month"] / 12.0)
    return monthly, overall


def _train_single_index_monthly(
    monthly: pd.DataFrame,
    overall: pd.DataFrame,
    target_col: str,
    clip_bounds: Tuple[float, float],
    future_month_starts: List[date],
) -> Dict:
    """Huấn luyện Random Forest theo tháng cho 1 chỉ số và dự báo đệ quy 12 tháng tới."""
    d = monthly.copy()
    train_mask = d["date"] < "2024-01-01"

    c_mean = d[train_mask].groupby("cell_id")[target_col].mean().rename("c_mean")
    c_smean = d[train_mask].groupby(["cell_id", "month"])[target_col].mean().rename("c_smean")
    d = d.merge(c_mean, on="cell_id", how="left").merge(c_smean, on=["cell_id", "month"], how="left")
    d["c_mean"] = d["c_mean"].fillna(d[target_col].mean())
    d["c_smean"] = d["c_smean"].fillna(d["c_mean"])

    d["lag1"] = d.groupby("cell_id")[target_col].shift(1)
    d["lag2"] = d.groupby("cell_id")[target_col].shift(2)
    d["lag3"] = d.groupby("cell_id")[target_col].shift(3)
    d["lag12"] = d.groupby("cell_id")[target_col].shift(12)
    d["roll3"] = d[["lag1", "lag2", "lag3"]].mean(axis=1)

    d_clean = d.dropna(subset=["lag1", "lag2", "lag3", "lag12", target_col]).copy()
    feats = [
        "lag1", "lag2", "lag3", "lag12", "roll3",
        "sin_m", "cos_m", "month", "c_mean", "c_smean", "lon", "lat",
    ]

    tr = d_clean[d_clean["date"] < "2024-01-01"]
    te = d_clean[d_clean["date"] >= "2024-01-01"]

    rf = RandomForestRegressor(
        n_estimators=120,
        max_depth=12,
        min_samples_split=4,
        random_state=42,
        n_jobs=-1,
    )
    rf.fit(tr[feats], tr[target_col])

    lo, hi = clip_bounds
    te = te.copy()
    te["pred"] = np.clip(rf.predict(te[feats]), lo, hi)
    grid_metrics = {
        "r2_score": round(float(r2_score(te[target_col], te["pred"])), 4),
        "rmse": round(float(np.sqrt(mean_squared_error(te[target_col], te["pred"]))), 4),
        "mae": round(float(mean_absolute_error(te[target_col], te["pred"])), 4),
        "test_samples": int(len(te)),
    }

    # Đánh giá trên trung bình toàn vùng theo tháng (tổng hợp từ lưới)
    ov_eval = te.groupby("date", as_index=False).agg(actual=(target_col, "mean"), pred=("pred", "mean"))
    overall_metrics = {
        "r2_score": round(float(r2_score(ov_eval["actual"], ov_eval["pred"])), 4),
        "rmse": round(float(np.sqrt(mean_squared_error(ov_eval["actual"], ov_eval["pred"]))), 4),
        "mae": round(float(mean_absolute_error(ov_eval["actual"], ov_eval["pred"])), 4),
        "test_samples": int(len(ov_eval)),
    }

    # Chuẩn bị phân phối thực nghiệm theo tháng trong năm để hiệu chuẩn phương sai (tránh co cụm về mean)
    month_stats = d.groupby("month")[target_col].agg(["mean", "std"]).to_dict("index")
    c_mean_map = c_mean.to_dict()
    c_smean_map = d.groupby(["cell_id", "month"])[target_col].mean().to_dict()

    # Lịch sử theo từng ô lưới đến hết 12/2025; bước nối chuyển tiếp đến tháng hiện tại để dự báo đệ quy liên tục
    cell_hist: Dict[int, Dict] = {}
    for cid, grp in d.groupby("cell_id"):
        grp_s = grp.sort_values("date")
        cell_hist[int(cid)] = {
            "lon": float(grp_s["lon"].iloc[0]),
            "lat": float(grp_s["lat"].iloc[0]),
            "c_mean": float(c_mean_map.get(cid, grp_s[target_col].mean())),
            "values": [float(v) for v in grp_s[target_col].values],
        }

    last_hist_month = date(2025, 12, 1)
    target_end_month = future_month_starts[-1]
    walk_months: List[date] = []
    cur = _add_months(last_hist_month, 1)
    while cur <= target_end_month:
        walk_months.append(cur)
        cur = _add_months(cur, 1)

    target_set = set(future_month_starts)
    cell_preds_by_date: Dict[date, Dict[int, float]] = {}

    for m_dt in walk_months:
        m_num = m_dt.month
        sin_m = math.sin(2 * math.pi * m_num / 12.0)
        cos_m = math.cos(2 * math.pi * m_num / 12.0)

        rows = []
        cids = []
        for cid, info in cell_hist.items():
            vals = info["values"]
            l1, l2, l3 = vals[-1], vals[-2], vals[-3]
            l12 = vals[-12] if len(vals) >= 12 else l1
            rows.append({
                "lag1": l1,
                "lag2": l2,
                "lag3": l3,
                "lag12": l12,
                "roll3": (l1 + l2 + l3) / 3.0,
                "sin_m": sin_m,
                "cos_m": cos_m,
                "month": m_num,
                "c_mean": info["c_mean"],
                "c_smean": float(c_smean_map.get((cid, m_num), info["c_mean"])),
                "lon": info["lon"],
                "lat": info["lat"],
            })
            cids.append(cid)

        raw_pred = np.clip(rf.predict(pd.DataFrame(rows)[feats]), lo, hi)
        # Hiệu chuẩn nhẹ phương sai không gian theo độ lệch chuẩn thực nghiệm của tháng
        ref_std = float(month_stats.get(m_num, {}).get("std") or np.std(raw_pred))
        cur_mean = float(np.mean(raw_pred))
        cur_std = float(np.std(raw_pred))
        if cur_std > 1e-5 and ref_std > 0:
            blend_std = 0.65 * cur_std + 0.35 * ref_std
            calib = cur_mean + (raw_pred - cur_mean) * (blend_std / cur_std)
        else:
            calib = raw_pred
        calib = np.clip(calib, lo, hi)

        for cid, val in zip(cids, calib):
            fval = float(val)
            cell_hist[cid]["values"].append(fval)

        if m_dt in target_set:
            cell_preds_by_date[m_dt] = {cid: float(val) for cid, val in zip(cids, calib)}

    importances = [
        {"feature": k, "importance_percent": round(float(v) * 100, 2)}
        for k, v in sorted(zip(feats, rf.feature_importances_), key=lambda x: x[1], reverse=True)
    ]

    return {
        "model": rf,
        "grid_metrics": grid_metrics,
        "overall_metrics": overall_metrics,
        "feature_importances": importances,
        "cell_preds_by_date": cell_preds_by_date,
    }


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
            ON CONFLICT ON CONSTRAINT uq_ward_forecast DO UPDATE SET
                issued_date = EXCLUDED.issued_date,
                forecast_step = EXCLUDED.forecast_step,
                is_simulated = EXCLUDED.is_simulated,
                lst_pred = EXCLUDED.lst_pred,
                ndvi_pred = EXCLUDED.ndvi_pred,
                tvdi_pred = EXCLUDED.tvdi_pred,
                drought_level = EXCLUDED.drought_level,
                model_run_id = EXCLUDED.model_run_id
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
                ON CONFLICT (date, COALESCE(cell_id, -1), horizon_type, satellite_source) DO UPDATE SET
                    tvdi_pred = EXCLUDED.tvdi_pred,
                    lst_pred = EXCLUDED.lst_pred,
                    ndvi_pred = EXCLUDED.ndvi_pred,
                    forecast_step = EXCLUDED.forecast_step,
                    issued_date = EXCLUDED.issued_date,
                    is_simulated = EXCLUDED.is_simulated,
                    model_name = EXCLUDED.model_name,
                    model_run_id = EXCLUDED.model_run_id,
                    drought_level = EXCLUDED.drought_level
                """,
                records,
                page_size=5000,
            )

        _sync_ward_forecasts(conn, days, "daily_7d", True, sim_run_id)

    return [d.strftime("%Y-%m-%d") for d in days]


def train_and_populate_monthly_12m(start_month: Optional[date] = None) -> Dict:
    """Huấn luyện Random Forest theo tháng (TVDI, LST, NDVI) và ghi dự báo 12 tháng tới vào PostGIS."""
    print("=" * 72)
    print("HUẤN LUYỆN RANDOM FOREST THEO THÁNG (TVDI, LST, NDVI) & DỰ BÁO 12 THÁNG")
    print("=" * 72)

    if start_month is None:
        today = date.today()
        start_month = date(today.year, today.month, 1)

    future_months = [_add_months(start_month, i) for i in range(12)]
    print(f"Cửa sổ 12 tháng dự báo AI: {future_months[0]} -> {future_months[-1]}")

    monthly, overall = _load_monthly_dataset()
    print(f"Dữ liệu tháng đã làm sạch: {len(monthly):,} mẫu ({monthly['date'].nunique()} tháng, {monthly['cell_id'].nunique()} ô lưới)")

    res_tvdi = _train_single_index_monthly(monthly, overall, "TVDI", (0.03, 0.97), future_months)
    res_lst = _train_single_index_monthly(monthly, overall, "LST_C", (20.0, 48.0), future_months)
    res_ndvi = _train_single_index_monthly(monthly, overall, "NDVI", (-0.2, 0.95), future_months)

    print(f"  [TVDI]  Grid Test R2={res_tvdi['grid_metrics']['r2_score']:.4f} | RMSE={res_tvdi['grid_metrics']['rmse']:.4f}")
    print(f"  [LST_C] Grid Test R2={res_lst['grid_metrics']['r2_score']:.4f} | RMSE={res_lst['grid_metrics']['rmse']:.4f}")
    print(f"  [NDVI]  Grid Test R2={res_ndvi['grid_metrics']['r2_score']:.4f} | RMSE={res_ndvi['grid_metrics']['rmse']:.4f}")

    MODELS_DIR.mkdir(exist_ok=True)
    joblib.dump(res_tvdi["model"], MODELS_DIR / "rf_monthly_tvdi.joblib")
    joblib.dump(res_lst["model"], MODELS_DIR / "rf_monthly_lst.joblib")
    joblib.dump(res_ndvi["model"], MODELS_DIR / "rf_monthly_ndvi.joblib")

    issued_dt = date.today()
    with engine.begin() as conn:
        # Lưu phiên chạy mới vào model_runs (deactivate phiên monthly_12m cũ)
        conn.execute(
            text("""
                UPDATE tvdi.model_runs
                SET is_active = FALSE
                WHERE horizon_type = 'monthly_12m' AND satellite_source = 'LANDSAT'
            """)
        )
        run_id = conn.execute(
            text("""
                INSERT INTO tvdi.model_runs (
                    model_name, model_version, target_index, satellite_source,
                    horizon_type, is_simulated, train_period, test_period,
                    r2_score, rmse, mae, metrics_json, notes, is_active
                )
                VALUES (
                    'Random Forest Regressor (Monthly)', 'v2.0', 'MULTI', 'LANDSAT',
                    'monthly_12m', FALSE, '2017-01 đến 2023-12 (84 tháng)', '2024-01 đến 2025-12 (24 tháng)',
                    :r2, :rmse, :mae, CAST(:mjson AS jsonb),
                    'Dự báo AI theo tháng (12 tháng) cho 3 chỉ số TVDI, LST, NDVI từ Landsat 8/9', TRUE
                )
                RETURNING id
            """),
            {
                "r2": res_tvdi["grid_metrics"]["r2_score"],
                "rmse": res_tvdi["grid_metrics"]["rmse"],
                "mae": res_tvdi["grid_metrics"]["mae"],
                "mjson": json.dumps({
                    "tvdi": res_tvdi["grid_metrics"],
                    "lst": res_lst["grid_metrics"],
                    "ndvi": res_ndvi["grid_metrics"],
                }, ensure_ascii=False),
            },
        ).scalar()

        # Chỉ giữ các ô lưới hoạt động có đa giác trong grid_cells
        active_cids = {
            int(r[0])
            for r in conn.execute(
                text("SELECT cell_id FROM tvdi.grid_cells WHERE geom_polygon IS NOT NULL")
            ).fetchall()
        }

        conn.execute(
            text("""
                DELETE FROM tvdi.tvdi_forecast
                WHERE horizon_type = 'monthly_12m' AND satellite_source = 'LANDSAT'
            """)
        )

        records = []
        for step_idx, m_dt in enumerate(future_months, start=1):
            tvdi_map = res_tvdi["cell_preds_by_date"][m_dt]
            lst_map = res_lst["cell_preds_by_date"][m_dt]
            ndvi_map = res_ndvi["cell_preds_by_date"][m_dt]

            m_tvdi, m_lst, m_ndvi = [], [], []
            for cid in sorted(active_cids):
                if cid not in tvdi_map:
                    continue
                tv = round(tvdi_map[cid], 3)
                ls = round(lst_map[cid], 2)
                nd = round(ndvi_map[cid], 3)
                m_tvdi.append(tv)
                m_lst.append(ls)
                m_ndvi.append(nd)
                records.append((
                    m_dt,
                    cid,
                    tv,
                    ls,
                    nd,
                    "monthly_12m",
                    step_idx,
                    issued_dt,
                    "LANDSAT",
                    False,
                    "Random Forest (Monthly AI)",
                    run_id,
                    _drought_lvl(tv),
                ))

            avg_tvdi = round(sum(m_tvdi) / len(m_tvdi), 3)
            avg_lst = round(sum(m_lst) / len(m_lst), 2)
            avg_ndvi = round(sum(m_ndvi) / len(m_ndvi), 3)
            records.append((
                m_dt,
                None,
                avg_tvdi,
                avg_lst,
                avg_ndvi,
                "monthly_12m",
                step_idx,
                issued_dt,
                "LANDSAT",
                False,
                "Random Forest (Monthly AI)",
                run_id,
                _drought_lvl(avg_tvdi),
            ))

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
                ON CONFLICT (date, COALESCE(cell_id, -1), horizon_type, satellite_source) DO UPDATE SET
                    tvdi_pred = EXCLUDED.tvdi_pred,
                    lst_pred = EXCLUDED.lst_pred,
                    ndvi_pred = EXCLUDED.ndvi_pred,
                    forecast_step = EXCLUDED.forecast_step,
                    issued_date = EXCLUDED.issued_date,
                    is_simulated = EXCLUDED.is_simulated,
                    model_name = EXCLUDED.model_name,
                    model_run_id = EXCLUDED.model_run_id,
                    drought_level = EXCLUDED.drought_level
                """,
                records,
                page_size=5000,
            )

        ward_cnt = _sync_ward_forecasts(conn, future_months, "monthly_12m", False, run_id)
        print(f"  [OK] Đã ghi {len(records):,} bản ghi dự báo 12 tháng vào tvdi.tvdi_forecast và {ward_cnt:,} dòng vào tvdi.ward_forecasts.")

    # Cập nhật rf_metrics.json (giữ tương thích ngược + bổ sung monthly_metrics)
    metrics_file = MODELS_DIR / "rf_metrics.json"
    existing_metrics = {}
    if metrics_file.exists():
        try:
            existing_metrics = json.loads(metrics_file.read_text(encoding="utf-8"))
        except Exception:
            existing_metrics = {}

    existing_metrics.update({
        "model_name": "Random Forest Regressor",
        "library": "scikit-learn",
        "trained_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "monthly_forecast_period": f"{future_months[0].strftime('%Y-%m')} đến {future_months[-1].strftime('%Y-%m')} (12 tháng AI)",
        "monthly_dates": [d.strftime("%Y-%m-%d") for d in future_months],
        "monthly_metrics": {
            "tvdi_grid": res_tvdi["grid_metrics"],
            "tvdi_overall": res_tvdi["overall_metrics"],
            "lst_grid": res_lst["grid_metrics"],
            "ndvi_grid": res_ndvi["grid_metrics"],
        },
        "monthly_feature_importances": res_tvdi["feature_importances"],
    })
    if "grid_metrics" not in existing_metrics:
        existing_metrics["grid_metrics"] = res_tvdi["grid_metrics"]
    if "overall_metrics" not in existing_metrics:
        existing_metrics["overall_metrics"] = res_tvdi["overall_metrics"]
    if "feature_importances" not in existing_metrics:
        existing_metrics["feature_importances"] = res_tvdi["feature_importances"]

    metrics_file.write_text(json.dumps(existing_metrics, ensure_ascii=False, indent=2), encoding="utf-8")

    # Sinh luôn dữ liệu giả lập 7 ngày từ hôm nay
    daily_dates = generate_daily_7d_simulated(date.today())
    print(f"  [OK] Đã sinh giả lập 7 ngày ({daily_dates[0]} -> {daily_dates[-1]}) cho cả 3 chỉ số.")
    return {"monthly_dates": [d.strftime("%Y-%m-%d") for d in future_months], "daily_dates": daily_dates}


if __name__ == "__main__":
    train_and_populate_monthly_12m()
