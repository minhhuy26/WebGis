"""
Router – API tính toán lợi ích trồng cây xanh & mô phỏng kịch bản sinh thái.
Được xây dựng theo phương pháp nghiên cứu định lượng:
- Hấp thụ CO2 & Tạo Oxy theo quang hợp sinh thái
- Tích lũy sinh khối (Biomass accumulation)
- Diện tích tán lá bóng mát & Giảm hiệu ứng đảo nhiệt đô thị (UHI)
- Giữ nước mưa, giảm dòng chảy tràn (Stormwater runoff retention)
- Định giá kinh tế sinh thái (Tín chỉ Carbon, Sinh khối, Nước mưa)
"""
import json
import math
from pathlib import Path
from typing import Dict, List, Optional, Any, Union
from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db

router = APIRouter()

# ---- Pydantic Schemas -----------------------------------------------------

class TreeBenefitInput(BaseModel):
    scenario_id: Optional[str] = Field("custom", description="Mã kịch bản")
    scenario_name: Optional[str] = Field("Tổng hợp tất cả lợi ích", description="Tên kịch bản")
    n_trees: float = Field(1000.0, ge=1, description="Số cây trồng (N)")
    years: float = Field(10.0, ge=0.5, le=100, description="Số năm (T)")
    co2_rate: float = Field(20.0, ge=0, description="CO2 hấp thụ (C) kg/cây/năm")
    biomass_rate: float = Field(12.0, ge=0, description="Sinh khối (B) kg/cây/năm")
    crown_area: float = Field(15.0, ge=0, description="Diện tích tán (S) m2/cây")
    water_retention: float = Field(300.0, ge=0, description="Nước giữ lại (R) lít/cây/năm")
    overlap_factor: float = Field(1.0, ge=0.1, le=1.0, description="Hệ số tán không chồng lấn (f)")
    carbon_price: float = Field(300000.0, ge=0, description="Giá carbon (P1) đ/tấn CO2")
    biomass_price: float = Field(1000.0, ge=0, description="Giá sinh khối (P2) đ/kg")
    water_price: float = Field(10000.0, ge=0, description="Giá trị nước (P3) đ/m3")
    c_invest: float = Field(0.0, ge=0, description="Chi phí đầu tư (đồng)")
    c_maint: float = Field(0.0, ge=0, description="Chi phí bảo dưỡng (đồng)")
    ward_id: Optional[int] = Field(None, description="ID phường/xã liên kết nếu có")
    ward_name: Optional[str] = Field(None, description="Tên phường/xã")


class YearlyBenefit(BaseModel):
    year: Union[int, float]
    cum_co2_tons: float
    cum_o2_tons: float
    cum_biomass_kg: float
    cum_water_m3: float
    cum_val_carbon: float
    cum_val_biomass: float
    cum_val_water: float
    cum_total_benefit: float


class TreeBenefitOutput(BaseModel):
    scenario_id: str
    scenario_name: str
    n_trees: float
    years: float
    
    # Chỉ tiêu vật lý sinh thái
    co2_tons: float
    o2_tons: float
    biomass_kg: float
    shade_area_m2: float
    shade_area_ha: float
    water_retained_m3: float
    
    # Chỉ tiêu hàng năm
    annual_co2_tons: float
    annual_o2_tons: float
    annual_water_m3: float
    
    # Chỉ tiêu giá trị kinh tế (VNĐ)
    val_carbon: float
    val_biomass: float
    val_water: float
    cost_invest: float
    cost_maint: float
    total_gross_benefit: float
    total_net_benefit: float
    
    # Diễn biến theo năm
    yearly_series: List[YearlyBenefit]


# ---- Kịch bản chuẩn tham chiếu --------------------------------------------

