/**
 * ============================================================================
 * Module Thành lập Bản đồ Chuyên đề & Export Bản đồ PNG / PDF (Cartographic Composer)
 * Hệ thống WebGIS Giám sát & Dự báo Khô hạn TVDI – TP. Hồ Chí Minh
 * ============================================================================
 */

const MAP_COMPOSER_DEFAULT_LABELS = [
    { name: 'Dầu Tiếng', lat: 11.28, lon: 106.38 },
    { name: 'Bến Cát', lat: 11.16, lon: 106.60 },
    { name: 'Thủ Dầu Một', lat: 10.98, lon: 106.65 },
    { name: 'Củ Chi', lat: 11.01, lon: 106.49 },
    { name: 'Hóc Môn', lat: 10.89, lon: 106.59 },
    { name: 'TP. Thủ Đức', lat: 10.84, lon: 106.76 },
    { name: 'Trung tâm TP.HCM', lat: 10.775, lon: 106.695 },
    { name: 'Bình Chánh', lat: 10.72, lon: 106.56 },
    { name: 'Nhà Bè', lat: 10.67, lon: 106.73 },
    { name: 'Cần Giờ', lat: 10.50, lon: 106.88 },
    { name: 'TP. Bà Rịa', lat: 10.50, lon: 107.17 },
    { name: 'TP. Vũng Tàu', lat: 10.36, lon: 107.09 },
    { name: 'Xuyên Mộc', lat: 10.59, lon: 107.47 },
];

function _mcBuildTicks(lo, hi, step = 0.2) {
    const ticks = [];
    const start = Math.ceil(lo / step) * step;
    for (let v = start; v <= hi + 1e-9; v += step) {
        ticks.push(Math.round(v * 100) / 100);
    }
    return ticks;
}

function _mcDefaultTitle(layerKey) {
    const meta = INDEX_META[layerKey] || INDEX_META.tvdi;
    if (layerKey === 'tvdi') return 'BẢN ĐỒ PHÂN VÙNG CHỈ SỐ KHÔ HẠN TVDI – TP. HỒ CHÍ MINH';
    if (layerKey === 'lst') return 'BẢN ĐỒ PHÂN BỐ NHIỆT ĐỘ BỀ MẶT (LST) – TP. HỒ CHÍ MINH';
    return `BẢN ĐỒ CHỈ SỐ THỰC VẬT (${meta.label}) – TP. HỒ CHÍ MINH`;
}

function _mcDefaultSubtitle() {
    const dStr = state.currentDate || (typeof getTodayDateStr === 'function' ? getTodayDateStr() : '');
    const viewDesc = (typeof describeCurrentView === 'function') ? describeCurrentView(false) : dStr;
    const isAdmin = (typeof isAdminUser === 'function') ? isAdminUser() : false;
    if (state.isAIMode || (typeof isForecastDate === 'function' && isForecastDate(dStr))) {
        if (!isAdmin) {
            return state.forecastHorizon === 'monthly_12m'
                ? `Dự báo 12 tháng · ${viewDesc}`
                : `Dự báo 7 ngày · ${viewDesc}`;
        }
        return state.forecastHorizon === 'monthly_12m'
            ? `Dự báo 12 tháng (AI Random Forest) · ${viewDesc}`
            : `Dự báo 7 ngày (Giả lập · Landsat 8/9) · ${viewDesc}`;
    }
    return isAdmin
        ? `Quan trắc viễn thám thực tế Landsat 8/9 · ${viewDesc}`
        : `Quan trắc thực tế · ${viewDesc}`;
}

