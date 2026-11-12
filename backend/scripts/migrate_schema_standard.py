"""
migrate_schema_standard.py – Nâng cấp và chuẩn hóa CSDL PostGIS (schema tvdi)
không làm mất dữ liệu hiện có.

Các bước thực hiện (an toàn, có thể chạy lại nhiều lần / idempotent):
1. Tạo các bảng chuẩn mới nếu chưa có:
   - tvdi.drought_classes (8 cấp độ khô hạn chuẩn)
   - tvdi.ward_observations (hiện trạng 3 chỉ số LST, NDVI, TVDI theo 167 phường/xã)
   - tvdi.gee_sync_logs (nhật ký đồng bộ hiện trạng từ Google Earth Engine)
   - tvdi.model_runs (metadata & độ chính xác mô hình AI / giả lập)
   - tvdi.ward_forecasts (dự báo 3 chỉ số theo 167 phường/xã)
   - tvdi.bulletins (lưu trữ bản tin giám sát & dự báo)
2. Bổ sung cột chuẩn hóa cho các bảng hiện có:
   - tvdi.regions, tvdi.grid_cells, tvdi.wards (thêm geom_boundary MultiPolygon, code, area_km2)
   - tvdi.tvdi_grid, tvdi.tvdi_series (satellite_source, granularity, spatial_res_m, cloud_pct, thống kê min/max/drought_area_pct)
   - tvdi.tvdi_forecast (bổ sung lst_pred, ndvi_pred, lst_actual, ndvi_actual, horizon_type, forecast_step, issued_date, satellite_source, is_simulated, model_run_id, drought_level)
3. Thiết lập khóa ngoại (Foreign Keys) và chỉ mục duy nhất (Unique Constraints) chuẩn.
4. Nạp/cập nhật dữ liệu chuẩn: drought_classes, wards boundary, thống kê tvdi_series, model_runs và ward_observations.

Chạy: python -m backend.scripts.migrate_schema_standard
"""
import json
import sys
from pathlib import Path

import numpy as np
from psycopg2.extras import execute_values
from sqlalchemy import text

BASE_DIR = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(BASE_DIR))

from backend.app.config import settings
from backend.app.database import Base, engine
from backend.app.models import (  # noqa: F401
    Bulletin,
    DroughtClass,
    GeeSyncLog,
    GridCell,
    ModelRun,
    Region,
    TvdiForecast,
    TvdiGrid,
    TvdiSeries,
    User,
    UserActivity,
    Ward,
    WardForecast,
    WardObservation,
)
from backend.app.services import tvdi_service
from backend.scripts.init_wards import init_wards_table


def _constraint_exists(conn, conname: str) -> bool:
    return (
        conn.execute(
            text("""
                SELECT 1 FROM pg_constraint
                WHERE conname = :name
                  AND connamespace = 'tvdi'::regnamespace
            """),
            {"name": conname},
        ).fetchone()
        is not None
    )


def _add_fk_if_missing(conn, table: str, conname: str, fk_sql: str):
    if not _constraint_exists(conn, conname):
        conn.execute(text(f"ALTER TABLE tvdi.{table} ADD CONSTRAINT {conname} {fk_sql};"))


def step_create_new_tables():
    print("[1/7] Tạo các bảng chuẩn mới (nếu chưa tồn tại)...")
    Base.metadata.create_all(bind=engine)