PRESET_SCENARIOS = [
    {
        "id": "tong_hop",
        "name": "Tổng hợp tất cả lợi ích (Tiêu chuẩn tham khảo)",
        "desc": "Kịch bản tiêu chuẩn đầy đủ các chỉ số sinh thái và kinh tế, phù hợp đánh giá tổng thể dự án phủ xanh đô thị.",
        "icon": "fa-seedling",
        "tag": "Tiêu chuẩn",
        "n_trees": 1000.0,
        "years": 10.0,
        "co2_rate": 20.0,
        "biomass_rate": 12.0,
        "crown_area": 15.0,
        "water_retention": 300.0,
        "overlap_factor": 1.0,
        "carbon_price": 300000.0,
        "biomass_price": 1000.0,
        "water_price": 10000.0,
        "c_invest": 0.0,
        "c_maint": 0.0,
    },
    {
        "id": "bong_mat_duong_pho",
        "name": "Cây bóng mát đường phố & Hạ nhiệt đảo nhiệt (UHI)",
        "desc": "Trồng cây tán lớn (Sao đen, Dầu rái, Giáng hương, Lim xẹt) dọc các trục đại lộ TP.HCM nhằm che bóng, hạ nhiệt bề mặt đường và giảm bức xạ nhiệt.",
        "icon": "fa-road",
        "tag": "Đô thị & Hạ nhiệt",
        "n_trees": 2000.0,
        "years": 15.0,
        "co2_rate": 25.0,
        "biomass_rate": 16.0,
        "crown_area": 25.0,
        "water_retention": 450.0,
        "overlap_factor": 0.92,
        "carbon_price": 350000.0,
        "biomass_price": 1200.0,
        "water_price": 12000.0,
        "c_invest": 300000000.0,
        "c_maint": 60000000.0,
    },
    {
        "id": "cong_vien_do_thi",
        "name": "Công viên cây xanh & Không gian công cộng đa tầng",
        "desc": "Mô hình công viên tập trung (như Tao Đàn, Gia Định, 23/9, Safari Củ Chi) với hệ thực vật đa tầng, cải thiện vi khí hậu và môi trường sống cộng đồng.",
        "icon": "fa-tree",
        "tag": "Công viên & Cảnh quan",
        "n_trees": 5000.0,
        "years": 10.0,
        "co2_rate": 22.0,
        "biomass_rate": 14.0,
        "crown_area": 18.0,
        "water_retention": 380.0,
        "overlap_factor": 0.90,
        "carbon_price": 300000.0,
        "biomass_price": 1000.0,
        "water_price": 10000.0,
        "c_invest": 600000000.0,
        "c_maint": 150000000.0,
    },
    {
        "id": "rung_ngap_man_can_gio",
        "name": "Phục hồi Rừng ngập mặn Cần Giờ (Tín chỉ Carbon xanh)",
        "desc": "Bảo tồn & trồng mới 'Lá phổi xanh' Cần Giờ (Đước đôi, Mắm trắng, Bần) với khả năng lưu giữ Blue Carbon vượt trội, tham gia thị trường tín chỉ carbon quốc tế.",
        "icon": "fa-water",
        "tag": "Rừng & Tín chỉ Carbon",
        "n_trees": 20000.0,
        "years": 20.0,
        "co2_rate": 35.0,
        "biomass_rate": 25.0,
        "crown_area": 12.0,
        "water_retention": 500.0,
        "overlap_factor": 0.85,
        "carbon_price": 500000.0,
        "biomass_price": 1500.0,
        "water_price": 10000.0,
        "c_invest": 1200000000.0,
        "c_maint": 250000000.0,
    },
    {
        "id": "thoat_nuoc_chong_ngap",
        "name": "Thành phố Bọt biển (Sponge City) & Giảm ngập úng",
        "desc": "Trồng dải cây xanh tiêu thoát nước bền vững (SUDS) tại các điểm trũng ngập (Quận 7, Nhà Bè, Thủ Đức), ưu tiên cây rễ sâu giữ nước mưa và giảm dòng chảy tràn.",
        "icon": "fa-cloud-showers-heavy",
        "tag": "Thủy văn & Chống ngập",
        "n_trees": 3000.0,
        "years": 10.0,
        "co2_rate": 18.0,
        "biomass_rate": 10.0,
        "crown_area": 16.0,
        "water_retention": 650.0,
        "overlap_factor": 0.95,
        "carbon_price": 300000.0,
        "biomass_price": 1000.0,
        "water_price": 15000.0,
        "c_invest": 450000000.0,
        "c_maint": 80000000.0,
    },
    {
        "id": "hoc_duong_benh_vien",
        "name": "Phủ xanh trường học, bệnh viện & Khu công nghiệp",
        "desc": "Quy mô vừa và nhỏ tại khuôn viên cơ quan, trường học, KCN Linh Trung, Tân Thuận nhằm tạo vi khí hậu mát mẻ, giảm khói bụi và tiếng ồn đô thị.",
        "icon": "fa-school",
        "tag": "Học đường & Cơ sở y tế",
        "n_trees": 800.0,
        "years": 8.0,
        "co2_rate": 18.0,
        "biomass_rate": 10.0,
        "crown_area": 14.0,
        "water_retention": 260.0,
        "overlap_factor": 0.95,
        "carbon_price": 300000.0,
        "biomass_price": 1000.0,
        "water_price": 10000.0,
        "c_invest": 120000000.0,
        "c_maint": 25000000.0,
    }
]


