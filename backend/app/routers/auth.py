"""
Module Phân quyền & Xác thực người dùng (Role-Based Access Control) & Quản trị Hệ thống.
- Người dùng thông thường (user): Đăng ký, đăng nhập, xem bản đồ, animation, tra cứu 167 phường, thống kê, xuất báo cáo.
- Quản trị viên (admin): Toàn quyền cấu hình Google Earth Engine (GEE), huấn luyện AI, quản lý danh sách user, audit log (nhật ký hành vi), khóa tài khoản, đổi mật khẩu giúp user.
"""
import base64
import hashlib
import hmac
import json
import time
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, Depends, HTTPException, Header, status, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..database import get_db

router = APIRouter(prefix="/api/auth", tags=["Xác thực & Phân quyền"])

SECRET_KEY = b"tvdi_webgis_secret_key_2026_hcm_secure"
TOKEN_EXPIRY_SECONDS = 86400 * 7  # 7 ngày

# Danh sách tài khoản mặc định (fallback in-memory)
USERS_DB = {
    "admin": {
        "password_hash": hashlib.sha256("admin123".encode()).hexdigest(),
        "role": "admin",
        "full_name": "Quản trị viên Hệ thống",
        "permissions": ["view", "stats", "export", "gee_manage", "ai_train", "system_admin"],
        "is_blocked": False
    },
    "user": {
        "password_hash": hashlib.sha256("user123".encode()).hexdigest(),
        "role": "user",
        "full_name": "Người dùng Mẫu",
        "permissions": ["view", "stats", "export"],
        "is_blocked": False
    },
}


def create_token(username: str, role: str) -> str:
    """Tạo chữ ký số token HMAC-SHA256."""
    payload = {
        "sub": username,
        "role": role,
        "exp": int(time.time()) + TOKEN_EXPIRY_SECONDS,
    }
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    sig = hmac.new(SECRET_KEY, raw, hashlib.sha256).hexdigest()
    token_str = f"{base64.urlsafe_b64encode(raw).decode('utf-8')}.{sig}"
    return token_str


def decode_token(token_str: str) -> Optional[Dict[str, Any]]:
    """Giải mã và xác thực token."""
    try:
        parts = token_str.strip().split(".")
        if len(parts) != 2:
            return None
        raw = base64.urlsafe_b64decode(parts[0].encode("utf-8"))
        expected_sig = hmac.new(SECRET_KEY, raw, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected_sig, parts[1]):
            return None
        payload = json.loads(raw.decode("utf-8"))
        if payload.get("exp", 0) < int(time.time()):
            return None
        return payload
    except Exception:
        return None


def record_activity(db: Session, username: str, action: str, details: str = "", ip_address: Optional[str] = None):
    """Ghi nhận nhật ký hành động người dùng vào tvdi.user_activities."""
    if db is None:
        return
    try:
        db.execute(
            text("""
                INSERT INTO tvdi.user_activities (username, action, details, ip_address, created_at)
                VALUES (:u, :a, :d, :ip, CURRENT_TIMESTAMP)
            """),
            {"u": username, "a": action, "d": details, "ip": ip_address or "127.0.0.1"}
        )
        db.commit()
    except Exception:
        db.rollback()


def find_user_record(username: str, db: Optional[Session] = None) -> Optional[Dict[str, Any]]:
    """Tìm thông tin user từ PostgreSQL tvdi.users hoặc USERS_DB."""
    u_clean = username.strip().lower()
    if db is not None:
        try:
            row = db.execute(
                text("""
                    SELECT username, password_hash, full_name, role, 
                           COALESCE(is_blocked, FALSE) AS is_blocked,
                           last_login, created_at
                    FROM tvdi.users 
                    WHERE LOWER(username) = LOWER(:u) LIMIT 1
                """),
                {"u": u_clean}
            ).fetchone()
            if row:
                r_role = row[3]
                perms = ["view", "stats", "export", "gee_manage", "ai_train", "system_admin"] if r_role == "admin" else ["view", "stats", "export"]
                return {
                    "username": row[0],
                    "password_hash": row[1],
                    "full_name": row[2],
                    "role": r_role,
                    "permissions": perms,
                    "is_blocked": bool(row[4]),
                    "last_login": row[5].strftime("%d/%m/%Y %H:%M") if row[5] else None,
                    "created_at": row[6].strftime("%d/%m/%Y %H:%M") if row[6] else None,
                }
        except Exception:
            pass

    fallback = USERS_DB.get(u_clean)
    if fallback:
        return {
            **fallback,
            "username": u_clean,
            "is_blocked": fallback.get("is_blocked", False),
            "last_login": fallback.get("last_login"),
            "created_at": None,
        }
    return None