function _mcReadComposerConfig() {
    const layerSel = document.getElementById('mc-layer-select');
    const displaySel = document.getElementById('mc-display-select');
    const orientSel = document.getElementById('mc-orient-select');
    const titleInp = document.getElementById('mc-title-input');
    const subInp = document.getElementById('mc-subtitle-input');
    const dpiSel = document.getElementById('mc-res-select');

    return {
        layerKey: (layerSel && INDEX_META[layerSel.value]) ? layerSel.value : (state.activeRasterLayer || 'tvdi'),
        displayMode: displaySel ? displaySel.value : (state.displayMode || 'pixel'),
        orientation: orientSel ? orientSel.value : 'landscape',
        title: (titleInp && titleInp.value.trim()) ? titleInp.value.trim() : _mcDefaultTitle(state.activeRasterLayer || 'tvdi'),
        subtitle: (subInp && subInp.value.trim()) ? subInp.value.trim() : _mcDefaultSubtitle(),
        scaleFactor: dpiSel ? (parseFloat(dpiSel.value) || 1.5) : 1.5,
        showGraticule: document.getElementById('mc-opt-graticule')?.checked !== false,
        showWards: document.getElementById('mc-opt-wards')?.checked !== false,
        showLabels: document.getElementById('mc-opt-labels')?.checked !== false,
        showNorth: document.getElementById('mc-opt-north')?.checked !== false,
        showScale: document.getElementById('mc-opt-scale')?.checked !== false,
        showLegend: document.getElementById('mc-opt-legend')?.checked !== false,
        showMeta: document.getElementById('mc-opt-meta')?.checked !== false,
    };
}

function _mcDrawGeoFeatures(ctx, geojson, projX, projY, strokeColor, lineWidth, fillFn = null) {
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
        if (lineWidth > 0 && strokeColor) {
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = lineWidth;
            ctx.stroke();
        }
    });
}

function _mcDrawNorthArrow(ctx, cx, cy, scale = 1) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 2, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 12px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', 0, -11);

    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(9, 17);
    ctx.lineTo(0, 11);
    ctx.lineTo(-9, 17);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(0, 11);
    ctx.lineTo(-9, 17);
    ctx.closePath();
    ctx.fillStyle = '#0f172a';
    ctx.fill();

    ctx.restore();
}

function _mcDrawScaleBar(ctx, sx, sy, px10km) {
    const segPx = px10km / 2; // 5 km mỗi đoạn
    const totalW = px10km + 38;

    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    ctx.fillRect(sx - 10, sy - 24, totalW, 34);
    ctx.strokeRect(sx - 10, sy - 24, totalW, 34);

    // 2 đoạn đen trắng xen kẽ 0-5-10 km
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(sx, sy - 4, segPx, 6);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + segPx, sy - 4, segPx, 6);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(sx, sy - 4, px10km, 6);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 10px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('0', sx, sy - 9);
    ctx.fillText('5', sx + segPx, sy - 9);
    ctx.fillText('10 km', sx + px10km + 6, sy - 9);
    ctx.restore();
}