def calculate_tree_benefits(data: TreeBenefitInput) -> TreeBenefitOutput:
    """Hàm lõi tính toán theo đúng chuẩn công thức sinh thái."""
    N = float(data.n_trees)
    T = float(data.years)
    C = float(data.co2_rate)
    B = float(data.biomass_rate)
    S = float(data.crown_area)
    R = float(data.water_retention)
    f = float(data.overlap_factor)
    P1 = float(data.carbon_price)
    P2 = float(data.biomass_price)
    P3 = float(data.water_price)
    c_inv = float(data.c_invest)
    c_maint = float(data.c_maint)

    # 1. CO2 hấp thụ (tấn) = N * C * T / 1000
    co2_tons = (N * C * T) / 1000.0

    # 2. O2 tạo ra (tấn) = CO2 * (32/44) = CO2 * 0.72727...
    # (Trong quang hợp: 6 CO2 + 6 H2O -> C6H12O6 + 6 O2. Tỷ số phân tử khối O2/CO2 = 32/44 ~ 0.72727)
    o2_tons = co2_tons * (32.0 / 44.0)

    # 3. Sinh khối tăng thêm (kg) = N * B * T
    biomass_kg = N * B * T

    # 4. Diện tích bóng mát (m2) = N * S * f
    shade_area_m2 = N * S * f
    shade_area_ha = shade_area_m2 / 10000.0

    # 5. Nước mưa giữ lại (m3) = N * R * T / 1000
    water_retained_m3 = (N * R * T) / 1000.0

    # 6. Giá trị carbon G1 = CO2 * P1
    val_carbon = co2_tons * P1

    # 7. Giá trị sinh khối G2 = B_total * P2
    val_biomass = biomass_kg * P2

    # 8. Giá trị giảm dòng chảy tràn G3 = V * P3
    val_water = water_retained_m3 * P3

    # Tổng lợi ích quy đổi gộp & ròng
    total_gross = val_carbon + val_biomass + val_water
    total_net = total_gross - c_inv - c_maint

    # Chỉ tiêu bình quân năm
    annual_co2 = (N * C) / 1000.0
    annual_o2 = annual_co2 * (32.0 / 44.0)
    annual_water = (N * R) / 1000.0

    # Chuỗi diễn biến theo từng năm (từ 1 đến T; nếu T < 1 thì 1 mốc tại T)
    yearly: List[YearlyBenefit] = []
    if T < 1.0:
        steps_t = [T]
    else:
        max_year = int(min(max(1, math.ceil(T)), 100))
        steps_t = [min(float(y), T) for y in range(1, max_year + 1)]
    for t_y in steps_t:
        y_co2 = (N * C * t_y) / 1000.0
        y_o2 = y_co2 * (32.0 / 44.0)
        y_bio = N * B * t_y
        y_water = (N * R * t_y) / 1000.0
        y_v1 = y_co2 * P1
        y_v2 = y_bio * P2
        y_v3 = y_water * P3
        y_tot = y_v1 + y_v2 + y_v3 - c_inv - (c_maint * (t_y / T))
        yearly.append(YearlyBenefit(
            year=int(t_y) if float(t_y).is_integer() else round(t_y, 2),
            cum_co2_tons=round(y_co2, 2),
            cum_o2_tons=round(y_o2, 2),
            cum_biomass_kg=round(y_bio, 0),
            cum_water_m3=round(y_water, 1),
            cum_val_carbon=round(y_v1, 0),
            cum_val_biomass=round(y_v2, 0),
            cum_val_water=round(y_v3, 0),
            cum_total_benefit=round(y_tot, 0)
        ))

    return TreeBenefitOutput(
        scenario_id=data.scenario_id or "custom",
        scenario_name=data.scenario_name or "Tổng hợp tất cả lợi ích",
        n_trees=N,
        years=T,
        co2_tons=round(co2_tons, 2),
        o2_tons=round(o2_tons, 2),
        biomass_kg=round(biomass_kg, 1),
        shade_area_m2=round(shade_area_m2, 1),
        shade_area_ha=round(shade_area_ha, 3),
        water_retained_m3=round(water_retained_m3, 2),
        annual_co2_tons=round(annual_co2, 2),
        annual_o2_tons=round(annual_o2, 2),
        annual_water_m3=round(annual_water, 2),
        val_carbon=round(val_carbon, 0),
        val_biomass=round(val_biomass, 0),
        val_water=round(val_water, 0),
        cost_invest=round(c_inv, 0),
        cost_maint=round(c_maint, 0),
        total_gross_benefit=round(total_gross, 0),
        total_net_benefit=round(total_net, 0),
        yearly_series=yearly,
    )


