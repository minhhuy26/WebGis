"""
FastAPI application – entry point.
"""
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response

from .config import settings
from .database import check_connection
from .routers import tvdi, stats, gee, prediction, auth

# ---- Tạo ứng dụng FastAPI -------------------------------------------------
app = FastAPI(
    title="WebGIS TVDI – TP. Hồ Chí Minh",
    description="Hệ thống WebGIS hiển thị và phân tích chỉ số khô hạn TVDI",
    version="2.0.0",
)

@app.middleware("http")
async def add_no_cache_headers(request, call_next):
    response = await call_next(request)
    # Vô hiệu hóa cache cho HTML và static files để frontend luôn cập nhật bản mới nhất
    if request.url.path.startswith("/static/") or request.url.path == "/":
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

# ---- Đăng ký routers -------------------------------------------------------
app.include_router(tvdi.router, prefix="/api", tags=["TVDI"])
app.include_router(stats.router, prefix="/api", tags=["Thống kê"])
app.include_router(prediction.router)
app.include_router(gee.router)
app.include_router(auth.router)

# ---- Phục vụ frontend (static files) ---------------------------------------
FRONTEND_DIR = Path(__file__).resolve().parent.parent.parent / "frontend"
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


@app.get("/", include_in_schema=False)
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


@app.on_event("startup")
def startup_event():
    """Khởi tạo trước kết nối Google Earth Engine và đồng bộ danh mục 167 phường/xã khi khởi động server."""
    from .services import gee_service, tvdi_service
    from .database import SessionLocal

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
