"""
Router – API endpoints cho thống kê theo khu vực và phân loại mức khô hạn.
"""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..services import tvdi_service

router = APIRouter()


@router.get("/stats/drought-classes")
def list_drought_classes():
    """Trả về bảng phân loại 8 cấp độ khô hạn TVDI kèm mô tả và mã màu chuẩn."""
    return settings.TVDI_CLASSES


@router.get("/stats/summary")
@router.get("/stats/summary/{date}")
def get_stats_summary(
    date: str,
    db: Session = Depends(get_db),
):
    """
    Thống kê phân loại mức khô hạn cho một ngày được chọn:
    - Số lượng ô và tỷ lệ % theo từng cấp độ khô hạn
    - LST, NDVI, TVDI trung bình, cực tiểu, cực đại toàn vùng
    """
    try:
        norm_date = datetime.strptime(date, "%Y-%m-%d").strftime("%Y-%m-%d")
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=400,
            detail=f"Tham số 'date' phải có định dạng YYYY-MM-DD (nhận được: {date}).",
        )
    return tvdi_service.get_drought_statistics(db, norm_date)
