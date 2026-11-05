"""
Script hỗ trợ nạp CSDL lên Supabase an toàn và tự động xử lý chuỗi kết nối.
"""
import sys
import os
import subprocess
from pathlib import Path

# Đảm bảo UTF-8 cho console Windows
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding='utf-8')

ROOT_DIR = Path(__file__).resolve().parent
SQL_FILE = ROOT_DIR / "data" / "tvdi_backup.sql"
PSQL_PATH = r"C:\Program Files\PostgreSQL\18\bin\psql.exe"

print("=" * 65)
print("   CÔNG CỤ NẠP CƠ SỞ DỮ LIỆU POSTGIS LÊN SUPABASE")
print("=" * 65)
print()

if not SQL_FILE.exists():
    print(f"[LỖI] Không tìm thấy file dữ liệu: {SQL_FILE}")
    input("\nNhấn Enter để thoát...")
    sys.exit(1)

if not os.path.exists(PSQL_PATH):
    print(f"[LỖI] Không tìm thấy psql.exe tại: {PSQL_PATH}")
    input("\nNhấn Enter để thoát...")
    sys.exit(1)

print("Ví dụ đường link hợp lệ:")
print("postgresql://postgres:matkhau@db.axymtpdoiqkxogouivss.supabase.co:5432/postgres")
print()

url = input("Dán đường link Supabase của bạn vào đây rồi bấm Enter:\n> ").strip()

# Tự động loại bỏ dấu ngoặc kép hoặc ngoặc đơn nếu có
url = url.strip('"').strip("'")

# Tự động sửa nếu người dùng còn giữ dấu ngoặc vuông quanh mật khẩu: postgres:[mypass]@
import re
match = re.search(r"://([^:]+):\[([^\]]+)\]@", url)
if match:
    user, pwd = match.group(1), match.group(2)
    url = url.replace(f"://{user}:[{pwd}]@", f"://{user}:{pwd}@")
    print("\n[THÔNG BÁO] Đã tự động loại bỏ dấu ngoặc vuông [ ] trong mật khẩu của bạn.")

if not url.startswith("postgresql://") and not url.startswith("postgres://"):
    print("\n[LỖI] Đường link không hợp lệ (phải bắt đầu bằng postgresql://)")
    input("\nNhấn Enter để thoát...")
    sys.exit(1)

print("\n" + "-" * 65)
print("[1/2] Đang kích hoạt extension PostGIS trên Supabase...")
try:
    cmd_ext = [PSQL_PATH, url, "-c", "CREATE EXTENSION IF NOT EXISTS postgis;"]
    res1 = subprocess.run(cmd_ext, capture_output=True, text=True)
    if res1.returncode != 0:
        print("\n[LỖI KẾT NỐI] Không thể kết nối tới Supabase:")
        print(res1.stderr)
        print("\nVui lòng kiểm tra lại mật khẩu hoặc đường link của bạn.")
        input("\nNhấn Enter để thoát...")
        sys.exit(1)
    print("-> Kích hoạt PostGIS thành công!")
except Exception as e:
    print(f"[LỖI] {e}")
    input("\nNhấn Enter để thoát...")
    sys.exit(1)

print("\n[2/2] Đang nạp 158.000+ bản ghi dữ liệu lên Supabase...")
print("Quá trình này mất khoảng 1 - 2 phút, vui lòng không tắt cửa sổ...")
try:
    cmd_import = [PSQL_PATH, url, "-f", str(SQL_FILE)]
    res2 = subprocess.run(cmd_import, capture_output=True, text=True)
    if res2.returncode != 0:
        print("\n[CẢNH BÁO / LỖI]:")
        print(res2.stderr[:500])
    else:
        print("-> Nạp dữ liệu hoàn tất 100%!")
except Exception as e:
    print(f"[LỖI] {e}")
    input("\nNhấn Enter để thoát...")
    sys.exit(1)

print("\n" + "=" * 65)
print("  HOÀN THÀNH ĐỒNG BỘ CSDL LÊN SUPABASE THÀNH CÔNG!")
print("=" * 65)
input("\nNhấn Enter để hoàn tất...")