def step_alter_existing_tables():
    print("[2/7] Bổ sung các cột chuẩn hóa cho bảng hiện có...")
    alter_statements = [
        # tvdi.regions
        "ALTER TABLE tvdi.regions ADD COLUMN IF NOT EXISTS code VARCHAR(50)",
        "ALTER TABLE tvdi.regions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP",
        # tvdi.grid_cells
        "ALTER TABLE tvdi.grid_cells ADD COLUMN IF NOT EXISTS region_id INTEGER",
        "ALTER TABLE tvdi.grid_cells ADD COLUMN IF NOT EXISTS area_km2 DOUBLE PRECISION",
        "ALTER TABLE tvdi.grid_cells ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE",
        # tvdi.wards
        "ALTER TABLE tvdi.wards ADD COLUMN IF NOT EXISTS code INTEGER",
        "ALTER TABLE tvdi.wards ADD COLUMN IF NOT EXISTS region_id INTEGER",
        "ALTER TABLE tvdi.wards ADD COLUMN IF NOT EXISTS area_km2 DOUBLE PRECISION",
        "ALTER TABLE tvdi.wards ADD COLUMN IF NOT EXISTS geom_boundary geometry(MultiPolygon, 4326)",
        # tvdi.tvdi_grid
        "ALTER TABLE tvdi.tvdi_grid ADD COLUMN IF NOT EXISTS satellite_source VARCHAR(30) NOT NULL DEFAULT 'LANDSAT'",
        "ALTER TABLE tvdi.tvdi_grid ADD COLUMN IF NOT EXISTS granularity VARCHAR(20) NOT NULL DEFAULT '15day'",
        "ALTER TABLE tvdi.tvdi_grid ADD COLUMN IF NOT EXISTS spatial_res_m INTEGER NOT NULL DEFAULT 30",
        "ALTER TABLE tvdi.tvdi_grid ADD COLUMN IF NOT EXISTS cloud_pct DOUBLE PRECISION",
        "ALTER TABLE tvdi.tvdi_grid ADD COLUMN IF NOT EXISTS data_quality VARCHAR(30) NOT NULL DEFAULT 'raw_gee'",
        "ALTER TABLE tvdi.tvdi_grid ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP",
        # tvdi.tvdi_series
        "ALTER TABLE tvdi.tvdi_series ADD COLUMN IF NOT EXISTS satellite_source VARCHAR(30) NOT NULL DEFAULT 'LANDSAT'",
        "ALTER TABLE tvdi.tvdi_series ADD COLUMN IF NOT EXISTS granularity VARCHAR(20) NOT NULL DEFAULT '15day'",
        "ALTER TABLE tvdi.tvdi_series ADD COLUMN IF NOT EXISTS lst_min DOUBLE PRECISION",
        "ALTER TABLE tvdi.tvdi_series ADD COLUMN IF NOT EXISTS lst_max DOUBLE PRECISION",
        "ALTER TABLE tvdi.tvdi_series ADD COLUMN IF NOT EXISTS ndvi_min DOUBLE PRECISION",
        "ALTER TABLE tvdi.tvdi_series ADD COLUMN IF NOT EXISTS ndvi_max DOUBLE PRECISION",
        "ALTER TABLE tvdi.tvdi_series ADD COLUMN IF NOT EXISTS tvdi_min DOUBLE PRECISION",
        "ALTER TABLE tvdi.tvdi_series ADD COLUMN IF NOT EXISTS tvdi_max DOUBLE PRECISION",
        "ALTER TABLE tvdi.tvdi_series ADD COLUMN IF NOT EXISTS drought_area_pct DOUBLE PRECISION",
        "ALTER TABLE tvdi.tvdi_series ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP",
        # tvdi.tvdi_forecast – bổ sung đủ 3 chỉ số + horizon + nguồn vệ tinh + cờ giả lập
        "ALTER TABLE tvdi.tvdi_forecast ALTER COLUMN tvdi_pred DROP NOT NULL",
        "ALTER TABLE tvdi.tvdi_forecast ALTER COLUMN model_name TYPE VARCHAR(80)",
        "ALTER TABLE tvdi.tvdi_forecast ADD COLUMN IF NOT EXISTS lst_actual DOUBLE PRECISION",
        "ALTER TABLE tvdi.tvdi_forecast ADD COLUMN IF NOT EXISTS lst_pred DOUBLE PRECISION",
        "ALTER TABLE tvdi.tvdi_forecast ADD COLUMN IF NOT EXISTS lst_residual DOUBLE PRECISION",
        "ALTER TABLE tvdi.tvdi_forecast ADD COLUMN IF NOT EXISTS ndvi_actual DOUBLE PRECISION",
        "ALTER TABLE tvdi.tvdi_forecast ADD COLUMN IF NOT EXISTS ndvi_pred DOUBLE PRECISION",
        "ALTER TABLE tvdi.tvdi_forecast ADD COLUMN IF NOT EXISTS ndvi_residual DOUBLE PRECISION",
        "ALTER TABLE tvdi.tvdi_forecast ADD COLUMN IF NOT EXISTS horizon_type VARCHAR(20) NOT NULL DEFAULT '15day'",
        "ALTER TABLE tvdi.tvdi_forecast ADD COLUMN IF NOT EXISTS forecast_step INTEGER",
        "ALTER TABLE tvdi.tvdi_forecast ADD COLUMN IF NOT EXISTS issued_date DATE",
        "ALTER TABLE tvdi.tvdi_forecast ADD COLUMN IF NOT EXISTS satellite_source VARCHAR(30) NOT NULL DEFAULT 'LANDSAT'",
        "ALTER TABLE tvdi.tvdi_forecast ADD COLUMN IF NOT EXISTS is_simulated BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE tvdi.tvdi_forecast ADD COLUMN IF NOT EXISTS model_run_id INTEGER",
        "ALTER TABLE tvdi.tvdi_forecast ADD COLUMN IF NOT EXISTS drought_level INTEGER",
        "ALTER TABLE tvdi.tvdi_forecast ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP",
    ]
    with engine.begin() as conn:
        for stmt in alter_statements:
            conn.execute(text(stmt))


