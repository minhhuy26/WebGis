"""
Khởi tạo danh mục 167 phường, xã (phần đất liền) của TP. Hồ Chí Minh sau sắp xếp
đơn vị hành chính năm 2025 (Nghị quyết 1685/NQ-UBTVQH15: 113 phường, 54 xã và đặc khu Côn Đảo).

Nguồn dữ liệu: ranh giới chính thức data/tphcm_wards_boundaries.geojson
(gisServerId = diaphanhanhchinhcapxa_2025.2, 168 đơn vị).
Đặc khu Côn Đảo nằm ngoài lưới ô viễn thám ~5,5 km (không có dữ liệu LST/NDVI/TVDI)
nên không đưa vào danh mục xếp hạng -> còn đúng 167 phường/xã.

Mỗi phường/xã được gán:
- name     : tên đầy đủ chính thức (fullName)
- type     : Phường / Xã
- district : khu vực trước sáp nhập, suy ra từ mã ĐVHC (25xxx: Bình Dương, 26xxx < 26734: Bà Rịa – Vũng Tàu, còn lại: TP.HCM)
- lat, lon : tâm hình học (nếu tâm rơi ra ngoài đa giác thì lấy điểm đại diện bên trong)

Kết quả: data/tphcm_167_wards.json và bảng tvdi.wards (PostGIS).
Chạy:  python -m backend.scripts.init_wards            (ghi JSON + CSDL)
       python -m backend.scripts.init_wards --json-only (chỉ ghi JSON)
"""
import json
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from shapely.geometry import shape

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


def build_wards_catalog():
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
        items.append({
            "code": code,
            "name": full_name,
            "district": former_region(code),
            "province": "TP. Hồ Chí Minh",
            "type": ward_type,
            "lat": round(pt.y, 5),
            "lon": round(pt.x, 5),
            "area_km2": p.get("areaKm2"),
        })

    items.sort(key=lambda w: (REGION_ORDER[w["district"]], w["code"]))
    catalog = [{"ward_id": i, **w} for i, w in enumerate(items, start=1)]

    assert len(catalog) == 167, f"Cần đúng 167 phường/xã đất liền, thực tế có {len(catalog)}"
    assert len({w["name"] for w in catalog}) == 167, "Tên phường/xã bị trùng lặp"
    return catalog


def write_json(catalog):
    with open(JSON_FILE, "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)
    print(f"  [OK] Đã lưu {len(catalog)} phường/xã vào {JSON_FILE}")


def write_database(catalog):
    from sqlalchemy import text
    from backend.app.database import engine

    with engine.begin() as conn:
        conn.execute(text("""
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
        conn.execute(text("TRUNCATE TABLE tvdi.wards;"))
        conn.execute(
            text("""
                INSERT INTO tvdi.wards (ward_id, name, district, province, type, lat, lon, geom)
                VALUES (:ward_id, :name, :district, :province, :type, :lat, :lon,
                        ST_SetSRID(ST_MakePoint(:lon, :lat), 4326));
            """),
            catalog,
        )
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_wards_geom ON tvdi.wards USING GIST (geom);"))
    print(f"  [OK] Đã nạp {len(catalog)} phường/xã vào bảng PostGIS tvdi.wards")


def init_wards_table(json_only: bool = False):
    catalog = build_wards_catalog()
    print(f"Tổng số phường/xã đất liền: {len(catalog)} "
          f"({sum(w['type'] == 'Phường' for w in catalog)} phường, {sum(w['type'] == 'Xã' for w in catalog)} xã)")
    write_json(catalog)
    if not json_only:
        write_database(catalog)


if __name__ == "__main__":
    init_wards_table(json_only="--json-only" in sys.argv)
