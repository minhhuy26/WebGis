"""
SQLAlchemy models – Thiết kế CSDL PostGIS chuẩn cho Hệ thống WebGIS TVDI TP.HCM.

Bao gồm:
1. Dữ liệu không gian & hành chính chuẩn:
   - tvdi.regions: ranh giới khu vực nghiên cứu (MultiPolygon, EPSG:4326)
   - tvdi.grid_cells: danh mục ô lưới ~5.5 km (Point + MultiPolygon cắt theo ranh giới)
   - tvdi.wards: danh mục & ranh giới 167 phường/xã (Point + MultiPolygon + diện tích)
   - tvdi.drought_classes: bảng phân cấp 8 mức độ khô hạn TVDI chuẩn
2. Dữ liệu hiện trạng 3 chỉ số (LST, NDVI, TVDI) từ Google Earth Engine:
   - tvdi.tvdi_grid: giá trị LST, NDVI, TVDI theo ô lưới & nguồn vệ tinh (Landsat / MODIS)
   - tvdi.tvdi_series: chuỗi thời gian tổng hợp toàn vùng + tham số biên khô / biên ướt
   - tvdi.ward_observations: giá trị LST, NDVI, TVDI tổng hợp theo từng phường/xã
   - tvdi.gee_sync_logs: nhật ký đồng bộ dữ liệu từ GEE vào PostGIS
3. Dữ liệu dự báo của mô hình & mô phỏng (hỗ trợ cả 3 chỉ số, 7 ngày & 12 tháng):
   - tvdi.model_runs: metadata & chỉ số đánh giá (R², RMSE, MAE) của các mô hình AI / giả lập
   - tvdi.tvdi_forecast: kết quả dự báo theo ô lưới & toàn vùng (lst_pred, ndvi_pred, tvdi_pred)
   - tvdi.ward_forecasts: kết quả dự báo tổng hợp theo 167 phường/xã
4. Bản tin & Quản trị hệ thống:
   - tvdi.bulletins: lưu trữ bản tin giám sát & dự báo định kỳ
   - tvdi.users, tvdi.user_activities: tài khoản, phân quyền & nhật ký hoạt động
"""
from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from geoalchemy2 import Geometry

from .database import Base


# =============================================================================
# 1. NHÓM BẢNG KHÔNG GIAN & DANH MỤC CHUẨN
# =============================================================================


