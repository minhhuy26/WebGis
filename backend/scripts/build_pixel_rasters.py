"""
Chuẩn bị ảnh pixel (~120 m) LST / NDVI / TVDI cho lớp "Pixel" của WebGIS.

Nguồn: bộ ảnh PNG 8-bit theo tháng đã tiền xử lý từ GeoTIFF Google Earth Engine
(thư mục data/raster + data/du_lieu_phuong.json của dự án WebGIS nhóm, sinh bởi tao_du_lieu_webgis.py).
Mỗi pixel: 0 = không có dữ liệu, 1..255 = giá trị mã hóa tuyến tính trong khoảng `encode` của chỉ số.
Ảnh ở hệ chiếu Web Mercator (EPSG:3857), phủ đúng khung `bounds` (độ, EPSG:4326).

Kết quả (frontend/data/raster/, phục vụ qua /static/data/raster/):
    <IDX>/<IDX>_YYYY_MM.png  ảnh tháng (LST, NDVI: sao chép nguyên bản; TVDI: chỉ thành phần chi tiết,
                             xem RESIDUAL_INDICES)
    <IDX>/<IDX>_Y_YYYY.png   trung bình năm (trung bình các tháng có ảnh, bỏ qua pixel trống)
    <IDX>/<IDX>_ALL.png      trung bình toàn giai đoạn
    <IDX>/<IDX>_DETAIL_MM.png thành phần chi tiết không gian theo tháng trong năm
                             (khí hậu tháng trừ bản làm trơn ~5 km) – dùng để chi tiết hóa
                             bản đồ lưới ~5,5 km (dự báo AI, kỳ không có ảnh tháng) lên 120 m
    meta.json                khung tọa độ, khoảng mã hóa, danh sách tháng / năm sẵn có

Chạy:  python -m backend.scripts.build_pixel_rasters --src "D:/.../Bai_Tap_Nhom_1/data"
"""
import argparse
import json
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_DIR = ROOT / "frontend" / "data" / "raster"
DEFAULT_SRC = Path("D:/Mon_ThayTuan/test/Bai_Tap_Nhom_1-20260927T124749Z-1-001/Bai_Tap_Nhom_1/data")

DETAIL_RANGE = {"LST": (-12.0, 12.0), "NDVI": (-0.5, 0.5), "TVDI": (-0.45, 0.45)}   # khoảng mã hóa thành phần chi tiết
SMOOTH_RADIUS = 22             # bán kính hộp làm trơn (pixel ~120 m) -> ~2,7 km, 3 lượt ≈ lọc Gauss
# TVDI của ảnh GEE dùng biên khô / ướt khác với TVDI trong PostGIS (lệch ~0,25 so với lưới 283 ô),
# nên chỉ giữ chi tiết không gian 120 m của ảnh; giá trị nền lấy từ lưới của hệ thống.
# LST và NDVI là đại lượng vật lý, khớp lưới (sai lệch < 1 °C / 0,02) nên dùng trực tiếp.
RESIDUAL_INDICES = {"TVDI"}


def decode(path, lo, hi):
    enc = np.asarray(Image.open(path), dtype=np.float32)
    out = lo + (enc - 1.0) / 254.0 * (hi - lo)
    out[enc == 0] = np.nan
    return out


def encode(arr, lo, hi):
    enc = np.zeros(arr.shape, dtype=np.uint8)
    good = np.isfinite(arr)
    enc[good] = np.clip(np.round((arr[good] - lo) / (hi - lo) * 254) + 1, 1, 255).astype(np.uint8)
    return Image.fromarray(enc, mode="L")


def nanmean_stack(paths, lo, hi):
    total = None
    count = None
    for p in paths:
        a = decode(p, lo, hi)
        ok = np.isfinite(a)
        if total is None:
            total = np.zeros(a.shape, dtype=np.float64)
            count = np.zeros(a.shape, dtype=np.int32)
        total[ok] += a[ok]
        count[ok] += 1
    with np.errstate(invalid="ignore", divide="ignore"):
        mean = total / count
    mean[count == 0] = np.nan
    return mean


