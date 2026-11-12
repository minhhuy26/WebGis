/**
 * ============================================================================
 * Module Bản tin & Báo cáo Tổng hợp (Bản đồ + Biểu đồ + Bảng + Lưu CSDL + Export)
 * Hệ thống WebGIS Giám sát & Dự báo Khô hạn TVDI – TP. Hồ Chí Minh
 * ============================================================================
 */

const BULLETIN_DROUGHT_CLASSES = [
    { level: 1, code: 'Cấp 1', label: 'Rất ẩm / Ngập nước', range: '≤ 0.125', color: '#066b00', risk: 'Đất bão hòa ẩm, nguy cơ ngập cục bộ' },
    { level: 2, code: 'Cấp 2', label: 'Ẩm ướt', range: '0.125 – 0.250', color: '#0bc400', risk: 'Sinh trưởng thực vật rất thuận lợi' },
    { level: 3, code: 'Cấp 3', label: 'Đủ ẩm, phát triển tốt', range: '0.250 – 0.375', color: '#0ce100', risk: 'Độ ẩm đầy đủ, ổn định' },
    { level: 4, code: 'Cấp 4', label: 'Bình thường', range: '0.375 – 0.500', color: '#00ff00', risk: 'Trạng thái cân bằng, tiếp tục quan trắc' },
    { level: 5, code: 'Cấp 5', label: 'Bắt đầu khô hạn nhẹ', range: '0.500 – 0.625', color: '#ffff00', risk: 'Cảnh báo cấp 1: Chớm thiếu ẩm' },
    { level: 6, code: 'Cấp 6', label: 'Hạn vừa', range: '0.625 – 0.750', color: '#ffcc00', risk: 'Cảnh báo cấp 2: Cần điều tiết tưới' },
    { level: 7, code: 'Cấp 7', label: 'Hạn nặng', range: '0.750 – 0.875', color: '#ff6600', risk: 'Báo động cấp 3: Nguy cơ cháy rừng cao' },
    { level: 8, code: 'Cấp 8', label: 'Hạn gay gắt / Khô khốc', range: '> 0.875', color: '#ff0000', risk: 'Báo động khẩn cấp: Thiếu nước nghiêm trọng' },
];

const bulletinState = {
    currentDraft: null,
    lastMapDataUrl: '',
    lastSeriesChartUrl: '',
    lastDistChartUrl: '',
};

function _escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function _isBulletinAdmin() {
    return (typeof isAdminUser === 'function') ? isAdminUser() : false;
}

