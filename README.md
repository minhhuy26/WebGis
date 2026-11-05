# 🌍 WebGIS TVDI – TP. Hồ Chí Minh

Hệ thống WebGIS hiển thị, phân tích và dự báo chỉ số khô hạn thực vật **TVDI** (Temperature Vegetation Dryness Index) cùng nhiệt độ bề mặt **LST** và chỉ số thực vật **NDVI** cho TP. Hồ Chí Minh mở rộng (TP.HCM + Bình Dương + Bà Rịa – Vũng Tàu), giai đoạn 2017–2025, kèm dự báo AI đến hết 2027.

## 📋 Tổng quan

- **Backend:** Python + FastAPI
- **CSDL:** PostgreSQL + PostGIS
- **Frontend:** Leaflet (bản đồ 2D), MapLibre GL JS (bản đồ 3D), Chart.js – giao diện tiếng Việt
- **AI:** Random Forest (scikit-learn) dự báo TVDI
- **Dữ liệu:** Landsat 8/9 qua Google Earth Engine, chu kỳ 15 ngày, 283 ô lưới ~5,5 km; ranh giới 168 đơn vị hành chính cấp xã năm 2025

## ✨ Chức năng chính

| Nhóm | Chức năng |
|------|-----------|
| Bản đồ chỉ số | Chọn lớp **LST / NDVI / TVDI**; hiển thị **Pixel** (raster cắt theo ranh giới) hoặc **Phường/Xã** (tô màu 167 phường, xã); thang màu theo tài liệu *Thang màu Nhiệt độ – NDVI – TVDI*, dải hiển thị chỉnh được (mặc định LST 25–45 °C) |
| Trình bày bản đồ | Tiêu đề bản đồ, mũi tên Bắc, lưới tọa độ kinh – vĩ độ (độ – phút), thước tỷ lệ, tọa độ con trỏ kèm giá trị chỉ số, chú giải thang màu liên tục + bảng phân cấp, làm mờ ngoài vùng nghiên cứu, toàn màn hình |
| Bản đồ nền | Nền sáng / nền tối (Esri), đường phố (OpenStreetMap, Google, Esri), ảnh vệ tinh (Google, Esri), vệ tinh + nhãn, địa hình (Google, Esri, OpenTopoMap), không dùng nền |
| Bản đồ 3D | Khối 3D phường/xã hoặc cột pixel ~2,2 km, chiều cao & màu theo chỉ số đang chọn, hệ số phóng đại, xoay tự động, nền đồng bộ với bản đồ 2D |
| Thời gian | Theo kỳ 15 ngày, trung bình tháng, trung bình năm, trung bình giai đoạn 2017–2025; animation theo kỳ / tháng / năm; dự báo AI theo ngày đến 31/12/2027 |
| Phường / Xã | Xếp hạng 167 phường, xã theo LST, NDVI, TVDI; lọc ngưỡng; tìm kiếm không dấu; xuất CSV |
| Biểu đồ | Dự báo 15 ngày, chuỗi lịch sử 2017–2025 (kèm dải P5 – P95), so sánh **thực tế vs AI** (R², RMSE, MAE), tam giác TVDI (không gian LST–NDVI với biên khô / biên ướt), histogram, Top 10 phường/xã, ma trận tương quan |
| Báo cáo & dữ liệu | Báo cáo in A4 / PDF, xuất CSV, xuất **GeoJSON** (mở trong QGIS/ArcGIS), API JSON/GeoJSON |
| Tài khoản | Đăng ký / đăng nhập, phân quyền Người dùng – Quản trị viên, nhật ký hoạt động, cấu hình GEE, huấn luyện lại mô hình |

> Lớp **Pixel** dùng ảnh Landsat 30 m trực tiếp từ Google Earth Engine khi máy chủ đã xác thực GEE; nếu chưa, hệ thống hiển thị bề mặt nội suy IDW (pixel ~275 m) từ lưới ô ~5,5 km lưu trong PostGIS. Mốc dự báo AI chỉ có chỉ số TVDI.

