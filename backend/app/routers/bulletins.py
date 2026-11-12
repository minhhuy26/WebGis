"""
API quản lý Bản tin Giám sát & Dự báo Khô hạn TVDI (tvdi.bulletins).
Hỗ trợ sinh bản tin tổng hợp (bản đồ, biểu đồ, bảng, nhận định) từ dữ liệu PostGIS,
lưu trữ bản tin phát hành và truy xuất lịch sử bản tin.
"""
import json
from datetime import date, datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..database import get_db
from ..services.tvdi_service import get_drought_class
from .auth import decode_token, record_activity

router = APIRouter(prefix="/api/bulletins", tags=["Bản tin & Báo cáo"])


class BulletinCreate(BaseModel):
    title: str
    bulletin_type: str = "observed"  # observed | daily_7d | monthly_12m | aggregate
    period_start: str
    period_end: str
    satellite_source: str = "LANDSAT"
    summary_stats: Optional[Dict[str, Any]] = None
    highlights: Optional[str] = None
    recommendations: Optional[str] = None


def _parse_date(val: Optional[str], fallback: date) -> date:
    if not val:
        return fallback
    try:
        return datetime.strptime(val[:10], "%Y-%m-%d").date()
    except Exception:
        return fallback


def _optional_username(authorization: Optional[str]) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        return "system"
    payload = decode_token(authorization[7:])
    if payload and payload.get("sub"):
        return str(payload["sub"])
    return "system"


def _build_recommendations_text(drought_pct: float, avg_tvdi: Optional[float], horizon: str) -> str:
    avg_txt = f"{avg_tvdi:.3f}" if avg_tvdi is not None else "--"
    if horizon == "daily_7d":
        src_note = "Số liệu dự báo 7 ngày được mô phỏng giả lập theo đặc trưng Landsat 8/9 để phục vụ theo dõi ngắn hạn."
    elif horizon == "monthly_12m":
        src_note = "Số liệu dự báo 12 tháng được tính toán từ mô hình AI Random Forest (đánh giá theo chuỗi nhiều năm)."
    else:
        src_note = "Số liệu quan trắc thực tế từ ảnh viễn thám Landsat 8/9 trên Google Earth Engine."

    if drought_pct >= 30.0:
        return (
            f"[CẤP ĐỘ III - KHẨN CẤP] Tỷ lệ diện tích khô hạn (TVDI ≥ 0.625) đạt {drought_pct:.1f}% "
            f"(TVDI trung bình {avg_txt}). Khuyến nghị ưu tiên điều tiết nước tưới cho vùng nông nghiệp ngoại thành, "
            f"nâng mức cảnh báo phòng cháy chữa cháy rừng phòng hộ Cần Giờ và theo dõi sát xâm nhập mặn sông Sài Gòn – Đồng Nai. {src_note}"
        )
    if drought_pct >= 10.0:
        return (
            f"[CẤP ĐỘ II - CẢNH BÁO CỤC BỘ] Tỷ lệ diện tích khô hạn đạt {drought_pct:.1f}% "
            f"(TVDI trung bình {avg_txt}). Đề nghị kiểm tra độ ẩm đất tầng mặt tại các khu vực điểm nóng nhiệt/khô hạn, "
            f"chủ động kế hoạch tích trữ nước ngọt và duy trì cảnh báo cháy rừng cấp cao. {src_note}"
        )
    return (
        f"[CẤP ĐỘ I - AN TOÀN / ỔN ĐỊNH] Độ ẩm đất và thảm phủ thực vật toàn vùng duy trì ở trạng thái tương đối ổn định "
        f"(TVDI trung bình {avg_txt}, diện tích khô hạn {drought_pct:.1f}%). Tiếp tục giám sát định kỳ theo chu kỳ vệ tinh và cập nhật bản tin tiếp theo. {src_note}"
    )


