@echo off
title Dat lai mat khau PostgreSQL cho He thong WebGIS

:: Kiem tra quyen Admin
net session >nul 2>&1
if %errorLevel% NEQ 0 (
    echo Dang mo hop thoai yeu cau quyen Administrator...
    powershell -Command "Start-Process cmd -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)

echo ========================================================
echo DANG DAT LAI MAT KHAU POSTGRESQL CHO HE THONG
echo ========================================================
powershell -ExecutionPolicy Bypass -File "%~dp0backend\scripts\reset_pg_password.ps1"

echo.
pause