def box_blur(a, r):
    """Trung bình trượt cửa sổ (2r+1)² bỏ qua pixel trống (cumsum, không cần scipy)."""
    ok = np.isfinite(a)
    v = np.where(ok, a, 0.0)
    w = ok.astype(np.float64)

    def blur_axis(x, axis):
        pad = [(0, 0), (0, 0)]
        pad[axis] = (r + 1, r)
        c = np.cumsum(np.pad(x, pad), axis=axis)
        n = x.shape[axis]
        hi = np.take(c, np.arange(2 * r + 1, n + 2 * r + 1), axis=axis)
        lo = np.take(c, np.arange(0, n), axis=axis)
        return hi - lo

    for _ in range(3):
        v = blur_axis(blur_axis(v, 0), 1)
        w = blur_axis(blur_axis(w, 0), 1)
        with np.errstate(invalid="ignore", divide="ignore"):
            v = np.where(w > 0, v / w, 0.0)
        w = (w > 0).astype(np.float64)
    out = v.copy()
    out[~ok] = np.nan
    return out


def main():
    ap = argparse.ArgumentParser(description="Chuẩn bị ảnh pixel LST/NDVI/TVDI cho WebGIS")
    ap.add_argument("--src", default=str(DEFAULT_SRC), help="Thư mục data chứa du_lieu_phuong.json và raster/")
    ap.add_argument("--out", default=str(OUT_DIR))
    args = ap.parse_args()

    src = Path(args.src)
    out = Path(args.out)
    info = json.loads((src / "du_lieu_phuong.json").read_text(encoding="utf-8"))
    overlay = info["overlay"]
    meta = {
        "bounds": overlay["bounds"],       # [west, south, east, north] (độ)
        "width": overlay["width"],
        "height": overlay["height"],
        "crs": "EPSG:3857",
        "resolution_m": 120,
        "source": "Landsat 8/9 (Google Earth Engine) – ảnh tổng hợp theo tháng",
        "indices": {},
    }

    for idx, desc in info["indices"].items():
        lo, hi = desc["encode"]
        d_lo, d_hi = DETAIL_RANGE[idx]
        residual = idx in RESIDUAL_INDICES
        dst = out / idx
        dst.mkdir(parents=True, exist_ok=True)

        def save(arr, name):
            if residual:
                arr = np.clip(arr - box_blur(arr, SMOOTH_RADIUS), d_lo, d_hi)
                encode(arr, d_lo, d_hi).save(dst / f"{idx}_{name}.png", optimize=True)
            else:
                encode(arr, lo, hi).save(dst / f"{idx}_{name}.png", optimize=True)

        src_paths = {}
        for ym, rel in desc["files"].items():
            p = src / rel
            if p.exists():
                src_paths[ym] = p
        months = sorted(src_paths)
        for ym in months:
            name = ym.replace("-", "_")
            if residual:
                save(decode(src_paths[ym], lo, hi), name)
            else:
                shutil.copyfile(src_paths[ym], dst / f"{idx}_{name}.png")

        years = {}
        for ym in months:
            years.setdefault(ym[:4], []).append(src_paths[ym])
        for y, paths in years.items():
            save(nanmean_stack(paths, lo, hi), f"Y_{y}")
        all_paths = [src_paths[ym] for ym in months]
        save(nanmean_stack(all_paths, lo, hi), "ALL")

        entry = {"encode": [lo, hi], "unit": desc.get("unit", ""), "months": months, "years": sorted(years)}
        if residual:
            # Ảnh của chỉ số này chỉ chứa thành phần chi tiết (mã hóa theo khoảng "detail"),
            # trình duyệt cộng vào lưới PostGIS để giữ đúng thang giá trị của hệ thống
            entry["residual"] = True

        # Thành phần chi tiết: khí hậu tháng (đủ >= 2 ảnh, nếu không thì toàn giai đoạn) trừ bản làm trơn
        overall = nanmean_stack(all_paths, lo, hi)
        for mm in range(1, 13):
            sel = [src_paths[ym] for ym in months if int(ym[5:7]) == mm]
            clim = nanmean_stack(sel, lo, hi) if len(sel) >= 2 else overall
            clim = np.where(np.isfinite(clim), clim, overall)
            resid = np.clip(clim - box_blur(clim, SMOOTH_RADIUS), d_lo, d_hi)
            encode(resid, d_lo, d_hi).save(dst / f"{idx}_DETAIL_{mm:02d}.png", optimize=True)
        entry["detail"] = [d_lo, d_hi]

        meta["indices"][idx] = entry
        print(f"{idx}: {len(months)} ảnh tháng, {len(years)} năm ({months[0]} → {months[-1]})")

    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Đã ghi {out / 'meta.json'}")


if __name__ == "__main__":
    main()
