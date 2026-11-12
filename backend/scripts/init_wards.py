"""
Khởi tạo và đồng bộ danh mục 167 phường, xã (phần đất liền) của TP. Hồ Chí Minh sau sắp xếp
đơn vị hành chính năm 2025 (Nghị quyết 1685/NQ-UBTVQH15: 113 phường, 54 xã và đặc khu Côn Đảo).

Nguồn dữ liệu: ranh giới chính thức data/tphcm_wards_boundaries.geojson
(gisServerId = diaphanhanhchinhcapxa_2025.2, 168 đơn vị).
Đặc khu Côn Đảo nằm ngoài lưới ô viễn thám ~5,5 km (không có dữ liệu LST/NDVI/TVDI)
nên không đưa vào danh mục xếp hạng -> còn đúng 167 phường/xã.

Mỗi phường/xã được gán:
- code          : mã ĐVHC cấp xã
- name          : tên đầy đủ chính thức (fullName)
- type          : Phường / Xã
- district      : khu vực trước sáp nhập, suy ra từ mã ĐVHC
- lat, lon      : tâm hình học (hoặc điểm đại diện bên trong)
- area_km2      : diện tích hành chính (km²)
- geom          : điểm đại diện (Point, EPSG:4326)
- geom_boundary : ranh giới hành chính (MultiPolygon, EPSG:4326)

Kết quả: data/tphcm_167_wards.json và bảng tvdi.wards (PostGIS).
Chạy:  python -m backend.scripts.init_wards            (ghi JSON + CSDL)
       python -m backend.scripts.init_wards --json-only (chỉ ghi JSON)
"""
import json
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from shapely.geometry import MultiPolygon, Polygon, shape

DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"
BOUNDARY_FILE = DATA_DIR / "tphcm_wards_boundaries.geojson"
JSON_FILE = DATA_DIR / "tphcm_167_wards.json"

REGION_ORDER = {"TP. Hồ Chí Minh (cũ)": 0, "Bình Dương (cũ)": 1, "Bà Rịa – Vũng Tàu (cũ)": 2}


def former_region(code: int) -> str:
    """Khu vực trước sáp nhập 2025 theo mã đơn vị hành chính cấp xã."""
    if code < 26000:
        return "Bình Dương (cũ)"
    if code < 26734:
        return "Bà Rịa – Vũng Tàu (cũ)"
    return "TP. Hồ Chí Minh (cũ)"


def _to_multipolygon_wkt(geom) -> str:
    """Chuẩn hóa hình học Polygon/MultiPolygon sang MultiPolygon WKT (EPSG:4326)."""
    if isinstance(geom, Polygon):
        geom = MultiPolygon([geom])
    return geom.wkt


def build_wards_catalog(include_wkt: bool = False):
    """Đọc ranh giới chính thức và trả về danh sách 167 phường/xã (bỏ đặc khu Côn Đảo)."""
    with open(BOUNDARY_FILE, "r", encoding="utf-8") as f:
        features = json.load(f)["features"]

    items = []
    for feat in features:
        p = feat["properties"]
        full_name = unicodedata.normalize("NFC", p["fullName"]).strip()
        ward_type = full_name.split(" ")[0]
        if ward_type not in ("Phường", "Xã"):
            continue  # Đặc khu Côn Đảo: ngoài lưới ô viễn thám

        geom = shape(feat["geometry"])
        pt = geom.centroid
        if not geom.contains(pt):
            pt = geom.representative_point()

        code = int(p["code"])
        entry = {
            "code": code,
            "name": full_name,
            "district": former_region(code),
            "province": "TP. Hồ Chí Minh",
            "type": ward_type,
            "lat": round(pt.y, 5),
            "lon": round(pt.x, 5),
            "area_km2": p.get("areaKm2"),
        }
        if include_wkt:
            entry["boundary_wkt"] = _to_multipolygon_wkt(geom)
        items.append(entry)

    items.sort(key=lambda w: (REGION_ORDER[w["district"]], w["code"]))
    catalog = [{"ward_id": i, **w} for i, w in enumerate(items, start=1)]

    assert len(catalog) == 167, f"Cần đúng 167 phường/xã đất liền, thực tế có {len(catalog)}"
    assert len({w["name"] for w in catalog}) == 167, "Tên phường/xã bị trùng lặp"
    return catalog