## 📁 Cấu trúc thư mục

```
PPNCKH/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI entry point (đồng bộ danh mục phường/xã khi khởi động)
│   │   ├── config.py            # Cấu hình (.env)
│   │   ├── database.py          # Kết nối PostgreSQL
│   │   ├── models.py            # SQLAlchemy / PostGIS models
│   │   ├── routers/
│   │   │   ├── tvdi.py          # API: lưới ô, trung bình theo khoảng, chuỗi thời gian, ranh giới, phường/xã
│   │   │   ├── stats.py         # API: thống kê & phân loại khô hạn
│   │   │   ├── prediction.py    # API: dự báo AI Random Forest
│   │   │   ├── gee.py           # API: tile ảnh Landsat từ Google Earth Engine
│   │   │   └── auth.py          # API: đăng nhập, phân quyền, quản trị
│   │   └── services/            # tvdi_service.py, gee_service.py
│   ├── models/                  # Mô hình Random Forest (.joblib) & chỉ số đánh giá
│   └── scripts/                 # Khởi tạo CSDL, nạp dữ liệu, huấn luyện & xử lý dự báo
├── frontend/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── app.js               # Luồng chính: dữ liệu, bản đồ 2D, thống kê, biểu đồ, phường/xã, tài khoản
│       ├── map-decor.js         # Bản đồ nền, lưới tọa độ, mũi tên Bắc, tiêu đề, chú giải
│       ├── map3d.js             # Bản đồ 3D (MapLibre GL)
│       └── analysis.js          # Tab "Biểu đồ" phân tích nâng cao
├── data/
│   ├── TVDI_TPHCM_grid_2017_2025.csv
│   ├── TVDI_TPHCM_series_2017_2025.csv
│   ├── TPHCM_chinh_xac/                         # Shapefile ranh giới toàn vùng
│   ├── tphcm_wards_boundaries.geojson           # Ranh giới 168 phường/xã 2025 (gốc)
│   ├── tphcm_wards_boundaries_simplified.geojson# Bản đơn giản hóa dùng cho web
│   └── tphcm_167_wards.json                     # Danh mục 167 phường/xã (sinh từ ranh giới 2025)
├── GEE_tphcm.docx, Thang màu Nhiệt độ-NDVI-TVDI.pdf, Nhóm_5__K13-CNTT6_PostGIS_RF.docx
├── .env.example
├── requirements.txt
├── start_server.bat
└── README.md
```

## 🚀 Hướng dẫn cài đặt (Windows)

### 1. Yêu cầu hệ thống

- **Python** ≥ 3.11
- **PostgreSQL** ≥ 16 kèm PostGIS
- Kết nối Internet (tải bản đồ nền và thư viện Leaflet / MapLibre / Chart.js từ CDN)

### 2. Tạo database

```sql
CREATE DATABASE tvdi_webgis;
-- Kết nối vào database vừa tạo, rồi chạy:
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE SCHEMA IF NOT EXISTS tvdi;
```

### 3. Cài thư viện Python & cấu hình

```powershell
pip install -r requirements.txt
copy .env.example .env      # rồi sửa DB_PASSWORD (và EE_PROJECT_ID nếu dùng GEE)
```

### 4. Khởi tạo CSDL & nạp dữ liệu

```powershell
python -m backend.scripts.init_db            # Bảng PostGIS
python -m backend.scripts.load_data          # Nạp CSV + shapefile, tạo đa giác ô lưới
python -m backend.scripts.init_wards         # Danh mục 167 phường/xã từ ranh giới 2025
python -m backend.scripts.init_users_table   # Tài khoản & nhật ký (admin/admin123, user/user123)
python -m backend.scripts.train_rf           # Huấn luyện Random Forest, ghi dự báo vào tvdi.tvdi_forecast
python -m backend.scripts.build_pixel_rasters --src "<thư mục data của WebGIS nhóm>"   # Ảnh pixel 120 m cho lớp "Pixel"
```

