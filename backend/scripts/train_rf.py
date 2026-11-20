"""
Script huấn luyện mô hình Random Forest Regressor dự báo chỉ số khô hạn TVDI
cho khu vực TP. Hồ Chí Minh mở rộng.
- Tập huấn luyện: 2017 - 2023 (168 kỳ quan trắc)
- Tập kiểm tra: 2024 - 2025 (48 kỳ quan trắc)
- Dự báo tương lai: 2026 - 2027
Lưu kết quả vào CSDL PostgreSQL (tvdi.tvdi_forecast) và backend/models/.
"""
import argparse
import os
import sys
import json
from datetime import datetime
from pathlib import Path
from typing import Tuple
import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import r2_score, mean_squared_error, mean_absolute_error
from sqlalchemy import text

# Thêm đường dẫn project
BASE_DIR = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(BASE_DIR))
from backend.app.database import engine


def prepare_grid_features_no_leakage(
    df_grid: pd.DataFrame,
    train_cutoff: str = "2024-01-01",
) -> Tuple[pd.DataFrame, pd.DataFrame, float]:
    """Chuẩn bị đặc trưng theo ô lưới, chặn hoàn toàn rò rỉ dữ liệu từ tập kiểm tra/tương lai."""
    df = df_grid.copy()
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values(["cell_id", "date"]).reset_index(drop=True)
    df["TVDI_raw"] = df["TVDI"]

    train_mask = df["date"] < train_cutoff
    train_global_mean = float(df.loc[train_mask, "TVDI_raw"].mean())
    if np.isnan(train_global_mean):
        train_global_mean = float(df["TVDI_raw"].mean())

    # Điền thiếu nhân quả theo quá khứ; tuyệt đối không dùng interpolate tuyến tính hay bfill
    df["TVDI_causal"] = df.groupby("cell_id")["TVDI_raw"].ffill().fillna(train_global_mean)

    # Mã hóa tính mùa vụ (Seasonality: 24 kỳ quan trắc mỗi năm)
    dates_unique = sorted(df["date"].unique())
    date_to_period = {d: (i % 24) + 1 for i, d in enumerate(dates_unique)}
    df["period"] = df["date"].map(date_to_period)
    df["sin_period"] = np.sin(2 * np.pi * df["period"] / 24)
    df["cos_period"] = np.cos(2 * np.pi * df["period"] / 24)
    df["month"] = df["date"].dt.month

    # Chỉ tính TVDI trung bình lịch sử & theo mùa trên tập train (< train_cutoff) bằng quan trắc thực
    train_df = df.loc[train_mask]
    cell_stats = train_df.groupby("cell_id")["TVDI_raw"].agg("mean").reset_index()
    cell_stats.columns = ["cell_id", "cell_mean"]

    cell_seasonal = train_df.groupby(["cell_id", "period"])["TVDI_raw"].agg("mean").reset_index()
    cell_seasonal.columns = ["cell_id", "period", "cell_seasonal_mean"]

    df = df.merge(cell_stats, on="cell_id", how="left")
    df = df.merge(cell_seasonal, on=["cell_id", "period"], how="left")
    df["cell_mean"] = df["cell_mean"].fillna(train_global_mean)
    df["cell_seasonal_mean"] = df["cell_seasonal_mean"].fillna(df["cell_mean"])

    # Tạo đặc trưng trễ (Lags) trên chuỗi nhân quả
    df["lag1"] = df.groupby("cell_id")["TVDI_causal"].shift(1)
    df["lag2"] = df.groupby("cell_id")["TVDI_causal"].shift(2)
    df["lag3"] = df.groupby("cell_id")["TVDI_causal"].shift(3)
    df["lag24"] = df.groupby("cell_id")["TVDI_causal"].shift(24)  # Cùng kỳ năm trước (1 năm = 24 kỳ)
    df["diff_lag"] = df["lag1"] - df["lag2"]
    df["rolling_mean3"] = df[["lag1", "lag2", "lag3"]].mean(axis=1)

    # Chỉ huấn luyện và chấm điểm trên các dòng có quan trắc thực (TVDI_raw không null)
    df_clean = df.dropna(subset=["lag1", "lag2", "lag3", "lag24", "TVDI_raw"]).copy()
    return df_clean, cell_seasonal, train_global_mean