def write_json(catalog):
    clean = [{k: v for k, v in w.items() if k != "boundary_wkt"} for w in catalog]
    with open(JSON_FILE, "w", encoding="utf-8") as f:
        json.dump(clean, f, ensure_ascii=False, indent=2)
    print(f"  [OK] Đã lưu {len(clean)} phường/xã vào {JSON_FILE}")


def write_database(catalog):
    from sqlalchemy import text
    from backend.app.database import engine

    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS tvdi.wards (
                ward_id INT PRIMARY KEY,
                code INT,
                region_id INT REFERENCES tvdi.regions(id) ON DELETE SET NULL,
                name VARCHAR(255) NOT NULL,
                district VARCHAR(255) NOT NULL,
                province VARCHAR(255) NOT NULL,
                type VARCHAR(50) NOT NULL,
                lat DOUBLE PRECISION NOT NULL,
                lon DOUBLE PRECISION NOT NULL,
                area_km2 DOUBLE PRECISION,
                geom geometry(Point, 4326),
                geom_boundary geometry(MultiPolygon, 4326)
            );
        """))
        conn.execute(text("ALTER TABLE tvdi.wards ADD COLUMN IF NOT EXISTS code INT"))
        conn.execute(text("ALTER TABLE tvdi.wards ADD COLUMN IF NOT EXISTS area_km2 DOUBLE PRECISION"))
        conn.execute(text("ALTER TABLE tvdi.wards ADD COLUMN IF NOT EXISTS geom_boundary geometry(MultiPolygon, 4326)"))
        conn.execute(text("ALTER TABLE tvdi.wards ADD COLUMN IF NOT EXISTS region_id INT"))

        region_row = conn.execute(text("SELECT id FROM tvdi.regions ORDER BY id ASC LIMIT 1")).fetchone()
        region_id = region_row[0] if region_row else None

        rows = [{**w, "region_id": region_id} for w in catalog]
        conn.execute(
            text("""
                INSERT INTO tvdi.wards (
                    ward_id, code, region_id, name, district, province, type,
                    lat, lon, area_km2, geom, geom_boundary
                )
                VALUES (
                    :ward_id, :code, :region_id, :name, :district, :province, :type,
                    :lat, :lon, :area_km2,
                    ST_SetSRID(ST_MakePoint(:lon, :lat), 4326),
                    ST_GeomFromText(:boundary_wkt, 4326)
                )
                ON CONFLICT (ward_id) DO UPDATE SET
                    code = EXCLUDED.code,
                    region_id = COALESCE(EXCLUDED.region_id, tvdi.wards.region_id),
                    name = EXCLUDED.name,
                    district = EXCLUDED.district,
                    province = EXCLUDED.province,
                    type = EXCLUDED.type,
                    lat = EXCLUDED.lat,
                    lon = EXCLUDED.lon,
                    area_km2 = COALESCE(EXCLUDED.area_km2, tvdi.wards.area_km2),
                    geom = EXCLUDED.geom,
                    geom_boundary = COALESCE(EXCLUDED.geom_boundary, tvdi.wards.geom_boundary);
            """),
            rows,
        )
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_wards_geom ON tvdi.wards USING GIST (geom);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_wards_geom_boundary ON tvdi.wards USING GIST (geom_boundary);"))
    print(f"  [OK] Đã đồng bộ {len(catalog)} phường/xã (kèm ranh giới MultiPolygon) vào tvdi.wards")


def init_wards_table(json_only: bool = False):
    catalog = build_wards_catalog(include_wkt=not json_only)
    print(
        f"Tổng số phường/xã đất liền: {len(catalog)} "
        f"({sum(w['type'] == 'Phường' for w in catalog)} phường, {sum(w['type'] == 'Xã' for w in catalog)} xã)"
    )
    write_json(catalog)
    if not json_only:
        write_database(catalog)


if __name__ == "__main__":
    init_wards_table(json_only="--json-only" in sys.argv)