function _mcDrawLegendPanel(ctx, x, y, w, cfg) {
    const key = cfg.layerKey;
    const meta = INDEX_META[key] || INDEX_META.tvdi;
    const pal = (typeof GEE_COLOR_PALETTES !== 'undefined' && GEE_COLOR_PALETTES[key]) ? GEE_COLOR_PALETTES[key] : { min: 0, max: 1 };
    const rangeCfg = { min: pal.min, max: pal.max };

    ctx.save();
    ctx.fillStyle = '#f8fafc';
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1.2;

    const panelH = (key === 'tvdi') ? 336 : 210;
    ctx.fillRect(x, y, w, panelH);
    ctx.strokeRect(x, y, w, panelH);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 13px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('CHÚ GIẢI BẢN ĐỒ', x + 14, y + 24);

    ctx.strokeStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.moveTo(x + 14, y + 32);
    ctx.lineTo(x + w - 14, y + 32);
    ctx.stroke();

    let curY = y + 50;
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 12px "Segoe UI", Arial, sans-serif';
    ctx.fillText(`Chỉ số ${meta.label}${meta.unit ? ' (' + meta.unit + ')' : ''}`, x + 14, curY);
    curY += 12;

    if (key === 'tvdi' && typeof BULLETIN_DROUGHT_CLASSES !== 'undefined') {
        BULLETIN_DROUGHT_CLASSES.forEach(c => {
            ctx.fillStyle = c.color;
            ctx.fillRect(x + 14, curY, 22, 13);
            ctx.strokeStyle = '#334155';
            ctx.lineWidth = 0.7;
            ctx.strokeRect(x + 14, curY, 22, 13);

            ctx.fillStyle = '#0f172a';
            ctx.font = '11px "Segoe UI", Arial, sans-serif';
            ctx.fillText(`${c.range} · ${c.label}`, x + 44, curY + 10);
            curY += 21;
        });
    } else {
        const barW = w - 28;
        const barH = 16;
        const steps = 64;
        for (let i = 0; i < steps; i++) {
            const v = rangeCfg.min + (i / (steps - 1)) * (rangeCfg.max - rangeCfg.min);
            const rgba = interpolateColor(key, v);
            ctx.fillStyle = `rgb(${rgba[0]},${rgba[1]},${rgba[2]})`;
            ctx.fillRect(x + 14 + (i / steps) * barW, curY + 6, barW / steps + 1, barH);
        }
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 0.9;
        ctx.strokeRect(x + 14, curY + 6, barW, barH);

        ctx.fillStyle = '#334155';
        ctx.font = '11px "Segoe UI", Arial, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`${rangeCfg.min}${meta.unit ? ' ' + meta.unit : ''}`, x + 14, curY + 38);
        ctx.textAlign = 'center';
        ctx.fillText(`${((rangeCfg.min + rangeCfg.max) / 2).toFixed(key === 'lst' ? 1 : 2)}`, x + 14 + barW / 2, curY + 38);
        ctx.textAlign = 'right';
        ctx.fillText(`${rangeCfg.max}${meta.unit ? ' ' + meta.unit : ''}`, x + 14 + barW, curY + 38);
        ctx.textAlign = 'left';
        curY += 58;
    }

    // Ký hiệu ranh giới hành chính
    curY += 10;
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 11.5px "Segoe UI", Arial, sans-serif';
    ctx.fillText('Yếu tố nền địa lý', x + 14, curY);
    curY += 16;

    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 14, curY);
    ctx.lineTo(x + 42, curY);
    ctx.stroke();
    ctx.fillStyle = '#334155';
    ctx.font = '11px "Segoe UI", Arial, sans-serif';
    ctx.fillText('Ranh giới TP. Hồ Chí Minh', x + 50, curY + 4);
    curY += 20;

    if (cfg.showWards) {
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(x + 14, curY);
        ctx.lineTo(x + 42, curY);
        ctx.stroke();
        ctx.fillStyle = '#334155';
        ctx.fillText('Ranh giới 167 Phường/Xã', x + 50, curY + 4);
    }

    // Dữ liệu không có giá trị
    curY += 20;
    ctx.fillStyle = 'rgb(203, 213, 225)';
    ctx.fillRect(x + 14, curY - 7, 22, 12);
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 0.6;
    ctx.strokeRect(x + 14, curY - 7, 22, 12);
    ctx.fillStyle = '#475569';
    ctx.fillText('Ngoài phạm vi / Không dữ liệu', x + 44, curY + 3);

    ctx.restore();
    return panelH;
}