def get_current_user(authorization: Optional[str] = Header(None), db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Dependency: lấy thông tin user hiện tại từ Bearer token."""
    if not authorization:
        return {
            "username": "guest",
            "role": "guest",
            "full_name": "Người dùng",
            "is_admin": False,
            "permissions": ["view", "stats", "export"],
        }
    
    parts = authorization.strip().split()
    token = parts[1] if len(parts) == 2 and parts[0].lower() == "bearer" else parts[0]
    payload = decode_token(token)
    if not payload:
        return {
            "username": "guest",
            "role": "guest",
            "full_name": "Người dùng",
            "is_admin": False,
            "permissions": ["view", "stats", "export"],
        }
    
    username = payload.get("sub", "guest")
    user_info = find_user_record(username, db) or {}
    
    # Kiểm tra xem user có bị Admin chặn không
    if user_info.get("is_blocked"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tài khoản của bạn đã bị khóa bởi Quản trị viên."
        )

    role = user_info.get("role", payload.get("role", "user"))
    return {
        "username": username,
        "role": role,
        "full_name": user_info.get("full_name", username),
        "is_admin": role == "admin",
        "is_blocked": user_info.get("is_blocked", False),
        "permissions": user_info.get("permissions", ["view", "stats", "export"]),
    }


def require_admin(current_user: Dict[str, Any] = Depends(get_current_user)):
    """Dependency bảo vệ các chức năng quản trị, yêu cầu quyền admin."""
    if not current_user.get("is_admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Truy cập bị từ chối: Chức năng này yêu cầu quyền Quản trị viên (Admin)!"
        )
    return current_user


# ---- Request / Response Schemas ----
class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str
    password: str
    full_name: Optional[str] = None


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


class AdminResetPasswordRequest(BaseModel):
    username: str
    new_password: str


class ToggleBlockRequest(BaseModel):
    username: str
    blocked: bool


class ActivityLogRequest(BaseModel):
    action: str
    details: Optional[str] = ""


class LoginResponse(BaseModel):
    success: bool
    message: str
    token: Optional[str] = None
    role: str
    full_name: str
    permissions: List[str]


# ---- Endpoints ----

@router.post("/register", response_model=LoginResponse)
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    """Đăng ký tài khoản người dùng mới (User)."""
    uname = req.username.strip().lower()
    if len(uname) < 3 or len(uname) > 30:
        raise HTTPException(status_code=400, detail="Tên đăng nhập phải có từ 3 đến 30 ký tự.")
    if not req.password or len(req.password) < 6:
        raise HTTPException(status_code=400, detail="Mật khẩu phải có ít nhất 6 ký tự.")
    
    # Kiểm tra trùng lặp
    existing = find_user_record(uname, db)
    if existing:
        raise HTTPException(status_code=400, detail="Tên đăng nhập này đã tồn tại trên hệ thống. Vui lòng chọn tên khác.")
    
    pwd_hash = hashlib.sha256(req.password.strip().encode()).hexdigest()
    full_name = (req.full_name or uname).strip()
    if not full_name:
        full_name = uname

    try:
        db.execute(
            text("""
                INSERT INTO tvdi.users (username, password_hash, full_name, role, is_blocked, last_login)
                VALUES (:u, :p, :f, 'user', FALSE, CURRENT_TIMESTAMP)
            """),
            {"u": uname, "p": pwd_hash, "f": full_name}
        )
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Lỗi khi lưu tài khoản vào cơ sở dữ liệu: {str(e)}")

    record_activity(db, uname, "Đăng ký tài khoản", f"Đăng ký tài khoản mới thành công (Họ tên: {full_name})")

    token = create_token(uname, "user")
    return LoginResponse(
        success=True,
        message=f"Đăng ký tài khoản thành công! Chào mừng {full_name} đến với hệ thống WebGIS.",
        token=token,
        role="user",
        full_name=full_name,
        permissions=["view", "stats", "export"]
    )


@router.post("/login", response_model=LoginResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)):
    """Đăng nhập hệ thống (cho cả Người dùng và Quản trị viên)."""
    uname = req.username.strip().lower()
    user_record = find_user_record(uname, db)
    if not user_record:
        record_activity(db, uname, "Đăng nhập thất bại", "Tên đăng nhập không tồn tại")
        raise HTTPException(status_code=400, detail="Tên đăng nhập hoặc mật khẩu không chính xác.")
    
    # Kiểm tra xem tài khoản có bị khóa không
    if user_record.get("is_blocked"):
        record_activity(db, uname, "Đăng nhập bị từ chối", "Tài khoản đang bị khóa cố gắng đăng nhập")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tài khoản này đã bị Quản trị viên khóa. Vui lòng liên hệ ban quản trị để được mở lại."
        )

    input_hash = hashlib.sha256(req.password.strip().encode()).hexdigest()
    if input_hash != user_record["password_hash"]:
        record_activity(db, uname, "Đăng nhập thất bại", "Sai mật khẩu")
        raise HTTPException(status_code=400, detail="Tên đăng nhập hoặc mật khẩu không chính xác.")
    
    # Cập nhật thời gian đăng nhập gần nhất
    try:
        db.execute(
            text("UPDATE tvdi.users SET last_login = CURRENT_TIMESTAMP WHERE LOWER(username) = LOWER(:u)"),
            {"u": uname}
        )
        db.commit()
    except Exception:
        db.rollback()

    role_label = "Quản trị viên" if user_record["role"] == "admin" else "Người dùng"
    record_activity(db, user_record["username"], "Đăng nhập hệ thống", f"Đăng nhập phiên {role_label} thành công")

    token = create_token(user_record["username"], user_record["role"])
    return LoginResponse(
        success=True,
        message=f"Đăng nhập thành công với vai trò {role_label} ({user_record['full_name']})!",
        token=token,
        role=user_record["role"],
        full_name=user_record["full_name"],
        permissions=user_record["permissions"],
    )


@router.get("/me")
def get_me(user: Dict[str, Any] = Depends(get_current_user)):
    """Lấy thông tin và quyền hạn của phiên làm việc hiện tại."""
    return user


@router.post("/change-password")
def change_password(req: ChangePasswordRequest, current_user: Dict[str, Any] = Depends(get_current_user), db: Session = Depends(get_db)):
    """Đổi mật khẩu người dùng."""
    if not current_user or current_user.get("role") == "guest":
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập để thực hiện đổi mật khẩu.")
    if len(req.new_password.strip()) < 6:
        raise HTTPException(status_code=400, detail="Mật khẩu mới phải có ít nhất 6 ký tự.")
    
    old_hash = hashlib.sha256(req.old_password.strip().encode()).hexdigest()
    user_record = find_user_record(current_user["username"], db)
    if not user_record or user_record["password_hash"] != old_hash:
        raise HTTPException(status_code=400, detail="Mật khẩu hiện tại không chính xác.")
    
    new_hash = hashlib.sha256(req.new_password.strip().encode()).hexdigest()
    if db is not None:
        try:
            db.execute(
                text("UPDATE tvdi.users SET password_hash = :p WHERE LOWER(username) = LOWER(:u)"),
                {"p": new_hash, "u": current_user["username"]}
            )
            db.commit()
        except Exception as e:
            db.rollback()
            raise HTTPException(status_code=500, detail=f"Lỗi cơ sở dữ liệu: {str(e)}")
            
    if current_user["username"].lower() in USERS_DB:
        USERS_DB[current_user["username"].lower()]["password_hash"] = new_hash
        
    record_activity(db, current_user["username"], "Đổi mật khẩu", "Người dùng tự cập nhật mật khẩu thành công")
    return {"success": True, "message": "Đổi mật khẩu thành công! Vui lòng ghi nhớ mật khẩu mới."}


@router.post("/logout")
def logout(current_user: Dict[str, Any] = Depends(get_current_user), db: Session = Depends(get_db)):
    """Đăng xuất khỏi hệ thống."""
    if current_user.get("role") != "guest":
        record_activity(db, current_user.get("username", "guest"), "Đăng xuất", "Người dùng đã kết thúc phiên làm việc")
    return {"success": True, "message": "Đã đăng xuất thành công."}


@router.post("/log-activity")
def log_activity_from_client(
    req: ActivityLogRequest,
    current_user: Dict[str, Any] = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Ghi nhận hành động tương tác của người dùng từ giao diện Web."""
    uname = current_user.get("username", "guest")
    record_activity(db, uname, req.action, req.details or "")
    return {"success": True}


# ---- CHỨC NĂNG QUẢN TRỊ VIÊN (ADMIN ONLY) ----

@router.get("/admin/users")
def get_all_users_for_admin(
    admin_user: Dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Quản trị viên xem toàn bộ danh sách người dùng đã đăng ký vào web."""
    sql = text("""
        SELECT 
            u.id, 
            u.username, 
            u.full_name, 
            u.role, 
            COALESCE(u.is_blocked, FALSE) AS is_blocked,
            u.created_at, 
            u.last_login,
            COUNT(a.id) AS activity_count
        FROM tvdi.users u
        LEFT JOIN tvdi.user_activities a ON LOWER(a.username) = LOWER(u.username)
        GROUP BY u.id, u.username, u.full_name, u.role, u.is_blocked, u.created_at, u.last_login
        ORDER BY u.created_at DESC NULLS LAST, u.id DESC;
    """)
    rows = db.execute(sql).fetchall()
    users = []
    for r in rows:
        users.append({
            "id": r[0],
            "username": r[1],
            "full_name": r[2],
            "role": r[3],
            "is_blocked": bool(r[4]),
            "created_at": r[5].strftime("%d/%m/%Y %H:%M") if r[5] else "Khởi tạo ban đầu",
            "last_login": r[6].strftime("%d/%m/%Y %H:%M") if r[6] else "Chưa đăng nhập",
            "activity_count": r[7]
        })
    return {"success": True, "users": users, "total": len(users)}


@router.post("/admin/toggle-block")
def admin_toggle_block_user(
    req: ToggleBlockRequest,
    admin_user: Dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Quản trị viên khóa hoặc mở khóa tài khoản người dùng."""
    target_uname = req.username.strip().lower()
    if target_uname == admin_user["username"].lower():
        raise HTTPException(status_code=400, detail="Bạn không thể tự khóa tài khoản của chính mình!")
    if target_uname == "admin":
        raise HTTPException(status_code=400, detail="Không thể khóa tài khoản Quản trị viên cấp cao nhất (admin)!")

    # Cập nhật trong DB
    db.execute(
        text("UPDATE tvdi.users SET is_blocked = :b WHERE LOWER(username) = LOWER(:u)"),
        {"b": req.blocked, "u": target_uname}
    )
    db.commit()

    if target_uname in USERS_DB:
        USERS_DB[target_uname]["is_blocked"] = req.blocked

    status_text = "khóa" if req.blocked else "mở khóa"
    record_activity(
        db, admin_user["username"], f"Admin: {status_text.capitalize()} tài khoản",
        f"Quản trị viên đã {status_text} quyền truy cập của người dùng '{target_uname}'"
    )
    return {
        "success": True,
        "message": f"Đã {status_text} tài khoản '{target_uname}' thành công!",
        "username": target_uname,
        "is_blocked": req.blocked
    }


@router.post("/admin/reset-password")
def admin_reset_user_password(
    req: AdminResetPasswordRequest,
    admin_user: Dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Quản trị viên đổi mật khẩu giúp người dùng."""
    target_uname = req.username.strip().lower()
    if len(req.new_password.strip()) < 6:
        raise HTTPException(status_code=400, detail="Mật khẩu mới phải có ít nhất 6 ký tự.")

    user_record = find_user_record(target_uname, db)
    if not user_record:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy tài khoản '{target_uname}'!")

    new_hash = hashlib.sha256(req.new_password.strip().encode()).hexdigest()
    db.execute(
        text("UPDATE tvdi.users SET password_hash = :p WHERE LOWER(username) = LOWER(:u)"),
        {"p": new_hash, "u": target_uname}
    )
    db.commit()

    if target_uname in USERS_DB:
        USERS_DB[target_uname]["password_hash"] = new_hash

    record_activity(
        db, admin_user["username"], "Admin: Đổi mật khẩu",
        f"Quản trị viên đã đổi mật khẩu mới cho tài khoản '{target_uname}'"
    )
    return {
        "success": True,
        "message": f"Đã cập nhật mật khẩu mới cho tài khoản '{target_uname}' thành công!"
    }


@router.get("/admin/activities")
def admin_get_user_activities(
    username: Optional[str] = None,
    limit: int = 150,
    admin_user: Dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Quản trị viên xem nhật ký hành động (Audit log) của toàn bộ hoặc từng người dùng."""
    if username and username.strip() and username.strip().lower() != "all":
        sql = text("""
            SELECT id, username, action, details, ip_address, created_at
            FROM tvdi.user_activities
            WHERE LOWER(username) = LOWER(:u)
            ORDER BY created_at DESC
            LIMIT :lim;
        """)
        rows = db.execute(sql, {"u": username.strip().lower(), "lim": limit}).fetchall()
    else:
        sql = text("""
            SELECT id, username, action, details, ip_address, created_at
            FROM tvdi.user_activities
            ORDER BY created_at DESC
            LIMIT :lim;
        """)
        rows = db.execute(sql, {"lim": limit}).fetchall()

    activities = []
    for r in rows:
        activities.append({
            "id": r[0],
            "username": r[1],
            "action": r[2],
            "details": r[3] or "",
            "ip_address": r[4] or "127.0.0.1",
            "created_at": r[5].strftime("%d/%m/%Y %H:%M:%S") if r[5] else ""
        })
    return {"success": True, "activities": activities, "total": len(activities)}
