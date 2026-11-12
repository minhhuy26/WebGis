"""
sync_gee_observations.py – Đồng bộ hiện trạng 3 chỉ số (LST, NDVI, TVDI) từ Google Earth Engine
vào CSDL PostGIS (tvdi_grid, tvdi_series, ward_observations, gee_sync_logs).

Ví dụ sử dụng:
    python -m backend.scripts.sync_gee_observations --date 2025-12-27 --source LANDSAT
    python -m backend.scripts.sync_gee_observations --date 2026-10-15 --end 2026-10-30 --source MODIS --granularity 15day
"""
import argparse
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(BASE_DIR))

from backend.app.database import SessionLocal
from backend.app.services import gee_service


def main():
    parser = argparse.ArgumentParser(description="Đồng bộ dữ liệu hiện trạng LST/NDVI/TVDI từ GEE vào PostGIS.")
    parser.add_argument("--date", required=True, help="Ngày bắt đầu cửa sổ quan trắc (YYYY-MM-DD)")
    parser.add_argument("--end", default=None, help="Ngày kết thúc (tùy chọn, YYYY-MM-DD)")
    parser.add_argument("--source", default="LANDSAT", choices=["LANDSAT", "MODIS"], help="Nguồn ảnh vệ tinh")
    parser.add_argument("--granularity", default="15day", choices=["daily", "15day", "monthly"], help="Tần suất")
    parser.add_argument("--window", type=int, default=32, help="Độ rộng cửa sổ ghép ảnh Landsat (ngày)")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        result = gee_service.sync_gee_observation_to_db(
            db=db,
            date_str=args.date,
            end_date_str=args.end,
            satellite_source=args.source,
            granularity=args.granularity,
            window_days=args.window,
        )
        print("[OK] Đồng bộ thành công:")
        print(result)
    finally:
        db.close()


if __name__ == "__main__":
    main()