# ---- Endpoints -------------------------------------------------------------

@router.get("/tree-benefit/presets")
def get_presets():
    """Lấy danh sách các kịch bản mẫu được lập trình sẵn."""
    return PRESET_SCENARIOS


@router.post("/tree-benefit/calculate", response_model=TreeBenefitOutput)
def calculate_benefits(payload: TreeBenefitInput):
    """Tính toán lợi ích trồng cây xanh tức thì từ tham số đầu vào."""
    return calculate_tree_benefits(payload)


@router.get("/tree-benefit/compare")
def compare_all_scenarios():
    """So sánh toàn bộ các kịch bản chuẩn cạnh nhau."""
    results = []
    for sc in PRESET_SCENARIOS:
        inp = TreeBenefitInput(
            scenario_id=sc["id"],
            scenario_name=sc["name"],
            n_trees=sc["n_trees"],
            years=sc["years"],
            co2_rate=sc["co2_rate"],
            biomass_rate=sc["biomass_rate"],
            crown_area=sc["crown_area"],
            water_retention=sc["water_retention"],
            overlap_factor=sc["overlap_factor"],
            carbon_price=sc["carbon_price"],
            biomass_price=sc["biomass_price"],
            water_price=sc["water_price"],
            c_invest=sc["c_invest"],
            c_maint=sc["c_maint"],
        )
        out = calculate_tree_benefits(inp)
        results.append({
            "id": sc["id"],
            "name": sc["name"],
            "tag": sc.get("tag", ""),
            "icon": sc.get("icon", "fa-tree"),
            "n_trees": out.n_trees,
            "years": out.years,
            "co2_tons": out.co2_tons,
            "o2_tons": out.o2_tons,
            "biomass_kg": out.biomass_kg,
            "shade_area_m2": out.shade_area_m2,
            "water_retained_m3": out.water_retained_m3,
            "total_net_benefit": out.total_net_benefit,
            "val_carbon": out.val_carbon,
            "val_biomass": out.val_biomass,
            "val_water": out.val_water,
        })
    return results


