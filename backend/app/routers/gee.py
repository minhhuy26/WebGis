"""
Router API cho Google Earth Engine (GEE).
Cung cấp tile URL trực tiếp từ vệ tinh Landsat 8/9 cho bản đồ Leaflet.
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel

from ..database import get_db
from ..services import gee_service
from ..config import settings
from .auth import require_admin

router = APIRouter(prefix="/api/gee", tags=["Google Earth Engine"])


class ProjectRequest(BaseModel):
    project_id: str


@router.get("/status")
def get_status():
    """Lấy trạng thái kết nối và cấu hình Google Earth Engine."""
    return gee_service.get_gee_status()


@router.post("/set-project")
def set_project(req: ProjectRequest, admin_user=Depends(require_admin)):
    """Cập nhật Google Cloud / Earth Engine Project ID (Chỉ Admin)."""
    success = gee_service.set_project(req.project_id)
    return {
        "success": success,
        "project_id": req.project_id,
        "status": gee_service.get_gee_status(),
    }


@router.get("/tile/{layer_type}/{date_str}")
def get_tile(
    layer_type: str,
    date_str: str,
    end: Optional[str] = Query(None, description="Ngày kết thúc khi ghép ảnh theo khoảng (YYYY-MM-DD); mặc định +15 ngày"),
    vmin: Optional[float] = Query(None, description="Giá trị nhỏ nhất của thang màu"),
    vmax: Optional[float] = Query(None, description="Giá trị lớn nhất của thang màu"),
    db: Session = Depends(get_db),
):
    """
    Lấy template URL XYZ Tile từ Earth Engine cho một lớp ảnh (tvdi, lst, ndvi) và mốc ngày (YYYY-MM-DD).
    Ví dụ kết quả: https://earthengine.googleapis.com/v1/projects/.../maps/.../tiles/{z}/{x}/{y}
    """
    layer_type = layer_type.lower()
    if layer_type not in ["tvdi", "lst", "ndvi"]:
        raise HTTPException(
            status_code=400,
            detail=f"Lớp '{layer_type}' không hợp lệ. Chỉ hỗ trợ 'tvdi', 'lst', 'ndvi'."
        )
    for value in (date_str, end):
        if value is None:
            continue
        try:
            datetime.strptime(value, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Ngày '{value}' phải có định dạng YYYY-MM-DD.")
    if vmin is not None and vmax is not None and vmin >= vmax:
        raise HTTPException(status_code=400, detail="vmin phải nhỏ hơn vmax.")

    try:
        tile_url = gee_service.get_tile_url_for_date(db, layer_type, date_str, end_date_str=end, vmin=vmin, vmax=vmax)
        if not tile_url:
            status = gee_service.get_gee_status()
            raise HTTPException(
                status_code=503,
                detail={
                    "message": "Google Earth Engine chưa được xác thực trên máy chủ.",
                    "status": status
                }
            )
        return {
            "status": "success",
            "layer": layer_type,
            "date": date_str,
            "tile_url": tile_url,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi xử lý GEE: {str(e)}")