def build_bulletin_draft(
    db: Session,
    target_date: Optional[str] = None,
    horizon: str = "observed",
    start: Optional[str] = None,
    end: Optional[str] = None,
) -> Dict[str, Any]:
    """Tổng hợp số liệu bản tin từ PostGIS cho hiện trạng, khoảng tổng hợp hoặc dự báo."""
    horizon_norm = (horizon or "observed").strip().lower()
    is_forecast = horizon_norm in ("daily_7d", "monthly_12m")

    if not target_date:
        if is_forecast:
            row_dt = db.execute(
                text("""
                    SELECT MIN(date) FROM tvdi.tvdi_forecast
                    WHERE horizon_type = :h AND cell_id IS NOT NULL
                      AND date >= :d0
                """),
                {"h": horizon_norm, "d0": date.today().replace(day=1) if horizon_norm == "monthly_12m" else date.today()},
            ).fetchone()
            dt = row_dt[0] if row_dt and row_dt[0] else date.today()
        else:
            row_dt = db.execute(text("SELECT MAX(date) FROM tvdi.tvdi_grid")).fetchone()
            dt = row_dt[0] if row_dt and row_dt[0] else date(2025, 3, 1)
    else:
        dt = _parse_date(target_date, date.today())

    level_counts = {str(lvl): 0 for lvl in range(1, 9)}
    top_wards: List[Dict[str, Any]] = []
    series_points: List[Dict[str, Any]] = []

    if is_forecast:
        grid_rows = db.execute(
            text("""
                SELECT cell_id, tvdi_pred, lst_pred, ndvi_pred
                FROM tvdi.tvdi_forecast
                WHERE date = :d AND horizon_type = :h AND cell_id IS NOT NULL
            """),
            {"d": dt, "h": horizon_norm},
        ).fetchall()

        ward_rows = db.execute(
            text("""
                SELECT w.ward_id, w.name, w.district, wf.tvdi_pred, wf.lst_pred, wf.ndvi_pred, wf.drought_level
                FROM tvdi.ward_forecasts wf
                JOIN tvdi.wards w ON w.ward_id = wf.ward_id
                WHERE wf.target_date = :d AND wf.horizon_type = :h AND wf.tvdi_pred IS NOT NULL
                ORDER BY wf.tvdi_pred DESC
                LIMIT 10
            """),
            {"d": dt, "h": horizon_norm},
        ).fetchall()

        series_rows = db.execute(
            text("""
                SELECT date, AVG(tvdi_pred), AVG(lst_pred), AVG(ndvi_pred)
                FROM tvdi.tvdi_forecast
                WHERE horizon_type = :h AND cell_id IS NOT NULL
                  AND date >= :d0
                GROUP BY date
                ORDER BY date ASC
                LIMIT 12
            """),
            {"h": horizon_norm, "d0": date.today().replace(day=1) if horizon_norm == "monthly_12m" else date.today()},
        ).fetchall()
    elif horizon_norm == "aggregate" and start and end:
        s_dt = _parse_date(start, dt)
        e_dt = _parse_date(end, dt)
        grid_rows = db.execute(
            text("""
                SELECT cell_id, AVG(tvdi), AVG(lst_c), AVG(ndvi)
                FROM tvdi.tvdi_grid
                WHERE date >= :s AND date <= :e AND tvdi IS NOT NULL
                GROUP BY cell_id
            """),
            {"s": s_dt, "e": e_dt},
        ).fetchall()
        ward_rows = db.execute(
            text("""
                SELECT w.ward_id, w.name, w.district, AVG(wo.tvdi) AS tv, AVG(wo.lst_c), AVG(wo.ndvi), NULL
                FROM tvdi.ward_observations wo
                JOIN tvdi.wards w ON w.ward_id = wo.ward_id
                WHERE wo.date >= :s AND wo.date <= :e AND wo.tvdi IS NOT NULL
                GROUP BY w.ward_id, w.name, w.district
                ORDER BY tv DESC
                LIMIT 10
            """),
            {"s": s_dt, "e": e_dt},
        ).fetchall()
        series_rows = db.execute(
            text("""
                SELECT date, AVG(tvdi), AVG(lst_c), AVG(ndvi)
                FROM tvdi.tvdi_grid
                WHERE date >= :s AND date <= :e AND tvdi IS NOT NULL
                GROUP BY date
                ORDER BY date ASC
                LIMIT 12
            """),
            {"s": s_dt, "e": e_dt},
        ).fetchall()
    else:
        grid_rows = db.execute(
            text("""
                SELECT cell_id, tvdi, lst_c, ndvi
                FROM tvdi.tvdi_grid
                WHERE date = :d AND tvdi IS NOT NULL
            """),
            {"d": dt},
        ).fetchall()
        ward_rows = db.execute(
            text("""
                SELECT w.ward_id, w.name, w.district, wo.tvdi, wo.lst_c, wo.ndvi, wo.drought_level
                FROM tvdi.ward_observations wo
                JOIN tvdi.wards w ON w.ward_id = wo.ward_id
                WHERE wo.date = :d AND wo.tvdi IS NOT NULL
                ORDER BY wo.tvdi DESC
                LIMIT 10
            """),
            {"d": dt},
        ).fetchall()
        series_rows = db.execute(
            text("""
                SELECT date, AVG(tvdi), AVG(lst_c), AVG(ndvi)
                FROM tvdi.tvdi_grid
                WHERE date <= :d AND tvdi IS NOT NULL
                GROUP BY date
                ORDER BY date DESC
                LIMIT 8
            """),
            {"d": dt},
        ).fetchall()
        series_rows = list(reversed(series_rows))

    tvdi_vals: List[float] = []
    lst_vals: List[float] = []
    ndvi_vals: List[float] = []
    drought_cells = 0
    max_cell = None
    min_cell = None
    max_v = -1e9
    min_v = 1e9

    for cid, tv, ls, nd in grid_rows:
        if tv is not None:
            fv = float(tv)
            tvdi_vals.append(fv)
            dc = get_drought_class(fv)
            lvl = str(dc["level"])
            if lvl in level_counts:
                level_counts[lvl] += 1
            if fv >= 0.625:
                drought_cells += 1
            if fv > max_v:
                max_v = fv
                max_cell = {"cell_id": cid, "tvdi": round(fv, 3)}
            if fv < min_v:
                min_v = fv
                min_cell = {"cell_id": cid, "tvdi": round(fv, 3)}
        if ls is not None:
            lst_vals.append(float(ls))
        if nd is not None:
            ndvi_vals.append(float(nd))

    valid_cells = len(tvdi_vals)
    avg_tvdi = round(sum(tvdi_vals) / valid_cells, 3) if valid_cells else None
    avg_lst = round(sum(lst_vals) / len(lst_vals), 2) if lst_vals else None
    avg_ndvi = round(sum(ndvi_vals) / len(ndvi_vals), 3) if ndvi_vals else None
    drought_pct = round((drought_cells / valid_cells) * 100.0, 1) if valid_cells else 0.0

    for wid, wname, wdist, tv, ls, nd, dlvl in ward_rows:
        dc = get_drought_class(float(tv)) if tv is not None else get_drought_class(None)
        top_wards.append({
            "ward_id": wid,
            "name": wname,
            "district": wdist,
            "tvdi": round(float(tv), 3) if tv is not None else None,
            "lst_c": round(float(ls), 2) if ls is not None else None,
            "ndvi": round(float(nd), 3) if nd is not None else None,
            "drought_level": dlvl or dc["level"],
            "drought_label": dc["label"],
            "color": dc["color"],
        })

    for sd, tv, ls, nd in series_rows:
        sd_str = sd.strftime("%Y-%m-%d") if isinstance(sd, date) else str(sd)
        series_points.append({
            "date": sd_str,
            "tvdi": round(float(tv), 3) if tv is not None else None,
            "lst_c": round(float(ls), 2) if ls is not None else None,
            "ndvi": round(float(nd), 3) if nd is not None else None,
        })

    p_start = start if (horizon_norm == "aggregate" and start) else (series_points[0]["date"] if (is_forecast and series_points) else dt.strftime("%Y-%m-%d"))
    p_end = end if (horizon_norm == "aggregate" and end) else (series_points[-1]["date"] if (is_forecast and series_points) else dt.strftime("%Y-%m-%d"))

    if horizon_norm == "daily_7d":
        title = f"Bản tin Dự báo Khô hạn 7 ngày (Giả lập · Landsat) từ {p_start}"
        highlights = (
            f"Bản tin dự báo ngắn hạn 7 ngày ({p_start} → {p_end}) cho thấy TVDI TB toàn vùng "
            f"{avg_tvdi if avg_tvdi is not None else '--'}, LST TB {avg_lst if avg_lst is not None else '--'} °C, "
            f"NDVI TB {avg_ndvi if avg_ndvi is not None else '--'}; tỷ lệ ô lưới khô hạn ≥ 0.625 là {drought_pct}%."
        )
    elif horizon_norm == "monthly_12m":
        title = f"Bản tin Dự báo Khô hạn 12 tháng (AI Random Forest) · Mốc {dt.strftime('%m/%Y')}"
        highlights = (
            f"Dự báo AI Random Forest chuỗi 12 tháng ({p_start[:7]} → {p_end[:7]}) ghi nhận tại mốc {dt.strftime('%m/%Y')} "
            f"TVDI TB = {avg_tvdi if avg_tvdi is not None else '--'}, LST TB = {avg_lst if avg_lst is not None else '--'} °C, "
            f"NDVI TB = {avg_ndvi if avg_ndvi is not None else '--'}; diện tích có nguy cơ hạn đạt {drought_pct}%."
        )
    elif horizon_norm == "aggregate":
        title = f"Bản tin Tổng hợp Giám sát Khô hạn ({p_start} → {p_end})"
        highlights = (
            f"Trung bình giai đoạn {p_start} đến {p_end}: TVDI = {avg_tvdi if avg_tvdi is not None else '--'}, "
            f"LST = {avg_lst if avg_lst is not None else '--'} °C, NDVI = {avg_ndvi if avg_ndvi is not None else '--'}; "
            f"tỷ lệ khu vực khô hạn đạt {drought_pct}%."
        )
    else:
        title = f"Bản tin Giám sát Khô hạn TVDI – TP.HCM (Kỳ Landsat {dt.strftime('%d/%m/%Y')})"
        highlights = (
            f"Quan trắc vệ tinh Landsat 8/9 kỳ {dt.strftime('%Y-%m-%d')} ghi nhận TVDI TB toàn vùng = "
            f"{avg_tvdi if avg_tvdi is not None else '--'}, LST TB = {avg_lst if avg_lst is not None else '--'} °C, "
            f"NDVI TB = {avg_ndvi if avg_ndvi is not None else '--'}; {drought_pct}% diện tích đạt ngưỡng khô hạn."
        )

    summary_stats = {
        "target_date": dt.strftime("%Y-%m-%d"),
        "horizon_type": horizon_norm,
        "is_simulated": horizon_norm == "daily_7d",
        "valid_cells": valid_cells,
        "avg_tvdi": avg_tvdi,
        "max_tvdi": round(max_v, 3) if valid_cells else None,
        "min_tvdi": round(min_v, 3) if valid_cells else None,
        "max_cell": max_cell,
        "min_cell": min_cell,
        "avg_lst": avg_lst,
        "avg_ndvi": avg_ndvi,
        "drought_cell_count": drought_cells,
        "drought_pct": drought_pct,
        "level_counts": level_counts,
        "top_wards": top_wards,
        "series_points": series_points,
    }

    return {
        "title": title,
        "bulletin_type": horizon_norm,
        "period_start": p_start,
        "period_end": p_end,
        "satellite_source": "LANDSAT",
        "summary_stats": summary_stats,
        "highlights": highlights,
        "recommendations": _build_recommendations_text(drought_pct, avg_tvdi, horizon_norm),
    }