class Region(Base):
    """Bảng lưu ranh giới khu vực nghiên cứu (từ shapefile)."""

    __tablename__ = "regions"
    __table_args__ = (
        Index("idx_regions_geom", "geom", postgresql_using="gist"),
        {"schema": "tvdi"},
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    code = Column(String(50), nullable=True, comment="Mã vùng nghiên cứu")
    ten = Column(String(255))
    sap_nhap = Column(Text)
    quy_mo = Column(Text)
    dt_km2 = Column(Float)
    geom = Column(
        Geometry("MULTIPOLYGON", srid=4326, spatial_index=False),
        nullable=False,
    )
    updated_at = Column(DateTime(timezone=True), server_default=func.now())


class GridCell(Base):
    """
    Bảng lưu danh mục ô lưới tĩnh (~5.5 km x 5.5 km).
    Bao gồm điểm tâm (Point) và đa giác ô lưới cắt theo ranh giới (MultiPolygon).
    """

    __tablename__ = "grid_cells"
    __table_args__ = (
        Index("idx_grid_cells_polygon", "geom_polygon", postgresql_using="gist"),
        Index("idx_grid_cells_point", "geom_point", postgresql_using="gist"),
        {"schema": "tvdi"},
    )

    cell_id = Column(Integer, primary_key=True)
    region_id = Column(
        Integer,
        ForeignKey("tvdi.regions.id", ondelete="SET NULL"),
        nullable=True,
    )
    lon = Column(Float, nullable=False)
    lat = Column(Float, nullable=False)
    area_km2 = Column(Float, nullable=True, comment="Diện tích thực tế trong ranh giới (km²)")
    is_active = Column(Boolean, nullable=False, server_default=text("true"))
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


class Ward(Base):
    """
    Bảng lưu danh mục và ranh giới 167 phường/xã đất liền TP.HCM (ĐVHC 2025).
    Lưu cả điểm tâm (Point) lẫn đa giác ranh giới hành chính (MultiPolygon).
    """

    __tablename__ = "wards"
    __table_args__ = (
        Index("idx_wards_geom", "geom", postgresql_using="gist"),
        Index("idx_wards_geom_boundary", "geom_boundary", postgresql_using="gist"),
        {"schema": "tvdi"},
    )

    ward_id = Column(Integer, primary_key=True)
    code = Column(Integer, nullable=True, comment="Mã ĐVHC cấp xã")
    region_id = Column(
        Integer,
        ForeignKey("tvdi.regions.id", ondelete="SET NULL"),
        nullable=True,
    )
    name = Column(String(255), nullable=False)
    district = Column(String(255), nullable=False)
    province = Column(String(255), nullable=False)
    type = Column(String(50), nullable=False)
    lat = Column(Float, nullable=False)
    lon = Column(Float, nullable=False)
    area_km2 = Column(Float, nullable=True, comment="Diện tích hành chính (km²)")
    geom = Column(
        Geometry("POINT", srid=4326, spatial_index=False),
        nullable=True,
        comment="Điểm đại diện/tâm phường xã (EPSG:4326)",
    )
    geom_boundary = Column(
        Geometry("MULTIPOLYGON", srid=4326, spatial_index=False),
        nullable=True,
        comment="Đa giác ranh giới hành chính phường/xã (EPSG:4326)",
    )


class DroughtClass(Base):
    """Danh mục 8 cấp phân loại mức độ khô hạn TVDI chuẩn (bước 0.125)."""

    __tablename__ = "drought_classes"
    __table_args__ = ({"schema": "tvdi"},)

    level = Column(Integer, primary_key=True)
    min_tvdi = Column(Float, nullable=False)
    max_tvdi = Column(Float, nullable=False)
    label = Column(String(100), nullable=False)
    description = Column(Text, nullable=False)
    color = Column(String(20), nullable=False)
    risk_note = Column(Text, nullable=True)


# =============================================================================
# 2. NHÓM BẢNG HIỆN TRẠNG 3 CHỈ SỐ (LST, NDVI, TVDI) TỪ GOOGLE EARTH ENGINE
# =============================================================================


class TvdiGrid(Base):
    """
    Bảng lưu hiện trạng 3 chỉ số LST, NDVI, TVDI theo ô lưới từ GEE.
    Hỗ trợ đa nguồn vệ tinh (LANDSAT, MODIS, MULTI_SOURCE) và đa tần suất (daily, 15day, monthly).
    """

    __tablename__ = "tvdi_grid"
    __table_args__ = (
        Index("idx_tvdi_grid_date", "date"),
        Index("idx_tvdi_grid_cell_id", "cell_id"),
        Index("idx_tvdi_grid_source_gran", "satellite_source", "granularity"),
        Index("idx_tvdi_grid_geom", "geom", postgresql_using="gist"),
        UniqueConstraint(
            "date",
            "cell_id",
            "satellite_source",
            "granularity",
            name="uq_tvdi_grid_obs",
        ),
        {"schema": "tvdi"},
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    date = Column(Date, nullable=False)
    cell_id = Column(
        Integer,
        ForeignKey("tvdi.grid_cells.cell_id", ondelete="CASCADE"),
        nullable=False,
    )
    lon = Column(Float, nullable=False)
    lat = Column(Float, nullable=False)
    lst_c = Column(Float, comment="Nhiệt độ bề mặt (°C)")
    ndvi = Column(Float, comment="Chỉ số thực vật NDVI")
    tvdi = Column(Float, comment="Chỉ số khô hạn TVDI")
    n_img = Column(Integer, comment="Số ảnh vệ tinh ghép trong cửa sổ")
    satellite_source = Column(
        String(30),
        nullable=False,
        server_default=text("'LANDSAT'"),
        comment="Nguồn vệ tinh: LANDSAT | MODIS | MULTI_SOURCE",
    )
    granularity = Column(
        String(20),
        nullable=False,
        server_default=text("'15day'"),
        comment="Tần suất dữ liệu: daily | 15day | monthly",
    )
    spatial_res_m = Column(
        Integer,
        nullable=False,
        server_default=text("30"),
        comment="Độ phân giải ảnh gốc (m)",
    )
    cloud_pct = Column(Float, nullable=True, comment="Tỷ lệ mây che phủ (%)")
    data_quality = Column(
        String(30),
        nullable=False,
        server_default=text("'raw_gee'"),
        comment="Chất lượng dữ liệu: raw_gee | interpolated | calibrated",
    )
    synced_at = Column(DateTime(timezone=True), server_default=func.now())
    geom = Column(
        Geometry("POINT", srid=4326, spatial_index=False),
        nullable=False,
        comment="Tâm ô lưới (EPSG:4326)",
    )


class TvdiSeries(Base):
    """
    Bảng lưu chuỗi thời gian hiện trạng trung bình toàn khu vực từ GEE.
    Lưu đủ 3 chỉ số LST, NDVI, TVDI kèm tham số không gian LST-NDVI và thống kê phân bố.
    """

    __tablename__ = "tvdi_series"
    __table_args__ = (
        Index("idx_tvdi_series_date", "date"),
        Index("idx_tvdi_series_source_gran", "satellite_source", "granularity"),
        UniqueConstraint(
            "date",
            "satellite_source",
            "granularity",
            name="uq_tvdi_series_obs",
        ),
        {"schema": "tvdi"},
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    date = Column(Date, nullable=False)
    satellite_source = Column(
        String(30),
        nullable=False,
        server_default=text("'LANDSAT'"),
    )
    granularity = Column(
        String(20),
        nullable=False,
        server_default=text("'15day'"),
    )
    lst_c = Column(Float)
    ndvi = Column(Float)
    tvdi = Column(Float)
    n_img = Column(Integer)
    dry_a = Column(Float, comment="Hệ số chặn biên khô")
    dry_b = Column(Float, comment="Hệ số góc biên khô")
    ts_min = Column(Float, comment="LST_min biên ướt (percentile 1%)")
    fit_ok = Column(Integer, comment="1 = hồi quy biên khô hợp lệ")
    lst_min = Column(Float)
    lst_max = Column(Float)
    ndvi_min = Column(Float)
    ndvi_max = Column(Float)
    tvdi_min = Column(Float)
    tvdi_max = Column(Float)
    drought_area_pct = Column(Float, comment="Tỷ lệ ô lưới bị hạn (TVDI >= 0.625)")
    synced_at = Column(DateTime(timezone=True), server_default=func.now())


class WardObservation(Base):
    """
    Bảng lưu hiện trạng 3 chỉ số LST, NDVI, TVDI theo 167 phường/xã.
    Phục vụ truy vấn xếp hạng, thống kê và bản tin theo đơn vị hành chính.
    """

    __tablename__ = "ward_observations"
    __table_args__ = (
        Index("idx_ward_obs_date", "date"),
        Index("idx_ward_obs_ward_id", "ward_id"),
        UniqueConstraint(
            "date",
            "ward_id",
            "satellite_source",
            "granularity",
            name="uq_ward_obs",
        ),
        {"schema": "tvdi"},
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    date = Column(Date, nullable=False)
    ward_id = Column(
        Integer,
        ForeignKey("tvdi.wards.ward_id", ondelete="CASCADE"),
        nullable=False,
    )
    satellite_source = Column(
        String(30),
        nullable=False,
        server_default=text("'LANDSAT'"),
    )
    granularity = Column(
        String(20),
        nullable=False,
        server_default=text("'15day'"),
    )
    lst_c = Column(Float, nullable=True)
    ndvi = Column(Float, nullable=True)
    tvdi = Column(Float, nullable=True)
    drought_level = Column(
        Integer,
        ForeignKey("tvdi.drought_classes.level", ondelete="SET NULL"),
        nullable=True,
    )
    pixel_count = Column(Integer, nullable=True)
    valid_pct = Column(Float, nullable=True)
    method = Column(
        String(30),
        nullable=False,
        server_default=text("'idw_centroid'"),
        comment="Phương pháp tổng hợp: zonal_mean | idw_centroid",
    )
    synced_at = Column(DateTime(timezone=True), server_default=func.now())


class GeeSyncLog(Base):
    """Nhật ký các lần trích xuất / đồng bộ hiện trạng từ Google Earth Engine vào CSDL."""

    __tablename__ = "gee_sync_logs"
    __table_args__ = (
        Index("idx_gee_sync_started", "started_at"),
        {"schema": "tvdi"},
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    satellite_source = Column(String(30), nullable=False, server_default=text("'LANDSAT'"))
    granularity = Column(String(20), nullable=False, server_default=text("'15day'"))
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    dates_synced = Column(Integer, nullable=False, server_default=text("0"))
    grid_rows_upserted = Column(Integer, nullable=False, server_default=text("0"))
    ward_rows_upserted = Column(Integer, nullable=False, server_default=text("0"))
    status = Column(String(30), nullable=False, server_default=text("'running'"))
    message = Column(Text, nullable=True)
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    finished_at = Column(DateTime(timezone=True), nullable=True)


# =============================================================================
# 3. NHÓM BẢNG MÔ HÌNH & DỰ BÁO (HỖ TRỢ ĐỦ 3 CHỈ SỐ + NGÀY/THÁNG + AI/GIẢ LẬP)
# =============================================================================


class ModelRun(Base):
    """
    Bảng lưu metadata các phiên huấn luyện mô hình AI hoặc kịch bản giả lập.
    """

    __tablename__ = "model_runs"
    __table_args__ = (
        Index("idx_model_runs_active", "is_active", "horizon_type"),
        {"schema": "tvdi"},
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    model_name = Column(String(80), nullable=False)
    model_version = Column(String(30), nullable=False, server_default=text("'v1.0'"))
    target_index = Column(
        String(20),
        nullable=False,
        server_default=text("'TVDI'"),
        comment="LST | NDVI | TVDI | MULTI",
    )
    satellite_source = Column(String(30), nullable=False, server_default=text("'LANDSAT'"))
    horizon_type = Column(
        String(20),
        nullable=False,
        server_default=text("'15day'"),
        comment="daily_7d | monthly_12m | 15day | test_eval",
    )
    is_simulated = Column(Boolean, nullable=False, server_default=text("false"))
    train_period = Column(String(120), nullable=True)
    test_period = Column(String(120), nullable=True)
    r2_score = Column(Float, nullable=True)
    rmse = Column(Float, nullable=True)
    mae = Column(Float, nullable=True)
    metrics_json = Column(JSONB, nullable=True)
    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, server_default=text("true"))
    trained_at = Column(DateTime(timezone=True), server_default=func.now())


class TvdiForecast(Base):
    """
    Bảng lưu kết quả dự báo cho cả 3 chỉ số (LST, NDVI, TVDI) theo ô lưới & toàn vùng.
    Hỗ trợ dự báo theo ngày (7 ngày: daily_7d), theo tháng (12 tháng: monthly_12m),
    chu kỳ 15 ngày và đánh giá tập kiểm tra (test_eval).
    """

    __tablename__ = "tvdi_forecast"
    __table_args__ = (
        Index("idx_tvdi_forecast_date", "date"),
        Index("idx_tvdi_forecast_cell_id", "cell_id"),
        Index("idx_tvdi_forecast_horizon_src", "horizon_type", "satellite_source"),
        {"schema": "tvdi"},
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    date = Column(Date, nullable=False, comment="Mốc ngày/tháng mục tiêu được dự báo")
    cell_id = Column(
        Integer,
        ForeignKey("tvdi.grid_cells.cell_id", ondelete="CASCADE"),
        nullable=True,
        comment="Mã ô lưới, NULL nếu là trung bình toàn vùng",
    )

    # Chỉ số TVDI
    tvdi_actual = Column(Float, nullable=True, comment="TVDI thực tế quan trắc")
    tvdi_pred = Column(Float, nullable=True, comment="TVDI dự báo (AI hoặc giả lập)")
    residual = Column(Float, nullable=True, comment="Sai số TVDI (actual - pred)")

    # Chỉ số LST (°C)
    lst_actual = Column(Float, nullable=True, comment="LST thực tế quan trắc (°C)")
    lst_pred = Column(Float, nullable=True, comment="LST dự báo (°C)")
    lst_residual = Column(Float, nullable=True, comment="Sai số LST (actual - pred)")

    # Chỉ số NDVI
    ndvi_actual = Column(Float, nullable=True, comment="NDVI thực tế quan trắc")
    ndvi_pred = Column(Float, nullable=True, comment="NDVI dự báo")
    ndvi_residual = Column(Float, nullable=True, comment="Sai số NDVI (actual - pred)")

    # Metadata khung dự báo, nguồn vệ tinh và mô hình
    horizon_type = Column(
        String(20),
        nullable=False,
        server_default=text("'15day'"),
        comment="daily_7d | monthly_12m | 15day | test_eval",
    )
    forecast_step = Column(Integer, nullable=True, comment="Bước dự báo: 1..7 (ngày) hoặc 1..12 (tháng)")
    issued_date = Column(Date, nullable=True, comment="Ngày phát hành dự báo")
    satellite_source = Column(
        String(30),
        nullable=False,
        server_default=text("'LANDSAT'"),
        comment="LANDSAT | MODIS | MULTI_SOURCE",
    )
    is_simulated = Column(
        Boolean,
        nullable=False,
        server_default=text("false"),
        comment="True = dữ liệu giả lập; False = dự báo AI",
    )
    model_name = Column(String(80), default="Random Forest")
    model_run_id = Column(
        Integer,
        ForeignKey("tvdi.model_runs.id", ondelete="SET NULL"),
        nullable=True,
    )
    drought_level = Column(
        Integer,
        ForeignKey("tvdi.drought_classes.level", ondelete="SET NULL"),
        nullable=True,
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class WardForecast(Base):
    """
    Bảng lưu kết quả dự báo 3 chỉ số (LST, NDVI, TVDI) theo 167 phường/xã.
    """

    __tablename__ = "ward_forecasts"
    __table_args__ = (
        Index("idx_ward_forecasts_date", "target_date"),
        Index("idx_ward_forecasts_ward", "ward_id"),
        UniqueConstraint(
            "target_date",
            "ward_id",
            "horizon_type",
            "satellite_source",
            name="uq_ward_forecast",
        ),
        {"schema": "tvdi"},
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    target_date = Column(Date, nullable=False)
    issued_date = Column(Date, nullable=True)
    ward_id = Column(
        Integer,
        ForeignKey("tvdi.wards.ward_id", ondelete="CASCADE"),
        nullable=False,
    )
    horizon_type = Column(String(20), nullable=False, server_default=text("'monthly_12m'"))
    forecast_step = Column(Integer, nullable=True)
    satellite_source = Column(String(30), nullable=False, server_default=text("'LANDSAT'"))
    is_simulated = Column(Boolean, nullable=False, server_default=text("false"))
    lst_pred = Column(Float, nullable=True)
    ndvi_pred = Column(Float, nullable=True)
    tvdi_pred = Column(Float, nullable=True)
    drought_level = Column(
        Integer,
        ForeignKey("tvdi.drought_classes.level", ondelete="SET NULL"),
        nullable=True,
    )
    model_run_id = Column(
        Integer,
        ForeignKey("tvdi.model_runs.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# =============================================================================
# 4. BẢN TIN, BÁO CÁO & QUẢN TRỊ HỆ THỐNG
# =============================================================================


class Bulletin(Base):
    """Bảng lưu trữ các bản tin giám sát & dự báo (kết hợp bảng, biểu đồ, nhận định)."""

    __tablename__ = "bulletins"
    __table_args__ = (
        Index("idx_bulletins_period", "period_start", "period_end"),
        {"schema": "tvdi"},
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(255), nullable=False)
    bulletin_type = Column(
        String(30),
        nullable=False,
        server_default=text("'observed'"),
        comment="observed | daily_7d | monthly_12m",
    )
    period_start = Column(Date, nullable=False)
    period_end = Column(Date, nullable=False)
    satellite_source = Column(String(30), nullable=False, server_default=text("'LANDSAT'"))
    summary_stats = Column(JSONB, nullable=True)
    highlights = Column(Text, nullable=True)
    recommendations = Column(Text, nullable=True)
    created_by = Column(String(50), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class User(Base):
    """Bảng tài khoản người dùng & quản trị viên."""

    __tablename__ = "users"
    __table_args__ = ({"schema": "tvdi"},)

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(50), unique=True, nullable=False)
    password_hash = Column(String(128), nullable=False)
    full_name = Column(String(100), nullable=False)
    role = Column(String(20), nullable=False, server_default=text("'user'"))
    is_blocked = Column(Boolean, nullable=False, server_default=text("false"))
    last_login = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class UserActivity(Base):
    """Bảng nhật ký hoạt động người dùng (Audit Log)."""

    __tablename__ = "user_activities"
    __table_args__ = (
        Index("idx_user_activities_username", "username"),
        Index("idx_user_activities_created", "created_at"),
        {"schema": "tvdi"},
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(50), nullable=False)
    action = Column(String(120), nullable=False)
    details = Column(Text, nullable=True)
    ip_address = Column(String(64), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
