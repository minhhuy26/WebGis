"""
FastAPI application – entry point.
"""
import threading
from datetime import date
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from sqlalchemy import text

from .config import settings
from .database import SessionLocal, check_connection, engine
from .routers import tvdi, stats, gee, prediction, auth, bulletins, tree_benefit

# ---- Tạo ứng dụng FastAPI -------------------------------------------------
app = FastAPI(
    title="Hệ thống Giám sát Mức độ Khô hạn tại TP.HCM",
    description="Hệ thống WebGIS giám sát và dự báo mức độ khô hạn (TVDI, LST, NDVI) tại TP. Hồ Chí Minh",
    version="2.0.0",
)

STATIC_LONG_CACHE_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".svg", ".woff", ".woff2", ".geojson")


@app.middleware("http")
async def add_no_cache_headers(request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path.startswith("/static/"):
        lower_path = path.lower()
        has_version = bool(request.query_params.get("v"))
        if lower_path.endswith(STATIC_LONG_CACHE_EXTS) or (has_version and lower_path.endswith((".js", ".css"))):
            response.headers["Cache-Control"] = "public, max-age=604800"
        else:
            response.headers["Cache-Control"] = "no-cache, must-revalidate"
    elif path == "/":
        response.headers["Cache-Control"] = "no-cache, must-revalidate"
    return response

# ---- Đăng ký routers -------------------------------------------------------
app.include_router(tvdi.router, prefix="/api", tags=["TVDI"])
app.include_router(stats.router, prefix="/api", tags=["Thống kê"])
app.include_router(prediction.router)
app.include_router(gee.router)
app.include_router(auth.router)
app.include_router(bulletins.router)
app.include_router(tree_benefit.router, prefix="/api", tags=["Lợi ích Cây xanh"])

# ---- Phục vụ frontend (static files) ---------------------------------------
FRONTEND_DIR = Path(__file__).resolve().parent.parent.parent / "frontend"
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


@app.api_route("/", methods=["GET", "HEAD"], include_in_schema=False)
async def serve_index():
    """Trả về trang chủ (index.html)."""
    return FileResponse(str(FRONTEND_DIR / "index.html"))


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return Response(status_code=204)


@app.get("/health")
async def health_check():
    """Kiểm tra trạng thái hệ thống."""
    db_ok = check_connection()
    return {
        "status": "ok" if db_ok else "degraded",
        "database": "connected" if db_ok else "disconnected",
    }


def _ensure_standard_schema_fast() -> bool:
    """Đảm bảo schema chuẩn (14 bảng + cột mới) tồn tại trên CSDL cloud trước khi phục vụ request."""
    try:
        with engine.connect() as conn:
            has_col = conn.execute(text("""
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'tvdi'
                  AND table_name = 'tvdi_forecast'
                  AND column_name = 'horizon_type'
            """)).fetchone() is not None
            has_bul = conn.execute(text("""
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'tvdi' AND table_name = 'bulletins'
            """)).fetchone() is not None
            has_wf = conn.execute(text("""
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'tvdi' AND table_name = 'ward_forecasts'
            """)).fetchone() is not None
            has_idx = conn.execute(text("""
                SELECT 1 FROM pg_indexes
                WHERE schemaname = 'tvdi' AND indexname = 'uq_tvdi_forecast_target'
            """)).fetchone() is not None
            if has_col and has_bul and has_wf and has_idx:
                return False

        from ..scripts import migrate_schema_standard as mig
        if not (has_col and has_bul and has_wf):
            mig.step_create_new_tables()
            mig.step_alter_existing_tables()
        if not has_idx:
            mig.step_constraints_and_indexes()
        print("[STARTUP] Đã tự động nâng cấp cấu trúc bảng/cột chuẩn trong schema tvdi.")
        return True
    except Exception as e:
        print(f"[STARTUP] Lỗi kiểm tra nâng cấp schema tự động: {e}")
        return False


def _ensure_cloud_data_background():
    """Đồng bộ dữ liệu nền còn thiếu (dự báo 7 ngày, 12 tháng, ranh giới phường) ở luồng nền."""
    try:
        from ..scripts import migrate_schema_standard as mig
        from ..scripts.monthly_model import VERSION
        from ..scripts.train_monthly_forecast import (
            generate_daily_7d_simulated,
            train_and_populate_monthly_12m,
        )

        with engine.connect() as conn:
            dclass_cnt = conn.execute(text("SELECT COUNT(*) FROM tvdi.drought_classes")).scalar() or 0
            poly_cnt = conn.execute(text("SELECT COUNT(*) FROM tvdi.wards WHERE geom_boundary IS NOT NULL")).scalar() or 0
            obs_cnt = conn.execute(text("SELECT COUNT(*) FROM tvdi.ward_observations")).scalar() or 0

        if dclass_cnt < 8 or poly_cnt < 167:
            mig.step_seed_reference_and_spatial()
            mig.step_backfill_series_stats()

        if obs_cnt == 0:
            mig.step_backfill_ward_observations()

        today_dt = date.today()
        m0 = date(today_dt.year, today_dt.month, 1)
        with engine.connect() as conn:
            d7_cnt = conn.execute(
                text("SELECT COUNT(DISTINCT date) FROM tvdi.tvdi_forecast WHERE horizon_type = 'daily_7d' AND date >= :d0"),
                {"d0": today_dt},
            ).scalar() or 0
            m12_cnt = conn.execute(
                text("""SELECT COUNT(DISTINCT f.date) FROM tvdi.tvdi_forecast f
                        JOIN tvdi.model_runs r ON r.id = f.model_run_id
                        WHERE f.horizon_type = 'monthly_12m' AND f.satellite_source = 'LANDSAT'
                          AND r.model_version = :version AND r.is_active AND f.cell_id IS NOT NULL
                          AND f.date >= :m0"""),
                {"m0": m0, "version": VERSION},
            ).scalar() or 0

        daily_seeded = []
        if m12_cnt == 0:
            res = train_and_populate_monthly_12m(m0, force_retrain=False, seed_only=True)
            daily_seeded = res.get("daily_dates") or []
            if res.get("monthly_dates"):
                print("[STARTUP-BG] Đã nạp xong dữ liệu dự báo 12 tháng từ seed (monthly_12m).")
        if d7_cnt < 7 and not daily_seeded:
            generate_daily_7d_simulated(today_dt)
            print("[STARTUP-BG] Đã sinh xong dữ liệu dự báo 7 ngày (daily_7d).")

        try:
            from .routers.bulletins import _ensure_default_bulletins
            db_b = SessionLocal()
            try:
                _ensure_default_bulletins(db_b)
            finally:
                db_b.close()
        except Exception as be:
            print(f"[STARTUP-BG] Lưu ý bản tin mặc định: {be}")
    except Exception as e:
        print(f"[STARTUP-BG] Bỏ qua đồng bộ dữ liệu nền: {e}")


@app.on_event("startup")
def startup_event():
    """Khởi tạo cấu trúc DB chuẩn, GEE và đồng bộ danh mục 167 phường/xã khi khởi động server."""
    from .services import gee_service, tvdi_service

    _ensure_standard_schema_fast()
    gee_service.init_earth_engine()

    try:
        db = SessionLocal()
        try:
            result = tvdi_service.sync_wards_table(db)
            print(f"[STARTUP] Danh mục 167 phường/xã (tvdi.wards): {result}")
        finally:
            db.close()
    except Exception as e:
        print(f"[STARTUP] Bỏ qua đồng bộ danh mục phường/xã: {e}")

    threading.Thread(target=_ensure_cloud_data_background, daemon=True).start()