def _ensure_default_bulletins(db: Session) -> None:
    cnt = db.execute(text("SELECT COUNT(*) FROM tvdi.bulletins")).scalar() or 0
    if cnt > 0:
        return
    try:
        draft_obs = build_bulletin_draft(db, horizon="observed")
        draft_m12 = build_bulletin_draft(db, horizon="monthly_12m")
        for d in (draft_obs, draft_m12):
            db.execute(
                text("""
                    INSERT INTO tvdi.bulletins (
                        title, bulletin_type, period_start, period_end,
                        satellite_source, summary_stats, highlights, recommendations, created_by
                    ) VALUES (
                        :title, :btype, :ps, :pe,
                        :src, CAST(:stats AS jsonb), :hi, :rec, 'system'
                    )
                """),
                {
                    "title": d["title"],
                    "btype": d["bulletin_type"],
                    "ps": _parse_date(d["period_start"], date.today()),
                    "pe": _parse_date(d["period_end"], date.today()),
                    "src": d["satellite_source"],
                    "stats": json.dumps(d["summary_stats"], ensure_ascii=False),
                    "hi": d["highlights"],
                    "rec": d["recommendations"],
                },
            )
        db.commit()
    except Exception:
        db.rollback()


def _serialize_bulletin_row(r: Any) -> Dict[str, Any]:
    return {
        "id": r[0],
        "title": r[1],
        "bulletin_type": r[2],
        "period_start": r[3].strftime("%Y-%m-%d") if isinstance(r[3], date) else str(r[3]),
        "period_end": r[4].strftime("%Y-%m-%d") if isinstance(r[4], date) else str(r[4]),
        "satellite_source": r[5],
        "summary_stats": r[6] if isinstance(r[6], dict) else (json.loads(r[6]) if r[6] else {}),
        "highlights": r[7] or "",
        "recommendations": r[8] or "",
        "created_by": r[9] or "system",
        "created_at": r[10].isoformat() if r[10] else None,
    }


