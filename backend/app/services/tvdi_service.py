"""
Dịch vụ xử lý dữ liệu TVDI, phân loại mức khô hạn và tạo GeoJSON.
"""
import json
import logging
from typing import Dict, Any, List, Optional
from datetime import date
from sqlalchemy import text
from sqlalchemy.orm import Session
import numpy as np
from scipy.spatial import cKDTree

from ..config import settings

logger = logging.getLogger("tvdi_service")


def get_drought_class(tvdi: Optional[float]) -> Dict[str, Any]:
    """Phân loại mức độ khô hạn theo chỉ số TVDI (8 cấp, bước 0.125)."""
    if tvdi is None:
        return {
            "level": -1,
            "label": "Không có dữ liệu",
            "description": "Khu vực bị mây che phủ hoặc thiếu ảnh vệ tinh",
            "color": "#9e9e9e",
        }

    # Giới hạn trong khoảng [0, 1]
    val = max(0.0, min(1.0, float(tvdi)))

    if val <= 0.125:
        return {
            "level": 1,
            "label": "Rất ẩm / Ngập nước",
            "description": "Đất bão hòa nước hoặc ngập úng, thực vật phát triển mạnh",
            "color": "#066b00",
        }
    elif val <= 0.250:
        return {
            "level": 2,
            "label": "Ẩm ướt",
            "description": "Đất có độ ẩm cao, điều kiện sinh trưởng rất thuận lợi",
            "color": "#0bc400",
        }
    elif val <= 0.375:
        return {
            "level": 3,
            "label": "Đủ ẩm, phát triển tốt",
            "description": "Độ ẩm đất đầy đủ, thực vật phát triển tốt",
            "color": "#0ce100",
        }
    elif val <= 0.500:
        return {
            "level": 4,
            "label": "Bình thường",
            "description": "Độ ẩm đất ở mức bình thường, thực vật ổn định",
            "color": "#00ff00",
        }
    elif val <= 0.625:
        return {
            "level": 5,
            "label": "Bắt đầu khô hạn nhẹ",
            "description": "Đất bắt đầu thiếu nước nhẹ, thực vật chịu áp lực",
            "color": "#ffff00",
        }
    elif val <= 0.750:
        return {
            "level": 6,
            "label": "Hạn vừa",
            "description": "Đất thiếu nước rõ rệt, thực vật bắt đầu héo",
            "color": "#ffcc00",
        }
    elif val <= 0.875:
        return {
            "level": 7,
            "label": "Hạn nặng",
            "description": "Đất thiếu hụt độ ẩm nghiêm trọng, thực vật héo rũ",
            "color": "#ff6600",
        }
    else:
        return {
            "level": 8,
            "label": "Hạn gay gắt / Khô khốc",
            "description": "Đất kiệt nước nghiêm trọng, cây trồng suy thoái hoặc chết",
            "color": "#ff0000",
        }


def get_available_dates(db: Session) -> List[str]:
    """Lấy danh sách tất cả các mốc thời gian có dữ liệu (YYYY-MM-DD)."""
    sql = text("SELECT DISTINCT date FROM tvdi.tvdi_series ORDER BY date ASC")
    rows = db.execute(sql).fetchall()
    return [r[0].strftime("%Y-%m-%d") if isinstance(r[0], (date,)) else str(r[0]) for r in rows]


def get_grid_by_date(db: Session, date_str: str) -> Dict[str, Any]:
    """
    Lấy dữ liệu ô lưới cho một mốc thời gian dưới dạng GeoJSON FeatureCollection.
    Bao gồm hình học đa giác (Polygon) và các chỉ số LST, NDVI, TVDI, nhãn hạn hán và màu.
    """
    sql = text("""
        SELECT 
            c.cell_id,
            c.lon,
            c.lat,
            g.lst_c,
            g.ndvi,
            g.tvdi,
            g.n_img,
            ST_AsGeoJSON(c.geom_polygon)::json AS geom_polygon
        FROM tvdi.grid_cells c
        LEFT JOIN tvdi.tvdi_grid g ON c.cell_id = g.cell_id AND g.date = :date
        WHERE c.geom_polygon IS NOT NULL AND NOT ST_IsEmpty(c.geom_polygon)
        ORDER BY c.cell_id ASC;
    """)

    rows = db.execute(sql, {"date": date_str}).fetchall()
    features = _grid_rows_to_features(rows)

    return {
        "type": "FeatureCollection",
        "date": date_str,
        "total_cells": len(features),
        "features": features,
    }