function _cleanBulletinTextForRole(str) {
    const raw = String(str || '');
    if (_isBulletinAdmin() || !raw) return raw;
    return raw
        .replace(/\s*\(AI Random Forest\)/gi, '')
        .replace(/\s*\(Giả lập(?:\s*[·\-]\s*Landsat(?:\s*8\/9)?)?\)/gi, '')
        .replace(/\(Kỳ\s+Landsat\s+/gi, '(Kỳ ')
        .replace(/Dự báo\s+AI\s+Random Forest/gi, 'Dự báo')
        .replace(/Quan trắc\s+vệ tinh\s+Landsat(?:\s*8\/9)?/gi, 'Quan trắc')
        .replace(/\s*Số liệu dự báo 7 ngày được mô phỏng giả lập[^.]*\./gi, '')
        .replace(/\s*Số liệu dự báo 12 tháng được tính toán từ mô hình AI Random Forest[^.]*\./gi, '')
        .replace(/\s*Số liệu quan trắc thực tế từ ảnh viễn thám Landsat[^.]*\./gi, '')
        .replace(/\s*theo chu kỳ vệ tinh(?=\s)/gi, '')
        .replace(/\s*(?:Landsat\s*8\/9|Landsat|Google Earth Engine|Random Forest)/gi, '')
        .replace(/\bAI\b/g, '')
        .replace(/\(\s*\)/g, '')
        .replace(/\s+([,.;:)])/g, '$1')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function _formatHorizonBadge(bType) {
    const isAdmin = _isBulletinAdmin();
    if (!isAdmin) {
        if (bType === 'daily_7d') return '<span class="bul-badge is-sim"><i class="fa-solid fa-calendar-day"></i> Dự báo 7 ngày</span>';
        if (bType === 'monthly_12m') return '<span class="bul-badge is-ai"><i class="fa-solid fa-calendar-days"></i> Dự báo 12 tháng</span>';
        if (bType === 'aggregate') return '<span class="bul-badge is-obs"><i class="fa-solid fa-calendar-week"></i> Tổng hợp quan trắc</span>';
        return '<span class="bul-badge is-obs"><i class="fa-solid fa-eye"></i> Quan trắc thực tế</span>';
    }
    if (bType === 'daily_7d') return '<span class="bul-badge is-sim"><i class="fa-solid fa-flask"></i> Dự báo 7 ngày (Giả lập · Landsat)</span>';
    if (bType === 'monthly_12m') return '<span class="bul-badge is-ai"><i class="fa-solid fa-brain"></i> Dự báo 12 tháng (AI Random Forest)</span>';
    if (bType === 'aggregate') return '<span class="bul-badge is-obs"><i class="fa-solid fa-calendar-week"></i> Tổng hợp quan trắc Landsat</span>';
    return '<span class="bul-badge is-obs"><i class="fa-solid fa-satellite"></i> Quan trắc thực tế Landsat 8/9</span>';
}

// Vẽ ảnh Bản đồ chuyên đề trực tiếp lên Canvas từ dữ liệu đang hiển thị (không phụ thuộc tile CORS)
function renderBulletinMapDataUrl(layerKey = 'tvdi', customSubtitle = '') {
    const key = INDEX_META[layerKey] ? layerKey : 'tvdi';
    const meta = INDEX_META[key];
    const grid = (typeof computeRasterGrid === 'function') ? computeRasterGrid(key) : null;

    const W = 640;
    const H = 740;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    // Khung ngoài trang bản đồ
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(8, 8, W - 16, H - 16);

    // Tiêu đề bản đồ nhỏ
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 16px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`BẢN ĐỒ PHÂN VÙNG ${meta.label.toUpperCase()} – TP. HỒ CHÍ MINH`, W / 2, 34);

    ctx.fillStyle = '#475569';
    ctx.font = '12px "Segoe UI", Arial, sans-serif';
    const sub = customSubtitle || (typeof describeCurrentView === 'function' ? describeCurrentView(false) : (state.currentDate || ''));
    ctx.fillText(sub, W / 2, 54);

    const mapBox = { x: 52, y: 68, w: W - 78, h: H - 178 };
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(mapBox.x, mapBox.y, mapBox.w, mapBox.h);

    const minLon = grid ? grid.minLon : 106.34;
    const maxLon = grid ? grid.maxLon : 107.03;
    const minLat = grid ? grid.minLat : 10.36;
    const maxLat = grid ? grid.maxLat : 11.17;
    const cosLat = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);

    const geoW = (maxLon - minLon) * cosLat;
    const geoH = (maxLat - minLat);
    const scale = Math.min((mapBox.w - 16) / geoW, (mapBox.h - 16) / geoH);
    const drawW = geoW * scale;
    const drawH = geoH * scale;
    const offX = mapBox.x + (mapBox.w - drawW) / 2;
    const offY = mapBox.y + (mapBox.h - drawH) / 2;

    const projX = (lon) => offX + ((lon - minLon) * cosLat) * scale;
    const projY = (lat) => offY + (maxLat - lat) * scale;

    // Lưới kinh vĩ tuyến mờ
    ctx.save();
    ctx.beginPath();
    ctx.rect(mapBox.x, mapBox.y, mapBox.w, mapBox.h);
    ctx.clip();

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
    ctx.lineWidth = 0.8;
    const lonTicks = [106.4, 106.6, 106.8, 107.0];
    const latTicks = [10.4, 10.6, 10.8, 11.0];
    lonTicks.forEach(ln => {
        const x = projX(ln);
        ctx.beginPath();
        ctx.moveTo(x, mapBox.y);
        ctx.lineTo(x, mapBox.y + mapBox.h);
        ctx.stroke();
    });
    latTicks.forEach(lt => {
        const y = projY(lt);
        ctx.beginPath();
        ctx.moveTo(mapBox.x, y);
        ctx.lineTo(mapBox.x + mapBox.w, y);
        ctx.stroke();
    });

    // 1. Vẽ bề mặt raster IDW chuẩn ranh giới
    if (grid) {
        const tmp = document.createElement('canvas');
        tmp.width = grid.w;
        tmp.height = grid.h;
        const tctx = tmp.getContext('2d');
        const img = tctx.createImageData(grid.w, grid.h);
        const px = img.data;
        for (let i = 0; i < grid.w * grid.h; i++) {
            const st = grid.status[i];
            if (st === 0) continue;
            const rgba = st === 2 ? interpolateColor(key, grid.values[i]) : NODATA_RGBA;
            const o = i * 4;
            px[o] = rgba[0];
            px[o + 1] = rgba[1];
            px[o + 2] = rgba[2];
            px[o + 3] = 235;
        }
        tctx.putImageData(img, 0, 0);
        ctx.drawImage(tmp, offX, offY, drawW, drawH);
    }

    // Helper vẽ GeoJSON Polygon / MultiPolygon lên canvas
    const drawGeoFeatures = (geojson, strokeColor, lineWidth, fillFn = null) => {
        if (!geojson || !geojson.features) return;
        geojson.features.forEach(f => {
            if (!f.geometry) return;
            const polys = f.geometry.type === 'Polygon'
                ? [f.geometry.coordinates]
                : (f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : []);
            ctx.beginPath();
            polys.forEach(poly => {
                poly.forEach(ring => {
                    ring.forEach((pt, idx) => {
                        const x = projX(pt[0]);
                        const y = projY(pt[1]);
                        if (idx === 0) ctx.moveTo(x, y);
                        else ctx.lineTo(x, y);
                    });
                    ctx.closePath();
                });
            });
            if (fillFn) {
                const fc = fillFn(f);
                if (fc) {
                    ctx.fillStyle = fc;
                    ctx.fill('evenodd');
                }
            }
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = lineWidth;
            ctx.stroke();
        });
    };

    // Nếu đang bật chế độ phường/xã thì tô màu choropleth theo phường
    if (state.displayMode === 'ward' && state.wardsBoundaryGeoJson && typeof buildWardValueMap === 'function') {
        const vMap = buildWardValueMap(key);
        drawGeoFeatures(state.wardsBoundaryGeoJson, '#334155', 0.7, (feat) => {
            const p = feat.properties || {};
            const info = vMap.get(removeVietnameseTones(p.fullName || p.name || ''));
            if (!info || info.value === null) return 'rgba(203, 213, 225, 0.8)';
            const c = interpolateColor(key, info.value);
            return `rgba(${c[0]},${c[1]},${c[2]},0.88)`;
        });
    } else if (state.wardsBoundaryGeoJson) {
        drawGeoFeatures(state.wardsBoundaryGeoJson, 'rgba(15, 23, 42, 0.35)', 0.55);
    }

    if (state.boundaryGeoJson) {
        drawGeoFeatures(state.boundaryGeoJson, '#0f172a', 1.6);
    }
    ctx.restore();

    // Khung bản đồ & Nhãn tọa độ
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(mapBox.x, mapBox.y, mapBox.w, mapBox.h);

    ctx.fillStyle = '#475569';
    ctx.font = '10px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    lonTicks.forEach(ln => {
        const x = projX(ln);
        if (x > mapBox.x + 15 && x < mapBox.x + mapBox.w - 15) {
            ctx.beginPath();
            ctx.moveTo(x, mapBox.y + mapBox.h);
            ctx.lineTo(x, mapBox.y + mapBox.h + 4);
            ctx.stroke();
            ctx.fillText(`${ln.toFixed(1)}°E`, x, mapBox.y + mapBox.h + 15);
        }
    });
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    latTicks.forEach(lt => {
        const y = projY(lt);
        if (y > mapBox.y + 12 && y < mapBox.y + mapBox.h - 12) {
            ctx.beginPath();
            ctx.moveTo(mapBox.x - 4, y);
            ctx.lineTo(mapBox.x, y);
            ctx.stroke();
            ctx.fillText(`${lt.toFixed(1)}°N`, mapBox.x - 7, y);
        }
    });
    ctx.textBaseline = 'alphabetic';

    // Mũi tên hướng Bắc (góc trên phải)
    const nx = mapBox.x + mapBox.w - 28;
    const ny = mapBox.y + 30;
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 11px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', nx, ny - 14);
    ctx.beginPath();
    ctx.moveTo(nx, ny - 10);
    ctx.lineTo(nx + 7, ny + 8);
    ctx.lineTo(nx, ny + 3);
    ctx.lineTo(nx - 7, ny + 8);
    ctx.closePath();
    ctx.fill();

    // Thanh tỷ lệ xích (góc dưới trái)
    const kmPerDegLon = 111.32 * cosLat;
    const px10km = (10 / kmPerDegLon) * cosLat * scale;
    const sx = mapBox.x + 16;
    const sy = mapBox.y + mapBox.h - 18;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(sx - 6, sy - 18, px10km + 24, 24);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx, sy - 4);
    ctx.lineTo(sx, sy);
    ctx.lineTo(sx + px10km, sy);
    ctx.lineTo(sx + px10km, sy - 4);
    ctx.stroke();
    ctx.fillStyle = '#0f172a';
    ctx.font = '10px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('0', sx - 2, sy - 7);
    ctx.textAlign = 'right';
    ctx.fillText('10 km', sx + px10km + 8, sy - 7);

    // Thanh chú giải màu phía dưới
    const legY = mapBox.y + mapBox.h + 34;
    const legX = mapBox.x + 10;
    const legW = mapBox.w - 20;
    const legH = 14;
    const cfg = (state.vizRange && state.vizRange[key]) ? state.vizRange[key] : { min: meta.min, max: meta.max };

    const steps = 64;
    for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        const v = cfg.min + t * (cfg.max - cfg.min);
        const rgba = interpolateColor(key, v);
        ctx.fillStyle = `rgb(${rgba[0]},${rgba[1]},${rgba[2]})`;
        ctx.fillRect(legX + (i / steps) * legW, legY, legW / steps + 1, legH);
    }
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 0.8;
    ctx.strokeRect(legX, legY, legW, legH);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 11px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${cfg.min} (${key === 'tvdi' ? 'Rất ẩm' : (key === 'lst' ? 'Mát' : 'Ít thực bì')})`, legX, legY + 30);
    ctx.textAlign = 'center';
    ctx.fillText(`Thang giá trị ${meta.label} · WGS 84`, legX + legW / 2, legY + 30);
    ctx.textAlign = 'right';
    ctx.fillText(`${cfg.max}${meta.unit ? ' ' + meta.unit : ''} (${key === 'tvdi' ? 'Khô khốc' : (key === 'lst' ? 'Nóng' : 'Rậm rạp')})`, legX + legW, legY + 30);

    return canvas.toDataURL('image/png');
}

// Vẽ 2 biểu đồ snapshot PNG (Chuỗi thời gian + Phân bố 8 cấp độ) bằng Chart.js
function renderBulletinChartsDataUrls(seriesPoints = [], levelCounts = {}, activeKey = 'tvdi', bType = 'observed') {
    const key = INDEX_META[activeKey] ? activeKey : 'tvdi';
    const meta = INDEX_META[key];
    const result = { seriesImg: '', distImg: '' };

    if (typeof Chart === 'undefined') return result;

    // 1. Biểu đồ chuỗi thời gian
    if (seriesPoints && seriesPoints.length > 0) {
        const c1 = document.createElement('canvas');
        c1.width = 580;
        c1.height = 250;
        const ctx1 = c1.getContext('2d');
        ctx1.fillStyle = '#ffffff';
        ctx1.fillRect(0, 0, c1.width, c1.height);

        const labels = seriesPoints.map(p => {
            const d = p.date || '';
            return bType === 'monthly_12m' ? `T${d.substring(5, 7)}/${d.substring(2, 4)}` : `${d.substring(8, 10)}/${d.substring(5, 7)}`;
        });
        const prop = key === 'lst' ? 'lst_c' : key;
        const vals = seriesPoints.map(p => {
            const v = p[prop] ?? p.tvdi;
            return v !== null && v !== undefined ? Number(v) : null;
        });

        const ch1 = new Chart(ctx1, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: `${meta.label}`,
                    data: vals,
                    borderColor: bType === 'daily_7d' ? '#0284c7' : '#4f46e5',
                    borderWidth: 2.5,
                    borderDash: bType === 'daily_7d' ? [6, 3] : [],
                    backgroundColor: bType === 'daily_7d' ? 'rgba(2, 132, 199, 0.14)' : 'rgba(79, 70, 229, 0.14)',
                    fill: true,
                    tension: 0.32,
                    pointRadius: 3.5,
                    pointBackgroundColor: bType === 'daily_7d' ? '#0284c7' : '#4f46e5',
                }],
            },
            options: {
                responsive: false,
                animation: false,
                plugins: {
                    legend: { display: false },
                    title: {
                        display: true,
                        text: _isBulletinAdmin()
                            ? `Diễn biến ${meta.label} (${bType === 'daily_7d' ? '7 ngày · Giả lập' : (bType === 'monthly_12m' ? '12 tháng · AI' : 'Các kỳ quan trắc')})`
                            : `Diễn biến ${meta.label} (${bType === 'daily_7d' ? '7 ngày' : (bType === 'monthly_12m' ? '12 tháng' : 'Các kỳ quan trắc')})`,
                        color: '#0f172a',
                        font: { size: 13, weight: 'bold' },
                    },
                },
                scales: {
                    x: { ticks: { font: { size: 10 }, color: '#475569' }, grid: { display: false } },
                    y: { ticks: { font: { size: 10 }, color: '#475569' }, grid: { color: '#e2e8f0' } },
                },
            },
        });
        result.seriesImg = c1.toDataURL('image/png');
        ch1.destroy();
    }

    // 2. Biểu đồ cột phân bố 8 cấp độ khô hạn TVDI
    const c2 = document.createElement('canvas');
    c2.width = 580;
    c2.height = 250;
    const ctx2 = c2.getContext('2d');
    ctx2.fillStyle = '#ffffff';
    ctx2.fillRect(0, 0, c2.width, c2.height);

    const lvlLabels = BULLETIN_DROUGHT_CLASSES.map(d => d.code);
    const lvlValues = BULLETIN_DROUGHT_CLASSES.map(d => Number(levelCounts[String(d.level)] ?? levelCounts[d.level] ?? 0));
    const lvlColors = BULLETIN_DROUGHT_CLASSES.map(d => d.color);

    const ch2 = new Chart(ctx2, {
        type: 'bar',
        data: {
            labels: lvlLabels,
            datasets: [{
                label: 'Số ô lưới',
                data: lvlValues,
                backgroundColor: lvlColors,
                borderColor: '#334155',
                borderWidth: 0.7,
                borderRadius: 4,
            }],
        },
        options: {
            responsive: false,
            animation: false,
            plugins: {
                legend: { display: false },
                title: {
                    display: true,
                    text: 'Phân bố số ô lưới theo 8 cấp độ khô hạn (TVDI)',
                    color: '#0f172a',
                    font: { size: 13, weight: 'bold' },
                },
            },
            scales: {
                x: { ticks: { font: { size: 10 }, color: '#334155' }, grid: { display: false } },
                y: { beginAtZero: true, ticks: { font: { size: 10 }, color: '#475569' }, grid: { color: '#e2e8f0' } },
            },
        },
    });
    result.distImg = c2.toDataURL('image/png');
    ch2.destroy();

    return result;
}

function renderBulletinPaperFromDraft(draft) {
    const reportPaper = document.getElementById('report-paper');
    if (!reportPaper || !draft) return;

    bulletinState.currentDraft = draft;
    const stats = draft.summary_stats || {};
    const bType = draft.bulletin_type || 'observed';
    const activeKey = state.activeRasterLayer || 'tvdi';
    const levelCounts = stats.level_counts || {};
    const validCells = Number(stats.valid_cells || 0) || 272;
    const avgTvdi = stats.avg_tvdi !== null && stats.avg_tvdi !== undefined ? Number(stats.avg_tvdi).toFixed(3) : '--';
    const maxTvdi = stats.max_tvdi !== null && stats.max_tvdi !== undefined ? Number(stats.max_tvdi).toFixed(3) : '--';
    const minTvdi = stats.min_tvdi !== null && stats.min_tvdi !== undefined ? Number(stats.min_tvdi).toFixed(3) : '--';
    const avgLst = stats.avg_lst !== null && stats.avg_lst !== undefined ? `${Number(stats.avg_lst).toFixed(1)} °C` : '--';
    const avgNdvi = stats.avg_ndvi !== null && stats.avg_ndvi !== undefined ? Number(stats.avg_ndvi).toFixed(3) : '--';
    const droughtPct = stats.drought_pct !== null && stats.drought_pct !== undefined ? Number(stats.drought_pct).toFixed(1) : '0.0';
    const droughtCells = stats.drought_cell_count ?? 0;
    const topWards = Array.isArray(stats.top_wards) ? stats.top_wards : [];
    const seriesPoints = Array.isArray(stats.series_points) ? stats.series_points : [];

    // Tạo ảnh bản đồ + 2 biểu đồ PNG
    const isAdmin = _isBulletinAdmin();
    const mapTypeTag = isAdmin
        ? (bType === 'daily_7d' ? 'Giả lập (Landsat)' : (bType === 'monthly_12m' ? 'AI Random Forest' : 'Quan trắc Landsat 8/9'))
        : (bType === 'daily_7d' ? 'Dự báo 7 ngày' : (bType === 'monthly_12m' ? 'Dự báo 12 tháng' : 'Quan trắc thực tế'));
    const mapSubtitle = `${draft.period_start === draft.period_end ? draft.period_start : `${draft.period_start} → ${draft.period_end}`} · ${mapTypeTag}`;
    const displayTitle = _cleanBulletinTextForRole(draft.title || 'BẢN TIN GIÁM SÁT & DỰ BÁO KHÔ HẠN TVDI');
    const displayHighlights = _cleanBulletinTextForRole(draft.highlights || '');
    const displayRecommendations = _cleanBulletinTextForRole(draft.recommendations || '');
    const mapDataUrl = renderBulletinMapDataUrl(activeKey, mapSubtitle);
    const { seriesImg, distImg } = renderBulletinChartsDataUrls(seriesPoints, levelCounts, activeKey, bType);
    bulletinState.lastMapDataUrl = mapDataUrl;
    bulletinState.lastSeriesChartUrl = seriesImg;
    bulletinState.lastDistChartUrl = distImg;

    const overallTheme = avgTvdi !== '--' ? getDroughtUITheme(parseFloat(avgTvdi)) : { label: 'Chưa xác định', scoreColor: '#64748b' };
    const now = new Date();
    const issuedStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const topWardsRows = topWards.length > 0
        ? topWards.map((w, idx) => {
            const dc = getDroughtUITheme(w.tvdi);
            return `
                <tr>
                    <td class="center">${idx + 1}</td>
                    <td><strong>${_escapeHtml(w.name)}</strong>${w.district ? ` <span style="color:#64748b;font-size:0.78rem;">(${_escapeHtml(w.district)})</span>` : ''}</td>
                    <td class="center" style="font-weight:700;color:${dc.scoreColor};">${w.tvdi !== null && w.tvdi !== undefined ? Number(w.tvdi).toFixed(3) : '--'}</td>
                    <td class="center">${w.lst_c !== null && w.lst_c !== undefined ? Number(w.lst_c).toFixed(1) + ' °C' : '--'}</td>
                    <td class="center">${w.ndvi !== null && w.ndvi !== undefined ? Number(w.ndvi).toFixed(3) : '--'}</td>
                    <td><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${dc.barColor};margin-right:5px;"></span>${dc.label}</td>
                </tr>
            `;
        }).join('')
        : '<tr><td colspan="6" class="center" style="color:#64748b;">Chưa có dữ liệu tổng hợp theo phường/xã cho kỳ này.</td></tr>';

    const seriesRows = seriesPoints.length > 0
        ? seriesPoints.map(s => {
            const dc = getDroughtUITheme(s.tvdi);
            return `
                <tr>
                    <td class="center"><strong>${_escapeHtml(s.date)}</strong></td>
                    <td class="center" style="font-weight:700;color:${dc.scoreColor};">${s.tvdi !== null && s.tvdi !== undefined ? Number(s.tvdi).toFixed(3) : '--'}</td>
                    <td class="center">${s.lst_c !== null && s.lst_c !== undefined ? Number(s.lst_c).toFixed(1) + ' °C' : '--'}</td>
                    <td class="center">${s.ndvi !== null && s.ndvi !== undefined ? Number(s.ndvi).toFixed(3) : '--'}</td>
                    <td>${dc.label}</td>
                </tr>
            `;
        }).join('')
        : '';

    reportPaper.innerHTML = `
        <div class="bul-banner">
            <div class="bul-banner-left">
                <div class="bul-sys-name">HỆ THỐNG GIÁM SÁT MỨC ĐỘ KHÔ HẠN TẠI TP.HCM</div>
                <h2>${_escapeHtml(displayTitle)}</h2>
                <div class="bul-meta-row">
                    ${_formatHorizonBadge(bType)}
                    <span><i class="fa-regular fa-calendar"></i> Thời gian: <strong>${_escapeHtml(draft.period_start)}</strong>${draft.period_end && draft.period_end !== draft.period_start ? ` → <strong>${_escapeHtml(draft.period_end)}</strong>` : ''}</span>
                    <span><i class="fa-regular fa-clock"></i> Xuất bản tin: ${issuedStr}</span>
                </div>
            </div>
        </div>

        <!-- Khối I: Tóm tắt 4 chỉ số trọng yếu -->
        <div class="bul-kpi-grid">
            <div class="bul-kpi-card is-primary">
                <div class="bul-kpi-lbl">TVDI Trung bình (Ưu tiên)</div>
                <div class="bul-kpi-val">${avgTvdi}</div>
                <div class="bul-kpi-sub">${overallTheme.label} · Min ${minTvdi} / Max ${maxTvdi}</div>
            </div>
            <div class="bul-kpi-card">
                <div class="bul-kpi-lbl">Nhiệt độ bề mặt (LST)</div>
                <div class="bul-kpi-val" style="color:#b45309;">${avgLst}</div>
                <div class="bul-kpi-sub">Trung bình toàn vùng TP.HCM</div>
            </div>
            <div class="bul-kpi-card">
                <div class="bul-kpi-lbl">Chỉ số thực vật (NDVI)</div>
                <div class="bul-kpi-val" style="color:#15803d;">${avgNdvi}</div>
                <div class="bul-kpi-sub">Mật độ phủ xanh bề mặt</div>
            </div>
            <div class="bul-kpi-card">
                <div class="bul-kpi-lbl">Tỷ lệ diện tích khô hạn</div>
                <div class="bul-kpi-val" style="color:${parseFloat(droughtPct) >= 20 ? '#dc2626' : '#ea580c'};">${droughtPct}%</div>
                <div class="bul-kpi-sub">${droughtCells} / ${validCells} ô lưới (TVDI ≥ 0.625)</div>
            </div>
        </div>

        <!-- Khối II: Bản đồ + Biểu đồ trực quan -->
        <div class="rep-section">
            <div class="rep-sec-title">I. Bản đồ phân bố không gian &amp; Biểu đồ diễn biến</div>
            <div class="bul-visual-grid">
                <div class="bul-map-panel">
                    <img src="${mapDataUrl}" alt="Bản đồ phân bố ${metaLabelSafe(activeKey)}" class="bul-snapshot-img" />
                </div>
                <div class="bul-charts-panel">
                    ${seriesImg ? `<img src="${seriesImg}" alt="Biểu đồ chuỗi thời gian" class="bul-snapshot-img" />` : '<div class="bul-empty-box">Chưa có chuỗi thời gian</div>'}
                    ${distImg ? `<img src="${distImg}" alt="Biểu đồ phân bố 8 cấp độ" class="bul-snapshot-img" />` : ''}
                </div>
            </div>
        </div>

        <!-- Khối III: Bảng Top 10 phường/xã khô hạn nhất (đủ 3 chỉ số) -->
        <div class="rep-section">
            <div class="rep-sec-title">II. Bảng thống kê Top 10 phường/xã có chỉ số TVDI cao nhất</div>
            <table class="rep-table">
                <thead>
                    <tr>
                        <th style="width:6%;">STT</th>
                        <th style="width:28%;">Phường / Xã</th>
                        <th style="width:14%;">TVDI</th>
                        <th style="width:14%;">LST (°C)</th>
                        <th style="width:14%;">NDVI</th>
                        <th>Phân cấp khô hạn</th>
                    </tr>
                </thead>
                <tbody>${topWardsRows}</tbody>
            </table>
        </div>

        <!-- Khối IV: Bảng phân bố 8 cấp độ khô hạn -->
        <div class="rep-section">
            <div class="rep-sec-title">III. Bảng phân cấp diện tích theo 8 mức độ khô hạn TVDI</div>
            <table class="rep-table">
                <thead>
                    <tr>
                        <th style="width:11%;">Cấp độ</th>
                        <th style="width:15%;">Khoảng TVDI</th>
                        <th style="width:24%;">Tên phân cấp</th>
                        <th style="width:11%;">Số ô</th>
                        <th style="width:11%;">Tỷ lệ</th>
                        <th>Nhận định rủi ro</th>
                    </tr>
                </thead>
                <tbody>
                    ${BULLETIN_DROUGHT_CLASSES.map(c => {
                        const cnt = Number(levelCounts[String(c.level)] ?? levelCounts[c.level] ?? 0);
                        const pct = validCells > 0 ? ((cnt / validCells) * 100).toFixed(1) : '0.0';
                        return `
                            <tr>
                                <td class="center"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${c.color};vertical-align:middle;margin-right:4px;"></span><strong>${c.code}</strong></td>
                                <td class="center"><code>${c.range}</code></td>
                                <td><strong>${c.label}</strong></td>
                                <td class="center">${cnt}</td>
                                <td class="center" style="font-weight:700;">${pct}%</td>
                                <td style="font-size:0.8rem;">${c.risk}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>

        ${seriesRows ? `
        <div class="rep-section">
            <div class="rep-sec-title">IV. Bảng số liệu chuỗi thời gian (TVDI · LST · NDVI)</div>
            <table class="rep-table">
                <thead>
                    <tr>
                        <th style="width:18%;">Mốc thời gian</th>
                        <th style="width:16%;">TVDI</th>
                        <th style="width:16%;">LST (°C)</th>
                        <th style="width:16%;">NDVI</th>
                        <th>Đánh giá trạng thái</th>
                    </tr>
                </thead>
                <tbody>${seriesRows}</tbody>
            </table>
        </div>` : ''}

        <!-- Khối V: Nhận định & Khuyến nghị -->
        <div class="rep-section">
            <div class="rep-sec-title">V. Nhận định tổng hợp &amp; Khuyến nghị ứng phó</div>
            <div class="bul-highlight-box">
                <strong><i class="fa-solid fa-magnifying-glass-chart"></i> Tóm tắt hiện trạng / dự báo:</strong>
                <p>${_escapeHtml(displayHighlights)}</p>
            </div>
            <div class="rep-recom-box" style="margin-top:8px;">
                <strong><i class="fa-solid fa-shield-halved"></i> Khuyến nghị kỹ thuật:</strong>
                <p style="margin:4px 0 0 0;">${_escapeHtml(displayRecommendations)}</p>
            </div>
        </div>
    `;
}

function metaLabelSafe(key) {
    return (INDEX_META[key] && INDEX_META[key].label) ? INDEX_META[key].label : 'TVDI';
}

async function generateReportPaper(savedBulletin = null) {
    const reportPaper = document.getElementById('report-paper');
    if (!reportPaper) return;

    if (savedBulletin) {
        renderBulletinPaperFromDraft(savedBulletin);
        return;
    }

    reportPaper.innerHTML = '<div class="bul-loading"><i class="fa-solid fa-spinner fa-spin"></i> Đang tổng hợp Bản tin (Bản đồ + Biểu đồ + Bảng)...</div>';

    const view = state.currentView || {};
    const dateStr = state.currentDate || getTodayDateStr();
    let horizon = 'observed';
    let query = `horizon=observed&date=${encodeURIComponent(view.date || dateStr)}`;

    if (view.kind === 'forecast' || isForecastDate(dateStr)) {
        horizon = view.horizon || state.forecastHorizon || 'daily_7d';
        query = `horizon=${encodeURIComponent(horizon)}&date=${encodeURIComponent(dateStr)}`;
    } else if (view.kind === 'aggregate') {
        horizon = 'aggregate';
        query = `horizon=aggregate&start=${encodeURIComponent(view.start)}&end=${encodeURIComponent(view.end)}`;
    }

    try {
        const headers = {};
        if (state.auth && state.auth.token) headers['Authorization'] = `Bearer ${state.auth.token}`;
        const res = await fetch(`/api/bulletins/draft?${query}`, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const draft = await res.json();
        renderBulletinPaperFromDraft(draft);
    } catch (err) {
        console.error('Lỗi tổng hợp bản tin:', err);
        reportPaper.innerHTML = `<div class="bul-loading" style="color:#dc2626;">Không thể nạp dữ liệu bản tin từ máy chủ (${_escapeHtml(err.message)}).</div>`;
    }
}

async function loadBulletinsHistory() {
    const listEl = document.getElementById('bulletin-history-list');
    if (!listEl) return;
    listEl.innerHTML = '<div class="bul-loading"><i class="fa-solid fa-spinner fa-spin"></i> Đang tải danh sách bản tin đã lưu...</div>';

    try {
        const headers = {};
        if (state.auth && state.auth.token) headers['Authorization'] = `Bearer ${state.auth.token}`;
        const res = await fetch('/api/bulletins', { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const items = data.bulletins || [];

        if (items.length === 0) {
            listEl.innerHTML = '<div class="bul-empty-box">Chưa có bản tin nào được lưu trong CSDL.</div>';
            return;
        }

        listEl.innerHTML = items.map(b => {
            const st = b.summary_stats || {};
            const avgT = st.avg_tvdi !== null && st.avg_tvdi !== undefined ? Number(st.avg_tvdi).toFixed(3) : '--';
            const dPct = st.drought_pct !== null && st.drought_pct !== undefined ? `${Number(st.drought_pct).toFixed(1)}%` : '--';
            const created = b.created_at ? b.created_at.substring(0, 16).replace('T', ' ') : '';
            const safeTitle = _cleanBulletinTextForRole(b.title);
            return `
                <div class="bul-history-card" data-id="${b.id}">
                    <div class="bul-history-main">
                        <div class="bul-history-title">${_escapeHtml(safeTitle)}</div>
                        <div class="bul-history-meta">
                            ${_formatHorizonBadge(b.bulletin_type)}
                            <span>Kỳ: <strong>${_escapeHtml(b.period_start)}</strong>${b.period_end !== b.period_start ? ` → <strong>${_escapeHtml(b.period_end)}</strong>` : ''}</span>
                            <span>TVDI TB: <strong>${avgT}</strong> · Hạn hán: <strong>${dPct}</strong></span>
                            <span>Lưu lúc: ${created}</span>
                        </div>
                    </div>
                    <div class="bul-history-actions">
                        <button type="button" class="btn btn-primary btn-xs bul-btn-view" data-id="${b.id}">
                            <i class="fa-solid fa-eye"></i> Xem bản tin
                        </button>
                        <button type="button" class="btn btn-secondary btn-xs bul-btn-del" data-id="${b.id}" title="Xóa bản tin">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        listEl.querySelectorAll('.bul-btn-view').forEach(btn => {
            btn.addEventListener('click', () => {
                const bid = Number(btn.dataset.id);
                const found = items.find(x => x.id === bid);
                if (!found) return;
                switchBulletinTab('preview');
                generateReportPaper(found);
            });
        });

        listEl.querySelectorAll('.bul-btn-del').forEach(btn => {
            btn.addEventListener('click', async () => {
                const bid = Number(btn.dataset.id);
                const headers = {};
                if (state.auth && state.auth.token) headers['Authorization'] = `Bearer ${state.auth.token}`;
                const r = await fetch(`/api/bulletins/${bid}`, { method: 'DELETE', headers });
                if (r.ok) {
                    if (typeof showToast === 'function') showToast('Đã xóa bản tin khỏi kho lưu trữ.');
                    loadBulletinsHistory();
                }
            });
        });
    } catch (err) {
        listEl.innerHTML = `<div class="bul-empty-box" style="color:#dc2626;">Lỗi tải danh sách bản tin: ${_escapeHtml(err.message)}</div>`;
    }
}

async function saveCurrentBulletin() {
    if (!bulletinState.currentDraft) {
        if (typeof showToast === 'function') showToast('Chưa có nội dung bản tin để lưu.');
        return;
    }
    const d = bulletinState.currentDraft;
    const headers = { 'Content-Type': 'application/json' };
    if (state.auth && state.auth.token) headers['Authorization'] = `Bearer ${state.auth.token}`;

    try {
        const res = await fetch('/api/bulletins', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                title: d.title,
                bulletin_type: d.bulletin_type,
                period_start: d.period_start,
                period_end: d.period_end,
                satellite_source: d.satellite_source || 'LANDSAT',
                summary_stats: d.summary_stats,
                highlights: d.highlights,
                recommendations: d.recommendations,
            }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (typeof showToast === 'function') showToast('Đã lưu Bản tin vào CSDL PostgreSQL!');
        loadBulletinsHistory();
    } catch (err) {
        if (typeof showToast === 'function') showToast(`Lỗi lưu bản tin: ${err.message}`);
    }
}

function _loadImg(src) {
    return new Promise((resolve) => {
        if (!src) return resolve(null);
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => resolve(null);
        im.src = src;
    });
}

function _drawWrappedText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = String(text || '').split(/\s+/);
    let line = '';
    let curY = y;
    for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        if (ctx.measureText(test).width > maxWidth && line) {
            ctx.fillText(line, x, curY);
            line = w;
            curY += lineHeight;
        } else {
            line = test;
        }
    }
    if (line) {
        ctx.fillText(line, x, curY);
        curY += lineHeight;
    }
    return curY;
}

// Xuất toàn bộ Bản tin (Tiêu đề + 4 KPI + Bản đồ + 2 Biểu đồ + Top 5 phường + Khuyến nghị) ra ảnh PNG sắc nét
async function exportBulletinPNG() {
    const d = bulletinState.currentDraft;
    if (!d) {
        if (typeof showToast === 'function') showToast('Chưa có bản tin để xuất ảnh.');
        return;
    }
    const stats = d.summary_stats || {};
    const W = 1280;
    const H = 1260;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    // Header
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, W, 94);
    ctx.fillStyle = '#93c5fd';
    ctx.font = 'bold 13px "Segoe UI", Arial, sans-serif';
    ctx.fillText('HỆ THỐNG GIÁM SÁT MỨC ĐỘ KHÔ HẠN TẠI TP.HCM', 36, 30);
    const safeTitle = _cleanBulletinTextForRole(d.title || 'BẢN TIN GIÁM SÁT & DỰ BÁO KHÔ HẠN TVDI');
    const periodTxt = `Kỳ: ${d.period_start}${d.period_end !== d.period_start ? ' -> ' + d.period_end : ''}`;
    const metaTxt = _isBulletinAdmin() ? `${periodTxt} | Nguồn: ${d.satellite_source || 'LANDSAT'}` : periodTxt;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px "Segoe UI", Arial, sans-serif';
    ctx.fillText(safeTitle, 36, 62);
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '13px "Segoe UI", Arial, sans-serif';
    ctx.fillText(metaTxt, 36, 84);

    // 4 KPI cards
    const kpis = [
        { lbl: 'TVDI Trung bình', val: stats.avg_tvdi !== null && stats.avg_tvdi !== undefined ? Number(stats.avg_tvdi).toFixed(3) : '--', color: '#2563eb' },
        { lbl: 'LST Trung bình', val: stats.avg_lst !== null && stats.avg_lst !== undefined ? `${Number(stats.avg_lst).toFixed(1)} °C` : '--', color: '#b45309' },
        { lbl: 'NDVI Trung bình', val: stats.avg_ndvi !== null && stats.avg_ndvi !== undefined ? Number(stats.avg_ndvi).toFixed(3) : '--', color: '#15803d' },
        { lbl: 'Diện tích khô hạn', val: `${Number(stats.drought_pct || 0).toFixed(1)}% (${stats.drought_cell_count || 0} ô)`, color: '#dc2626' },
    ];
    const cardW = (W - 72 - 36) / 4;
    kpis.forEach((k, i) => {
        const cx = 36 + i * (cardW + 12);
        const cy = 112;
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(cx, cy, cardW, 74);
        ctx.strokeStyle = '#cbd5e1';
        ctx.strokeRect(cx, cy, cardW, 74);
        ctx.fillStyle = '#475569';
        ctx.font = 'bold 12px "Segoe UI", Arial, sans-serif';
        ctx.fillText(k.lbl, cx + 14, cy + 24);
        ctx.fillStyle = k.color;
        ctx.font = 'bold 22px "Segoe UI", Arial, sans-serif';
        ctx.fillText(k.val, cx + 14, cy + 56);
    });

    const [mapIm, serIm, distIm] = await Promise.all([
        _loadImg(bulletinState.lastMapDataUrl),
        _loadImg(bulletinState.lastSeriesChartUrl),
        _loadImg(bulletinState.lastDistChartUrl),
    ]);

    if (mapIm) ctx.drawImage(mapIm, 36, 206, 560, 648);
    if (serIm) ctx.drawImage(serIm, 616, 206, 628, 312);
    if (distIm) ctx.drawImage(distIm, 616, 534, 628, 320);

    // Top 5 phường khô hạn nhất + Nhận định
    let curY = 884;
    ctx.fillStyle = '#1e3a8a';
    ctx.font = 'bold 15px "Segoe UI", Arial, sans-serif';
    ctx.fillText('TOP PHƯỜNG/XÃ CÓ CHỈ SỐ TVDI CAO NHẤT & KHUYẾN NGHỊ', 36, curY);
    curY += 16;

    const top5 = (stats.top_wards || []).slice(0, 5);
    top5.forEach((w, idx) => {
        ctx.fillStyle = idx % 2 === 0 ? '#f8fafc' : '#ffffff';
        ctx.fillRect(36, curY, W - 72, 28);
        ctx.strokeStyle = '#e2e8f0';
        ctx.strokeRect(36, curY, W - 72, 28);
        ctx.fillStyle = '#0f172a';
        ctx.font = '13px "Segoe UI", Arial, sans-serif';
        const tv = w.tvdi !== null && w.tvdi !== undefined ? Number(w.tvdi).toFixed(3) : '--';
        const ls = w.lst_c !== null && w.lst_c !== undefined ? `${Number(w.lst_c).toFixed(1)}°C` : '--';
        const nd = w.ndvi !== null && w.ndvi !== undefined ? Number(w.ndvi).toFixed(3) : '--';
        ctx.fillText(`${idx + 1}. ${w.name} ${w.district ? '(' + w.district + ')' : ''}`, 48, curY + 19);
        ctx.fillText(`TVDI: ${tv}   |   LST: ${ls}   |   NDVI: ${nd}   |   ${w.drought_label || ''}`, 520, curY + 19);
        curY += 28;
    });

    curY += 22;
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 13px "Segoe UI", Arial, sans-serif';
    ctx.fillText('Nhận định & Khuyến nghị:', 36, curY);
    curY += 20;
    ctx.fillStyle = '#334155';
    ctx.font = '13px "Segoe UI", Arial, sans-serif';
    const safeHighlights = _cleanBulletinTextForRole(d.highlights || '');
    const safeRecs = _cleanBulletinTextForRole(d.recommendations || '');
    curY = _drawWrappedText(ctx, `${safeHighlights} ${safeRecs}`.trim(), 36, curY, W - 72, 20);

    const link = document.createElement('a');
    const dtTag = (d.period_start || getTodayDateStr()).replace(/[^0-9-]/g, '');
    link.download = `Ban_tin_TVDI_TPHCM_${dtTag}.png`;
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    if (typeof showToast === 'function') showToast('Đã tải xuống ảnh Bản tin PNG!');
}

function switchBulletinTab(tabName) {
    const previewTab = document.getElementById('btn-bul-tab-preview');
    const historyTab = document.getElementById('btn-bul-tab-history');
    const paperEl = document.getElementById('report-paper');
    const historyEl = document.getElementById('bulletin-history-panel');

    const isPreview = tabName !== 'history';
    if (previewTab) previewTab.classList.toggle('active', isPreview);
    if (historyTab) historyTab.classList.toggle('active', !isPreview);
    if (paperEl) paperEl.style.display = isPreview ? 'block' : 'none';
    if (historyEl) historyEl.style.display = isPreview ? 'none' : 'block';
    if (!isPreview) loadBulletinsHistory();
}

function setupReportModal() {
    const btnOpen = document.getElementById('btn-open-report');
    const modal = document.getElementById('report-modal');
    const btnClose = document.getElementById('btn-close-report-modal');
    const btnCloseFooter = document.getElementById('btn-close-report-footer');
    const btnPrint = document.getElementById('btn-print-report');
    const btnExcel = document.getElementById('btn-export-excel');
    const btnGeoJson = document.getElementById('btn-export-geojson');
    const btnSaveBul = document.getElementById('btn-save-bulletin');
    const btnPngBul = document.getElementById('btn-export-bulletin-png');
    const tabPreview = document.getElementById('btn-bul-tab-preview');
    const tabHistory = document.getElementById('btn-bul-tab-history');

    if (!btnOpen || !modal) return;

    btnOpen.addEventListener('click', async () => {
        if (!state.currentGridData && typeof loadDataForCurrentDate === 'function') {
            await loadDataForCurrentDate();
        }
        switchBulletinTab('preview');
        modal.style.display = 'flex';
        await generateReportPaper();
    });

    const closeModal = () => { modal.style.display = 'none'; };
    if (btnClose) btnClose.addEventListener('click', closeModal);
    if (btnCloseFooter) btnCloseFooter.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    if (tabPreview) tabPreview.addEventListener('click', () => switchBulletinTab('preview'));
    if (tabHistory) tabHistory.addEventListener('click', () => switchBulletinTab('history'));
    if (btnSaveBul) btnSaveBul.addEventListener('click', saveCurrentBulletin);
    if (btnPngBul) btnPngBul.addEventListener('click', exportBulletinPNG);
    if (btnPrint) btnPrint.addEventListener('click', () => window.print());
    if (btnExcel) btnExcel.addEventListener('click', () => { if (typeof exportToCSV === 'function') exportToCSV(); });
    if (btnGeoJson) btnGeoJson.addEventListener('click', () => { if (typeof exportToGeoJSON === 'function') exportToGeoJSON(); });
}