def step_seed_reference_and_spatial():
    print("[3/7] Nạp danh mục 8 cấp khô hạn & đồng bộ thông tin không gian (regions, grid_cells, wards)...")
    with engine.begin() as conn:
        # 1. Drought classes
        risk_notes = {
            1: "Nguy cơ ngập úng cục bộ, thực bì bão hòa nước",
            2: "An toàn, độ ẩm cao thuận lợi cho sinh trưởng",
            3: "Độ ẩm đất đầy đủ, điều kiện phát triển tốt",
            4: "Trạng thái bình thường, ổn định",
            5: "Cảnh báo cấp 1: Bắt đầu thiếu ẩm nhẹ",
            6: "Cảnh báo cấp 2: Hạn vừa, cần theo dõi tưới tiêu",
            7: "Báo động cấp 3: Hạn nặng, nguy cơ cháy rừng cao",
            8: "Báo động khẩn cấp: Khô hạn gay gắt",
        }
        for lvl, cls in enumerate(settings.TVDI_CLASSES, start=1):
            conn.execute(
                text("""
                    INSERT INTO tvdi.drought_classes (level, min_tvdi, max_tvdi, label, description, color, risk_note)
                    VALUES (:level, :min_tvdi, :max_tvdi, :label, :description, :color, :risk_note)
                    ON CONFLICT (level) DO UPDATE SET
                        min_tvdi = EXCLUDED.min_tvdi,
                        max_tvdi = EXCLUDED.max_tvdi,
                        label = EXCLUDED.label,
                        description = EXCLUDED.description,
                        color = EXCLUDED.color,
                        risk_note = EXCLUDED.risk_note;
                """),
                {
                    "level": lvl,
                    "min_tvdi": cls["min"],
                    "max_tvdi": cls["max"],
                    "label": cls["label"],
                    "description": cls["description"],
                    "color": cls["color"],
                    "risk_note": risk_notes.get(lvl),
                },
            )

        # 2. Regions & GridCells metadata
        conn.execute(text("UPDATE tvdi.regions SET code = COALESCE(code, 'TPHCM_MO_RONG'), updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP);"))
        region_id = conn.execute(text("SELECT id FROM tvdi.regions ORDER BY id ASC LIMIT 1")).scalar()
        if region_id is not None:
            conn.execute(
                text("""
                    UPDATE tvdi.grid_cells
                    SET region_id = COALESCE(region_id, :rid),
                        is_active = (geom_polygon IS NOT NULL AND NOT ST_IsEmpty(geom_polygon)),
                        area_km2 = CASE
                            WHEN geom_polygon IS NOT NULL AND NOT ST_IsEmpty(geom_polygon)
                            THEN ROUND((ST_Area(geom_polygon::geography) / 1e6)::numeric, 3)::float
                            ELSE 0.0
                        END;
                """),
                {"rid": region_id},
            )

    # 3. Wards (Point + MultiPolygon boundary + area_km2)
    init_wards_table(json_only=False)