def _grid_rows_to_features(rows) -> List[Dict[str, Any]]:
    """Chuyển các dòng (cell_id, lon, lat, lst_c, ndvi, tvdi, n_img, geom[, n_obs]) thành GeoJSON Feature."""
    features = []
    for r in rows:
        cell_id = r[0]
        lst_c = round(float(r[3]), 2) if r[3] is not None else None
        ndvi = round(float(r[4]), 3) if r[4] is not None else None
        tvdi = round(float(r[5]), 3) if r[5] is not None else None
        drought_info = get_drought_class(tvdi)

        props = {
            "cell_id": cell_id,
            "lon": float(r[1]),
            "lat": float(r[2]),
            "lst_c": lst_c,
            "ndvi": ndvi,
            "tvdi": tvdi,
            "n_img": int(r[6]) if r[6] is not None else 0,
            "has_data": tvdi is not None,
            "drought_level": drought_info["level"],
            "drought_label": drought_info["label"],
            "drought_desc": drought_info["description"],
            "color": drought_info["color"],
        }
        if len(r) > 8:
            props["n_obs"] = int(r[8]) if r[8] is not None else 0

        features.append({
            "type": "Feature",
            "id": cell_id,
            "geometry": r[7],
            "properties": props,
        })
    return features


def get_grid_aggregate(db: Session, start_str: str, end_str: str) -> Dict[str, Any]:
    """
    Trung bình LST, NDVI, TVDI của từng ô lưới trong khoảng thời gian [start, end]
    (tổng hợp theo tháng, theo năm hoặc toàn giai đoạn). Trả về GeoJSON cùng cấu trúc với get_grid_by_date.
    """
    sql = text("""
        WITH agg AS (
            SELECT cell_id,
                   AVG(lst_c) AS lst_c,
                   AVG(ndvi) AS ndvi,
                   AVG(tvdi) AS tvdi,
                   SUM(n_img) AS n_img,
                   COUNT(tvdi) AS n_obs
            FROM tvdi.tvdi_grid
            WHERE date BETWEEN :s AND :e
            GROUP BY cell_id
        )
        SELECT
            c.cell_id,
            c.lon,
            c.lat,
            a.lst_c,
            a.ndvi,
            a.tvdi,
            a.n_img,
            ST_AsGeoJSON(c.geom_polygon)::json AS geom_polygon,
            a.n_obs
        FROM tvdi.grid_cells c
        LEFT JOIN agg a ON a.cell_id = c.cell_id
        WHERE c.geom_polygon IS NOT NULL AND NOT ST_IsEmpty(c.geom_polygon)
        ORDER BY c.cell_id ASC;
    """)
    rows = db.execute(sql, {"s": start_str, "e": end_str}).fetchall()
    features = _grid_rows_to_features(rows)

    n_dates = db.execute(
        text("SELECT COUNT(*) FROM tvdi.tvdi_series WHERE date BETWEEN :s AND :e"),
        {"s": start_str, "e": end_str},
    ).scalar() or 0

    return {
        "type": "FeatureCollection",
        "date": start_str,
        "start": start_str,
        "end": end_str,
        "aggregate": True,
        "n_dates": int(n_dates),
        "total_cells": len(features),
        "features": features,
    }


