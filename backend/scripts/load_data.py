"""
load_data.py – Nạp dữ liệu CSV và Shapefile vào PostGIS với hiệu năng cao.

Chạy: python -m backend.scripts.load_data
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import pandas as pd
import geopandas as gpd
from psycopg2.extras import execute_values
from sqlalchemy import text

from backend.app.config import settings
from backend.app.database import engine


def load_series_csv():
    """Nạp file TVDI_TPHCM_series_2017_2025.csv vào bảng tvdi.tvdi_series."""
    csv_path = settings.DATA_DIR / "TVDI_TPHCM_series_2017_2025.csv"
    print(f"  Đọc file: {csv_path}")

    df = pd.read_csv(csv_path)
    df.columns = [c.strip().lower() for c in df.columns]
    df["date"] = pd.to_datetime(df["date"]).dt.date
    print(f"  Số dòng: {len(df):,}")

    records = [
        (
            row["date"],
            float(row["lst_c"]) if pd.notna(row["lst_c"]) else None,
            float(row["ndvi"]) if pd.notna(row["ndvi"]) else None,
            float(row["tvdi"]) if pd.notna(row["tvdi"]) else None,
            int(row["n_img"]) if pd.notna(row["n_img"]) else None,
            float(row["dry_a"]) if pd.notna(row["dry_a"]) else None,
            float(row["dry_b"]) if pd.notna(row["dry_b"]) else None,
            float(row["ts_min"]) if pd.notna(row["ts_min"]) else None,
            int(row["fit_ok"]) if pd.notna(row["fit_ok"]) else None,
        )
        for _, row in df.iterrows()
    ]

    raw_conn = engine.raw_connection()
    try:
        with raw_conn.cursor() as cur:
            cur.execute("TRUNCATE TABLE tvdi.tvdi_series RESTART IDENTITY")
            sql = """
                INSERT INTO tvdi.tvdi_series
                (date, lst_c, ndvi, tvdi, n_img, dry_a, dry_b, ts_min, fit_ok)
                VALUES %s
            """
            execute_values(cur, sql, records, template="(%s, %s, %s, %s, %s, %s, %s, %s, %s)", page_size=1000)
        raw_conn.commit()
        print(f"  [OK] Đã nạp thành công {len(records):,} dòng vào tvdi.tvdi_series")
    finally:
        raw_conn.close()


def load_grid_csv():
    """Nạp file TVDI_TPHCM_grid_2017_2025.csv vào bảng tvdi.tvdi_grid."""
    csv_path = settings.DATA_DIR / "TVDI_TPHCM_grid_2017_2025.csv"
    print(f"  Đọc file: {csv_path}")

    df = pd.read_csv(csv_path)
    print(f"  Số dòng: {len(df):,}")

    df.columns = [c.strip().lower() for c in df.columns]
    df["cell_id"] = df["cell_id"].astype(float).astype(int)
    df["date"] = pd.to_datetime(df["date"]).dt.date

    records = [
        (
            row["date"],
            int(row["cell_id"]),
            float(row["lon"]),
            float(row["lat"]),
            float(row["lst_c"]) if pd.notna(row["lst_c"]) else None,
            float(row["ndvi"]) if pd.notna(row["ndvi"]) else None,
            float(row["tvdi"]) if pd.notna(row["tvdi"]) else None,
            int(row["n_img"]) if pd.notna(row["n_img"]) else None,
            float(row["lon"]),
            float(row["lat"]),
        )
        for _, row in df.iterrows()
    ]

    raw_conn = engine.raw_connection()
    try:
        with raw_conn.cursor() as cur:
            cur.execute("TRUNCATE TABLE tvdi.tvdi_grid RESTART IDENTITY")
            sql = """
                INSERT INTO tvdi.tvdi_grid
                (date, cell_id, lon, lat, lst_c, ndvi, tvdi, n_img, geom)
                VALUES %s
            """
            execute_values(
                cur,
                sql,
                records,
                template="(%s, %s, %s, %s, %s, %s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326))",
                page_size=5000,
            )
        raw_conn.commit()
        print(f"  [OK] Đã nạp thành công {len(records):,} dòng vào tvdi.tvdi_grid")
    finally:
        raw_conn.close()


def load_shapefile():
    """Nạp shapefile ranh giới TPHCM vào bảng tvdi.regions."""
    shp_path = settings.DATA_DIR / "TPHCM_chinh_xac" / "TPHCM_chinh_xac" / "TPHCM_chinh_xac.shp"
    print(f"  Đọc shapefile: {shp_path}")

    gdf = gpd.read_file(shp_path)
    print(f"  Số feature: {len(gdf)}, CRS: {gdf.crs}")

    if gdf.crs and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(epsg=4326)

    raw_conn = engine.raw_connection()
    try:
        with raw_conn.cursor() as cur:
            cur.execute("TRUNCATE TABLE tvdi.regions RESTART IDENTITY")
            for _, row in gdf.iterrows():
                wkt = row.geometry.wkt
                cur.execute(
                    """
                    INSERT INTO tvdi.regions (ten, sap_nhap, quy_mo, dt_km2, geom)
                    VALUES (%s, %s, %s, %s, ST_GeomFromText(%s, 4326))
                    """,
                    (
                        row.get("ten", ""),
                        row.get("sap_nhap", ""),
                        row.get("quy_mo", ""),
                        float(row.get("dt_km2", 0)),
                        wkt,
                    ),
                )
        raw_conn.commit()
        print(f"  [OK] Đã nạp {len(gdf)} feature vào tvdi.regions")
    finally:
        raw_conn.close()


def populate_grid_cells():
    """Tạo đa giác ô lưới cắt gọt chuẩn xác theo ranh giới TP.HCM mở rộng."""
    raw_conn = engine.raw_connection()
    try:
        with raw_conn.cursor() as cur:
            # 1. Nạp danh mục toàn bộ ô lưới
            cur.execute("""
                INSERT INTO tvdi.grid_cells (cell_id, lon, lat, geom_point, geom_polygon)
                SELECT 
                    sub.cell_id, sub.lon, sub.lat,
                    ST_SetSRID(ST_MakePoint(sub.lon, sub.lat), 4326) as geom_point,
                    NULL as geom_polygon
                FROM (
                    SELECT DISTINCT cell_id, lon, lat
                    FROM tvdi.tvdi_grid
                ) sub
                ON CONFLICT (cell_id) DO UPDATE 
                SET lon = EXCLUDED.lon, lat = EXCLUDED.lat, geom_point = EXCLUDED.geom_point;
            """)

            # 2. Cắt gọt chuẩn xác theo ranh giới hành chính tvdi.regions
            sql = """
                UPDATE tvdi.grid_cells c
                SET geom_polygon = ST_Multi(ST_CollectionExtract(
                    ST_Intersection(
                        ST_SetSRID(ST_MakeEnvelope(c.lon - 0.025, c.lat - 0.025, c.lon + 0.025, c.lat + 0.025, 4326), 4326),
                        r.geom
                    ), 3
                ))
                FROM tvdi.regions r
                WHERE r.id = 1
                  AND ST_Intersects(
                      ST_SetSRID(ST_MakeEnvelope(c.lon - 0.025, c.lat - 0.025, c.lon + 0.025, c.lat + 0.025, 4326), 4326),
                      r.geom
                  );
            """
            cur.execute(sql)

            # 3. Đảm bảo các ô nằm ngoài ranh giới không có đa giác (để không vẽ tràn ra ngoài)
            cur.execute("""
                UPDATE tvdi.grid_cells c
                SET geom_polygon = NULL
                FROM tvdi.regions r
                WHERE r.id = 1
                  AND NOT ST_Intersects(
                      ST_SetSRID(ST_MakeEnvelope(c.lon - 0.025, c.lat - 0.025, c.lon + 0.025, c.lat + 0.025, 4326), 4326),
                      r.geom
                  );
            """)

            # 4. Bổ sung các ô lưới còn khuyết trong ranh giới (vùng bán đảo phía Bắc Phú Giáo / mép ranh giới)
            cur.execute("""
                WITH grid AS (
                    SELECT 
                        (i * 1000 + j) as cell_id,
                        round((106.36645 + i * 0.05)::numeric, 5)::float as lon,
                        round((10.34819 + j * 0.05)::numeric, 5)::float as lat,
                        ST_SetSRID(ST_MakeEnvelope(
                            106.36645 + i * 0.05 - 0.025,
                            10.34819 + j * 0.05 - 0.025,
                            106.36645 + i * 0.05 + 0.025,
                            10.34819 + j * 0.05 + 0.025,
                            4326
                        ), 4326) as env
                    FROM generate_series(0, 24) as i
                    CROSS JOIN generate_series(0, 24) as j
                )
                INSERT INTO tvdi.grid_cells (cell_id, lon, lat, geom_point, geom_polygon)
                SELECT g.cell_id, g.lon, g.lat,
                       ST_SetSRID(ST_MakePoint(g.lon, g.lat), 4326),
                       ST_Multi(ST_CollectionExtract(ST_Intersection(g.env, r.geom), 3))
                FROM grid g
                CROSS JOIN tvdi.regions r
                LEFT JOIN tvdi.grid_cells c ON g.cell_id = c.cell_id AND c.geom_polygon IS NOT NULL
                WHERE c.cell_id IS NULL
                  AND ST_Intersects(g.env, r.geom)
                  AND ST_Area(ST_Intersection(g.env, r.geom)::geography)/1e6 >= 0.5
                ON CONFLICT (cell_id) DO UPDATE
                SET lon = EXCLUDED.lon, lat = EXCLUDED.lat, geom_point = EXCLUDED.geom_point, geom_polygon = EXCLUDED.geom_polygon;
            """)

            cur.execute("SELECT COUNT(*) FROM tvdi.grid_cells WHERE geom_polygon IS NOT NULL")
            count = cur.fetchone()[0]
        raw_conn.commit()
        print(f"  [OK] Đã tạo và cập nhật {count} ô lưới đa giác cắt chuẩn theo ranh giới trong tvdi.grid_cells")
    finally:
        raw_conn.close()


def main():
    print("=" * 60)
    print("NẠP DỮ LIỆU VÀO POSTGIS")
    print("=" * 60)

    t0 = time.time()

    print("\n[1/4] Nạp chuỗi thời gian (series)...")
    load_series_csv()

    print("\n[2/4] Nạp dữ liệu ô lưới (grid)...")
    load_grid_csv()

    print("\n[3/4] Nạp ranh giới hành chính (shapefile)...")
    load_shapefile()

    print("\n[4/4] Tạo đa giác ô lưới tĩnh (grid_cells)...")
    populate_grid_cells()

    elapsed = time.time() - t0
    print(f"\n[HOÀN TẤT] Tổng thời gian nạp: {elapsed:.2f} giây")


if __name__ == "__main__":
    main()