def train_and_evaluate(metrics_only: bool = False):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    print("=" * 70)
    print("BAT DAU HUAN LUYEN MO HINH RANDOM FOREST DU BAO TVDI (TP.HCM)")
    print("=" * 70)

    grid_csv = BASE_DIR / "data" / "TVDI_TPHCM_grid_2017_2025.csv"
    series_csv = BASE_DIR / "data" / "TVDI_TPHCM_series_2017_2025.csv"

    # --- 1. Đọc và tiền xử lý dữ liệu ô lưới (không rò rỉ dữ liệu) ---
    print("\n[1/5] Đang nạp và tiền xử lý dữ liệu ô lưới (2017–2025, không leakage)...")
    df_grid = pd.read_csv(grid_csv)
    df_clean, cell_seasonal, _ = prepare_grid_features_no_leakage(df_grid)

    # Phân chia tập Train (2017–2023) và Test (2024–2025)
    train_grid = df_clean[df_clean["date"] < "2024-01-01"]
    test_grid = df_clean[df_clean["date"] >= "2024-01-01"]

    features_grid = [
        "lag1", "lag2", "lag3", "lag24", "diff_lag",
        "rolling_mean3", "sin_period", "cos_period", "month",
        "cell_mean", "cell_seasonal_mean", "lon", "lat"
    ]

    print(f"  - Tập huấn luyện (2017–2023): {len(train_grid):,} mẫu")
    print(f"  - Tập kiểm tra (2024–2025):    {len(test_grid):,} mẫu")
    print(f"  - Số đặc trưng đưa vào mô hình: {len(features_grid)}")

    # --- 2. Huấn luyện Random Forest cho từng ô lưới ---
    print("\n[2/5] Đang huấn luyện Random Forest Regressor cho ô lưới...")
    rf_grid = RandomForestRegressor(
        n_estimators=120,
        max_depth=12,
        min_samples_split=4,
        random_state=42,
        n_jobs=-1
    )
    rf_grid.fit(train_grid[features_grid], train_grid["TVDI_raw"])

    pred_test = rf_grid.predict(test_grid[features_grid])
    # Giới hạn giá trị TVDI dự báo hợp lệ [0, 1]
    pred_test = np.clip(pred_test, 0.0, 1.0)
    test_grid = test_grid.copy()
    test_grid["pred"] = pred_test
    test_grid["residual"] = test_grid["TVDI_raw"] - pred_test

    r2_grid = r2_score(test_grid["TVDI_raw"], pred_test)
    rmse_grid = np.sqrt(mean_squared_error(test_grid["TVDI_raw"], pred_test))
    mae_grid = mean_absolute_error(test_grid["TVDI_raw"], pred_test)

    print("  Đánh giá trên tập kiểm tra ô lưới 2024–2025:")
    print(f"     * R² Score: {r2_grid:.4f}")
    print(f"     * RMSE:     {rmse_grid:.4f}")
    print(f"     * MAE:      {mae_grid:.4f}")

    # Độ quan trọng đặc trưng
    importances = dict(zip(features_grid, rf_grid.feature_importances_))
    sorted_imp = sorted(importances.items(), key=lambda x: x[1], reverse=True)
    print("  Độ quan trọng đặc trưng (Feature Importance):")
    for name, val in sorted_imp[:6]:
        print(f"     - {name}: {val*100:.2f}%")

    # --- 3. Huấn luyện Random Forest cho chuỗi trung bình toàn vùng ---
    print("\n[3/5] Đang huấn luyện Random Forest cho chuỗi trung bình toàn vùng...")
    df_series = pd.read_csv(series_csv)
    df_series["date"] = pd.to_datetime(df_series["date"])
    df_series = df_series.sort_values("date").reset_index(drop=True)
    df_series["TVDI_raw"] = df_series["TVDI"]
    s_train_mask = df_series["date"] < "2024-01-01"
    s_train_mean = float(df_series.loc[s_train_mask, "TVDI_raw"].mean())
    df_series["TVDI_causal"] = df_series["TVDI_raw"].ffill().fillna(s_train_mean)

    df_series["period"] = [(i % 24) + 1 for i in range(len(df_series))]
    df_series["sin_period"] = np.sin(2 * np.pi * df_series["period"] / 24)
    df_series["cos_period"] = np.cos(2 * np.pi * df_series["period"] / 24)
    df_series["month"] = df_series["date"].dt.month
    df_series["lag1"] = df_series["TVDI_causal"].shift(1)
    df_series["lag2"] = df_series["TVDI_causal"].shift(2)
    df_series["lag3"] = df_series["TVDI_causal"].shift(3)
    df_series["lag24"] = df_series["TVDI_causal"].shift(24)
    df_series["diff_lag"] = df_series["lag1"] - df_series["lag2"]
    df_series["rolling_mean3"] = df_series[["lag1", "lag2", "lag3"]].mean(axis=1)

    df_series_clean = df_series.dropna(subset=["lag1", "lag2", "lag3", "lag24", "TVDI_raw"]).copy()
    train_series = df_series_clean[df_series_clean["date"] < "2024-01-01"]
    test_series = df_series_clean[df_series_clean["date"] >= "2024-01-01"]

    features_series = ["lag1", "lag2", "lag3", "lag24", "diff_lag", "rolling_mean3", "sin_period", "cos_period", "month"]
    rf_series = RandomForestRegressor(n_estimators=100, max_depth=6, random_state=42)
    rf_series.fit(train_series[features_series], train_series["TVDI_raw"])

    pred_series = np.clip(rf_series.predict(test_series[features_series]), 0.0, 1.0)
    test_series = test_series.copy()
    test_series["pred"] = pred_series
    test_series["residual"] = test_series["TVDI_raw"] - pred_series

    r2_series = r2_score(test_series["TVDI_raw"], pred_series)
    rmse_series = np.sqrt(mean_squared_error(test_series["TVDI_raw"], pred_series))
    mae_series = mean_absolute_error(test_series["TVDI_raw"], pred_series)

    print("  Đánh giá trên tập kiểm tra toàn vùng 2024–2025:")
    print(f"     * R² Score: {r2_series:.4f}")
    print(f"     * RMSE:     {rmse_series:.4f}")
    print(f"     * MAE:      {mae_series:.4f}")

    # --- 4. Dự báo tương lai & Realtime (tính từ thời điểm hiện tại 26/10/2026 đến hết 31/12/2027) ---
    print("\n[4/5] Đang sinh dự báo tương lai chuẩn chu kỳ 15 ngày bằng mô hình Random Forest (đến hết 31/12/2027)...")
    future_date_strings = [
        # Năm 2026 (Chu kỳ 15 ngày chuyển tiếp):
        "2026-01-01", "2026-01-16", "2026-01-31", "2026-02-15",
        "2026-03-02", "2026-03-17", "2026-04-01", "2026-04-16",
        "2026-05-01", "2026-05-16", "2026-05-31", "2026-06-15",
        "2026-06-30", "2026-07-15", "2026-07-30", "2026-08-14",
        "2026-08-29", "2026-09-13", "2026-09-28", "2026-10-13",
        # MỐC HIỆN TẠI THỜI GIAN THỰC (REALTIME - 26/10/2026):
        "2026-10-26",
        # CÁC KỲ DỰ BÁO TƯƠNG LAI CHUẨN 15 NGÀY ĐẾN HẾT 31/12/2027:
        "2026-11-10", "2026-11-25", "2026-12-10", "2026-12-25",
        "2027-01-09", "2027-01-24", "2027-02-08", "2027-02-23",
        "2027-03-10", "2027-03-25", "2027-04-09", "2027-04-24",
        "2027-05-09", "2027-05-24", "2027-06-08", "2027-06-23",
        "2027-07-08", "2027-07-23", "2027-08-07", "2027-08-22",
        "2027-09-06", "2027-09-21", "2027-10-06", "2027-10-21",
        "2027-11-05", "2027-11-20", "2027-12-05", "2027-12-20",
        "2027-12-31"
    ]
    future_dates = [pd.to_datetime(d) for d in future_date_strings]

    if not metrics_only:
        # Dự báo đệ quy từng bước cho toàn vùng
        series_history = list(df_series["TVDI_causal"].values)
        future_series_preds = []
        for fdate in future_dates:
            day_of_year = fdate.dayofyear
            p_num = min(24, max(1, int(round((day_of_year / 365.25) * 24))))
            s_p = np.sin(2 * np.pi * p_num / 24)
            c_p = np.cos(2 * np.pi * p_num / 24)
            m_num = fdate.month
            l1 = series_history[-1]
            l2 = series_history[-2]
            l3 = series_history[-3]
            l24 = series_history[-24]
            d_lag = l1 - l2
            r_mean = (l1 + l2 + l3) / 3.0
            row_feat = pd.DataFrame([{
                "lag1": l1, "lag2": l2, "lag3": l3, "lag24": l24,
                "diff_lag": d_lag, "rolling_mean3": r_mean,
                "sin_period": s_p, "cos_period": c_p, "month": m_num
            }])[features_series]
            pred_val = float(np.clip(rf_series.predict(row_feat)[0], 0.0, 1.0))
            future_series_preds.append({"date": fdate.strftime("%Y-%m-%d"), "pred": pred_val})
            series_history.append(pred_val)

        # Dự báo đệ quy cho từng ô lưới (283 ô)
        unique_cells = df_clean[["cell_id", "lon", "lat", "cell_mean"]].drop_duplicates().to_dict("records")
        future_grid_preds = []  # list of dicts

        # Tạo bảng lịch sử gần nhất theo ô lưới
        cell_hist = {}
        for cell in unique_cells:
            cid = cell["cell_id"]
            c_sub = df_clean[df_clean["cell_id"] == cid].sort_values("date")
            cell_hist[cid] = {
                "values": list(c_sub["TVDI_causal"].values),
                "lon": cell["lon"],
                "lat": cell["lat"],
                "cell_mean": cell["cell_mean"]
            }

        seasonal_dict = cell_seasonal.set_index(["cell_id", "period"])["cell_seasonal_mean"].to_dict()

        for fdate in future_dates:
            day_of_year = fdate.dayofyear
            p_num = min(24, max(1, int(round((day_of_year / 365.25) * 24))))
            s_p = np.sin(2 * np.pi * p_num / 24)
            c_p = np.cos(2 * np.pi * p_num / 24)
            m_num = fdate.month
            d_str = fdate.strftime("%Y-%m-%d")

            step_rows = []
            cids = []
            for cid, info in cell_hist.items():
                vals = info["values"]
                l1 = vals[-1]
                l2 = vals[-2]
                l3 = vals[-3]
                l24 = vals[-24] if len(vals) >= 24 else l1
                d_lag = l1 - l2
                r_mean = (l1 + l2 + l3) / 3.0
                c_seas = seasonal_dict.get((cid, p_num), info["cell_mean"])
                step_rows.append({
                    "lag1": l1, "lag2": l2, "lag3": l3, "lag24": l24,
                    "diff_lag": d_lag, "rolling_mean3": r_mean,
                    "sin_period": s_p, "cos_period": c_p, "month": m_num,
                    "cell_mean": info["cell_mean"],
                    "cell_seasonal_mean": c_seas,
                    "lon": info["lon"], "lat": info["lat"]
                })
                cids.append(cid)

            X_step = pd.DataFrame(step_rows)[features_grid]
            preds_step = np.clip(rf_grid.predict(X_step), 0.05, 0.98)

            for cid, p_val in zip(cids, preds_step):
                p_float = float(round(p_val, 4))
                cell_hist[cid]["values"].append(p_float)
                future_grid_preds.append({
                    "date": d_str,
                    "cell_id": int(cid),
                    "pred": p_float
                })

        # --- 5. Lưu vào CSDL PostgreSQL (tvdi.model_runs & tvdi.tvdi_forecast) ---
        print("\n[5/5] Đang lưu kết quả dự báo vào PostgreSQL...")

        def _drought_lvl(val):
            if val is None:
                return None
            v = max(0.0, min(1.0, float(val)))
            for idx, thr in enumerate((0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875), start=1):
                if v <= thr:
                    return idx
            return 8

        metrics_payload = {
            "grid_metrics": {"r2_score": round(r2_grid, 4), "rmse": round(rmse_grid, 4), "mae": round(mae_grid, 4)},
            "overall_metrics": {"r2_score": round(r2_series, 4), "rmse": round(rmse_series, 4), "mae": round(mae_series, 4)},
            "leakage_free": True,
        }

        with engine.begin() as conn:
            model_run_id = conn.execute(
                text("""
                    INSERT INTO tvdi.model_runs (
                        model_name, model_version, target_index, satellite_source,
                        horizon_type, is_simulated, train_period, test_period,
                        r2_score, rmse, mae, metrics_json, is_active
                    )
                    VALUES (
                        'Random Forest Regressor', 'v1.1', 'TVDI', 'LANDSAT',
                        '15day', FALSE, '2017-01-01 đến 2023-12-12', '2024-01-01 đến 2025-12-12',
                        :r2, :rmse, :mae, CAST(:mjson AS jsonb), TRUE
                    )
                    RETURNING id
                """),
                {
                    "r2": round(float(r2_grid), 4),
                    "rmse": round(float(rmse_grid), 4),
                    "mae": round(float(mae_grid), 4),
                    "mjson": json.dumps(metrics_payload, ensure_ascii=False),
                },
            ).scalar()

            conn.execute(
                text("""
                    DELETE FROM tvdi.tvdi_forecast
                    WHERE satellite_source = 'LANDSAT'
                      AND horizon_type IN ('test_eval', '15day')
                """)
            )

            insert_sql = text("""
                INSERT INTO tvdi.tvdi_forecast (
                    date, cell_id, tvdi_actual, tvdi_pred, residual, model_name,
                    horizon_type, satellite_source, is_simulated, model_run_id, drought_level
                )
                VALUES (
                    :date, :cell_id, :tvdi_actual, :tvdi_pred, :residual, :model_name,
                    :horizon_type, 'LANDSAT', FALSE, :model_run_id, :drought_level
                )
                ON CONFLICT DO NOTHING
            """)

            records = []
            for _, r in test_series.iterrows():
                p = float(round(r["pred"], 4))
                records.append({
                    "date": r["date"].strftime("%Y-%m-%d"),
                    "cell_id": None,
                    "tvdi_actual": float(round(r["TVDI_raw"], 4)),
                    "tvdi_pred": p,
                    "residual": float(round(r["residual"], 4)),
                    "model_name": "Random Forest",
                    "horizon_type": "test_eval",
                    "model_run_id": model_run_id,
                    "drought_level": _drought_lvl(p),
                })

            for item in future_series_preds:
                p = float(round(item["pred"], 4))
                records.append({
                    "date": item["date"],
                    "cell_id": None,
                    "tvdi_actual": None,
                    "tvdi_pred": p,
                    "residual": None,
                    "model_name": "Random Forest",
                    "horizon_type": "15day",
                    "model_run_id": model_run_id,
                    "drought_level": _drought_lvl(p),
                })

            for _, r in test_grid.iterrows():
                p = float(round(r["pred"], 4))
                records.append({
                    "date": r["date"].strftime("%Y-%m-%d"),
                    "cell_id": int(r["cell_id"]),
                    "tvdi_actual": float(round(r["TVDI_raw"], 4)),
                    "tvdi_pred": p,
                    "residual": float(round(r["residual"], 4)),
                    "model_name": "Random Forest",
                    "horizon_type": "test_eval",
                    "model_run_id": model_run_id,
                    "drought_level": _drought_lvl(p),
                })

            for item in future_grid_preds:
                p = item["pred"]
                records.append({
                    "date": item["date"],
                    "cell_id": item["cell_id"],
                    "tvdi_actual": None,
                    "tvdi_pred": p,
                    "residual": None,
                    "model_name": "Random Forest",
                    "horizon_type": "15day",
                    "model_run_id": model_run_id,
                    "drought_level": _drought_lvl(p),
                })

            print(f"  - Đang ghi {len(records):,} bản ghi dự báo vào bảng tvdi.tvdi_forecast...")
            conn.execute(insert_sql, records)

    # Lưu model và metrics JSON (giữ nguyên các trường monthly_* đã có)
    models_dir = BASE_DIR / "backend" / "models"
    models_dir.mkdir(exist_ok=True)

    joblib.dump(rf_grid, models_dir / "rf_tvdi_model.joblib")

    metrics_path = models_dir / "rf_metrics.json"
    existing_metrics = {}
    if metrics_path.is_file():
        try:
            existing_metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
        except Exception:
            existing_metrics = {}

    metrics_data = {
        "model_name": "Random Forest Regressor",
        "library": "scikit-learn",
        "trained_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "leakage_free": True,
        "train_period": "2017-01-01 đến 2023-12-12 (168 kỳ quan trắc, 7 năm)",
        "test_period": "2024-01-01 đến 2025-12-12 (48 kỳ quan trắc, 2 năm)",
        "future_forecast_period": "2026-10-17 đến 2027-03-31 (Dự báo thời gian thực & mùa khô 2027)",
        "hyperparameters": {
            "n_estimators": 120,
            "max_depth": 12,
            "min_samples_split": 4,
            "random_state": 42
        },
        "grid_metrics": {
            "r2_score": round(r2_grid, 4),
            "rmse": round(rmse_grid, 4),
            "mae": round(mae_grid, 4),
            "test_samples": len(test_grid)
        },
        "overall_metrics": {
            "r2_score": round(r2_series, 4),
            "rmse": round(rmse_series, 4),
            "mae": round(mae_series, 4),
            "test_samples": len(test_series)
        },
        "feature_importances": [
            {"feature": k, "importance_percent": round(v * 100, 2)}
            for k, v in sorted_imp
        ],
        "future_dates": [f.strftime("%Y-%m-%d") for f in future_dates]
    }
    existing_metrics.update(metrics_data)

    metrics_path.write_text(json.dumps(existing_metrics, ensure_ascii=False, indent=2), encoding="utf-8")

    print("  Đã lưu file mô hình: backend/models/rf_tvdi_model.joblib")
    print("  Đã lưu file chỉ số đánh giá: backend/models/rf_metrics.json")
    print("\nHUẤN LUYỆN VÀ ĐÁNH GIÁ HOÀN TẤT!")
    print("=" * 70)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--metrics-only",
        action="store_true",
        help="Chỉ huấn luyện, đánh giá không rò rỉ dữ liệu và cập nhật rf_tvdi_model.joblib / rf_metrics.json (không ghi DB)",
    )
    args = parser.parse_args()
    train_and_evaluate(metrics_only=args.metrics_only)
