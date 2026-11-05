"""
init_db.py – Tạo database, bật PostGIS, tạo schema và bảng.

Chạy: python -m backend.scripts.init_db
"""
import sys
from pathlib import Path

# Thêm thư mục gốc dự án vào sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from sqlalchemy import text, inspect
from backend.app.config import settings
from backend.app.database import engine, Base
from backend.app.models import TvdiGrid, TvdiSeries, Region, GridCell, TvdiForecast  # noqa: F401


def create_database_if_not_exists():
    """Tạo database nếu chưa tồn tại (kết nối vào 'postgres' trước)."""
    from sqlalchemy import create_engine as ce

    admin_url = (
        f"postgresql+psycopg2://{settings.DB_USER}:{settings.DB_PASSWORD}"
        f"@{settings.DB_HOST}:{settings.DB_PORT}/postgres"
    )
    tmp_engine = ce(admin_url, isolation_level="AUTOCOMMIT")
    with tmp_engine.connect() as conn:
        exists = conn.execute(
            text("SELECT 1 FROM pg_database WHERE datname = :db"),
            {"db": settings.DB_NAME},
        ).fetchone()
        if not exists:
            conn.execute(text(f'CREATE DATABASE "{settings.DB_NAME}"'))
            print(f"[OK] Đã tạo database: {settings.DB_NAME}")
        else:
            print(f"[OK] Database đã tồn tại: {settings.DB_NAME}")
    tmp_engine.dispose()


def enable_postgis():
    """Bật extension PostGIS trong database."""
    with engine.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
        conn.commit()
        print("[OK] PostGIS extension đã được bật")


def create_schema():
    """Tạo schema 'tvdi' nếu chưa có."""
    with engine.connect() as conn:
        conn.execute(text("CREATE SCHEMA IF NOT EXISTS tvdi"))
        conn.commit()
        print("[OK] Schema 'tvdi' đã sẵn sàng")


def create_tables():
    """Tạo tất cả bảng từ SQLAlchemy models."""
    Base.metadata.create_all(bind=engine)
    # Kiểm tra bảng đã tạo
    inspector = inspect(engine)
    tables = inspector.get_table_names(schema="tvdi")
    print(f"[OK] Các bảng trong schema 'tvdi': {tables}")


def main():
    print("=" * 60)
    print("KHỞI TẠO CƠ SỞ DỮ LIỆU POSTGIS")
    print("=" * 60)
    print(f"  Host:     {settings.DB_HOST}:{settings.DB_PORT}")
    print(f"  Database: {settings.DB_NAME}")
    print(f"  User:     {settings.DB_USER}")
    print()

    try:
        create_database_if_not_exists()
        enable_postgis()
        create_schema()
        create_tables()
        print()
        print("[HOÀN TẤT] Cơ sở dữ liệu đã sẵn sàng!")
    except Exception as e:
        print(f"\n[LỖI] {e}")
        print("\nKiểm tra lại:")
        print("  1. PostgreSQL có đang chạy không?")
        print("  2. Thông tin kết nối trong .env có đúng không?")
        print("  3. PostGIS extension đã được cài chưa?")
        sys.exit(1)


if __name__ == "__main__":
    main()
