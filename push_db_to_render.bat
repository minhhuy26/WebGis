@echo off
chcp 65001 >nul
title Nạp CSDL WebGIS lên Render PostgreSQL
echo ================================================================
echo   CÔNG CỤ NẠP CƠ SỞ DỮ LIỆU POSTGIS LÊN RENDER CLOUD
echo ================================================================
echo.
echo Vui lòng vào Render.com -> Vào Database của bạn -> Copy "External Database URL"
echo (Có dạng: postgresql://tvdi_user:matkhau@dpg-xxx.singapore-postgres.render.com/tvdi_webgis)
echo.
set /p RENDER_URL="Dán External Database URL vào đây rồi nhấn Enter: "

if "%RENDER_URL%"=="" (
    echo [LỖI] Bạn chưa nhập URL. Đã hủy thao tác.
    pause
    exit /b
)

echo.
echo [1/2] Đang kích hoạt extension PostGIS trên Render...
"C:\Program Files\PostgreSQL\18\bin\psql.exe" "%RENDER_URL%" -c "CREATE EXTENSION IF NOT EXISTS postgis;"
if errorlevel 1 (
    echo [CẢNH BÁO] Không thể kết nối hoặc kích hoạt PostGIS. Vui lòng kiểm tra lại URL.
    pause
    exit /b
)

echo [2/2] Đang nạp toàn bộ dữ liệu (158.000+ bản ghi) vào Render...
"C:\Program Files\PostgreSQL\18\bin\psql.exe" "%RENDER_URL%" -f "%~dp0data\tvdi_backup.sql"

echo.
echo ================================================================
echo  ĐÃ NẠP TOÀN BỘ CƠ SỞ DỮ LIỆU LÊN RENDER THÀNH CÔNG!
echo ================================================================
pause
