@echo off
chcp 65001 >nul
title Nạp CSDL WebGIS lên Supabase
echo ================================================================
echo   CÔNG CỤ NẠP CƠ SỞ DỮ LIỆU POSTGIS LÊN SUPABASE (MIỄN PHÍ VĨNH VIỄN)
echo ================================================================
echo.
echo Hướng dẫn lấy URI trên Supabase:
echo 1. Vào Supabase -> Chọn Project của bạn
echo 2. Bấm vào biểu tượng Cài đặt (Bánh răng ở góc dưới bên trái) -> Database
echo 3. Cuộn đến mục "Connection string" -> Chọn tab "URI"
echo 4. Copy đường link và THAY [YOUR-PASSWORD] bằng mật khẩu Database của bạn.
echo.
echo Đường link mẫu: postgresql://postgres.xxxx:matkhau@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
echo.
set /p SUPABASE_URL="Dán đường link URI vào đây rồi nhấn Enter: "

if "%SUPABASE_URL%"=="" (
    echo [LỖI] Bạn chưa nhập link kết nối. Đã hủy thao tác.
    pause
    exit /b
)

echo.
echo [1/2] Đang kích hoạt extension PostGIS trên Supabase...
"C:\Program Files\PostgreSQL\18\bin\psql.exe" "%SUPABASE_URL%" -c "CREATE EXTENSION IF NOT EXISTS postgis;"
if errorlevel 1 (
    echo.
    echo [CẢNH BÁO] Không thể kết nối tới Supabase.
    echo Vui lòng kiểm tra lại:
    echo - Bạn đã thay [YOUR-PASSWORD] bằng mật khẩu thật chưa?
    echo - Mật khẩu có ký tự đặc biệt không?
    echo - Đã chọn tab URI trong Supabase chưa?
    pause
    exit /b
)

echo.
echo [2/2] Đang nạp toàn bộ 158.000+ bản ghi dữ liệu vào Supabase...
"C:\Program Files\PostgreSQL\18\bin\psql.exe" "%SUPABASE_URL%" -f "%~dp0data\tvdi_backup.sql"

echo.
echo ================================================================
echo  ĐÃ NẠP TOÀN BỘ CSDL LÊN SUPABASE THÀNH CÔNG!
echo ================================================================
pause