def _run_ddl_safe(sql: str, label: str = ""):
    try:
        with engine.begin() as conn:
            conn.execute(text(sql))
    except Exception as e:
        print(f"  [WARN] DDL {label or sql[:60]}: {e}")


def step_constraints_and_indexes():
    print("[4/7] Thiết lập Foreign Keys và Unique Indexes chuẩn...")
    # Dọn bản ghi trùng (nếu có từ CSDL cũ) trước khi tạo unique index
    _run_ddl_safe("""
        DELETE FROM tvdi.tvdi_forecast a
        USING tvdi.tvdi_forecast b
        WHERE a.id < b.id
          AND a.date = b.date
          AND COALESCE(a.cell_id, -1) = COALESCE(b.cell_id, -1)
          AND a.horizon_type = b.horizon_type
          AND a.satellite_source = b.satellite_source;
    """, "dedup tvdi_forecast")
    _run_ddl_safe("""
        DELETE FROM tvdi.tvdi_grid a
        USING tvdi.tvdi_grid b
        WHERE a.id < b.id
          AND a.date = b.date
          AND a.cell_id = b.cell_id
          AND a.satellite_source = b.satellite_source
          AND a.granularity = b.granularity;
    """, "dedup tvdi_grid")

    with engine.begin() as conn:
        if _constraint_exists(conn, "tvdi_series_date_key"):
            conn.execute(text("ALTER TABLE tvdi.tvdi_series DROP CONSTRAINT tvdi_series_date_key;"))
        if not _constraint_exists(conn, "uq_tvdi_series_obs"):
            _run_ddl_safe(
                "ALTER TABLE tvdi.tvdi_series ADD CONSTRAINT uq_tvdi_series_obs UNIQUE (date, satellite_source, granularity);",
                "uq_tvdi_series_obs",
            )
        if not _constraint_exists(conn, "uq_tvdi_grid_obs"):
            _run_ddl_safe(
                "ALTER TABLE tvdi.tvdi_grid ADD CONSTRAINT uq_tvdi_grid_obs UNIQUE (date, cell_id, satellite_source, granularity);",
                "uq_tvdi_grid_obs",
            )

    _run_ddl_safe("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_tvdi_forecast_target
        ON tvdi.tvdi_forecast (date, COALESCE(cell_id, -1), horizon_type, satellite_source);
    """, "uq_tvdi_forecast_target")
    _run_ddl_safe("CREATE INDEX IF NOT EXISTS idx_grid_cells_point ON tvdi.grid_cells USING GIST (geom_point);", "idx_grid_cells_point")
    _run_ddl_safe("CREATE INDEX IF NOT EXISTS idx_tvdi_grid_source_gran ON tvdi.tvdi_grid (satellite_source, granularity);", "idx_tvdi_grid_source_gran")
    _run_ddl_safe("CREATE INDEX IF NOT EXISTS idx_tvdi_series_source_gran ON tvdi.tvdi_series (satellite_source, granularity);", "idx_tvdi_series_source_gran")
    _run_ddl_safe("CREATE INDEX IF NOT EXISTS idx_tvdi_forecast_horizon_src ON tvdi.tvdi_forecast (horizon_type, satellite_source);", "idx_tvdi_forecast_horizon_src")

    for tbl, cname, fk_sql in (
        ("grid_cells", "fk_grid_cells_region", "FOREIGN KEY (region_id) REFERENCES tvdi.regions(id) ON DELETE SET NULL"),
        ("wards", "fk_wards_region", "FOREIGN KEY (region_id) REFERENCES tvdi.regions(id) ON DELETE SET NULL"),
        ("tvdi_grid", "fk_tvdi_grid_cell", "FOREIGN KEY (cell_id) REFERENCES tvdi.grid_cells(cell_id) ON DELETE CASCADE"),
        ("tvdi_forecast", "fk_tvdi_forecast_cell", "FOREIGN KEY (cell_id) REFERENCES tvdi.grid_cells(cell_id) ON DELETE CASCADE"),
        ("tvdi_forecast", "fk_tvdi_forecast_model_run", "FOREIGN KEY (model_run_id) REFERENCES tvdi.model_runs(id) ON DELETE SET NULL"),
        ("tvdi_forecast", "fk_tvdi_forecast_drought_lvl", "FOREIGN KEY (drought_level) REFERENCES tvdi.drought_classes(level) ON DELETE SET NULL"),
    ):
        try:
            with engine.begin() as conn:
                _add_fk_if_missing(conn, tbl, cname, fk_sql)
        except Exception as e:
            print(f"  [WARN] FK {tbl}.{cname}: {e}")


def step_backfill_series_stats():
    print("[5/7] Cập nhật thống kê min/max và tỷ lệ diện tích hạn cho tvdi.tvdi_series...")
    with engine.begin() as conn:
        conn.execute(
            text("""
                UPDATE tvdi.tvdi_series s
                SET lst_min = sub.lst_min,
                    lst_max = sub.lst_max,
                    ndvi_min = sub.ndvi_min,
                    ndvi_max = sub.ndvi_max,
                    tvdi_min = sub.tvdi_min,
                    tvdi_max = sub.tvdi_max,
                    drought_area_pct = sub.drought_area_pct
                FROM (
                    SELECT
                        g.date,
                        g.satellite_source,
                        g.granularity,
                        ROUND(MIN(g.lst_c)::numeric, 2)::float AS lst_min,
                        ROUND(MAX(g.lst_c)::numeric, 2)::float AS lst_max,
                        ROUND(MIN(g.ndvi)::numeric, 3)::float AS ndvi_min,
                        ROUND(MAX(g.ndvi)::numeric, 3)::float AS ndvi_max,
                        ROUND(MIN(g.tvdi)::numeric, 3)::float AS tvdi_min,
                        ROUND(MAX(g.tvdi)::numeric, 3)::float AS tvdi_max,
                        ROUND((SUM(CASE WHEN g.tvdi >= 0.625 THEN 1 ELSE 0 END)::float / NULLIF(COUNT(g.tvdi), 0) * 100.0)::numeric, 2)::float AS drought_area_pct
                    FROM tvdi.tvdi_grid g
                    JOIN tvdi.grid_cells c ON g.cell_id = c.cell_id
                    WHERE c.geom_polygon IS NOT NULL
                    GROUP BY g.date, g.satellite_source, g.granularity
                ) sub
                WHERE s.date = sub.date
                  AND s.satellite_source = sub.satellite_source
                  AND s.granularity = sub.granularity;
            """)
        )


def step_backfill_models_and_forecasts():
    print("[6/7] Chuẩn hóa metadata bảng tvdi.model_runs và tvdi.tvdi_forecast...")
    metrics_path = BASE_DIR / "backend" / "models" / "rf_metrics.json"
    metrics_data = {}
    if metrics_path.exists():
        metrics_data = json.loads(metrics_path.read_text(encoding="utf-8"))

    with engine.begin() as conn:
        rf_run_id = conn.execute(
            text("""
                SELECT id FROM tvdi.model_runs
                WHERE model_name = 'Random Forest Regressor' AND target_index = 'TVDI' AND satellite_source = 'LANDSAT'
                ORDER BY id DESC LIMIT 1
            """)
        ).scalar()

        if rf_run_id is None:
            grid_m = metrics_data.get("grid_metrics", {})
            rf_run_id = conn.execute(
                text("""
                    INSERT INTO tvdi.model_runs (
                        model_name, model_version, target_index, satellite_source,
                        horizon_type, is_simulated, train_period, test_period,
                        r2_score, rmse, mae, metrics_json, notes, is_active
                    )
                    VALUES (
                        :mname, 'v1.0', 'TVDI', 'LANDSAT',
                        '15day', FALSE, :train_p, :test_p,
                        :r2, :rmse, :mae, CAST(:mjson AS jsonb),
                        'Phiên bản Random Forest ban đầu (chỉ TVDI)', TRUE
                    )
                    RETURNING id
                """),
                {
                    "mname": metrics_data.get("model_name", "Random Forest Regressor"),
                    "train_p": metrics_data.get("train_period"),
                    "test_p": metrics_data.get("test_period"),
                    "r2": grid_m.get("r2_score"),
                    "rmse": grid_m.get("rmse"),
                    "mae": grid_m.get("mae"),
                    "mjson": json.dumps(metrics_data, ensure_ascii=False),
                },
            ).scalar()

        # Phân loại các bản ghi tvdi_forecast hiện có
        conn.execute(
            text("""
                UPDATE tvdi.tvdi_forecast
                SET horizon_type = CASE
                        WHEN tvdi_actual IS NOT NULL THEN 'test_eval'
                        ELSE '15day'
                    END,
                    is_simulated = CASE
                        WHEN tvdi_actual IS NULL AND model_name ILIKE '%Realtime Dynamic%' THEN TRUE
                        ELSE FALSE
                    END,
                    model_run_id = COALESCE(model_run_id, :run_id),
                    drought_level = CASE
                        WHEN tvdi_pred IS NULL THEN NULL
                        WHEN tvdi_pred <= 0.125 THEN 1
                        WHEN tvdi_pred <= 0.250 THEN 2
                        WHEN tvdi_pred <= 0.375 THEN 3
                        WHEN tvdi_pred <= 0.500 THEN 4
                        WHEN tvdi_pred <= 0.625 THEN 5
                        WHEN tvdi_pred <= 0.750 THEN 6
                        WHEN tvdi_pred <= 0.875 THEN 7
                        ELSE 8
                    END;
            """),
            {"run_id": rf_run_id},
        )


def step_backfill_ward_observations():
    print("[7/7] Tổng hợp hiện trạng 3 chỉ số (LST, NDVI, TVDI) cho 167 phường/xã vào tvdi.ward_observations...")
    with engine.connect() as conn:
        wards_rows = conn.execute(
            text("SELECT ward_id, name, district, province, type, lat, lon FROM tvdi.wards ORDER BY ward_id ASC")
        ).fetchall()
        dates = [
            r[0]
            for r in conn.execute(
                text("""
                    SELECT DISTINCT date FROM tvdi.tvdi_grid
                    WHERE satellite_source = 'LANDSAT' AND granularity = '15day'
                    ORDER BY date ASC
                """)
            ).fetchall()
        ]
        existing_dates = {
            r[0]
            for r in conn.execute(
                text("""
                    SELECT date FROM tvdi.ward_observations
                    WHERE satellite_source = 'LANDSAT' AND granularity = '15day'
                    GROUP BY date HAVING COUNT(*) >= :n_wards
                """),
                {"n_wards": len(wards_rows)},
            ).fetchall()
        }

        missing_dates = [d for d in dates if d not in existing_dates]
        if not missing_dates:
            print(f"  [OK] Đã có đủ dữ liệu ward_observations cho cả {len(dates)} mốc ngày.")
            return

        rows = conn.execute(
            text("""
                SELECT date, lon, lat, lst_c, ndvi, tvdi
                FROM tvdi.tvdi_grid
                WHERE satellite_source = 'LANDSAT'
                  AND granularity = '15day'
                  AND date = ANY(:dates)
                ORDER BY date ASC
            """),
            {"dates": missing_dates},
        ).fetchall()

    by_date = {}
    for r in rows:
        by_date.setdefault(r[0], []).append((r[1], r[2], r[3], r[4], r[5]))

    records = []
    for dt in missing_dates:
        g_rows = by_date.get(dt, [])
        if not g_rows:
            continue
        interp_list = tvdi_service.interpolate_wards_from_grid(wards_rows, g_rows)
        for w, vals in zip(wards_rows, interp_list):
            tvdi_v = vals["tvdi"]
            lvl = None
            if tvdi_v is not None and np.isfinite(tvdi_v):
                dc = tvdi_service.get_drought_class(tvdi_v)
                lvl = dc["level"] if dc["level"] > 0 else None
            records.append(
                (dt, int(w[0]), "LANDSAT", "15day", vals["lst_c"], vals["ndvi"], tvdi_v, lvl, "idw_centroid")
            )

    raw_conn = engine.raw_connection()
    try:
        with raw_conn.cursor() as cur:
            execute_values(
                cur,
                """
                INSERT INTO tvdi.ward_observations (
                    date, ward_id, satellite_source, granularity,
                    lst_c, ndvi, tvdi, drought_level, method
                )
                VALUES %s
                ON CONFLICT ON CONSTRAINT uq_ward_obs DO UPDATE SET
                    lst_c = EXCLUDED.lst_c,
                    ndvi = EXCLUDED.ndvi,
                    tvdi = EXCLUDED.tvdi,
                    drought_level = EXCLUDED.drought_level,
                    method = EXCLUDED.method,
                    synced_at = CURRENT_TIMESTAMP
                """,
                records,
                page_size=5000,
            )
        raw_conn.commit()
    finally:
        raw_conn.close()
    print(f"  [OK] Đã đồng bộ {len(records):,} bản ghi vào tvdi.ward_observations ({len(missing_dates)} mốc ngày).")


def print_verification_report():
    print("\n" + "=" * 72)
    print("KIỂM TRA KẾT QUẢ CHUẨN HÓA CSDL (SCHEMA tvdi)")
    print("=" * 72)
    with engine.connect() as conn:
        tables = [
            r[0]
            for r in conn.execute(
                text("""
                    SELECT table_name FROM information_schema.tables
                    WHERE table_schema = 'tvdi' ORDER BY table_name
                """)
            ).fetchall()
        ]
        for t in tables:
            cnt = conn.execute(text(f'SELECT COUNT(*) FROM tvdi."{t}"')).scalar()
            print(f"  - tvdi.{t:<20} : {cnt:>8,} dòng")

        fks = conn.execute(
            text("""
                SELECT tc.table_name, tc.constraint_name
                FROM information_schema.table_constraints tc
                WHERE tc.table_schema = 'tvdi' AND tc.constraint_type = 'FOREIGN KEY'
                ORDER BY tc.table_name, tc.constraint_name
            """)
        ).fetchall()
        print(f"\n  Foreign Keys ({len(fks)}):")
        for tbl, cname in fks:
            print(f"    * {tbl}.{cname}")

        ward_poly = conn.execute(text("SELECT COUNT(*) FROM tvdi.wards WHERE geom_boundary IS NOT NULL")).scalar()
        fc_breakdown = conn.execute(
            text("""
                SELECT horizon_type, satellite_source, is_simulated, COUNT(*)
                FROM tvdi.tvdi_forecast
                GROUP BY horizon_type, satellite_source, is_simulated
                ORDER BY horizon_type, is_simulated
            """)
        ).fetchall()
        print(f"\n  Phường/xã có đa giác ranh giới trong PostGIS: {ward_poly}/167")
        print("  Phân loại dữ liệu tvdi.tvdi_forecast:")
        for r in fc_breakdown:
            print(f"    * horizon={r[0]}, source={r[1]}, simulated={r[2]} -> {r[3]:,} dòng")


def main():
    print("=" * 72)
    print("CHUẨN HÓA CSDL POSTGRESQL + POSTGIS CHO HỆ THỐNG WEBGIS TVDI")
    print("=" * 72)
    step_create_new_tables()
    step_alter_existing_tables()
    step_seed_reference_and_spatial()
    step_constraints_and_indexes()
    step_backfill_series_stats()
    step_backfill_models_and_forecasts()
    step_backfill_ward_observations()
    print_verification_report()
    print("\n[HOÀN TẤT] CSDL đã được chuẩn hóa thành công!")


if __name__ == "__main__":
    main()