function renderComposedMapCanvas(targetCanvas, overrideScale = null) {
    const cfg = _mcReadComposerConfig();
    const s = overrideScale || cfg.scaleFactor || 1.25;
    const isLandscape = cfg.orientation === 'landscape';

    const baseW = isLandscape ? 1188 : 840;
    const baseH = isLandscape ? 840 : 1188;

    targetCanvas.width = Math.round(baseW * s);
    targetCanvas.height = Math.round(baseH * s);
    const ctx = targetCanvas.getContext('2d');
    ctx.save();
    ctx.scale(s, s);

    // Nền trắng trang giấy A4
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, baseW, baseH);

    // Khung viền kép ngoài (Double Cartographic Neatline)
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.2;
    ctx.strokeRect(18, 18, baseW - 36, baseH - 36);
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 0.8;
    ctx.strokeRect(23, 23, baseW - 46, baseH - 46);

    // Khối tiêu đề phía trên
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 20px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(cfg.title.toUpperCase(), baseW / 2, 54);

    ctx.fillStyle = '#334155';
    ctx.font = '13px "Segoe UI", Arial, sans-serif';
    ctx.fillText(cfg.subtitle, baseW / 2, 76);

    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(36, 90);
    ctx.lineTo(baseW - 36, 90);
    ctx.stroke();

    // Tính vùng bản đồ & vùng chú giải bên cạnh (Landscape) hoặc phía dưới (Portrait)
    const sidePanelW = isLandscape ? 278 : (baseW - 72);
    const mapBox = isLandscape
        ? { x: 74, y: 112, w: baseW - sidePanelW - 128, h: baseH - 160 }
        : { x: 74, y: 112, w: baseW - 114, h: baseH - 486 };

    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(mapBox.x, mapBox.y, mapBox.w, mapBox.h);

    const grid = (typeof computeRasterGrid === 'function') ? computeRasterGrid(cfg.layerKey) : null;
    const minLon = grid ? grid.minLon : 106.32;
    const maxLon = grid ? grid.maxLon : 107.60;
    const minLat = grid ? grid.minLat : 10.31;
    const maxLat = grid ? grid.maxLat : 11.51;
    const cosLat = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);

    const geoW = (maxLon - minLon) * cosLat;
    const geoH = (maxLat - minLat);
    const mapScale = Math.min((mapBox.w - 28) / geoW, (mapBox.h - 28) / geoH);
    const drawW = geoW * mapScale;
    const drawH = geoH * mapScale;
    const offX = mapBox.x + (mapBox.w - drawW) / 2;
    const offY = mapBox.y + (mapBox.h - drawH) / 2;

    const projX = (lon) => offX + ((lon - minLon) * cosLat) * mapScale;
    const projY = (lat) => offY + (maxLat - lat) * mapScale;

    // Vẽ nội dung trong vùng bản đồ
    ctx.save();
    ctx.beginPath();
    ctx.rect(mapBox.x, mapBox.y, mapBox.w, mapBox.h);
    ctx.clip();

    const lonTicks = _mcBuildTicks(minLon, maxLon, 0.2);
    const latTicks = _mcBuildTicks(minLat, maxLat, 0.2);

    if (cfg.showGraticule) {
        ctx.strokeStyle = 'rgba(100, 116, 139, 0.25)';
        ctx.lineWidth = 0.8;
        ctx.setLineDash([4, 4]);
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
        ctx.setLineDash([]);
    }

    // Lớp dữ liệu chính: Choropleth 167 phường hoặc Raster IDW
    if (cfg.displayMode === 'ward' && state.wardsBoundaryGeoJson && typeof buildWardValueMap === 'function') {
        const vMap = buildWardValueMap(cfg.layerKey);
        _mcDrawGeoFeatures(ctx, state.wardsBoundaryGeoJson, projX, projY, cfg.showWards ? '#334155' : 'transparent', cfg.showWards ? 0.75 : 0, (feat) => {
            const p = feat.properties || {};
            const info = vMap.get(removeVietnameseTones(p.fullName || p.name || ''));
            if (!info || info.value === null) return 'rgba(203, 213, 225, 0.85)';
            const c = interpolateColor(cfg.layerKey, info.value);
            return `rgba(${c[0]},${c[1]},${c[2]},0.9)`;
        });
    } else {
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
                const rgba = st === 2 ? interpolateColor(cfg.layerKey, grid.values[i]) : NODATA_RGBA;
                const o = i * 4;
                px[o] = rgba[0];
                px[o + 1] = rgba[1];
                px[o + 2] = rgba[2];
                px[o + 3] = 240;
            }
            tctx.putImageData(img, 0, 0);
            ctx.drawImage(tmp, offX, offY, drawW, drawH);
        }
        if (cfg.showWards && state.wardsBoundaryGeoJson) {
            _mcDrawGeoFeatures(ctx, state.wardsBoundaryGeoJson, projX, projY, 'rgba(15, 23, 42, 0.36)', 0.6);
        }
    }

    // Ranh giới tổng TP.HCM
    if (state.boundaryGeoJson) {
        _mcDrawGeoFeatures(ctx, state.boundaryGeoJson, projX, projY, '#0f172a', 1.8);
    }

    // Nhãn khu vực trọng điểm
    if (cfg.showLabels) {
        ctx.font = 'bold 11px "Segoe UI", Arial, sans-serif';
        ctx.textAlign = 'center';
        MAP_COMPOSER_DEFAULT_LABELS.forEach(lb => {
            const lx = projX(lb.lon);
            const ly = projY(lb.lat);
            if (lx < mapBox.x + 25 || lx > mapBox.x + mapBox.w - 25 || ly < mapBox.y + 15 || ly > mapBox.y + mapBox.h - 15) return;
            ctx.lineWidth = 3;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
            ctx.strokeText(lb.name, lx, ly);
            ctx.fillStyle = '#0f172a';
            ctx.fillText(lb.name, lx, ly);
        });
    }

    ctx.restore();

    // Khung bản đồ
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(mapBox.x, mapBox.y, mapBox.w, mapBox.h);

    // Nhãn tọa độ dọc khung bản đồ (DMS)
    if (cfg.showGraticule) {
        ctx.fillStyle = '#334155';
        ctx.font = '10px "Segoe UI", Arial, sans-serif';

        ctx.textAlign = 'center';
        lonTicks.forEach(ln => {
            const x = projX(ln);
            if (x > mapBox.x + 18 && x < mapBox.x + mapBox.w - 18) {
                const lbl = (typeof formatDMS === 'function') ? formatDMS(ln, false, false) : `${ln.toFixed(2)}°E`;
                ctx.beginPath();
                ctx.moveTo(x, mapBox.y);
                ctx.lineTo(x, mapBox.y - 4);
                ctx.moveTo(x, mapBox.y + mapBox.h);
                ctx.lineTo(x, mapBox.y + mapBox.h + 4);
                ctx.stroke();
                ctx.fillText(lbl, x, mapBox.y - 7);
                ctx.fillText(lbl, x, mapBox.y + mapBox.h + 14);
            }
        });

        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        latTicks.forEach(lt => {
            const y = projY(lt);
            if (y > mapBox.y + 14 && y < mapBox.y + mapBox.h - 14) {
                const lbl = (typeof formatDMS === 'function') ? formatDMS(lt, true, false) : `${lt.toFixed(2)}°N`;
                ctx.beginPath();
                ctx.moveTo(mapBox.x - 4, y);
                ctx.lineTo(mapBox.x, y);
                ctx.moveTo(mapBox.x + mapBox.w, y);
                ctx.lineTo(mapBox.x + mapBox.w + 4, y);
                ctx.stroke();
                ctx.fillText(lbl, mapBox.x - 7, y);
            }
        });
        ctx.textBaseline = 'alphabetic';
    }

    // Mũi tên hướng Bắc & Thước tỷ lệ trong khung bản đồ
    if (cfg.showNorth) {
        _mcDrawNorthArrow(ctx, mapBox.x + mapBox.w - 38, mapBox.y + 40, 1);
    }
    if (cfg.showScale) {
        const kmPerDegLon = 111.32 * cosLat;
        const px10km = (10 / kmPerDegLon) * cosLat * mapScale;
        _mcDrawScaleBar(ctx, mapBox.x + 22, mapBox.y + mapBox.h - 22, px10km);
    }

    // Chú giải & Khung thông số kỹ thuật
    if (isLandscape) {
        const legX = mapBox.x + mapBox.w + 18;
        let curY = mapBox.y;
        if (cfg.showLegend) {
            const lh = _mcDrawLegendPanel(ctx, legX, curY, sidePanelW, cfg);
            curY += lh + 14;
        }
        if (cfg.showMeta) {
            _mcDrawMetaPanel(ctx, legX, curY, sidePanelW, mapBox.y + mapBox.h - curY, cfg);
        }
    } else {
        const botY = mapBox.y + mapBox.h + 28;
        if (cfg.showLegend && cfg.showMeta) {
            const halfW = (baseW - 86) / 2;
            _mcDrawLegendPanel(ctx, 36, botY, halfW + 40, cfg);
            _mcDrawMetaPanel(ctx, 36 + halfW + 54, botY, halfW - 40, 210, cfg);
        } else if (cfg.showLegend) {
            _mcDrawLegendPanel(ctx, 36, botY, baseW - 72, cfg);
        } else if (cfg.showMeta) {
            _mcDrawMetaPanel(ctx, 36, botY, baseW - 72, 160, cfg);
        }
    }

    ctx.restore();
    return { width: baseW, height: baseH, cfg };
}