def get_cell_time_series(db: Session, cell_id: int) -> Dict[str, Any]:
    """Lấy toàn bộ chuỗi thời gian 2017-2025 cho một ô lưới cụ thể."""
    sql = text("""
        SELECT 
            date,
            ROUND(lst_c::numeric, 2) AS lst_c,
            ROUND(ndvi::numeric, 3) AS ndvi,
            ROUND(tvdi::numeric, 3) AS tvdi,
            n_img
        FROM tvdi.tvdi_grid
        WHERE cell_id = :cell_id
        ORDER BY date ASC;
    """)
    rows = db.execute(sql, {"cell_id": cell_id}).fetchall()

    items = []
    for r in rows:
        d_str = r[0].strftime("%Y-%m-%d") if isinstance(r[0], (date,)) else str(r[0])
        tvdi_val = float(r[3]) if r[3] is not None else None
        dclass = get_drought_class(tvdi_val)
        items.append({
            "date": d_str,
            "lst_c": float(r[1]) if r[1] is not None else None,
            "ndvi": float(r[2]) if r[2] is not None else None,
            "tvdi": tvdi_val,
            "n_img": int(r[4]) if r[4] is not None else 0,
            "drought_label": dclass["label"],
            "color": dclass["color"],
        })

    # Lấy thông tin tọa độ ô lưới
    coord_sql = text("SELECT lon, lat FROM tvdi.grid_cells WHERE cell_id = :cell_id")
    coord_row = db.execute(coord_sql, {"cell_id": cell_id}).fetchone()

    return {
        "cell_id": cell_id,
        "lon": float(coord_row[0]) if coord_row else None,
        "lat": float(coord_row[1]) if coord_row else None,
        "total_records": len(items),
        "series": items,
    }


def get_overall_time_series(db: Session) -> Dict[str, Any]:
    """Lấy chuỗi thời gian trung bình toàn khu vực TP.HCM."""
    sql = text("""
        SELECT 
            date,
            ROUND(lst_c::numeric, 2) AS lst_c,
            ROUND(ndvi::numeric, 3) AS ndvi,
            ROUND(tvdi::numeric, 3) AS tvdi,
            n_img,
            ROUND(dry_a::numeric, 2) AS dry_a,
            ROUND(dry_b::numeric, 2) AS dry_b,
            ROUND(ts_min::numeric, 2) AS ts_min,
            fit_ok
        FROM tvdi.tvdi_series
        ORDER BY date ASC;
    """)
    rows = db.execute(sql).fetchall()

    # Dải phân vị P5 – P95 của các ô lưới tại từng mốc (độ phân tán không gian)
    pct_sql = text("""
        SELECT
            date,
            percentile_cont(0.05) WITHIN GROUP (ORDER BY lst_c) AS lst_p5,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY lst_c) AS lst_p95,
            percentile_cont(0.05) WITHIN GROUP (ORDER BY ndvi) AS ndvi_p5,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY ndvi) AS ndvi_p95,
            percentile_cont(0.05) WITHIN GROUP (ORDER BY tvdi) AS tvdi_p5,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY tvdi) AS tvdi_p95
        FROM tvdi.tvdi_grid
        GROUP BY date;
    """)
    pct_map = {}
    for p in db.execute(pct_sql).fetchall():
        key = p[0].strftime("%Y-%m-%d") if isinstance(p[0], (date,)) else str(p[0])
        pct_map[key] = [round(float(v), 3) if v is not None else None for v in p[1:]]

    items = []
    for r in rows:
        d_str = r[0].strftime("%Y-%m-%d") if isinstance(r[0], (date,)) else str(r[0])
        tvdi_val = float(r[3]) if r[3] is not None else None
        dclass = get_drought_class(tvdi_val)
        pct = pct_map.get(d_str, [None] * 6)
        items.append({
            "date": d_str,
            "lst_c": float(r[1]) if r[1] is not None else None,
            "ndvi": float(r[2]) if r[2] is not None else None,
            "tvdi": tvdi_val,
            "n_img": int(r[4]) if r[4] is not None else 0,
            "dry_a": float(r[5]) if r[5] is not None else None,
            "dry_b": float(r[6]) if r[6] is not None else None,
            "ts_min": float(r[7]) if r[7] is not None else None,
            "fit_ok": int(r[8]) if r[8] is not None else 0,
            "lst_p5": pct[0],
            "lst_p95": pct[1],
            "ndvi_p5": pct[2],
            "ndvi_p95": pct[3],
            "tvdi_p5": pct[4],
            "tvdi_p95": pct[5],
            "drought_label": dclass["label"],
            "color": dclass["color"],
        })

    return {
        "total_records": len(items),
        "series": items,
    }


