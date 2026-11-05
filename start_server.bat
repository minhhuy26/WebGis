@echo off
chcp 65001 >nul
title WebGIS TVDI TP.HCM - Server
echo ================================================================
echo   HỆ THỐNG WEBGIS GIÁM SÁT HẠN HÁN TVDI - TP. HỒ CHÍ MINH
echo   Tích hợp PostGIS & Google Earth Engine
echo ================================================================
echo.
echo Đang khởi động máy chủ tại: http://localhost:8000
echo Bạn có thể truy cập bằng trình duyệt web.
echo Nhấn Ctrl + C để dừng máy chủ khi không sử dụng.
echo.
python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
pause