function _mcDrawMetaPanel(ctx, x, y, w, availH, cfg) {
    const h = Math.max(125, Math.min(availH, 230));
    const meta = INDEX_META[cfg.layerKey] || INDEX_META.tvdi;

    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1.2;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);

    ctx.fillStyle = '#1e3a8a';
    ctx.font = 'bold 12px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('THÔNG TIN THÀNH LẬP BẢN ĐỒ', x + 14, y + 22);

    ctx.strokeStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.moveTo(x + 14, y + 30);
    ctx.lineTo(x + w - 14, y + 30);
    ctx.stroke();

    const now = new Date();
    const exportDate = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
    const period = cfg.displayMode === 'ward' ? wardPeriodLabel(state.wards.source) : describeCurrentView(true);
    const lines = [
        `Hệ thống: Giám sát Mức độ Khô hạn tại TP.HCM`,
        `Hệ tọa độ: WGS 84 (EPSG:4326)`,
        `Chỉ số chính: ${meta.label}`,
        `Mốc dữ liệu: ${period || 'Chưa có dữ liệu'}`,
        `Thể hiện: ${cfg.displayMode === 'ward' ? 'Theo 167 Phường/Xã' : 'Raster bề mặt liên tục'}`,
        cfg.displayMode === 'ward' ? 'Nguồn: bảng phường/xã' : 'Nguồn: nội suy từ lưới của kỳ đã chọn',
        `Ngày xuất: ${exportDate}`,
    ];

    ctx.fillStyle = '#334155';
    ctx.font = '11px "Segoe UI", Arial, sans-serif';
    let ly = y + 48;
    lines.forEach(t => {
        if (ly < y + h - 8) {
            ctx.fillText(t, x + 14, ly);
            ly += 18;
        }
    });
    ctx.restore();
}

