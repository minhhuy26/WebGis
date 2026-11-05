"""
Router – API endpoints cho dữ liệu TVDI (grid, series, boundary).
"""
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..services import tvdi_service

router = APIRouter()


def _validate_date(value: str, field: str = "date") -> str:
    """Kiểm tra chuỗi ngày đúng định dạng YYYY-MM-DD, trả về lỗi 400 nếu sai."""
    try:
        return datetime.strptime(value, "%Y-%m-%d").strftime("%Y-%m-%d")
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"Tham số '{field}' phải có định dạng YYYY-MM-DD (nhận được: {value}).")


@router.get("/dates")
@router.get("/grid/dates")
def list_dates(db: Session = Depends(get_db)):
    """Danh sách tất cả các mốc thời gian có dữ liệu (2017–2025)."""
    dates = tvdi_service.get_available_dates(db)
    return dates


@router.get("/grid/aggregate")
def get_grid_aggregate(
    start: str = Query(..., description="Ngày bắt đầu (YYYY-MM-DD)"),
    end: str = Query(..., description="Ngày kết thúc (YYYY-MM-DD)"),
    db: Session = Depends(get_db),
):
    """
    Trung bình LST, NDVI, TVDI theo ô lưới trong một khoảng thời gian
    (tổng hợp theo tháng, theo năm hoặc toàn giai đoạn 2017–2025) dưới dạng GeoJSON.
    """
    start = _validate_date(start, "start")
    end = _validate_date(end, "end")
    if start > end:
        raise HTTPException(status_code=400, detail="Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.")
    return tvdi_service.get_grid_aggregate(db, start, end)


@router.get("/grid/{date}")
def get_grid_by_date(date: str, db: Session = Depends(get_db)):
    """
    Lấy dữ liệu TVDI theo ô lưới (~5.5 km) cho một ngày dưới dạng GeoJSON FeatureCollection.
    Bao gồm Polygon, chỉ số LST, NDVI, TVDI, cấp độ hạn và mã màu.
    """
    date = _validate_date(date)
    geojson = tvdi_service.get_grid_by_date(db, date)
    if not geojson["features"]:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy dữ liệu cho ngày {date}")
    return geojson


@router.get("/series/overall")
@router.get("/timeseries/overall")
def get_overall_series(db: Session = Depends(get_db)):
    """Chuỗi thời gian trung bình toàn khu vực TP.HCM giai đoạn 2017–2025."""
    return tvdi_service.get_overall_time_series(db)


@router.get("/series/{cell_id}")
@router.get("/timeseries/cell/{cell_id}")
def get_cell_series(cell_id: int, db: Session = Depends(get_db)):
    """
    Chuỗi thời gian 2017–2025 cho 1 ô lưới cụ thể.
    Dùng để hiển thị biểu đồ biến thiên LST, NDVI, TVDI khi người dùng click vào ô trên bản đồ.
    """
    series_data = tvdi_service.get_cell_time_series(db, cell_id)
    if not series_data["series"]:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy ô lưới mang mã {cell_id}")
    return series_data


@router.get("/regions/boundary")
def get_boundary(db: Session = Depends(get_db)):
    """Ranh giới hành chính TP.HCM mở rộng dưới dạng GeoJSON."""
    return tvdi_service.get_region_boundary(db)


@router.get("/regions/wards-boundary")
def get_wards_boundary():
    """Ranh giới chi tiết 168 phường/xã của TP.HCM mở rộng dưới dạng GeoJSON."""
    return tvdi_service.get_wards_boundary()


@router.get("/wards")
def list_wards(
    date: Optional[str] = None,
    sort_by: str = Query("lst_desc", description="Tiêu chí sắp xếp: lst_desc, ndvi_asc, tvdi_desc, name_asc"),
    min_lst: Optional[float] = Query(None, description="Ngưỡng LST tối thiểu (°C)"),
    max_lst: Optional[float] = Query(None, description="Ngưỡng LST tối đa (°C)"),
    min_ndvi: Optional[float] = Query(None, description="Ngưỡng NDVI tối thiểu"),
    max_ndvi: Optional[float] = Query(None, description="Ngưỡng NDVI tối đa"),
    min_tvdi: Optional[float] = Query(None, description="Ngưỡng TVDI tối thiểu"),
    max_tvdi: Optional[float] = Query(None, description="Ngưỡng TVDI tối đa"),
    start: Optional[str] = Query(None, description="Ngày bắt đầu khi lấy giá trị trung bình theo khoảng (YYYY-MM-DD)"),
    end: Optional[str] = Query(None, description="Ngày kết thúc khi lấy giá trị trung bình theo khoảng (YYYY-MM-DD)"),
    db: Session = Depends(get_db),
):
    """
    Lập danh sách 167 phường/xã TP.HCM sắp xếp theo thứ tự LST (cao -> thấp),
    NDVI (thấp -> cao), TVDI (cao -> thấp) và hỗ trợ chọn ngưỡng lọc linh hoạt.
    Truyền thêm start & end để xếp hạng theo giá trị trung bình của khoảng thời gian.
    """
    if not date:
        # Mặc định lấy ngày có dữ liệu gần nhất
        available_dates = tvdi_service.get_available_dates(db)
        date = available_dates[-1] if available_dates else "2024-03-01"
    date = _validate_date(date)
    if start or end:
        if not (start and end):
            raise HTTPException(status_code=400, detail="Cần truyền đủ cả 'start' và 'end'.")
        start = _validate_date(start, "start")
        end = _validate_date(end, "end")

    data = tvdi_service.get_wards_ranking(
        db=db,
        date_str=date,
        sort_by=sort_by,
        min_lst=min_lst,
        max_lst=max_lst,
        min_ndvi=min_ndvi,
        max_ndvi=max_ndvi,
        min_tvdi=min_tvdi,
        max_tvdi=max_tvdi,
        start_str=start,
        end_str=end,
    )
    return data

