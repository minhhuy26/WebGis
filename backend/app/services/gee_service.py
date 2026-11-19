"""
Dịch vụ tích hợp Google Earth Engine (GEE).
Chuyển đổi trực tiếp thuật toán từ GEE_tphcm.docx sang Python Earth Engine API.
Cung cấp Tile URL (XYZ) cho Leaflet để hiển thị ảnh viễn thám Landsat 8/9 độ phân giải cao 30m.
"""
import os
import json
import logging
from typing import Dict, Any, Optional
from datetime import datetime, timedelta
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import settings, PROJECT_ROOT

logger = logging.getLogger("gee_service")

# Biến cờ trạng thái khởi tạo GEE
_gee_initialized = False
_gee_init_error = None
_cached_tile_urls: Dict[str, str] = {}


def has_credentials() -> bool:
    """Kiểm tra sự tồn tại của file credentials hoặc service account trước khi gọi API."""
    try:
        import ee.oauth
        cred_path = ee.oauth.get_credentials_path()
        if os.path.exists(cred_path):
            return True
    except Exception:
        pass

    if settings.EE_SERVICE_ACCOUNT and settings.EE_PRIVATE_KEY_FILE:
        if os.path.exists(settings.EE_PRIVATE_KEY_FILE):
            return True
    return False