@router.get("/tree-benefit/ward-recommendation/{ward_id}")
def get_ward_tree_recommendation(
    ward_id: int,
    target_cover_pct: float = Query(20.0, ge=5.0, le=50.0, description="Tỷ lệ độ che phủ cây xanh mục tiêu (%)"),
    db: Session = Depends(get_db),
):
    """
    Đề xuất kịch bản trồng cây dựa trên hiện trạng phường/xã
    (diện tích, độ che phủ thực vật NDVI và mức độ khô hạn TVDI).
    """
    wards_file = settings.DATA_DIR / "tphcm_167_wards.json"
    if not wards_file.exists():
        wards_file = Path(__file__).resolve().parent.parent.parent / "data" / "tphcm_167_wards.json"
    if not wards_file.exists():
        raise HTTPException(status_code=404, detail="Không tìm thấy dữ liệu danh mục phường/xã")

    with open(wards_file, "r", encoding="utf-8") as f:
        wards = json.load(f)

    target_ward = next((w for w in wards if w.get("ward_id") == ward_id), None)
    if not target_ward:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy phường/xã có ID {ward_id}")

    area_km2 = float(target_ward.get("area_km2") or 2.0)
    area_m2 = area_km2 * 1000000.0

    ndvi_val = None
    tvdi_val = None
    if db is not None and hasattr(db, "execute"):
        try:
            obs_row = db.execute(
                text("""
                    SELECT ndvi, tvdi
                    FROM tvdi.ward_observations
                    WHERE ward_id = :wid AND satellite_source = 'LANDSAT'
                    ORDER BY date DESC
                    LIMIT 1
                """),
                {"wid": ward_id},
            ).fetchone()
            if obs_row:
                ndvi_val = float(obs_row[0]) if obs_row[0] is not None else None
                tvdi_val = float(obs_row[1]) if obs_row[1] is not None else None
        except Exception:
            pass

    # Mật độ trồng điều chỉnh theo hiện trạng NDVI/TVDI và tỷ lệ che phủ bổ sung
    crown_avg = 16.0
    overlap_factor = 0.92
    baseline_pct = max(2.0, min(40.0, (ndvi_val - 0.1) * 50.0)) if ndvi_val is not None else 10.0
    added_cover_pct = max(2.0, target_cover_pct - baseline_pct)
    if tvdi_val is not None and tvdi_val >= 0.625:
        added_cover_pct += 2.0
    suggested_trees = int(
        max(200, min(50000, round((area_m2 * (added_cover_pct / 100.0)) / (crown_avg * overlap_factor))))
    )

    rec_input = TreeBenefitInput(
        scenario_id=f"ward_{ward_id}",
        scenario_name=f"Phủ xanh sinh thái {target_ward.get('name')} ({target_ward.get('district')})",
        n_trees=float(suggested_trees),
        years=10.0,
        co2_rate=22.0,
        biomass_rate=14.0,
        crown_area=crown_avg,
        water_retention=350.0,
        overlap_factor=overlap_factor,
        carbon_price=300000.0,
        biomass_price=1000.0,
        water_price=10000.0,
        c_invest=float(suggested_trees * 120000),  # 120.000 đ/cây giống & trồng
        c_maint=float(suggested_trees * 20000 * 10), # 20.000 đ/cây/năm chăm sóc
        ward_id=ward_id,
        ward_name=target_ward.get("name")
    )

    out = calculate_tree_benefits(rec_input)
    # Tác động làm dịu nhiệt độ LST ước tính (°C)
    temp_drop = round(min(1.8, max(0.2, (out.shade_area_m2 / area_m2) * 15.0)), 2)

    return {
        "ward": target_ward,
        "recommendation": {
            "suggested_n_trees": suggested_trees,
            "target_cover_pct": target_cover_pct,
            "current_ndvi": round(ndvi_val, 3) if ndvi_val is not None else None,
            "current_tvdi": round(tvdi_val, 3) if tvdi_val is not None else None,
            "added_cover_pct": round(added_cover_pct, 2),
            "estimated_temp_drop_c": temp_drop,
            "shade_area_pct": round((out.shade_area_m2 / area_m2) * 100.0, 2),
            "calculated_benefits": out.model_dump() if hasattr(out, "model_dump") else out.dict(),
        }
    }