function refreshMapComposerPreview() {
    const canvas = document.getElementById('map-composer-canvas');
    if (!canvas) return;
    renderComposedMapCanvas(canvas, 1.0);
}

function syncMapComposerDefaults() {
    const layerSel = document.getElementById('mc-layer-select');
    const displaySel = document.getElementById('mc-display-select');
    const titleInp = document.getElementById('mc-title-input');
    const subInp = document.getElementById('mc-subtitle-input');

    const activeKey = state.activeRasterLayer || 'tvdi';
    if (layerSel) layerSel.value = activeKey;
    if (displaySel) displaySel.value = state.displayMode || 'pixel';
    if (titleInp) titleInp.value = _mcDefaultTitle(activeKey);
    if (subInp) subInp.value = _mcDefaultSubtitle();
}

function exportComposedMapPNG() {
    const cfg = _mcReadComposerConfig();
    const hiResCanvas = document.createElement('canvas');
    renderComposedMapCanvas(hiResCanvas, cfg.scaleFactor);

    const dStr = (state.currentDate || getTodayDateStr() || 'map').replace(/[^0-9-]/g, '');
    const link = document.createElement('a');
    link.download = `Ban_do_${cfg.layerKey.toUpperCase()}_TPHCM_${dStr}.png`;
    link.href = hiResCanvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    if (typeof showToast === 'function') showToast(`Đã xuất ảnh Bản đồ ${cfg.layerKey.toUpperCase()} PNG!`);
}

