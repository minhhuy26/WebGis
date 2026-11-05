"""
init_users_table.py – Tạo bảng tài khoản tvdi.users và nhật ký hoạt động tvdi.user_activities
(phục vụ đăng nhập, phân quyền và audit log), kèm 2 tài khoản mặc định admin/admin123 và user/user123.

Kết nối CSDL lấy từ file .env (giống backend). Chạy: python -m backend.scripts.init_users_table
"""
import sys
import hashlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from sqlalchemy import text
from backend.app.database import engine


def init_users_table():
    admin_hash = hashlib.sha256("admin123".encode()).hexdigest()
    user_hash = hashlib.sha256("user123".encode()).hexdigest()

    with engine.begin() as conn:
        conn.execute(text("CREATE SCHEMA IF NOT EXISTS tvdi"))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS tvdi.users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password_hash VARCHAR(128) NOT NULL,
                full_name VARCHAR(100) NOT NULL,
                role VARCHAR(20) NOT NULL DEFAULT 'user',
                is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
                last_login TIMESTAMP WITH TIME ZONE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        """))
        # Bổ sung cột cho các CSDL đã tạo bằng phiên bản script cũ
        conn.execute(text("ALTER TABLE tvdi.users ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT FALSE"))
        conn.execute(text("ALTER TABLE tvdi.users ADD COLUMN IF NOT EXISTS last_login TIMESTAMP WITH TIME ZONE"))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS tvdi.user_activities (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) NOT NULL,
                action VARCHAR(120) NOT NULL,
                details TEXT,
                ip_address VARCHAR(64),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_user_activities_username ON tvdi.user_activities (username)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_user_activities_created ON tvdi.user_activities (created_at DESC)"))

        conn.execute(text("""
            INSERT INTO tvdi.users (username, password_hash, full_name, role)
            VALUES ('admin', :h, 'Quản trị viên Hệ thống', 'admin')
            ON CONFLICT (username) DO NOTHING;
        """), {"h": admin_hash})
        conn.execute(text("""
            INSERT INTO tvdi.users (username, password_hash, full_name, role)
            VALUES ('user', :h, 'Người dùng Mẫu', 'user')
            ON CONFLICT (username) DO NOTHING;
        """), {"h": user_hash})

        rows = conn.execute(text("SELECT id, username, full_name, role FROM tvdi.users ORDER BY id")).fetchall()
    print("[OK] Bảng tvdi.users và tvdi.user_activities đã sẵn sàng.")
    print("Tài khoản trong CSDL:", [tuple(r) for r in rows])


if __name__ == "__main__":
    init_users_table()
