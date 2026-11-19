/**
 * Module Tính Lợi Ích Trồng Cây Xanh & Kịch Bản Đô Thị (Tree Planting Benefit Calculator)
 * Tích hợp công thức định lượng sinh thái - kinh tế:
 * - Hấp thụ CO2 & Giải phóng O2 (Quang hợp thực vật)
 * - Tích lũy sinh khối (Biomass accumulation)
 * - Tán che bóng mát & Hạ nhiệt bề mặt đất LST
 * - Trữ nước mưa & Giảm dòng chảy tràn bề mặt (Stormwater runoff retention)
 * - Định giá kinh tế sinh thái (Thị trường Carbon, Sinh khối, Nước mưa)
 * - Tích hợp danh mục 167 phường/xã TP.HCM và biểu đồ Chart.js
 */

(function (window) {
    'use strict';

    // ---- Cấu hình các kịch bản chuẩn ----------------------------------------
    const TREE_SCENARIOS = {
        tong_hop: {
            id: 'tong_hop',
            name: 'Tổng hợp tất cả lợi ích (Tiêu chuẩn tham khảo)',
            desc: 'Kịch bản chuẩn từ tài liệu nghiên cứu: Đánh giá tổng hợp toàn diện các giá trị sinh thái và kinh tế quy đổi.',
            icon: 'fa-seedling',
            tag: 'Tiêu chuẩn',
            n: 1000,
            t: 10,
            c: 20,
            b: 12,
            s: 15,
            r: 300,
            f: 1.0,
            p1: 300000,
            p2: 1000,
            p3: 10000,
            c_inv: 0,
            c_maint: 0
        },
        bong_mat_duong_pho: {
            id: 'bong_mat_duong_pho',
            name: 'Cây bóng mát đường phố & Hạ nhiệt đảo nhiệt (UHI)',
            desc: 'Trồng cây tán lớn (Sao đen, Dầu rái, Giáng hương, Lim xẹt) dọc các đại lộ TP.HCM che bóng và hạ nhiệt bề mặt.',
            icon: 'fa-road',
            tag: 'Đô thị & Hạ nhiệt',
            n: 2000,
            t: 15,
            c: 25,
            b: 16,
            s: 25,
            r: 450,
            f: 0.92,
            p1: 350000,
            p2: 1200,
            p3: 12000,
            c_inv: 300000000,
            c_maint: 60000000
        },
        cong_vien_do_thi: {
            id: 'cong_vien_do_thi',
            name: 'Công viên cây xanh & Không gian công cộng đa tầng',
            desc: 'Mô hình công viên tập trung (như Tao Đàn, Gia Định, 23/9, Safari Củ Chi) với hệ thực vật đa tầng, cải thiện vi khí hậu.',
            icon: 'fa-tree',
            tag: 'Công viên cảnh quan',
            n: 5000,
            t: 10,
            c: 22,
            b: 14,
            s: 18,
            r: 380,
            f: 0.90,
            p1: 300000,
            p2: 1000,
            p3: 10000,
            c_inv: 600000000,
            c_maint: 150000000
        },
        rung_ngap_man_can_gio: {
            id: 'rung_ngap_man_can_gio',
            name: 'Phục hồi Rừng ngập mặn Cần Giờ (Tín chỉ Carbon xanh)',
            desc: 'Bảo tồn & trồng mới Rừng ngập mặn Cần Giờ (Đước đôi, Mắm, Bần) với khả năng lưu giữ Blue Carbon vượt trội.',
            icon: 'fa-water',
            tag: 'Rừng & Tín chỉ Carbon',
            n: 20000,
            t: 20,
            c: 35,
            b: 25,
            s: 12,
            r: 500,
            f: 0.85,
            p1: 500000,
            p2: 1500,
            p3: 10000,
            c_inv: 1200000000,
            c_maint: 250000000
        },
        thoat_nuoc_chong_ngap: {
            id: 'thoat_nuoc_chong_ngap',
            name: 'Thành phố Bọt biển (Sponge City) & Giảm ngập úng',
            desc: 'Dải cây xanh tiêu thoát nước bền vững (SUDS) tại vùng trũng thấp (Quận 7, Nhà Bè, Thủ Đức), ưu tiên giữ nước mưa.',
            icon: 'fa-cloud-showers-heavy',
            tag: 'Thủy văn & Chống ngập',
            n: 3000,
            t: 10,
            c: 18,
            b: 10,
            s: 16,
            r: 650,
            f: 0.95,
            p1: 300000,
            p2: 1000,
            p3: 15000,
            c_inv: 450000000,
            c_maint: 80000000
        },
        hoc_duong_benh_vien: {
            id: 'hoc_duong_benh_vien',
            name: 'Phủ xanh trường học, bệnh viện & Khu công nghiệp',
            desc: 'Quy mô vừa và nhỏ tại khuôn viên cơ quan, trường học, KCN Linh Trung, Tân Thuận nhằm tạo bóng mát và giảm khói bụi.',
            icon: 'fa-school',
            tag: 'Học đường & KCN',
            n: 800,
            t: 8,
            c: 18,
            b: 10,
            s: 14,
            r: 260,
            f: 0.95,
            p1: 300000,
            p2: 1000,
            p3: 10000,
            c_inv: 120000000,
            c_maint: 25000000
        }
    };

    // State quản lý của mô-đun
    const state = {
        currentScenarioId: 'tong_hop',
        selectedWard: null,
        activeTab: 'formula', // 'formula' | 'chart' | 'matrix'
        charts: {
            pie: null,
            timeline: null
        },
        latestResult: null
    };

    // ---- Format tiền tệ & số liệu Việt Nam chuẩn ----------------------------
    function formatVND(value) {
        if (value === null || value === undefined || isNaN(value)) return '0 đ';
        return Math.round(value).toLocaleString('vi-VN') + ' đ';
    }

    function formatNumberVN(value, decimals = 0) {
        if (value === null || value === undefined || isNaN(value)) return '0';
        return Number(value).toLocaleString('vi-VN', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });
    }

    // ---- Hàm tính toán cốt lõi ---------------------------------------------
    function computeBenefits(params) {
        const N = Math.max(0, parseFloat(params.n) || 0);
        const T = Math.max(0, parseFloat(params.t) || 0);
        const C = Math.max(0, parseFloat(params.c) || 0);
        const B = Math.max(0, parseFloat(params.b) || 0);
        const S = Math.max(0, parseFloat(params.s) || 0);
        const R = Math.max(0, parseFloat(params.r) || 0);
        const f = Math.max(0, Math.min(1.0, parseFloat(params.f) !== undefined ? parseFloat(params.f) : 1.0));
        const P1 = Math.max(0, parseFloat(params.p1) || 0);
        const P2 = Math.max(0, parseFloat(params.p2) || 0);
        const P3 = Math.max(0, parseFloat(params.p3) || 0);
        const C_inv = Math.max(0, parseFloat(params.c_inv) || 0);
        const C_maint = Math.max(0, parseFloat(params.c_maint) || 0);

        // 1. CO2 hấp thụ (tấn) = N * C * T / 1000
        const co2_tons = (N * C * T) / 1000;

        // 2. O2 tạo ra (tấn) = CO2 * (32 / 44) = CO2 * 0.72727...
        const o2_tons = co2_tons * (32 / 44);

        // 3. Sinh khối tăng thêm (kg) = N * B * T
        const biomass_kg = N * B * T;

        // 4. Diện tích bóng mát (m2) = N * S * f
        const shade_m2 = N * S * f;
        const shade_ha = shade_m2 / 10000;

        // 5. Nước mưa giữ lại (m3) = N * R * T / 1000
        const water_m3 = (N * R * T) / 1000;

        // 6. Giá trị carbon G1 = CO2 * P1
        const g1 = co2_tons * P1;

        // 7. Giá trị sinh khối G2 = N * B * T * P2
        const g2 = biomass_kg * P2;

        // 8. Giá trị giảm dòng chảy tràn G3 = V * P3
        const g3 = water_m3 * P3;

        // 9. Tổng lợi ích quy đổi gộp và ròng (trừ chi phí)
        const total_gross = g1 + g2 + g3;
        const total_net = total_gross - C_inv - C_maint;

        // Chuỗi diễn biến theo từng năm
        const yearsCount = Math.max(1, Math.min(50, Math.round(T)));
        const timeline = [];
        for (let y = 1; y <= yearsCount; y++) {
            const y_co2 = (N * C * y) / 1000;
            const y_o2 = y_co2 * (32 / 44);
            const y_bio = N * B * y;
            const y_water = (N * R * y) / 1000;
            const y_g1 = y_co2 * P1;
            const y_g2 = y_bio * P2;
            const y_g3 = y_water * P3;
            const y_tot = y_g1 + y_g2 + y_g3 - C_inv - (C_maint * (y / yearsCount));
            timeline.push({
                year: y,
                co2: y_co2,
                o2: y_o2,
                biomass: y_bio,
                water: y_water,
                g1: y_g1,
                g2: y_g2,
                g3: y_g3,
                total: y_tot
            });
        }

        return {
            N, T, C, B, S, R, f, P1, P2, P3, C_inv, C_maint,
            co2_tons,
            o2_tons,
            biomass_kg,
            shade_m2,
            shade_ha,
            water_m3,
            g1,
            g2,
            g3,
            total_gross,
            total_net,
            timeline
        };
    }

    // ---- Lấy thông số từ giao diện nhập liệu ---------------------------------
    function readFormInputs() {
        return {
            n: parseFloat(document.getElementById('tb-input-n')?.value) || 0,
            t: parseFloat(document.getElementById('tb-input-t')?.value) || 0,
            c: parseFloat(document.getElementById('tb-input-c')?.value) || 0,
            b: parseFloat(document.getElementById('tb-input-b')?.value) || 0,
            s: parseFloat(document.getElementById('tb-input-s')?.value) || 0,
            r: parseFloat(document.getElementById('tb-input-r')?.value) || 0,
            f: parseFloat(document.getElementById('tb-input-f')?.value) || 1.0,
            p1: parseFloat(document.getElementById('tb-input-p1')?.value) || 0,
            p2: parseFloat(document.getElementById('tb-input-p2')?.value) || 0,
            p3: parseFloat(document.getElementById('tb-input-p3')?.value) || 0,
            c_inv: parseFloat(document.getElementById('tb-input-cinv')?.value) || 0,
            c_maint: parseFloat(document.getElementById('tb-input-cmaint')?.value) || 0
        };
    }

    // ---- Đổ thông số vào form ----------------------------------------------
    function setFormInputs(params) {
        if (params.n !== undefined) setVal('tb-input-n', params.n);
        if (params.t !== undefined) setVal('tb-input-t', params.t);
        if (params.c !== undefined) setVal('tb-input-c', params.c);
        if (params.b !== undefined) setVal('tb-input-b', params.b);
        if (params.s !== undefined) setVal('tb-input-s', params.s);
        if (params.r !== undefined) setVal('tb-input-r', params.r);
        if (params.f !== undefined) setVal('tb-input-f', params.f);
        if (params.p1 !== undefined) setVal('tb-input-p1', params.p1);
        if (params.p2 !== undefined) setVal('tb-input-p2', params.p2);
        if (params.p3 !== undefined) setVal('tb-input-p3', params.p3);
        if (params.c_inv !== undefined) setVal('tb-input-cinv', params.c_inv);
        if (params.c_maint !== undefined) setVal('tb-input-cmaint', params.c_maint);
    }

    function setVal(id, val) {
        const el = document.getElementById(id);
        if (el) el.value = val;
    }

    // ---- Cập nhật kết quả lên giao diện -------------------------------------
    function renderResults(res) {
        state.latestResult = res;

        // Bảng kết quả ước tính (chuẩn xác từng hàng như ảnh cô giáo)
        setText('tb-res-co2', formatNumberVN(res.co2_tons, 2) + ' tấn');
        setText('tb-res-o2', formatNumberVN(res.o2_tons, 2) + ' tấn');
        setText('tb-res-biomass', formatNumberVN(res.biomass_kg, 0) + ' kg');
        setText('tb-res-shade', formatNumberVN(res.shade_m2, 0) + ' m²');
        const shadeExtra = document.getElementById('tb-res-shade-sub');
        if (shadeExtra) {
            shadeExtra.innerText = `≈ ${formatNumberVN(res.shade_ha, 2)} ha bóng mát`;
        }
        setText('tb-res-water', formatNumberVN(res.water_m3, 0) + ' m³');
        setText('tb-res-g1', formatVND(res.g1));
        setText('tb-res-g2', formatVND(res.g2));
        setText('tb-res-g3', formatVND(res.g3));
        setText('tb-res-total', formatVND(res.total_gross));

        // Nếu có chi phí thì hiển thị thêm dòng lợi ích ròng
        const netRow = document.getElementById('tb-res-net-row');
        if (netRow) {
            if (res.C_inv > 0 || res.C_maint > 0) {
                netRow.style.display = 'flex';
                setText('tb-res-cost-total', formatVND(res.C_inv + res.C_maint));
                setText('tb-res-net', formatVND(res.total_net));
            } else {
                netRow.style.display = 'none';
            }
        }

        // Cập nhật biểu đồ nếu tab biểu đồ đang mở
        if (state.activeTab === 'chart') {
            updateCharts(res);
        }
    }

    function setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.innerText = text;
    }

    // ---- Xử lý thay đổi kịch bản -------------------------------------------
    function onScenarioChange(scenarioId) {
        state.currentScenarioId = scenarioId;
        const bannerDesc = document.getElementById('tb-scenario-desc');
        const badge = document.getElementById('tb-scenario-badge');

        if (scenarioId === 'ward_selected' && state.selectedWard) {
            applyWardScenario(state.selectedWard);
            return;
        }

        const sc = TREE_SCENARIOS[scenarioId];
        if (sc) {
            setFormInputs(sc);
            if (bannerDesc) bannerDesc.innerText = sc.desc;
            if (badge) {
                badge.innerText = sc.tag || 'Kịch bản mẫu';
                badge.className = 'tb-scenario-badge is-preset';
            }
            const res = computeBenefits(sc);
            renderResults(res);
        } else if (scenarioId === 'custom') {
            if (bannerDesc) bannerDesc.innerText = 'Kịch bản tùy biến: Tự do điều chỉnh mọi thông số đầu vào và chi phí.';
            if (badge) {
                badge.innerText = 'Tùy chỉnh';
                badge.className = 'tb-scenario-badge is-custom';
            }
            onInputLiveUpdate();
        }
    }

    // Cập nhật tức thì khi gõ phím
    function onInputLiveUpdate() {
        const select = document.getElementById('tb-scenario-select');
        const badge = document.getElementById('tb-scenario-badge');
        // Nếu đang không ở custom hoặc ward thì đánh dấu là đang chỉnh sửa tùy biến
        if (select && select.value !== 'custom' && select.value !== 'ward_selected') {
            // Giữ nguyên hoặc có thể để người dùng biết là đã sửa số
            if (badge) {
                badge.innerText = 'Đã chỉnh sửa';
                badge.className = 'tb-scenario-badge is-modified';
            }
        }
        const params = readFormInputs();
        const res = computeBenefits(params);
        renderResults(res);
    }

    // ---- Kịch bản liên kết theo Phường/Xã WebGIS TVDI -----------------------
    function applyWardScenario(ward) {
        if (!ward) return;
        state.selectedWard = ward;
        state.currentScenarioId = 'ward_selected';

        const select = document.getElementById('tb-scenario-select');
        if (select) {
            // Đảm bảo có option ward_selected
            let optWard = select.querySelector('option[value="ward_selected"]');
            if (!optWard) {
                optWard = document.createElement('option');
                optWard.value = 'ward_selected';
                select.appendChild(optWard);
            }
            optWard.innerText = `📍 Phường: ${ward.name} (${ward.district || ''})`;
            select.value = 'ward_selected';
        }

        const areaKm2 = parseFloat(ward.area_km2) || 2.0;
        const areaM2 = areaKm2 * 1000000;

        // Tính số cây khuyến nghị dựa trên diện tích tự nhiên và chỉ số NDVI
        // Nếu NDVI < 0.2: khu vực đô thị đặc thiếu cây -> cần trồng tăng cường ~35 cây/ha
        // Nếu NDVI >= 0.2: duy trì & bổ sung ~18 cây/ha
        const ndvi = ward.ndvi !== undefined && ward.ndvi !== null ? parseFloat(ward.ndvi) : 0.25;
        const treesPerHa = ndvi < 0.20 ? 35 : (ndvi < 0.35 ? 22 : 15);
        const areaHa = areaKm2 * 100;
        const suggestedTrees = Math.min(25000, Math.max(200, Math.round(areaHa * treesPerHa)));

        const wardParams = {
            n: suggestedTrees,
            t: 10,
            c: 22,
            b: 14,
            s: 16,
            r: 350,
            f: 0.92,
            p1: 300000,
            p2: 1000,
            p3: 10000,
            c_inv: suggestedTrees * 120000, // 120k đ/cây
            c_maint: suggestedTrees * 20000 * 10 // 20k đ/cây/năm trong 10 năm
        };

        setFormInputs(wardParams);

        const bannerDesc = document.getElementById('tb-scenario-desc');
        const badge = document.getElementById('tb-scenario-badge');
        if (badge) {
            badge.innerText = `Phường/Xã: ${ward.name}`;
            badge.className = 'tb-scenario-badge is-ward';
        }
        if (bannerDesc) {
            const ndviStr = ward.ndvi !== undefined && ward.ndvi !== null ? Number(ward.ndvi).toFixed(3) : 'Chưa có';
            const tvdiStr = ward.tvdi !== undefined && ward.tvdi !== null ? Number(ward.tvdi).toFixed(3) : 'Chưa có';
            bannerDesc.innerHTML = `<strong>${ward.name}</strong> (${ward.district || 'TP.HCM'}) · Diện tích: <strong>${areaKm2.toFixed(2)} km²</strong> · NDVI hiện trạng: <strong>${ndviStr}</strong> · TVDI: <strong>${tvdiStr}</strong>.<br>Mô phỏng bổ sung <strong>${formatNumberVN(suggestedTrees)} cây</strong> giúp tăng diện tích bóng mát và làm dịu nhiệt độ bề mặt đất LST.`;
        }

        const res = computeBenefits(wardParams);
        renderResults(res);
    }

    // ---- Vẽ biểu đồ Chart.js (Doughnut cơ cấu giá trị & Diễn biến thời gian) ---
    function updateCharts(res) {
        if (!window.Chart) return;
        const pieCanvas = document.getElementById('tb-chart-pie');
        const timelineCanvas = document.getElementById('tb-chart-timeline');

        // 1. Biểu đồ tròn Doughnut: Cơ cấu giá trị kinh tế
        if (pieCanvas) {
            const totalG = res.g1 + res.g2 + res.g3;
            const dataG1 = totalG > 0 ? res.g1 : 1;
            const dataG2 = totalG > 0 ? res.g2 : 1;
            const dataG3 = totalG > 0 ? res.g3 : 1;

            if (state.charts.pie) {
                state.charts.pie.destroy();
            }

            state.charts.pie = new Chart(pieCanvas, {
                type: 'doughnut',
                data: {
                    labels: [
                        `Giá trị Carbon G₁ (${totalG > 0 ? ((res.g1 / totalG) * 100).toFixed(1) : 0}%)`,
                        `Giá trị Sinh khối G₂ (${totalG > 0 ? ((res.g2 / totalG) * 100).toFixed(1) : 0}%)`,
                        `Giá trị Giữ nước mưa G₃ (${totalG > 0 ? ((res.g3 / totalG) * 100).toFixed(1) : 0}%)`
                    ],
                    datasets: [{
                        data: [dataG1, dataG2, dataG3],
                        backgroundColor: ['#10b981', '#f59e0b', '#0284c7'],
                        borderWidth: 2,
                        borderColor: '#ffffff',
                        hoverOffset: 6
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: {
                                boxWidth: 12,
                                font: { size: 11, family: 'Inter, system-ui, sans-serif' },
                                padding: 12
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: (ctx) => ` ${ctx.label.split('(')[0]}: ${formatVND(ctx.raw)}`
                            }
                        }
                    },
                    cutout: '62%'
                }
            });
        }

        // 2. Biểu đồ đường Timeline: Diễn tiến lũy tích theo các năm
        if (timelineCanvas && res.timeline && res.timeline.length > 0) {
            const labels = res.timeline.map(t => `Năm ${t.year}`);
            const dataCarbon = res.timeline.map(t => Math.round(t.g1));
            const dataBiomass = res.timeline.map(t => Math.round(t.g2));
            const dataWater = res.timeline.map(t => Math.round(t.g3));
            const dataTotal = res.timeline.map(t => Math.round(t.total));

            if (state.charts.timeline) {
                state.charts.timeline.destroy();
            }

            state.charts.timeline = new Chart(timelineCanvas, {
                type: 'line',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'Lợi ích ròng (đồng)',
                            data: dataTotal,
                            borderColor: '#16a34a',
                            backgroundColor: 'rgba(22, 163, 74, 0.12)',
                            fill: true,
                            borderWidth: 3,
                            tension: 0.3,
                            pointRadius: 3
                        },
                        {
                            label: 'Giá trị Carbon G₁',
                            data: dataCarbon,
                            borderColor: '#10b981',
                            borderWidth: 1.8,
                            borderDash: [4, 4],
                            pointRadius: 0
                        },
                        {
                            label: 'Giá trị Sinh khối G₂',
                            data: dataBiomass,
                            borderColor: '#f59e0b',
                            borderWidth: 1.8,
                            borderDash: [4, 4],
                            pointRadius: 0
                        },
                        {
                            label: 'Giá trị Giữ nước G₃',
                            data: dataWater,
                            borderColor: '#0284c7',
                            borderWidth: 1.8,
                            borderDash: [4, 4],
                            pointRadius: 0
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        mode: 'index',
                        intersect: false
                    },
                    scales: {
                        y: {
                            ticks: {
                                callback: (val) => {
                                    if (val >= 1e9) return (val / 1e9).toFixed(1) + ' tỷ';
                                    if (val >= 1e6) return (val / 1e6).toFixed(0) + ' tr';
                                    return val.toLocaleString('vi-VN');
                                },
                                font: { size: 10 }
                            },
                            grid: { color: 'rgba(0,0,0,0.05)' }
                        },
                        x: {
                            ticks: { font: { size: 10 } },
                            grid: { display: false }
                        }
                    },
                    plugins: {
                        legend: {
                            position: 'top',
                            labels: {
                                boxWidth: 10,
                                font: { size: 11 },
                                padding: 8
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: (ctx) => ` ${ctx.dataset.label}: ${formatVND(ctx.raw)}`
                            }
                        }
                    }
                }
            });
        }
    }

    // ---- Hiển thị Bảng so sánh đa kịch bản (Scenario Matrix) -----------------
    function renderScenarioMatrix() {
        const tbody = document.getElementById('tb-matrix-body');
        if (!tbody) return;

        const scenariosList = Object.values(TREE_SCENARIOS);
        let html = '';

        scenariosList.forEach(sc => {
            const res = computeBenefits(sc);
            const isCurrent = sc.id === state.currentScenarioId;
            html += `
                <tr class="${isCurrent ? 'is-selected-scenario' : ''}">
                    <td class="col-name">
                        <div class="matrix-name-cell">
                            <i class="fa-solid ${sc.icon || 'fa-tree'}" style="color: #16a34a;"></i>
                            <div>
                                <strong>${sc.name}</strong>
                                <span class="matrix-tag">${sc.tag}</span>
                            </div>
                        </div>
                    </td>
                    <td class="text-right">${formatNumberVN(sc.n)}</td>
                    <td class="text-right">${sc.t} năm</td>
                    <td class="text-right font-semibold text-emerald">${formatNumberVN(res.co2_tons, 1)} tấn</td>
                    <td class="text-right">${formatNumberVN(res.o2_tons, 1)} tấn</td>
                    <td class="text-right">${formatNumberVN(res.shade_m2, 0)} m²</td>
                    <td class="text-right text-blue">${formatNumberVN(res.water_m3, 0)} m³</td>
                    <td class="text-right font-bold text-success">${formatVND(res.total_gross)}</td>
                    <td class="text-center">
                        <button class="btn-matrix-apply" onclick="TreeBenefitModule.selectPreset('${sc.id}')" title="Chọn kịch bản này">
                            ${isCurrent ? '<i class="fa-solid fa-check"></i> Đang chọn' : '<i class="fa-solid fa-arrow-right"></i> Áp dụng'}
                        </button>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html;
    }

    // ---- Sao chép công thức Word Equation & LaTeX --------------------------
    function copyWordEquations() {
        const eqText = `=== CÔNG THỨC TÍNH LỢI ÍCH TRỒNG CÂY XANH (EQUATION WORD / LATEX) ===

1. Khối lượng CO2 hấp thụ:
   CO2 = (N * C * T) / 1000   [tấn CO2]
   Word Equation: CO_2 = (N \\times C \\times T) / 1000

2. Khối lượng Oxy giải phóng:
   O2 = CO2 * 0.727   [tấn O2] (tỷ số phân tử khối O2/CO2 = 32/44)
   Word Equation: O_2 = CO_2 \\times 0.727

3. Sinh khối tăng thêm tích lũy:
   B_total = N * B * T   [kg sinh khối]
   Word Equation: B_{total} = N \\times B \\times T

4. Diện tích tán che bóng mát:
   S_total = N * S * f   [m², f hệ số không chồng lấn]
   Word Equation: S_{total} = N \\times S \\times f

5. Thể tích nước mưa giữ lại:
   V = (N * R * T) / 1000   [m³]
   Word Equation: V = (N \\times R \\times T) / 1000

6. Giá trị kinh tế quy đổi:
   - Giá trị Carbon: G1 = CO2 * P1  [đồng]
   - Giá trị Sinh khối: G2 = N * B * T * P2  [đồng]
   - Giá trị giảm dòng chảy tràn nước mưa: G3 = V * P3  [đồng]
   - Tổng lợi ích quy đổi ròng:
     G_tổng = G1 + G2 + G3 - C_đầu_tư - C_bảo_dưỡng
     Word Equation: G_{tổng} = G_1 + G_2 + G_3 - C_{đầu tư} - C_{bảo dưỡng}`;

        navigator.clipboard.writeText(eqText).then(() => {
            showToast('Đã sao chép công thức dạng Word Equation vào bộ nhớ tạm!');
        }).catch(() => {
            prompt('Sao chép công thức Word dưới đây:', eqText);
        });
    }

    // ---- Sao chép kết quả tóm tắt ------------------------------------------
    function copySummaryText() {
        if (!state.latestResult) return;
        const r = state.latestResult;
        const text = `🌱 KẾT QUẢ TÍNH TOÁN LỢI ÍCH TRỒNG CÂY XANH
- Số cây (N): ${formatNumberVN(r.N)} cây | Thời gian (T): ${r.T} năm
- CO₂ hấp thụ: ${formatNumberVN(r.co2_tons, 2)} tấn CO₂
- O₂ tạo ra: ${formatNumberVN(r.o2_tons, 2)} tấn O₂
- Sinh khối tăng thêm: ${formatNumberVN(r.biomass_kg, 0)} kg
- Diện tích bóng mát: ${formatNumberVN(r.shade_m2, 0)} m² (${formatNumberVN(r.shade_ha, 2)} ha)
- Nước mưa giữ lại: ${formatNumberVN(r.water_m3, 0)} m³
- Giá trị carbon (G₁): ${formatVND(r.g1)}
- Giá trị sinh khối (G₂): ${formatVND(r.g2)}
- Giá trị trữ nước (G₃): ${formatVND(r.g3)}
=> TỔNG LỢI ÍCH QUY ĐỔI: ${formatVND(r.total_gross)}
(Hệ thống WebGIS TVDI TP.HCM)`;

        navigator.clipboard.writeText(text).then(() => {
            showToast('Đã sao chép kết quả tính toán!');
        }).catch(() => {
            prompt('Sao chép kết quả:', text);
        });
    }

    // ---- Xuất file CSV báo cáo ---------------------------------------------
    function exportCSV() {
        if (!state.latestResult) return;
        const r = state.latestResult;
        let csv = '\uFEFF'; // BOM UTF-8
        csv += 'BAO CAO DANH GIA LOI ICH TRONG CAY XANH\n';
        csv += `Ngay lap,${new Date().toLocaleDateString('vi-VN')}\n`;
        csv += `Kich ban,${state.currentScenarioId}\n\n`;

        csv += 'THAM SO DAU VAO,Gia tri,Don vi\n';
        csv += `So cay trong (N),${r.N},cay\n`;
        csv += `Thoi gian tinh toan (T),${r.T},nam\n`;
        csv += `Luong CO2 hap thu/cay/nam (C),${r.C},kg/cay/nam\n`;
        csv += `Sinh khoi tang them/cay/nam (B),${r.B},kg/cay/nam\n`;
        csv += `Dien tich tan la/cay (S),${r.S},m2/cay\n`;
        csv += `Nuoc mua giu lai/cay/nam (R),${r.R},lit/cay/nam\n`;
        csv += `He so tan khong chong lan (f),${r.f},-\n`;
        csv += `Gia tin chi carbon (P1),${r.P1},dong/tan CO2\n`;
        csv += `Gia sinh khoi (P2),${r.P2},dong/kg\n`;
        csv += `Gia tri nuoc mua giu lai (P3),${r.P3},dong/m3\n`;
        csv += `Chi phi dau tu ban dau (C_inv),${r.C_inv},dong\n`;
        csv += `Chi phi cham soc bao duong (C_maint),${r.C_maint},dong\n\n`;

        csv += 'KET QUA UOC TINH TONG HOP,Gia tri,Don vi\n';
        csv += `CO2 hap thu,${r.co2_tons.toFixed(2)},tan CO2\n`;
        csv += `Oxy giai phong,${r.o2_tons.toFixed(2)},tan O2\n`;
        csv += `Sinh khoi tich luy,${r.biomass_kg.toFixed(0)},kg\n`;
        csv += `Dien tich bong mat,${r.shade_m2.toFixed(0)},m2\n`;
        csv += `Nuoc mua giu lai,${r.water_m3.toFixed(0)},m3\n`;
        csv += `Gia tri carbon (G1),${r.g1.toFixed(0)},dong\n`;
        csv += `Gia tri sinh khoi (G2),${r.g2.toFixed(0)},dong\n`;
        csv += `Gia tri giam dong chay tran (G3),${r.g3.toFixed(0)},dong\n`;
        csv += `Tong loi ich gop quy doi,${r.total_gross.toFixed(0)},dong\n`;
        csv += `Tong loi ich rong (tru chi phi),${r.total_net.toFixed(0)},dong\n\n`;

        if (r.timeline && r.timeline.length > 0) {
            csv += 'DIEN BIEN TICH LUY THEO NAM\n';
            csv += 'Nam,CO2 luy ke (tan),Oxy (tan),Sinh khoi (kg),Nuoc giu (m3),Gia tri Carbon (d),Gia tri Sinh khoi (d),Gia tri Nuoc (d),Loi ich quy doi (d)\n';
            r.timeline.forEach(t => {
                csv += `${t.year},${t.co2.toFixed(2)},${t.o2.toFixed(2)},${t.biomass.toFixed(0)},${t.water.toFixed(0)},${t.g1.toFixed(0)},${t.g2.toFixed(0)},${t.g3.toFixed(0)},${t.total.toFixed(0)}\n`;
            });
        }

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `Loi_ich_trong_cay_${state.currentScenarioId}_${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        showToast('Đã xuất báo cáo CSV thành công!');
    }

    // ---- In ấn báo cáo A4 --------------------------------------------------
    function printReport() {
        window.print();
    }

    // ---- Toast thông báo ngắn gọn ------------------------------------------
    function showToast(msg) {
        if (typeof window.showToast === 'function') {
            window.showToast(msg);
            return;
        }
        const toast = document.getElementById('app-toast');
        if (toast) {
            toast.innerText = msg;
            toast.style.display = 'block';
            setTimeout(() => { toast.style.display = 'none'; }, 2500);
        }
    }

    // ---- Chuyển tab bên phải (Công thức / Biểu đồ / So sánh) ----------------
    function switchTab(tabId) {
        state.activeTab = tabId;
        const tabBtns = document.querySelectorAll('.tb-right-tab-btn');
        tabBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabId);
        });

        const tabPanes = document.querySelectorAll('.tb-tab-pane');
        tabPanes.forEach(pane => {
            pane.style.display = pane.id === `tb-pane-${tabId}` ? 'block' : 'none';
        });

        if (tabId === 'chart') {
            // Re-render chart sau khi container hiển thị
            setTimeout(() => {
                if (state.latestResult) updateCharts(state.latestResult);
            }, 50);
        } else if (tabId === 'matrix') {
            renderScenarioMatrix();
        }
    }

    // ---- Mở / Đóng Modal ----------------------------------------------------
    function openModal(ward = null) {
        const modal = document.getElementById('tree-benefit-modal');
        if (!modal) return;
        modal.style.display = 'flex';

        // Điền danh sách phường vào select nếu chưa có
        populateWardSelect();

        if (ward) {
            applyWardScenario(ward);
        } else {
            // Mặc định nạp kịch bản hiện tại
            onScenarioChange(state.currentScenarioId);
        }
    }

    function closeModal() {
        const modal = document.getElementById('tree-benefit-modal');
        if (modal) modal.style.display = 'none';
    }

    // Nạp danh sách 167 phường vào select bên trong modal
    function populateWardSelect() {
        const sel = document.getElementById('tb-ward-select');
        if (!sel || sel.options.length > 1) return;

        const wards = (window.state && window.state.wards && window.state.wards.allList) || [];
        if (wards.length === 0) return;

        sel.innerHTML = '<option value="">-- Chọn Phường/Xã để tính toán tự động --</option>';
        wards.forEach(w => {
            const opt = document.createElement('option');
            opt.value = w.ward_id;
            opt.innerText = `${w.name} - ${w.district || 'TP.HCM'}`;
            sel.appendChild(opt);
        });
    }

    // Gắn sự kiện khi khởi tạo
    function init() {
        // Nút mở modal từ Header
        const btnHeader = document.getElementById('btn-open-tree-benefit');
        if (btnHeader) {
            btnHeader.addEventListener('click', () => openModal());
        }

        // Nút đóng modal
        const btnClose = document.getElementById('btn-close-tb-modal');
        if (btnClose) btnClose.addEventListener('click', closeModal);
        const btnCloseFooter = document.getElementById('btn-close-tb-modal-footer');
        if (btnCloseFooter) btnCloseFooter.addEventListener('click', closeModal);

        // Đóng khi click ngoài modal
        const modal = document.getElementById('tree-benefit-modal');
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) closeModal();
            });
        }

        // Dropdown chọn kịch bản
        const scSelect = document.getElementById('tb-scenario-select');
        if (scSelect) {
            scSelect.addEventListener('change', (e) => onScenarioChange(e.target.value));
        }

        // Dropdown chọn Phường/Xã
        const wardSelect = document.getElementById('tb-ward-select');
        if (wardSelect) {
            wardSelect.addEventListener('change', (e) => {
                const wId = parseInt(e.target.value, 10);
                if (!wId) return;
                const wards = (window.state && window.state.wards && window.state.wards.allList) || [];
                const matched = wards.find(w => w.ward_id === wId);
                if (matched) applyWardScenario(matched);
            });
        }

        // Live update trên các input
        const inputIds = [
            'tb-input-n', 'tb-input-t', 'tb-input-c', 'tb-input-b',
            'tb-input-s', 'tb-input-r', 'tb-input-f', 'tb-input-p1',
            'tb-input-p2', 'tb-input-p3', 'tb-input-cinv', 'tb-input-cmaint'
        ];
        inputIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', onInputLiveUpdate);
                el.addEventListener('change', onInputLiveUpdate);
            }
        });

        // Nút tính lợi ích (tường minh)
        const btnCalc = document.getElementById('btn-tb-calculate');
        if (btnCalc) {
            btnCalc.addEventListener('click', () => {
                onInputLiveUpdate();
                showToast('Đã tính toán xong lợi ích trồng cây!');
            });
        }

        // Nút khôi phục mặc định
        const btnReset = document.getElementById('btn-tb-reset');
        if (btnReset) {
            btnReset.addEventListener('click', () => {
                const scSelect = document.getElementById('tb-scenario-select');
                if (scSelect) scSelect.value = 'tong_hop';
                onScenarioChange('tong_hop');
                showToast('Đã khôi phục thông số chuẩn tham khảo!');
            });
        }

        // Tab chuyển đổi bên phải
        const tabBtns = document.querySelectorAll('.tb-right-tab-btn');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => switchTab(btn.dataset.tab));
        });

        // Nút sao chép Word Equation
        const btnCopyEq = document.getElementById('btn-tb-copy-equation');
        if (btnCopyEq) btnCopyEq.addEventListener('click', copyWordEquations);

        // Nút sao chép tóm tắt
        const btnCopySum = document.getElementById('btn-tb-copy-summary');
        if (btnCopySum) btnCopySum.addEventListener('click', copySummaryText);

        // Nút xuất CSV
        const btnExportCsv = document.getElementById('btn-tb-export-csv');
        if (btnExportCsv) btnExportCsv.addEventListener('click', exportCSV);

        // Nút in ấn
        const btnPrint = document.getElementById('btn-tb-print');
        if (btnPrint) btnPrint.addEventListener('click', printReport);
    }

    // Khởi chạy khi DOM đã sẵn sàng
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Xuất module ra window
    window.TreeBenefitModule = {
        openModal,
        closeModal,
        applyWardScenario,
        selectPreset: (scId) => {
            const scSelect = document.getElementById('tb-scenario-select');
            if (scSelect) scSelect.value = scId;
            onScenarioChange(scId);
            switchTab('formula');
            showToast('Đã chuyển sang kịch bản ' + scId);
        },
        computeBenefits,
        exportCSV,
        printReport,
        copyWordEquations,
        copySummaryText
    };

})(window);