def get_region_boundary(db: Session) -> Dict[str, Any]:
    """Lấy ranh giới TP.HCM mở rộng dưới dạng GeoJSON FeatureCollection."""
    sql = text("""
        SELECT 
            id, ten, sap_nhap, quy_mo, dt_km2,
            ST_AsGeoJSON(geom)::json AS geometry
        FROM tvdi.regions
        LIMIT 1;
    """)
    row = db.execute(sql).fetchone()

    if not row:
        return {"type": "FeatureCollection", "features": []}

    feature = {
        "type": "Feature",
        "id": row[0],
        "geometry": row[5],
        "properties": {
            "ten": row[1],
            "sap_nhap": row[2],
            "quy_mo": row[3],
            "dt_km2": float(row[4]) if row[4] else None,
        },
    }

    return {
        "type": "FeatureCollection",
        "features": [feature],
    }


_wards_boundary_cache: Optional[Dict[str, Any]] = None
_wards_catalog_cache: Optional[List[Dict[str, Any]]] = None


def get_wards_boundary() -> Dict[str, Any]:
    """Lấy ranh giới 168 phường/xã của TP.HCM mở rộng dưới dạng GeoJSON (đọc 1 lần rồi lưu đệm)."""
    global _wards_boundary_cache
    if _wards_boundary_cache is None:
        path = settings.DATA_DIR / "tphcm_wards_boundaries_simplified.geojson"
        if not path.exists():
            path = settings.DATA_DIR / "tphcm_wards_boundaries.geojson"
        with open(path, "r", encoding="utf-8") as f:
            _wards_boundary_cache = json.load(f)
    return _wards_boundary_cache


def load_wards_catalog() -> List[Dict[str, Any]]:
    """Danh mục chuẩn 167 phường/xã (data/tphcm_167_wards.json, sinh bởi scripts/init_wards.py)."""
    global _wards_catalog_cache
    if _wards_catalog_cache is None:
        json_file = settings.DATA_DIR / "tphcm_167_wards.json"
        try:
            with open(json_file, "r", encoding="utf-8") as f:
                _wards_catalog_cache = json.load(f)
        except (OSError, ValueError) as e:
            logger.warning(f"Không đọc được danh mục phường/xã {json_file}: {e}")
            _wards_catalog_cache = []
    return _wards_catalog_cache


def _catalog_rows(catalog: List[Dict[str, Any]]) -> List[tuple]:
    return [(w["ward_id"], w["name"], w["district"], w["province"], w["type"], w["lat"], w["lon"]) for w in catalog]


def get_wards_rows(db: Session) -> List[tuple]:
    """
    Lấy danh mục phường/xã từ bảng PostGIS tvdi.wards.
    Nếu bảng chưa có hoặc còn danh sách cũ (khác danh mục chuẩn) thì dùng danh mục chuẩn từ file JSON.
    """
    catalog = load_wards_catalog()
    try:
        rows = db.execute(text("""
            SELECT ward_id, name, district, province, type, lat, lon
            FROM tvdi.wards
            ORDER BY ward_id ASC;
        """)).fetchall()
    except Exception:
        db.rollback()
        rows = []

    if rows and (not catalog or {r[1] for r in rows} == {w["name"] for w in catalog}):
        return rows
    return _catalog_rows(catalog)