def get_configured_project() -> Optional[str]:
    """Lấy Project ID từ cấu hình hoặc từ file credentials của earthengine."""
    if settings.EE_PROJECT_ID:
        return settings.EE_PROJECT_ID.strip()
    try:
        import ee.oauth
        cred_path = ee.oauth.get_credentials_path()
        if os.path.exists(cred_path):
            with open(cred_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                p = data.get("project")
                if p:
                    return str(p).strip()
    except Exception:
        pass
    return None


def init_earth_engine() -> bool:
    """Khởi tạo Google Earth Engine từ môi trường hoặc tài khoản cục bộ."""
    global _gee_initialized, _gee_init_error
    if _gee_initialized:
        return True

    if not has_credentials():
        _gee_init_error = (
            "Chưa xác thực Google Earth Engine. Vui lòng chạy lệnh 'python -m ee.cli.eecli authenticate' "
            "trong terminal."
        )
        return False

    project = get_configured_project()
    if not project and not settings.EE_SERVICE_ACCOUNT:
        _gee_init_error = (
            "Tài khoản Google đã xác thực thành công nhưng chưa có Project ID. "
            "Vui lòng nhập Google Earth Engine Project ID của bạn (ví dụ: ee-tenban) để hoàn tất kết nối."
        )
        return False

    try:
        import ee
        # 1. Ưu tiên Service Account nếu được cấu hình
        if settings.EE_SERVICE_ACCOUNT and settings.EE_PRIVATE_KEY_FILE:
            if os.path.exists(settings.EE_PRIVATE_KEY_FILE):
                credentials = ee.ServiceAccountCredentials(
                    settings.EE_SERVICE_ACCOUNT, settings.EE_PRIVATE_KEY_FILE
                )
                ee.Initialize(credentials, project=project or None)
                _gee_initialized = True
                logger.info("Khởi tạo GEE thành công qua Service Account.")
                return True

        # 2. Khởi tạo qua Project ID hoặc persistent credentials
        if project:
            ee.Initialize(project=project)
        else:
            ee.Initialize()

        _gee_initialized = True
        _gee_init_error = None
        logger.info("Khởi tạo Google Earth Engine thành công.")
        return True
    except Exception as e:
        _gee_init_error = str(e)
        logger.warning(f"Chưa thể kết nối Google Earth Engine: {e}")
        return False


def set_project(project_id: str) -> bool:
    """Lưu Project ID vào file credentials và .env, sau đó thử kết nối lại."""
    global _gee_initialized, _gee_init_error
    p = project_id.strip()
    settings.EE_PROJECT_ID = p

    # Lưu vào file ~/.config/earthengine/credentials
    try:
        import ee.oauth
        cred_path = ee.oauth.get_credentials_path()
        if os.path.exists(cred_path):
            with open(cred_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            data["project"] = p
            ee.oauth.write_private_json(cred_path, data)
    except Exception as e:
        logger.warning(f"Không thể cập nhật credentials file: {e}")

    # Cập nhật file .env
    try:
        env_path = PROJECT_ROOT / ".env"
        if env_path.exists():
            content = env_path.read_text(encoding="utf-8")
            if "EE_PROJECT_ID=" in content:
                import re
                content = re.sub(r"EE_PROJECT_ID=.*", f"EE_PROJECT_ID={p}", content)
            else:
                content += f"\nEE_PROJECT_ID={p}\n"
            env_path.write_text(content, encoding="utf-8")
    except Exception as e:
        logger.warning(f"Không thể ghi .env: {e}")

    _gee_initialized = False
    return init_earth_engine()


def get_gee_status() -> Dict[str, Any]:
    """Trả về trạng thái kết nối Google Earth Engine."""
    global _gee_initialized, _gee_init_error
    has_creds = has_credentials()
    project = get_configured_project()

    if not _gee_initialized and has_creds and project:
        init_earth_engine()

    return {
        "has_credentials": has_creds,
        "project_id": project or "",
        "needs_project": has_creds and not project,
        "initialized": _gee_initialized,
        "error": _gee_init_error if not _gee_initialized else None,
        "instructions": (
            "Tài khoản Google đã xác thực thành công! Vui lòng nhập Project ID để hoàn tất."
            if (has_creds and not project)
            else (
                "Chưa xác thực Google Earth Engine. Vui lòng chạy 'python -m ee.cli.eecli authenticate'."
                if not has_creds
                else "GEE đã sẵn sàng cung cấp lớp ảnh vệ tinh 30m."
            )
        ),
    }


def get_region_geometry(db: Session):
    """Lấy geometry ranh giới TP.HCM mở rộng từ PostGIS chuyển thành ee.Geometry."""
    import ee
    sql = text("SELECT ST_AsGeoJSON(geom)::json FROM tvdi.regions LIMIT 1;")
    row = db.execute(sql).fetchone()
    if row and row[0]:
        geojson_geom = row[0]
        return ee.Geometry(geojson_geom)
    # Tọa độ mặc định bao trùm TP.HCM nếu chưa có trong DB
    return ee.Geometry.BBox(106.0, 8.5, 107.6, 11.55)


def prep_landsat(img):
    """
    Chuẩn hóa ảnh Landsat 8/9 C2 L2:
    Lọc mây (QA_PIXEL), tính LST (°C) từ ST_B10, tính NDVI từ SR_B5 (NIR) và SR_B4 (Red).
    (Nguyên bản từ hàm prepLandsat trong GEE_tphcm.docx)
    """
    import ee
    qa = img.select("QA_PIXEL")
    # bit 1 dilated cloud, 2 cirrus, 3 cloud, 4 cloud shadow, 5 snow -> bitwiseAnd(62).eq(0)
    clear = qa.bitwiseAnd(62).eq(0)
    red = img.select("SR_B4").multiply(0.0000275).add(-0.2)
    nir = img.select("SR_B5").multiply(0.0000275).add(-0.2)
    ndvi = nir.subtract(red).divide(nir.add(red)).rename("NDVI")
    lst = img.select("ST_B10").multiply(0.00341802).add(149.0).subtract(273.15).rename("LST_C")
    ok_lst = lst.gt(10).And(lst.lt(65))
    return ee.Image.cat([lst, ndvi]).updateMask(clear).updateMask(ok_lst).copyProperties(img, ["system:time_start"])


def dry_wet_edge(img, region):
    """
    Dựng không gian LST–NDVI (biên khô / biên ướt) để tính TVDI.
    (Nguyên bản từ hàm dryWetEdge trong GEE_tphcm.docx)
    """
    import ee
    FIT_SCALE = 500
    NDVI_FIT_MIN = 0.1
    NDVI_FIT_MAX = 0.95
    NDVI_BIN = 0.02
    MIN_PX_BIN = 20

    ndvi = img.select("NDVI")
    lst = img.select("LST_C")
    in_range = ndvi.gte(NDVI_FIT_MIN).And(ndvi.lte(NDVI_FIT_MAX))
    bin_img = ndvi.subtract(NDVI_FIT_MIN).divide(NDVI_BIN).floor().rename("bin").updateMask(in_range)
    stack = lst.updateMask(in_range).addBands(bin_img)
    reducer = (
        ee.Reducer.percentile([99])
        .combine(ee.Reducer.count(), "", True)
        .group(groupField=1, groupName="bin")
    )
    res = ee.Dictionary(
        stack.reduceRegion(
            reducer=reducer, geometry=region, scale=FIT_SCALE, maxPixels=1e10, bestEffort=True, tileScale=4
        )
    )
    groups = ee.List(res.get("groups", ee.List([])))

    def map_pts(g):
        g = ee.Dictionary(g)
        return ee.Feature(
            None,
            {
                "x": ee.Number(g.get("bin")).multiply(NDVI_BIN).add(NDVI_FIT_MIN + NDVI_BIN / 2),
                "y": g.get("p99"),
                "n": g.get("count"),
            },
        )

    pts = ee.FeatureCollection(groups.map(map_pts)).filter(ee.Filter.gte("n", MIN_PX_BIN))
    enough = pts.size().gte(5)
    lin = ee.Dictionary(
        ee.Algorithms.If(
            enough, pts.reduceColumns(ee.Reducer.linearFit(), ["x", "y"]), {"offset": 0, "scale": 0}
        )
    )
    a = ee.Number(lin.get("offset"))
    b = ee.Number(lin.get("scale"))
    valid = enough.And(b.lt(0))
    ts_min = ee.Number(
        ee.Algorithms.If(
            valid,
            lst.updateMask(ndvi.gte(NDVI_FIT_MIN)).reduceRegion(
                reducer=ee.Reducer.percentile([1]), geometry=region, scale=FIT_SCALE, maxPixels=1e10, bestEffort=True, tileScale=4
            ).get("LST_C"),
            0,
        )
    )
    return ee.Dictionary({"a": a, "b": b, "tsMin": ts_min, "valid": valid})


def _finalize_tvdi_composite(comp, n_img, region, mask_water: bool = True):
    """Dựng không gian LST-NDVI và ghép band TVDI + gắn metadata biên khô/ướt lên ảnh."""
    import ee

    fit = dry_wet_edge(comp, region)
    a = ee.Number(fit.get("a"))
    b = ee.Number(fit.get("b"))
    ts_min = ee.Number(fit.get("tsMin"))
    valid = ee.Number(fit.get("valid"))

    ndvi = comp.select("NDVI")
    lst = comp.select("LST_C")
    ts_max = ndvi.multiply(b).add(a)
    tvdi = (
        lst.subtract(ts_min)
        .divide(ts_max.subtract(ts_min))
        .clamp(0, 1)
        .rename("TVDI")
        .updateMask(ts_max.gt(ts_min))
        .updateMask(ee.Image.constant(valid))
    )
    if mask_water:
        tvdi = tvdi.updateMask(ndvi.gte(0))

    img = comp.addBands(tvdi).select(["LST_C", "NDVI", "TVDI"]).set({
        "n_img": n_img,
        "dry_a": a,
        "dry_b": b,
        "ts_min": ts_min,
        "fit_ok": valid,
    })
    return img


def build_composite(
    start_date_str: str,
    end_date_str: str,
    region,
    satellite_source: str = "LANDSAT",
    window_days: int = 32,
):
    """
    Tạo ảnh ghép median trong cửa sổ thời gian cho Landsat 8/9 (30 m) hoặc MODIS (1000 m).
    Tính LST_C, NDVI, TVDI cắt theo ranh giới vùng kèm metadata biên khô/ướt.
    """
    import ee

    src = (satellite_source or "LANDSAT").upper()
    s = ee.Date(start_date_str)
    e = ee.Date(end_date_str)

    if src == "MODIS":
        # Chuẩn bị khung đa nguồn: MODIS Terra Daily LST (MOD11A1) & Surface Reflectance (MOD09GA)
        def _prep_modis_lst(img):
            lst = img.select("LST_Day_1km").multiply(0.02).subtract(273.15).rename("LST_C")
            ok = lst.gt(10).And(lst.lt(65))
            return lst.updateMask(ok)

        def _prep_modis_ndvi(img):
            nir = img.select("sur_refl_b02").multiply(0.0001)
            red = img.select("sur_refl_b01").multiply(0.0001)
            return nir.subtract(red).divide(nir.add(red)).rename("NDVI")

        lst_col = (
            ee.ImageCollection("MODIS/061/MOD11A1")
            .filterBounds(region)
            .filterDate(s, e)
            .map(_prep_modis_lst)
        )
        sr_col = (
            ee.ImageCollection("MODIS/061/MOD09GA")
            .filterBounds(region)
            .filterDate(s, e)
            .map(_prep_modis_ndvi)
        )
        n = lst_col.size()
        empty_lst = ee.Image.constant(0).rename("LST_C").updateMask(0)
        empty_ndvi = ee.Image.constant(0).rename("NDVI").updateMask(0)
        lst_img = ee.Image(ee.Algorithms.If(lst_col.size().gt(0), lst_col.median(), empty_lst))
        ndvi_img = ee.Image(ee.Algorithms.If(sr_col.size().gt(0), sr_col.median(), empty_ndvi))
        comp = lst_img.addBands(ndvi_img).clip(region)
        return _finalize_tvdi_composite(comp, n, region)

    # Mặc định: Landsat 8/9 C2 L2 (theo thuật toán GEE_tphcm.docx)
    step_days = 15
    pad = max(0.0, (window_days - step_days) / 2.0)

    col = (
        ee.ImageCollection("LANDSAT/LC08/C02/T1_L2")
        .merge(ee.ImageCollection("LANDSAT/LC09/C02/T1_L2"))
        .filterBounds(region)
        .filterDate(s.advance(-pad, "day"), e.advance(pad, "day"))
        .map(prep_landsat)
    )

    n = col.size()
    empty = ee.Image.constant([0, 0]).rename(["LST_C", "NDVI"]).updateMask(0)
    comp = ee.Image(ee.Algorithms.If(n.gt(0), col.median(), empty)).clip(region)
    return _finalize_tvdi_composite(comp, n, region)


# Tham số trực quan hóa đồng bộ với GEE script và tài liệu "Thang màu Nhiệt độ-NDVI-TVDI.pdf"
# (dải hiển thị mặc định khớp với chú giải trên WebGIS; frontend có thể truyền vmin/vmax khác)
VIS_PARAMS = {
    "tvdi": {
        "min": 0,
        "max": 1,
        "palette": ["#066b00", "#0bc400", "#0ce100", "#00ff00", "#ffff00", "#ffcc00", "#ff6600", "#ff0000"],
    },
    "lst": {
        "min": 25,
        "max": 45,
        "palette": ["#0000FF", "#0066FF", "#00FFFF", "#00FF00", "#FFFF00", "#FFCC00", "#FF6600", "#FF0000"],
    },
    "ndvi": {
        "min": -0.2,
        "max": 1,
        "palette": ["#FF0000", "#FF7F00", "#FFFF00", "#ADFF2F", "#00FF00", "#00FFFF", "#007FFF", "#0000FF"],
    },
}


def get_tile_url_for_date(
    db: Session,
    layer_name: str,
    date_str: str,
    end_date_str: Optional[str] = None,
    vmin: Optional[float] = None,
    vmax: Optional[float] = None,
    satellite_source: str = "LANDSAT",
) -> Optional[str]:
    """
    Tạo hoặc lấy URL Tile XYZ từ Google Earth Engine cho lớp được chỉ định và mốc ngày
    (hoặc khoảng [date_str, end_date_str] khi tổng hợp theo tháng/năm/giai đoạn).
    """
    src = (satellite_source or "LANDSAT").upper()
    vis = VIS_PARAMS.get(layer_name.lower(), VIS_PARAMS["tvdi"])
    vis_min = vis["min"] if vmin is None else vmin
    vis_max = vis["max"] if vmax is None else vmax

    if not end_date_str:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
        end_date_str = (dt + timedelta(days=15)).strftime("%Y-%m-%d")

    else:
        # The map requests inclusive calendar dates. Earth Engine's upper limit is exclusive.
        end_date_str = (datetime.strptime(end_date_str, "%Y-%m-%d") + timedelta(days=1)).date().isoformat()

    cache_key = f"{src}_{layer_name}_{date_str}_{end_date_str}_{vis_min}_{vis_max}"
    if cache_key in _cached_tile_urls:
        return _cached_tile_urls[cache_key]

    if not init_earth_engine():
        return None

    region = get_region_geometry(db)
    comp = build_composite(date_str, end_date_str, region, satellite_source=src, window_days=15)

    band_map = {"tvdi": "TVDI", "lst": "LST_C", "ndvi": "NDVI"}
    band = band_map.get(layer_name.lower(), "TVDI")

    vis_image = comp.select(band).visualize(min=vis_min, max=vis_max, palette=vis["palette"])

    # Tạo Map ID để cung cấp tile XYZ cho Leaflet
    map_id = vis_image.getMapId()
    tile_url = map_id["tile_fetcher"].url_format

    _cached_tile_urls[cache_key] = tile_url
    return tile_url


def _safe_float(val) -> Optional[float]:
    if val is None:
        return None
    try:
        f = float(val)
        return None if (f != f) else f
    except (TypeError, ValueError):
        return None


def sync_gee_observation_to_db(
    db: Session,
    date_str: str,
    end_date_str: Optional[str] = None,
    satellite_source: str = "LANDSAT",
    granularity: str = "15day",
    window_days: int = 32,
) -> Dict[str, Any]:
    """
    Trích xuất hiện trạng 3 chỉ số (LST, NDVI, TVDI) từ Google Earth Engine
    cho 1 mốc thời gian (kỳ 15 ngày / ngày / tháng) và lưu vào PostGIS:
    - tvdi.tvdi_grid (ô lưới ~5.5 km)
    - tvdi.tvdi_series (trung bình toàn vùng + tham số biên khô/ướt + thống kê)
    - tvdi.ward_observations (tổng hợp 167 phường/xã)
    - tvdi.gee_sync_logs (nhật ký đồng bộ)
    """
    from . import tvdi_service

    src = (satellite_source or "LANDSAT").upper()
    gran = (granularity or "15day").lower()
    spatial_res = 1000 if src == "MODIS" else 30

    dt = datetime.strptime(date_str, "%Y-%m-%d").date()
    if not end_date_str:
        step = 1 if gran == "daily" else (30 if gran == "monthly" else 15)
        end_date_str = (dt + timedelta(days=step)).strftime("%Y-%m-%d")
    end_dt = datetime.strptime(end_date_str, "%Y-%m-%d").date()

    log_id = db.execute(
        text("""
            INSERT INTO tvdi.gee_sync_logs (
                satellite_source, granularity, start_date, end_date, status, message
            )
            VALUES (:src, :gran, :s, :e, 'running', 'Đang trích xuất từ GEE...')
            RETURNING id
        """),
        {"src": src, "gran": gran, "s": dt, "e": end_dt},
    ).scalar()
    db.commit()

    if not init_earth_engine():
        msg = _gee_init_error or "Google Earth Engine chưa được xác thực."
        db.execute(
            text("""
                UPDATE tvdi.gee_sync_logs
                SET status = 'failed', message = :msg, finished_at = CURRENT_TIMESTAMP
                WHERE id = :id
            """),
            {"id": log_id, "msg": msg},
        )
        db.commit()
        raise RuntimeError(msg)

    try:
        import ee

        region = get_region_geometry(db)
        comp = build_composite(
            date_str,
            end_date_str,
            region,
            satellite_source=src,
            window_days=window_days,
        )

        # Lấy danh sách ô lưới hoạt động từ PostGIS
        cells = db.execute(
            text("""
                SELECT cell_id, lon, lat
                FROM tvdi.grid_cells
                WHERE geom_polygon IS NOT NULL AND NOT ST_IsEmpty(geom_polygon)
                ORDER BY cell_id ASC
            """)
        ).fetchall()

        half = 0.025
        ee_features = [
            ee.Feature(
                ee.Geometry.Rectangle(
                    [float(c[1]) - half, float(c[2]) - half, float(c[1]) + half, float(c[2]) + half],
                    None,
                    False,
                ),
                {"cell_id": int(c[0]), "lon": float(c[1]), "lat": float(c[2])},
            )
            for c in cells
        ]
        fc = ee.FeatureCollection(ee_features)

        reduce_scale = 500 if src == "MODIS" else 30
        reduced_fc = comp.select(["LST_C", "NDVI", "TVDI"]).reduceRegions(
            collection=fc,
            reducer=ee.Reducer.mean(),
            scale=reduce_scale,
            tileScale=4,
        )
        grid_info = reduced_fc.getInfo()
        meta_info = comp.toDictionary(["n_img", "dry_a", "dry_b", "ts_min", "fit_ok"]).getInfo()
        reg_info = comp.select(["LST_C", "NDVI", "TVDI"]).reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=region,
            scale=1000 if src == "MODIS" else 100,
            maxPixels=1e10,
            bestEffort=True,
            tileScale=8,
        ).getInfo()

        n_img = int(meta_info.get("n_img") or 0)
        dry_a = _safe_float(meta_info.get("dry_a"))
        dry_b = _safe_float(meta_info.get("dry_b"))
        ts_min = _safe_float(meta_info.get("ts_min"))
        fit_ok = int(bool(meta_info.get("fit_ok")))

        grid_records = []
        grid_rows_for_wards = []
        lst_vals, ndvi_vals, tvdi_vals = [], [], []

        for feat in grid_info.get("features", []):
            props = feat.get("properties", {})
            lst_v = _safe_float(props.get("LST_C"))
            ndvi_v = _safe_float(props.get("NDVI"))
            tvdi_v = _safe_float(props.get("TVDI"))
            if lst_v is None and ndvi_v is None and tvdi_v is None:
                continue

            cid = int(props["cell_id"])
            lon = float(props["lon"])
            lat = float(props["lat"])
            if lst_v is not None:
                lst_vals.append(lst_v)
            if ndvi_v is not None:
                ndvi_vals.append(ndvi_v)
            if tvdi_v is not None:
                tvdi_vals.append(tvdi_v)

            grid_records.append({
                "date": dt,
                "cell_id": cid,
                "lon": lon,
                "lat": lat,
                "lst_c": lst_v,
                "ndvi": ndvi_v,
                "tvdi": tvdi_v,
                "n_img": n_img,
                "satellite_source": src,
                "granularity": gran,
                "spatial_res_m": spatial_res,
                "data_quality": "raw_gee",
            })
            grid_rows_for_wards.append((lon, lat, lst_v, ndvi_v, tvdi_v))

        if grid_records:
            db.execute(
                text("""
                    INSERT INTO tvdi.tvdi_grid (
                        date, cell_id, lon, lat, lst_c, ndvi, tvdi, n_img,
                        satellite_source, granularity, spatial_res_m, data_quality, synced_at, geom
                    )
                    VALUES (
                        :date, :cell_id, :lon, :lat, :lst_c, :ndvi, :tvdi, :n_img,
                        :satellite_source, :granularity, :spatial_res_m, :data_quality, CURRENT_TIMESTAMP,
                        ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)
                    )
                    ON CONFLICT (date, cell_id, satellite_source, granularity) DO UPDATE SET
                        lst_c = EXCLUDED.lst_c,
                        ndvi = EXCLUDED.ndvi,
                        tvdi = EXCLUDED.tvdi,
                        n_img = EXCLUDED.n_img,
                        spatial_res_m = EXCLUDED.spatial_res_m,
                        data_quality = EXCLUDED.data_quality,
                        synced_at = CURRENT_TIMESTAMP;
                """),
                grid_records,
            )

        reg_lst = _safe_float(reg_info.get("LST_C")) or (round(sum(lst_vals) / len(lst_vals), 3) if lst_vals else None)
        reg_ndvi = _safe_float(reg_info.get("NDVI")) or (round(sum(ndvi_vals) / len(ndvi_vals), 4) if ndvi_vals else None)
        reg_tvdi = _safe_float(reg_info.get("TVDI")) or (round(sum(tvdi_vals) / len(tvdi_vals), 4) if tvdi_vals else None)
        drought_pct = (
            round(sum(1 for v in tvdi_vals if v >= 0.625) / len(tvdi_vals) * 100.0, 2)
            if tvdi_vals else None
        )

        db.execute(
            text("""
                INSERT INTO tvdi.tvdi_series (
                    date, satellite_source, granularity, lst_c, ndvi, tvdi, n_img,
                    dry_a, dry_b, ts_min, fit_ok,
                    lst_min, lst_max, ndvi_min, ndvi_max, tvdi_min, tvdi_max, drought_area_pct, synced_at
                )
                VALUES (
                    :date, :src, :gran, :lst_c, :ndvi, :tvdi, :n_img,
                    :dry_a, :dry_b, :ts_min, :fit_ok,
                    :lst_min, :lst_max, :ndvi_min, :ndvi_max, :tvdi_min, :tvdi_max, :drought_area_pct, CURRENT_TIMESTAMP
                )
                ON CONFLICT (date, satellite_source, granularity) DO UPDATE SET
                    lst_c = EXCLUDED.lst_c,
                    ndvi = EXCLUDED.ndvi,
                    tvdi = EXCLUDED.tvdi,
                    n_img = EXCLUDED.n_img,
                    dry_a = EXCLUDED.dry_a,
                    dry_b = EXCLUDED.dry_b,
                    ts_min = EXCLUDED.ts_min,
                    fit_ok = EXCLUDED.fit_ok,
                    lst_min = EXCLUDED.lst_min,
                    lst_max = EXCLUDED.lst_max,
                    ndvi_min = EXCLUDED.ndvi_min,
                    ndvi_max = EXCLUDED.ndvi_max,
                    tvdi_min = EXCLUDED.tvdi_min,
                    tvdi_max = EXCLUDED.tvdi_max,
                    drought_area_pct = EXCLUDED.drought_area_pct,
                    synced_at = CURRENT_TIMESTAMP;
            """),
            {
                "date": dt,
                "src": src,
                "gran": gran,
                "lst_c": reg_lst,
                "ndvi": reg_ndvi,
                "tvdi": reg_tvdi,
                "n_img": n_img,
                "dry_a": dry_a,
                "dry_b": dry_b,
                "ts_min": ts_min,
                "fit_ok": fit_ok,
                "lst_min": min(lst_vals) if lst_vals else None,
                "lst_max": max(lst_vals) if lst_vals else None,
                "ndvi_min": min(ndvi_vals) if ndvi_vals else None,
                "ndvi_max": max(ndvi_vals) if ndvi_vals else None,
                "tvdi_min": min(tvdi_vals) if tvdi_vals else None,
                "tvdi_max": max(tvdi_vals) if tvdi_vals else None,
                "drought_area_pct": drought_pct,
            },
        )

        # Tổng hợp sang 167 phường/xã (tvdi.ward_observations)
        ward_upserted = 0
        wards_rows = tvdi_service.get_wards_rows(db)
        if wards_rows and grid_rows_for_wards:
            interp_list = tvdi_service.interpolate_wards_from_grid(wards_rows, grid_rows_for_wards)
            ward_records = []
            for w, vals in zip(wards_rows, interp_list):
                dclass = tvdi_service.get_drought_class(vals["tvdi"])
                ward_records.append({
                    "date": dt,
                    "ward_id": int(w[0]),
                    "src": src,
                    "gran": gran,
                    "lst_c": vals["lst_c"],
                    "ndvi": vals["ndvi"],
                    "tvdi": vals["tvdi"],
                    "drought_level": dclass["level"] if dclass["level"] > 0 else None,
                    "method": "idw_centroid",
                })
            db.execute(
                text("""
                    INSERT INTO tvdi.ward_observations (
                        date, ward_id, satellite_source, granularity,
                        lst_c, ndvi, tvdi, drought_level, method, synced_at
                    )
                    VALUES (
                        :date, :ward_id, :src, :gran,
                        :lst_c, :ndvi, :tvdi, :drought_level, :method, CURRENT_TIMESTAMP
                    )
                    ON CONFLICT (date, ward_id, satellite_source, granularity) DO UPDATE SET
                        lst_c = EXCLUDED.lst_c,
                        ndvi = EXCLUDED.ndvi,
                        tvdi = EXCLUDED.tvdi,
                        drought_level = EXCLUDED.drought_level,
                        method = EXCLUDED.method,
                        synced_at = CURRENT_TIMESTAMP;
                """),
                ward_records,
            )
            ward_upserted = len(ward_records)

        db.execute(
            text("""
                UPDATE tvdi.gee_sync_logs
                SET status = 'success',
                    dates_synced = 1,
                    grid_rows_upserted = :g_cnt,
                    ward_rows_upserted = :w_cnt,
                    message = :msg,
                    finished_at = CURRENT_TIMESTAMP
                WHERE id = :id
            """),
            {
                "id": log_id,
                "g_cnt": len(grid_records),
                "w_cnt": ward_upserted,
                "msg": f"Đồng bộ thành công mốc {date_str} ({src}/{gran}): {len(grid_records)} ô lưới, {ward_upserted} phường/xã.",
            },
        )
        db.commit()
        return {
            "status": "success",
            "date": date_str,
            "end_date": end_date_str,
            "satellite_source": src,
            "granularity": gran,
            "n_img": n_img,
            "grid_rows_upserted": len(grid_records),
            "ward_rows_upserted": ward_upserted,
            "regional_mean": {"lst_c": reg_lst, "ndvi": reg_ndvi, "tvdi": reg_tvdi},
        }
    except Exception as e:
        db.rollback()
        try:
            db.execute(
                text("""
                    UPDATE tvdi.gee_sync_logs
                    SET status = 'failed', message = :msg, finished_at = CURRENT_TIMESTAMP
                    WHERE id = :id
                """),
                {"id": log_id, "msg": str(e)},
            )
            db.commit()
        except Exception:
            db.rollback()
        raise
