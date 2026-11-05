@echo off
chcp 65001 >nul
cd /d "%~dp0"
python push_db_to_supabase.py
if errorlevel 1 pause