def sync_wards_table(db: Session) -> str:
    """
    Đồng bộ bảng tvdi.wards với danh mục chuẩn 167 phường/xã (gọi khi khởi động máy chủ).
    Chỉ ghi lại khi nội dung bảng khác danh mục chuẩn.
    """
    catalog = load_wards_catalog()
    if not catalog:
        return "skipped"

    expected = {(w["ward_id"], w["name"], w["district"], w["type"], round(w["lat"], 5), round(w["lon"], 5)) for w in catalog}
    try:
        current = {
            (r[0], r[1], r[2], r[3], round(float(r[4]), 5), round(float(r[5]), 5))
            for r in db.execute(text("SELECT ward_id, name, district, type, lat, lon FROM tvdi.wards")).fetchall()
        }
    except Exception:
        db.rollback()
        current = None

    if current == expected:
        return "unchanged"

    try:
        if current is None:
            db.execute(text("""
                CREATE TABLE IF NOT EXISTS tvdi.wards (
                    ward_id INT PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    district VARCHAR(255) NOT NULL,
                    province VARCHAR(255) NOT NULL,
                    type VARCHAR(50) NOT NULL,
                    lat DOUBLE PRECISION NOT NULL,
                    lon DOUBLE PRECISION NOT NULL,
                    geom geometry(Point, 4326)
                );
            """))
        has_geom = db.execute(text("""
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'tvdi' AND table_name = 'wards' AND column_name = 'geom'
        """)).fetchone() is not None

        db.execute(text("TRUNCATE TABLE tvdi.wards;"))
        if has_geom:
            insert_sql = """
                INSERT INTO tvdi.wards (ward_id, name, district, province, type, lat, lon, geom)
                VALUES (:ward_id, :name, :district, :province, :type, :lat, :lon,
                        ST_SetSRID(ST_MakePoint(:lon, :lat), 4326))
            """
        else:
            insert_sql = """
                INSERT INTO tvdi.wards (ward_id, name, district, province, type, lat, lon)
                VALUES (:ward_id, :name, :district, :province, :type, :lat, :lon)
            """
        db.execute(text(insert_sql), [
            {k: w[k] for k in ("ward_id", "name", "district", "province", "type", "lat", "lon")}
            for w in catalog
        ])
        db.commit()
        logger.info(f"Đã đồng bộ bảng tvdi.wards với danh mục chuẩn {len(catalog)} phường/xã.")
        return "updated"
    except Exception as e:
        db.rollback()
        logger.warning(f"Không thể đồng bộ bảng tvdi.wards (sẽ dùng danh mục JSON): {e}")
        return "failed"


