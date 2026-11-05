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


def build_composite(start_date_str: str, end_date_str: str, region):
    """
    Tạo ảnh ghép Landsat 8/9 median trong cửa sổ thời gian [start - pad, end + pad].
    Tính TVDI, NDVI, LST_C cắt theo ranh giới vùng.
    (Nguyên bản từ hàm buildComposite trong GEE_tphcm.docx)
    """
    import ee
    WINDOW_DAYS = 32
    STEP_DAYS = 15
    PAD = (WINDOW_DAYS - STEP_DAYS) / 2  # 8.5 ngày

    s = ee.Date(start_date_str)
    e = ee.Date(end_date_str)

    col = (
        ee.ImageCollection("LANDSAT/LC08/C02/T1_L2")
        .merge(ee.ImageCollection("LANDSAT/LC09/C02/T1_L2"))
        .filterBounds(region)
        .filterDate(s.advance(-PAD, "day"), e.advance(PAD, "day"))
        .map(prep_landsat)
    )

    n = col.size()
    empty = ee.Image.constant([0, 0]).rename(["LST_C", "NDVI"]).updateMask(0)
    comp = ee.Image(ee.Algorithms.If(n.gt(0), col.median(), empty)).clip(region)

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
    # Lọc bỏ mặt nước (NDVI >= 0)
    tvdi = tvdi.updateMask(ndvi.gte(0))

    return comp.addBands(tvdi).select(["LST_C", "NDVI", "TVDI"])


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
) -> Optional[str]:
    """
    Tạo hoặc lấy URL Tile XYZ từ Google Earth Engine cho lớp được chỉ định và mốc ngày
    (hoặc khoảng [date_str, end_date_str] khi tổng hợp theo tháng/năm/giai đoạn).
    """
    vis = VIS_PARAMS.get(layer_name.lower(), VIS_PARAMS["tvdi"])
    vis_min = vis["min"] if vmin is None else vmin
    vis_max = vis["max"] if vmax is None else vmax

    if not end_date_str:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
        end_date_str = (dt + timedelta(days=15)).strftime("%Y-%m-%d")

    cache_key = f"{layer_name}_{date_str}_{end_date_str}_{vis_min}_{vis_max}"
    if cache_key in _cached_tile_urls:
        return _cached_tile_urls[cache_key]

    if not init_earth_engine():
        return None

    import ee

    region = get_region_geometry(db)
    comp = build_composite(date_str, end_date_str, region)

    band_map = {"tvdi": "TVDI", "lst": "LST_C", "ndvi": "NDVI"}
    band = band_map.get(layer_name.lower(), "TVDI")

    vis_image = comp.select(band).visualize(min=vis_min, max=vis_max, palette=vis["palette"])

    # Tạo Map ID để cung cấp tile XYZ cho Leaflet
    map_id = vis_image.getMapId()
    tile_url = map_id["tile_fetcher"].url_format

    _cached_tile_urls[cache_key] = tile_url
    return tile_url