function exportComposedMapPDF() {
    const cfg = _mcReadComposerConfig();
    const hiResCanvas = document.createElement('canvas');
    renderComposedMapCanvas(hiResCanvas, cfg.scaleFactor);

    const printSheet = document.getElementById('mc-print-sheet');
    if (!printSheet) return;
    printSheet.innerHTML = `<img src="${hiResCanvas.toDataURL('image/png')}" alt="Bản đồ chuyên đề" class="${cfg.orientation === 'landscape' ? 'is-landscape' : 'is-portrait'}" />`;

    document.body.classList.add('printing-map-composer');
    document.body.classList.toggle('mc-print-landscape', cfg.orientation === 'landscape');

    const cleanup = () => {
        document.body.classList.remove('printing-map-composer', 'mc-print-landscape');
    };
    window.addEventListener('afterprint', cleanup, { once: true });
    if (window.matchMedia) {
        const mql = window.matchMedia('print');
        const onChange = (e) => {
            if (!e.matches) {
                cleanup();
                if (mql.removeEventListener) mql.removeEventListener('change', onChange);
                else if (mql.removeListener) mql.removeListener(onChange);
            }
        };
        if (mql.addEventListener) mql.addEventListener('change', onChange);
        else if (mql.addListener) mql.addListener(onChange);
    }
    window.print();
}

async function openMapComposerModal() {
    const modal = document.getElementById('map-composer-modal');
    if (!modal) return;
    if (!state.currentGridData && typeof loadDataForCurrentDate === 'function') {
        await loadDataForCurrentDate();
    }
    syncMapComposerDefaults();
    modal.style.display = 'flex';
    refreshMapComposerPreview();
}

function setupMapComposer() {
    const btnOpen = document.getElementById('btn-open-map-composer');
    const modal = document.getElementById('map-composer-modal');
    const btnClose = document.getElementById('btn-close-map-composer');
    const btnCloseFooter = document.getElementById('btn-close-mc-footer');
    const btnPng = document.getElementById('btn-mc-export-png');
    const btnPdf = document.getElementById('btn-mc-export-pdf');
    const btnGeoJson = document.getElementById('btn-mc-export-geojson');

    if (btnOpen) btnOpen.addEventListener('click', openMapComposerModal);
    if (!modal) return;

    const closeModal = () => { modal.style.display = 'none'; };
    if (btnClose) btnClose.addEventListener('click', closeModal);
    if (btnCloseFooter) btnCloseFooter.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    // Tự cập nhật tiêu đề khi đổi chỉ số trong modal
    const layerSel = document.getElementById('mc-layer-select');
    if (layerSel) {
        layerSel.addEventListener('change', () => {
            const titleInp = document.getElementById('mc-title-input');
            if (titleInp) titleInp.value = _mcDefaultTitle(layerSel.value);
            refreshMapComposerPreview();
        });
    }

    const inputIds = [
        'mc-display-select', 'mc-orient-select', 'mc-title-input', 'mc-subtitle-input',
        'mc-res-select', 'mc-opt-graticule', 'mc-opt-wards', 'mc-opt-labels',
        'mc-opt-north', 'mc-opt-scale', 'mc-opt-legend', 'mc-opt-meta',
    ];
    inputIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const evt = (el.tagName === 'INPUT' && el.type === 'text') ? 'input' : 'change';
        el.addEventListener(evt, refreshMapComposerPreview);
    });

    if (btnPng) btnPng.addEventListener('click', exportComposedMapPNG);
    if (btnPdf) btnPdf.addEventListener('click', exportComposedMapPDF);
    if (btnGeoJson) {
        btnGeoJson.addEventListener('click', () => {
            if (typeof exportToGeoJSON === 'function') exportToGeoJSON();
        });
    }
}
