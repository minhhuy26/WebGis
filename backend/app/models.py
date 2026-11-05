"""
SQLAlchemy models – bảng PostGIS cho dữ liệu TVDI.
"""
from sqlalchemy import (
    Column, Integer, Float, Date, String, Text, Index
)
from geoalchemy2 import Geometry

from .database import Base


class TvdiGrid(Base):
    """
    Bảng lưu giá trị TVDI theo ô lưới ~5 km.
    Mỗi dòng = 1 ô lưới × 1 mốc thời gian.
    """
    __tablename__ = "tvdi_grid"
    __table_args__ = (
        Index("idx_tvdi_grid_date", "date"),
        Index("idx_tvdi_grid_cell_id", "cell_id"),
        Index("idx_tvdi_grid_geom", "geom", postgresql_using="gist"),
        {"schema": "tvdi"},
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    date = Column(Date, nullable=False)
    cell_id = Column(Integer, nullable=False)
    lon = Column(Float, nullable=False)
    lat = Column(Float, nullable=False)
    lst_c = Column(Float)          # Nhiệt độ bề mặt (°C)
    ndvi = Column(Float)           # Chỉ số thực vật
    tvdi = Column(Float)           # Chỉ số khô hạn
    n_img = Column(Integer)        # Số ảnh Landsat
    geom = Column(
        Geometry("POINT", srid=4326, spatial_index=False),
        nullable=False,
        comment="Tâm ô lưới (EPSG:4326)",
    )


class TvdiSeries(Base):
    """
    Bảng lưu chuỗi thời gian trung bình toàn khu vực.
    Mỗi dòng = 1 mốc thời gian (15 ngày).
    """
    __tablename__ = "tvdi_series"
    __table_args__ = (
        Index("idx_tvdi_series_date", "date"),
        {"schema": "tvdi"},
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    date = Column(Date, nullable=False, unique=True)
    lst_c = Column(Float)
    ndvi = Column(Float)
    tvdi = Column(Float)
    n_img = Column(Integer)
    dry_a = Column(Float)          # Hệ số chặn biên khô
    dry_b = Column(Float)          # Hệ số góc biên khô
    ts_min = Column(Float)         # LST_min (percentile 1%)
    fit_ok = Column(Integer)       # 1 = hồi quy biên khô hợp lệ


class Region(Base):
    """
    Bảng lưu ranh giới khu vực (từ shapefile).
    """
    __tablename__ = "regions"
    __table_args__ = (
        Index("idx_regions_geom", "geom", postgresql_using="gist"),
        {"schema": "tvdi"},
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    ten = Column(String(255))
    sap_nhap = Column(Text)
    quy_mo = Column(Text)
    dt_km2 = Column(Float)
    geom = Column(
        Geometry("MULTIPOLYGON", srid=4326, spatial_index=False),
        nullable=False,
    )


class GridCell(Base):
    """
    Bảng lưu danh mục 283 ô lưới tĩnh (~5.5 km x 5.5 km).
    Bao gồm cả điểm tâm (Point) và đa giác ô vuông (Polygon).
    """
    __tablename__ = "grid_cells"
    __table_args__ = (
        Index("idx_grid_cells_polygon", "geom_polygon", postgresql_using="gist"),
        {"schema": "tvdi"},
    )

    cell_id = Column(Integer, primary_key=True)
    lon = Column(Float, nullable=False)
    lat = Column(Float, nullable=False)
    geom_point = Column(
        Geometry("POINT", srid=4326, spatial_index=False),
        nullable=False,
        comment="Điểm tâm ô lưới",
    )
    geom_polygon = Column(
        Geometry("MULTIPOLYGON", srid=4326, spatial_index=False),
        nullable=True,
        comment="Đa giác ô lưới cắt theo ranh giới chuẩn",
    )


class TvdiForecast(Base):
    """
    Bảng lưu kết quả dự báo chỉ số TVDI từ mô hình Random Forest.
    """
    __tablename__ = "tvdi_forecast"
    __table_args__ = (
        Index("idx_tvdi_forecast_date", "date"),
        Index("idx_tvdi_forecast_cell_id", "cell_id"),
        {"schema": "tvdi"},
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    date = Column(Date, nullable=False)
    cell_id = Column(Integer, nullable=True, comment="Mã ô lưới, NULL nếu là trung bình toàn vùng")
    tvdi_actual = Column(Float, nullable=True, comment="Giá trị thực tế quan trắc")
    tvdi_pred = Column(Float, nullable=False, comment="Giá trị dự báo từ AI")
    residual = Column(Float, nullable=True, comment="Sai số (actual - pred)")
    model_name = Column(String(50), default="Random Forest")