@router.get("/draft")
def get_auto_bulletin_draft(
    date_str: Optional[str] = Query(None, alias="date"),
    horizon: str = Query("observed"),
    start: Optional[str] = None,
    end: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Sinh bản nháp bản tin tự động từ dữ liệu PostGIS theo mốc/khung thời gian."""
    return build_bulletin_draft(db, target_date=date_str, horizon=horizon, start=start, end=end)


@router.get("")
def list_bulletins(limit: int = 30, db: Session = Depends(get_db)):
    """Lấy danh sách các bản tin đã lưu trong CSDL (tvdi.bulletins)."""
    _ensure_default_bulletins(db)
    rows = db.execute(
        text("""
            SELECT id, title, bulletin_type, period_start, period_end,
                   satellite_source, summary_stats, highlights, recommendations,
                   created_by, created_at
            FROM tvdi.bulletins
            ORDER BY created_at DESC, id DESC
            LIMIT :lim
        """),
        {"lim": max(1, min(limit, 100))},
    ).fetchall()
    return {"bulletins": [_serialize_bulletin_row(r) for r in rows]}


@router.get("/{bulletin_id}")
def get_bulletin(bulletin_id: int, db: Session = Depends(get_db)):
    """Lấy chi tiết 1 bản tin theo ID."""
    row = db.execute(
        text("""
            SELECT id, title, bulletin_type, period_start, period_end,
                   satellite_source, summary_stats, highlights, recommendations,
                   created_by, created_at
            FROM tvdi.bulletins
            WHERE id = :bid
        """),
        {"bid": bulletin_id},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Không tìm thấy bản tin.")
    return _serialize_bulletin_row(row)


@router.post("")
def create_bulletin(
    payload: BulletinCreate,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Lưu bản tin mới vào CSDL (tvdi.bulletins)."""
    username = _optional_username(authorization)
    ps = _parse_date(payload.period_start, date.today())
    pe = _parse_date(payload.period_end, ps)

    stats = payload.summary_stats
    highlights = payload.highlights
    recommendations = payload.recommendations
    if stats is None:
        draft = build_bulletin_draft(db, target_date=payload.period_start, horizon=payload.bulletin_type)
        stats = draft["summary_stats"]
        highlights = highlights or draft["highlights"]
        recommendations = recommendations or draft["recommendations"]

    row = db.execute(
        text("""
            INSERT INTO tvdi.bulletins (
                title, bulletin_type, period_start, period_end,
                satellite_source, summary_stats, highlights, recommendations, created_by
            ) VALUES (
                :title, :btype, :ps, :pe,
                :src, CAST(:stats AS jsonb), :hi, :rec, :u
            )
            RETURNING id, title, bulletin_type, period_start, period_end,
                      satellite_source, summary_stats, highlights, recommendations,
                      created_by, created_at
        """),
        {
            "title": payload.title.strip()[:255] or "Bản tin Giám sát Khô hạn TVDI",
            "btype": payload.bulletin_type.strip()[:30],
            "ps": ps,
            "pe": pe,
            "src": (payload.satellite_source or "LANDSAT").upper()[:30],
            "stats": json.dumps(stats or {}, ensure_ascii=False),
            "hi": highlights or "",
            "rec": recommendations or "",
            "u": username,
        },
    ).fetchone()
    db.commit()

    if username != "system":
        record_activity(db, username, "Lưu bản tin TVDI", f"Đã lưu bản tin: {payload.title[:80]}")

    return {"message": "Đã lưu bản tin thành công.", "bulletin": _serialize_bulletin_row(row)}


@router.delete("/{bulletin_id}")
def delete_bulletin(
    bulletin_id: int,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Xóa bản tin khỏi kho lưu trữ."""
    username = _optional_username(authorization)
    row = db.execute(
        text("DELETE FROM tvdi.bulletins WHERE id = :bid RETURNING id, title"),
        {"bid": bulletin_id},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Không tìm thấy bản tin cần xóa.")
    db.commit()

    if username != "system":
        record_activity(db, username, "Xóa bản tin TVDI", f"Xóa bản tin ID={bulletin_id}: {row[1]}")

    return {"message": "Đã xóa bản tin.", "id": bulletin_id}