`build_pixel_rasters` đọc bộ ảnh PNG 8-bit theo tháng (`du_lieu_phuong.json` + `raster/`, sinh từ GeoTIFF GEE bằng `tao_du_lieu_webgis.py`) và ghi vào `frontend/data/raster/`: ảnh tháng, trung bình năm / giai đoạn và thành phần chi tiết không gian theo tháng. LST, NDVI hiển thị trực tiếp; TVDI của ảnh GEE dùng biên khô/ướt khác PostGIS nên chỉ lấy chi tiết 120 m cộng vào lưới của hệ thống (giữ khớp thống kê, xếp hạng và dự báo AI).

Các script `extend_forecast_2027.py`, `calibrate_forecasts.py`, `fix_all_forecast_nans.py`, `sync_15day_cycles.py` là các bước xử lý bổ sung chuỗi dự báo (mở rộng đến 2027, hiệu chuẩn phân phối, làm sạch NaN, đồng bộ chu kỳ 15 ngày) đã dùng để tạo dữ liệu dự báo hiện tại.

### 5. (Tùy chọn) Kết nối Google Earth Engine

```powershell
python -m ee.cli.eecli authenticate
```

Sau đó đăng nhập tài khoản Quản trị viên trên web → *Cấu hình Google Earth Engine* → nhập Project ID.

### 6. Chạy server

```powershell
python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
```

(hoặc chạy `start_server.bat`). Mở trình duyệt: **http://localhost:8000** – tài liệu API: **http://localhost:8000/docs**

## 🔌 API chính

| Endpoint | Mô tả |
|----------|-------|
| `GET /api/dates` | Các mốc quan trắc 2017–2025 |
| `GET /api/grid/{date}` | Lưới ô (GeoJSON) LST, NDVI, TVDI của một kỳ |
| `GET /api/grid/aggregate?start=&end=` | Trung bình LST, NDVI, TVDI theo khoảng thời gian (tháng / năm / giai đoạn) |
| `GET /api/series/overall`, `/api/series/{cell_id}` | Chuỗi thời gian toàn vùng (kèm P5 – P95) / theo ô |
| `GET /api/wards?date=&sort_by=&min_lst=…&start=&end=` | Xếp hạng & lọc 167 phường/xã |
| `GET /api/regions/boundary`, `/api/regions/wards-boundary` | Ranh giới toàn vùng / 168 phường, xã |
| `GET /api/prediction/grid/{date}`, `/api/prediction/series/…` | Dự báo AI Random Forest |
| `GET /api/gee/tile/{layer}/{date}?end=&vmin=&vmax=` | URL tile ảnh Landsat 30 m từ GEE (`layer`: lst, ndvi, tvdi) |

## 📊 Phân loại mức khô hạn TVDI (8 cấp)

| Khoảng TVDI | Mức độ |
|-------------|--------|
| 0.000 – 0.125 | Rất ẩm / Ngập nước |
| 0.125 – 0.250 | Ẩm ướt |
| 0.250 – 0.375 | Đủ ẩm, phát triển tốt |
| 0.375 – 0.500 | Bình thường |
| 0.500 – 0.625 | Bắt đầu khô hạn nhẹ |
| 0.625 – 0.750 | Hạn vừa |
| 0.750 – 0.875 | Hạn nặng |
| 0.875 – 1.000 | Hạn gay gắt / Khô khốc |

Vùng bị hạn: TVDI ≥ 0.625.

## 👥 Đơn vị phát triển & Vận hành

Hệ thống WebGIS Giám sát & Dự báo Khô hạn TVDI TP. Hồ Chí Minh
Trung tâm Ứng dụng Viễn thám & Hệ thống Thông tin Địa lý (GIS)