def get_drought_statistics(db: Session, date_str: str) -> Dict[str, Any]:
    """
    Thống kê phân loại mức khô hạn theo 5 cấp độ cho một mốc ngày.
    Tính toán số ô, tỷ lệ phần trăm và các chỉ số LST, NDVI, TVDI trung bình.
    """
    sql = text("""
        SELECT 
            g.cell_id,
            g.lst_c,
            g.ndvi,
            g.tvdi
        FROM tvdi.tvdi_grid g
        JOIN tvdi.grid_cells c ON g.cell_id = c.cell_id
        WHERE g.date = :date AND c.geom_polygon IS NOT NULL;
    """)
    rows = db.execute(sql, {"date": date_str}).fetchall()

    class_counts = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0}
    lst_values = []
    ndvi_values = []
    tvdi_values = []

    for r in rows:
        lst = float(r[1]) if r[1] is not None else None
        ndvi = float(r[2]) if r[2] is not None else None
        tvdi = float(r[3]) if r[3] is not None else None

        if lst is not None:
            lst_values.append(lst)
        if ndvi is not None:
            ndvi_values.append(ndvi)
        if tvdi is not None:
            tvdi_values.append(tvdi)
            info = get_drought_class(tvdi)
            if info["level"] in class_counts:
                class_counts[info["level"]] += 1

    total_valid = len(tvdi_values)

    classes_summary = []
    for cls in settings.TVDI_CLASSES:
        # Xác định level tương ứng (8 cấp, bước 0.125)
        if cls["max"] <= 0.125:
            lvl = 1
        elif cls["max"] <= 0.250:
            lvl = 2
        elif cls["max"] <= 0.375:
            lvl = 3
        elif cls["max"] <= 0.500:
            lvl = 4
        elif cls["max"] <= 0.625:
            lvl = 5
        elif cls["max"] <= 0.750:
            lvl = 6
        elif cls["max"] <= 0.875:
            lvl = 7
        else:
            lvl = 8

        cnt = class_counts.get(lvl, 0)
        pct = round(cnt / total_valid * 100, 1) if total_valid > 0 else 0.0

        classes_summary.append({
            "level": lvl,
            "label": cls["label"],
            "description": cls["description"],
            "color": cls["color"],
            "min_tvdi": cls["min"],
            "max_tvdi": cls["max"],
            "cell_count": cnt,
            "percentage": pct,
        })

    return {
        "date": date_str,
        "total_active_cells": total_valid,
        "avg_lst": round(sum(lst_values) / len(lst_values), 2) if lst_values else None,
        "avg_ndvi": round(sum(ndvi_values) / len(ndvi_values), 3) if ndvi_values else None,
        "avg_tvdi": round(sum(tvdi_values) / len(tvdi_values), 3) if tvdi_values else None,
        "min_tvdi": round(min(tvdi_values), 3) if tvdi_values else None,
        "max_tvdi": round(max(tvdi_values), 3) if tvdi_values else None,
        "classes": classes_summary,
    }


def get_wards_ranking(
    db: Session,
    date_str: str,
    sort_by: str = "lst_desc",
    min_lst: Optional[float] = None,
    max_lst: Optional[float] = None,
    min_ndvi: Optional[float] = None,
    max_ndvi: Optional[float] = None,
    min_tvdi: Optional[float] = None,
    max_tvdi: Optional[float] = None,
    start_str: Optional[str] = None,
    end_str: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Lập danh sách xếp hạng 167 phường/xã TP.HCM theo chỉ số LST, NDVI, TVDI cho một mốc ngày
    (hoặc giá trị trung bình trong khoảng [start, end] khi tổng hợp theo tháng/năm/giai đoạn).
    Hỗ trợ sắp xếp theo thứ tự:
    - LST (cao -> thấp): 'lst_desc'
    - NDVI (thấp -> cao): 'ndvi_asc'
    - TVDI (cao -> thấp): 'tvdi_desc'
    - Tên phường: 'name_asc'
    Và lọc theo các ngưỡng chỉ số người dùng chọn (ví dụ: LST > 40, TVDI >= 0.6).
    """
    # 1. Danh mục chuẩn 167 phường/xã (bảng PostGIS tvdi.wards hoặc file JSON)
    wards_rows = get_wards_rows(db)

    empty_result = {"date": date_str, "is_forecast": False, "total_wards": len(wards_rows),
                    "matching_wards": 0, "sort_by": sort_by, "stats": {}, "wards": []}
    if not wards_rows:
        return empty_result

    is_forecast = False
    if start_str and end_str:
        # 2a. Giá trị trung bình của từng ô lưới trong khoảng thời gian
        grid_rows = db.execute(text("""
            SELECT lon, lat, lst_c, ndvi, tvdi FROM (
                SELECT cell_id, AVG(lon) AS lon, AVG(lat) AS lat,
                       AVG(lst_c) AS lst_c, AVG(ndvi) AS ndvi, AVG(tvdi) AS tvdi
                FROM tvdi.tvdi_grid
                WHERE date BETWEEN :s AND :e
                GROUP BY cell_id
            ) agg
            WHERE lst_c IS NOT NULL AND tvdi IS NOT NULL
        """), {"s": start_str, "e": end_str}).fetchall()
    else:
        # 2b. Lấy dữ liệu điểm lưới viễn thám thực tế hoặc AI dự báo
        grid_rows = db.execute(text("""
            SELECT lon, lat, lst_c, ndvi, tvdi
            FROM tvdi.tvdi_grid
            WHERE date = :d AND lst_c IS NOT NULL AND tvdi IS NOT NULL
        """), {"d": date_str}).fetchall()

    if not grid_rows and not (start_str and end_str):
        # Thử lấy từ tvdi_forecast (dự báo tương lai hoặc ngày hiện tại)
        grid_rows = db.execute(text("""
            SELECT c.lon, c.lat,
                   COALESCE(28.0 + f.tvdi_pred * 14.0, 32.0) as lst_c,
                   COALESCE(0.55 - f.tvdi_pred * 0.3, 0.40) as ndvi,
                   f.tvdi_pred as tvdi
            FROM tvdi.tvdi_forecast f
            JOIN tvdi.grid_cells c ON f.cell_id = c.cell_id
            WHERE f.date = :d AND f.tvdi_pred IS NOT NULL
        """), {"d": date_str}).fetchall()
        is_forecast = True

    if not grid_rows:
        # Nếu vẫn không có, lấy ngày gần nhất trong tvdi_grid
        closest = db.execute(text("""
            SELECT date FROM tvdi.tvdi_series
            ORDER BY ABS(date - CAST(:d AS date)) ASC
            LIMIT 1
        """), {"d": start_str or date_str}).fetchone()
        if closest:
            c_date = closest[0].strftime("%Y-%m-%d")
            grid_rows = db.execute(text("""
                SELECT lon, lat, lst_c, ndvi, tvdi
                FROM tvdi.tvdi_grid
                WHERE date = :d AND lst_c IS NOT NULL AND tvdi IS NOT NULL
            """), {"d": c_date}).fetchall()
            is_forecast = False

    # Loại các giá trị NaN (không hợp lệ cho nội suy và chuẩn JSON)
    grid_rows = [g for g in grid_rows if g[4] is not None and np.isfinite(float(g[4]))]
    if not grid_rows:
        return empty_result

    # 3. Nội suy không gian IDW cho từng phường
    ward_coords = np.array([[float(r[6]), float(r[5])] for r in wards_rows])  # lon, lat
    grid_coords = np.array([[float(g[0]), float(g[1])] for g in grid_rows])
    grid_vals = np.array([
        [
            float(g[2]) if g[2] is not None else 32.0,
            float(g[3]) if g[3] is not None else 0.45,
            float(g[4]) if g[4] is not None else 0.50,
        ]
        for g in grid_rows
    ])

    tree = cKDTree(grid_coords)
    dists, idxs = tree.query(ward_coords, k=min(4, len(grid_coords)))
    weights = 1.0 / np.maximum(dists, 1e-5) ** 2
    weights /= weights.sum(axis=1, keepdims=True)
    interp_vals = np.sum(grid_vals[idxs] * weights[:, :, None], axis=1)

    all_wards = []
    for i, w in enumerate(wards_rows):
        w_id = w[0]
        name = w[1]
        dist = w[2]
        prov = w[3]
        w_type = w[4]
        lat = float(w[5])
        lon = float(w[6])
        lst_val = round(float(interp_vals[i, 0]), 2)
        ndvi_val = round(float(interp_vals[i, 1]), 3)
        tvdi_val = round(float(interp_vals[i, 2]), 3)

        dclass = get_drought_class(tvdi_val)

        all_wards.append({
            "ward_id": w_id,
            "name": name,
            "district": dist,
            "province": prov,
            "type": w_type,
            "lat": lat,
            "lon": lon,
            "lst_c": lst_val,
            "ndvi": ndvi_val,
            "tvdi": tvdi_val,
            "drought_level": dclass["level"],
            "drought_label": dclass["label"],
            "drought_desc": dclass["description"],
            "color": dclass["color"],
        })

    # 4. Áp dụng bộ lọc ngưỡng (Threshold filtering)
    filtered = []
    for w in all_wards:
        if min_lst is not None and w["lst_c"] < min_lst:
            continue
        if max_lst is not None and w["lst_c"] > max_lst:
            continue
        if min_ndvi is not None and w["ndvi"] < min_ndvi:
            continue
        if max_ndvi is not None and w["ndvi"] > max_ndvi:
            continue
        if min_tvdi is not None and w["tvdi"] < min_tvdi:
            continue
        if max_tvdi is not None and w["tvdi"] > max_tvdi:
            continue
        filtered.append(w)

    # 5. Sắp xếp danh sách theo tiêu chí
    # Yêu cầu 1: LST (cao -> thấp), NDVI (thấp -> cao), TVDI (cao -> thấp)
    if sort_by == "lst_desc":
        filtered.sort(key=lambda x: (x["lst_c"] if x["lst_c"] is not None else -999), reverse=True)
    elif sort_by == "ndvi_asc":
        filtered.sort(key=lambda x: (x["ndvi"] if x["ndvi"] is not None else 999), reverse=False)
    elif sort_by == "tvdi_desc":
        filtered.sort(key=lambda x: (x["tvdi"] if x["tvdi"] is not None else -999), reverse=True)
    elif sort_by == "lst_asc":
        filtered.sort(key=lambda x: (x["lst_c"] if x["lst_c"] is not None else 999), reverse=False)
    elif sort_by == "ndvi_desc":
        filtered.sort(key=lambda x: (x["ndvi"] if x["ndvi"] is not None else -999), reverse=True)
    elif sort_by == "tvdi_asc":
        filtered.sort(key=lambda x: (x["tvdi"] if x["tvdi"] is not None else 999), reverse=False)
    elif sort_by == "name_asc":
        filtered.sort(key=lambda x: x["name"])
    else:
        filtered.sort(key=lambda x: x["tvdi"], reverse=True)

    # Gán số thứ tự xếp hạng (#Rank)
    for rank, w in enumerate(filtered, start=1):
        w["rank"] = rank

    # Thống kê tổng hợp cho danh sách
    lst_arr = [w["lst_c"] for w in filtered if w["lst_c"] is not None]
    ndvi_arr = [w["ndvi"] for w in filtered if w["ndvi"] is not None]
    tvdi_arr = [w["tvdi"] for w in filtered if w["tvdi"] is not None]

    stats = {
        "avg_lst": round(float(np.mean(lst_arr)), 2) if lst_arr else None,
        "max_lst": round(float(np.max(lst_arr)), 2) if lst_arr else None,
        "min_lst": round(float(np.min(lst_arr)), 2) if lst_arr else None,
        "avg_ndvi": round(float(np.mean(ndvi_arr)), 3) if ndvi_arr else None,
        "avg_tvdi": round(float(np.mean(tvdi_arr)), 3) if tvdi_arr else None,
        "max_tvdi": round(float(np.max(tvdi_arr)), 3) if tvdi_arr else None,
        "min_tvdi": round(float(np.min(tvdi_arr)), 3) if tvdi_arr else None,
        "severe_drought_count": sum(1 for w in filtered if w["tvdi"] >= 0.625),
    }

    return {
        "date": date_str,
        "start": start_str,
        "end": end_str,
        "is_forecast": is_forecast,
        "total_wards": len(all_wards),
        "matching_wards": len(filtered),
        "sort_by": sort_by,
        "filters": {
            "min_lst": min_lst,
            "max_lst": max_lst,
            "min_ndvi": min_ndvi,
            "max_ndvi": max_ndvi,
            "min_tvdi": min_tvdi,
            "max_tvdi": max_tvdi,
        },
        "stats": stats,
        "wards": filtered,
    }

