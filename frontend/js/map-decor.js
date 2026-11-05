/**
 * ============================================================================
 * WebGIS TVDI TP. Hồ Chí Minh – Trình bày bản đồ (Cartographic elements)
 * Bản đồ nền, mũi tên Bắc, lưới tọa độ kinh – vĩ độ, thước tỷ lệ, tọa độ con trỏ,
 * khung tiêu đề bản đồ, chú giải thang màu và đồng hồ hệ thống.
 * Dùng chung trạng thái `state` và bản đồ `map` khai báo trong app.js.
 * ============================================================================
 */

// --- 1. Danh mục bản đồ nền ---
// labels: lớp nhãn địa danh vẽ phía TRÊN lớp raster chỉ số (pane 'labelsPane')
const ESRI_TILE = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const BASEMAP_DEFS = {
    esri_light: {
        name: 'Nền sáng',
        icon: 'fa-sun',
        url: `${ESRI_TILE}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
        labels: `${ESRI_TILE}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
        maxZoom: 16,
        attribution: 'Tiles &copy; Esri — Esri, HERE, Garmin, &copy; OpenStreetMap contributors',
    },
    roadmap: {
        name: 'Đường phố',
        icon: 'fa-road',
        url: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
        maxZoom: 20,
        attribution: '&copy; Google Maps',
    },
    hybrid: {
        name: 'Vệ tinh',
        icon: 'fa-satellite',
        url: 'https://mt1.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}',
        maxZoom: 20,
        attribution: '&copy; Google Satellite',
    },
    terrain: {
        name: 'Địa hình',
        icon: 'fa-mountain',
        url: 'https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}',
        maxZoom: 20,
        attribution: '&copy; Google Maps',
    },
};

function createBaseMapLayers() {
    const layers = {};
    Object.entries(BASEMAP_DEFS).forEach(([key, def]) => {
        if (!def.url) {
            layers[key] = null;
            return;
        }
        const opts = {
            maxZoom: 20,
            maxNativeZoom: def.maxZoom || 19,
            subdomains: def.subdomains || 'abc',
            attribution: def.attribution || '',
        };
        const base = L.tileLayer(def.url, opts);
        layers[key] = def.labels
            ? L.layerGroup([base, L.tileLayer(def.labels, { ...opts, attribution: '', pane: 'labelsPane' })])
            : base;
    });
    return layers;
}

// --- 2. Định dạng tọa độ độ – phút – giây ---
function formatDMS(value, isLat, withSeconds = false) {
    const hemi = isLat ? (value >= 0 ? 'N' : 'S') : (value >= 0 ? 'E' : 'W');
    const total = Math.round(Math.abs(value) * 3600);
    const d = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = String(m).padStart(2, '0');
    return withSeconds
        ? `${d}°${mm}'${String(s).padStart(2, '0')}"${hemi}`
        : `${d}°${mm}'${hemi}`;
}

function formatDateVN(dateStr) {
    if (!dateStr) return '--';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
}

// --- 3. Khung bản đồ: thước tỷ lệ, tọa độ con trỏ, mũi tên Bắc & công cụ ---
const NORTH_ARROW_SVG = `
    <svg viewBox="0 0 40 52" width="30" height="40" aria-hidden="true">
        <text x="20" y="11" text-anchor="middle" font-size="11" font-weight="800" fill="#0f172a" font-family="Segoe UI, Arial">N</text>
        <polygon points="20,14 30,46 20,39 10,46" fill="#ffffff" stroke="#0f172a" stroke-width="1.6" stroke-linejoin="round"/>
        <polygon points="20,14 20,39 10,46" fill="#0f172a"/>
    </svg>`;

let graticuleLayer = null;
let graticuleRenderer = null;

function setupMapDecorations() {
    if (!map) return;

    // Thước tỷ lệ (hệ mét)
    L.control.scale({ position: 'bottomright', metric: true, imperial: false, maxWidth: 130 }).addTo(map);

    // Hộp tọa độ con trỏ chuột (độ – phút – giây & độ thập phân) + giá trị chỉ số tại vị trí
    const CoordsControl = L.Control.extend({
        options: { position: 'bottomright' },
        onAdd: function () {
            const div = L.DomUtil.create('div', 'map-coords-box');
            div.innerHTML = '<span id="map-coords-text">Di chuột trên bản đồ để xem tọa độ</span>';
            L.DomEvent.disableClickPropagation(div);
            return div;
        }
    });
    map.addControl(new CoordsControl());

    map.on('mousemove', (e) => {
        const el = document.getElementById('map-coords-text');
        if (!el) return;
        const { lat, lng } = e.latlng;
        let html = `${formatDMS(lat, true, true)} <span class="coord-dec">${lat.toFixed(4)}°</span> · ${formatDMS(lng, false, true)} <span class="coord-dec">${lng.toFixed(4)}°</span>`;
        if (state.displayMode === 'pixel' && state.currentGridData) {
            const key = state.activeRasterLayer;
            let v = null;
            if (state.rasterSource === 'pixel') v = pixelValueAt(lat, lng, key);
            else if (state.rasterSource === 'idw') v = sampleRasterGrid(computeRasterGrid(key), lat, lng);
            if (v !== null) html += ` · <strong>${INDEX_META[key].label} ${formatIndexValue(v, key)}</strong>`;
        }
        el.innerHTML = html;
    });
    map.on('mouseout', () => {
        const el = document.getElementById('map-coords-text');
        if (el) el.innerText = 'Di chuột trên bản đồ để xem tọa độ';
    });

    // Mũi tên Bắc & thanh công cụ bản đồ (góc trên bên phải)
    const ToolsControl = L.Control.extend({
        options: { position: 'topright' },
        onAdd: function () {
            const c = L.DomUtil.create('div', 'map-tools-control');
            c.innerHTML = `
                <button type="button" class="map-north-arrow" data-tool="north" title="Hướng Bắc (3D: nhấp để xoay về hướng Bắc)">${NORTH_ARROW_SVG}</button>
                <div class="map-tools-stack">
                    <button type="button" data-tool="home" title="Về toàn vùng nghiên cứu"><i class="fa-solid fa-house"></i></button>
                    <button type="button" data-tool="zoomin" title="Phóng to"><i class="fa-solid fa-plus"></i></button>
                    <button type="button" data-tool="zoomout" title="Thu nhỏ"><i class="fa-solid fa-minus"></i></button>
                </div>
                <div class="map-tools-stack">
                    <button type="button" data-tool="fullscreen" title="Toàn màn hình"><i class="fa-solid fa-expand"></i></button>
                    <button type="button" data-tool="info" title="Thông tin dữ liệu bản đồ"><i class="fa-solid fa-circle-info"></i></button>
                </div>`;
            L.DomEvent.disableClickPropagation(c);
            L.DomEvent.disableScrollPropagation(c);
            c.addEventListener('click', (e) => {
                const btn = e.target.closest('button[data-tool]');
                if (btn) handleMapTool(btn.dataset.tool, btn);
            });
            return c;
        }
    });
    map.addControl(new ToolsControl());

    const btnCloseInfo = document.getElementById('btn-close-map-info');
    if (btnCloseInfo) {
        btnCloseInfo.addEventListener('click', () => {
            const panel = document.getElementById('map-info-panel');
            if (panel) panel.style.display = 'none';
        });
    }

    document.addEventListener('fullscreenchange', () => {
        const isFs = !!document.fullscreenElement;
        document.querySelectorAll('.map-tools-control button[data-tool="fullscreen"]').forEach(b => {
            b.innerHTML = isFs ? '<i class="fa-solid fa-compress"></i>' : '<i class="fa-solid fa-expand"></i>';
            b.title = isFs ? 'Thoát toàn màn hình' : 'Toàn màn hình';
        });
        setTimeout(() => {
            if (map) map.invalidateSize();
            if (typeof resize3DMap === 'function') resize3DMap();
            updateGraticule();
        }, 150);
    });

    // Lưới tọa độ kinh – vĩ độ
    graticuleRenderer = L.svg({ pane: 'graticulePane' });
    graticuleLayer = L.layerGroup().addTo(map);
    map.on('moveend zoomend resize', updateGraticule);
    updateGraticule();
}

// Phạm vi đất liền TP.HCM (dùng cho nút "Về toàn vùng")
function getStudyBounds() {
    const geo = getMainlandGeometry();
    if (geo) {
        const [minLon, minLat, maxLon, maxLat] = geo.bbox;
        return L.latLngBounds([[minLat, minLon], [maxLat, maxLon]]);
    }
    return L.latLngBounds([[10.32, 106.32], [11.51, 107.58]]);
}

function handleMapTool(tool, btn) {
    // Ở chế độ 3D, các nút điều khiển camera của bản đồ MapLibre
    const m3d = (state.viewMode === '3d' && state.map3d.map) ? state.map3d.map : null;
    switch (tool) {
        case 'north':
            if (m3d) m3d.easeTo({ bearing: 0, duration: 600 });
            break;
        case 'home':
            if (m3d) reset3DCamera();
            else map.flyToBounds(getStudyBounds(), { padding: [24, 24], duration: 0.8 });
            break;
        case 'zoomin':
            if (m3d) m3d.zoomIn();
            else map.zoomIn();
            break;
        case 'zoomout':
            if (m3d) m3d.zoomOut();
            else map.zoomOut();
            break;
        case 'fullscreen': {
            const el = document.getElementById('map-container');
            if (!document.fullscreenElement && el && el.requestFullscreen) {
                el.requestFullscreen().catch(() => showToast('Trình duyệt không cho phép chế độ toàn màn hình.'));
            } else if (document.fullscreenElement && document.exitFullscreen) {
                document.exitFullscreen();
            }
            break;
        }
        case 'info': {
            const panel = document.getElementById('map-info-panel');
            if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
            break;
        }
        default:
            break;
    }
}

function setGraticuleVisible(visible) {
    state.mapDecor.graticule = !!visible;
    const chk = document.getElementById('chk-graticule');
    if (chk) chk.checked = state.mapDecor.graticule;
    updateGraticule();
}

// Xoay mũi tên Bắc theo góc phương vị camera 3D
function setNorthArrowBearing(bearing) {
    document.querySelectorAll('.map-north-arrow svg').forEach(svg => {
        svg.style.transform = bearing ? `rotate(${-bearing}deg)` : '';
    });
}

// Bước lưới theo độ – phút (1°, 30', 15', 10', 5', 2', 1', 30", 15")
const GRATICULE_STEPS = [1, 0.5, 0.25, 1 / 6, 1 / 12, 1 / 30, 1 / 60, 1 / 120, 1 / 240];

function updateGraticule() {
    const labels = document.getElementById('graticule-labels');
    if (labels) labels.innerHTML = '';
    if (!graticuleLayer || !map) return;
    graticuleLayer.clearLayers();
    if (!state.mapDecor.graticule || state.viewMode === '3d') return;

    const b = map.getBounds();
    const size = map.getSize();
    const west = b.getWest(), east = b.getEast(), south = b.getSouth(), north = b.getNorth();
    const step = GRATICULE_STEPS.find(s => (east - west) / s >= 4) || GRATICULE_STEPS[GRATICULE_STEPS.length - 1];
    const withSec = step < 1 / 60 - 1e-9;
    const lineStyle = { renderer: graticuleRenderer, color: '#475569', weight: 0.7, opacity: 0.45, dashArray: '4 5', interactive: false };
    const midLat = (south + north) / 2;
    const midLon = (west + east) / 2;
    let html = '';

    for (let i = Math.ceil(west / step); i * step <= east; i++) {
        const lon = i * step;
        graticuleLayer.addLayer(L.polyline([[south - 1, lon], [north + 1, lon]], lineStyle));
        const x = map.latLngToContainerPoint([midLat, lon]).x;
        if (x < 40 || x > size.x - 40) continue;
        const txt = formatDMS(lon, false, withSec);
        html += `<div class="grat-label grat-top" style="left:${x}px">${txt}</div><div class="grat-label grat-bottom" style="left:${x}px">${txt}</div>`;
    }
    for (let j = Math.ceil(south / step); j * step <= north; j++) {
        const lat = j * step;
        graticuleLayer.addLayer(L.polyline([[lat, west - 1], [lat, east + 1]], lineStyle));
        const y = map.latLngToContainerPoint([lat, midLon]).y;
        if (y < 40 || y > size.y - 40) continue;
        const txt = formatDMS(lat, true, withSec);
        html += `<div class="grat-label grat-left" style="top:${y}px">${txt}</div><div class="grat-label grat-right" style="top:${y}px">${txt}</div>`;
    }
    if (labels) labels.innerHTML = html;
}

// --- 4. Mô tả dữ liệu đang hiển thị & khung tiêu đề bản đồ ---
function describeCurrentView(short = false) {
    const v = state.currentView;
    if (!v) return '--';
    if (v.kind === 'forecast') {
        return short ? `Dự báo ${formatDateVN(v.date)}` : `Dự báo AI ngày ${formatDateVN(v.date)}`;
    }
    if (v.kind === 'aggregate') {
        const n = v.nDates || 0;
        if (v.agg === 'month') {
            const mm = `${v.start.substring(5, 7)}/${v.start.substring(0, 4)}`;
            return short ? `TB tháng ${mm}` : `Trung bình tháng ${mm} (${n} kỳ quan trắc)`;
        }
        if (v.agg === 'year') {
            return short ? `TB năm ${v.start.substring(0, 4)}` : `Trung bình năm ${v.start.substring(0, 4)} (${n} kỳ quan trắc)`;
        }
        const a = `${v.start.substring(5, 7)}/${v.start.substring(0, 4)}`;
        const z = `${v.end.substring(5, 7)}/${v.end.substring(0, 4)}`;
        return short ? `TB ${a} – ${z}` : `Trung bình ${a} – ${z} (${n} kỳ quan trắc)`;
    }
    return short
        ? `Kỳ ${formatDateVN(v.date)}`
        : `Kỳ quan trắc 15 ngày ${formatDateVN(v.start)} – ${formatDateVN(v.end)}`;
}

function updateMapTitle() {
    const mainEl = document.getElementById('map-title-main');
    const subEl = document.getElementById('map-title-sub');
    if (!mainEl || !subEl) return;

    const key = state.activeRasterLayer;
    const meta = INDEX_META[key];
    const v = state.currentView;
    const isForecast = v && v.kind === 'forecast';

    mainEl.innerText = isForecast
        ? 'BẢN ĐỒ DỰ BÁO KHÔ HẠN (TVDI) TP. HỒ CHÍ MINH'
        : `${meta.mapTitle} TP. HỒ CHÍ MINH`;

    if (!v) {
        subEl.innerText = 'Đang tải dữ liệu...';
        return;
    }

    let source;
    if (state.displayMode === 'ward') {
        source = 'giá trị trung bình 167 phường/xã';
    } else if (state.rasterSource === 'pixel' && typeof pixelRaster !== 'undefined' && pixelRaster.field) {
        source = pixelRaster.field.label;
    } else if (state.rasterSource === 'gee') {
        source = 'ảnh Landsat 30 m (Google Earth Engine)';
    } else {
        source = 'nội suy lưới ~5,5 km';
    }
    subEl.innerHTML = `<strong>${describeCurrentView(false)}</strong> · ${source}${state.viewMode === '3d' ? ' <span class="title-3d-tag">3D</span>' : ''}`;
}

// --- 5. Chú giải: thang màu liên tục + bảng phân cấp chi tiết ---
function legendTickLabel(value, key) {
    if (key === 'lst') return Number.isInteger(value) ? String(value) : value.toFixed(1);
    const s = value.toFixed(2);
    return s.replace(/0$/, '');
}

function renderLegend(layerKey) {
    const key = layerKey || state.activeRasterLayer;
    const meta = INDEX_META[key];
    const cfg = GEE_COLOR_PALETTES[key];
    if (!meta || !cfg) return;

    const titleEl = document.getElementById('legend-title');
    const badgeEl = document.getElementById('legend-badge');
    const gradEl = document.getElementById('legend-gradient');
    const ticksEl = document.getElementById('legend-ticks');
    const lowEl = document.getElementById('legend-low');
    const highEl = document.getElementById('legend-high');
    const bodyEl = document.getElementById('legend-body');

    if (titleEl) titleEl.innerHTML = `<i class="fa-solid ${meta.icon}"></i> ${meta.legendTitle}`;
    if (badgeEl) {
        badgeEl.innerText = state.displayMode === 'ward'
            ? 'phường/xã'
            : ({ gee: 'pixel 30 m', pixel: 'pixel 120 m' }[state.rasterSource] || 'nội suy');
    }
    if (gradEl) {
        const n = cfg.colors.length - 1;
        const stops = cfg.colors.map((c, i) => `${c} ${(i / n * 100).toFixed(1)}%`).join(', ');
        gradEl.style.background = `linear-gradient(to right, ${stops})`;
    }
    if (ticksEl) {
        const parts = [];
        for (let i = 0; i <= 4; i++) {
            const v = cfg.min + (cfg.max - cfg.min) * i / 4;
            parts.push(`<span style="left:${i * 25}%">${legendTickLabel(Math.round(v * 1000) / 1000, key)}</span>`);
        }
        ticksEl.innerHTML = parts.join('');
    }
    if (lowEl) lowEl.innerText = `◀ ${meta.low}`;
    if (highEl) highEl.innerText = `${meta.high} ▶`;

    if (bodyEl) {
        let rows = [];
        let footer = '';
        if (key === 'tvdi') {
            const ranges = ['0.000 – 0.125', '0.125 – 0.250', '0.250 – 0.375', '0.375 – 0.500', '0.500 – 0.625', '0.625 – 0.750', '0.750 – 0.875', '0.875 – 1.000'];
            const mids = [0.06, 0.19, 0.31, 0.44, 0.56, 0.69, 0.81, 0.94];
            rows = mids.map((m, i) => {
                const theme = getDroughtUITheme(m);
                return { color: theme.badgeBg, range: ranges[i], label: theme.label, cls: theme.level >= 8 ? 'is-severe' : (theme.level >= 6 ? 'is-drought' : '') };
            });
            footer = '<div class="legend-v-footer"><i class="fa-solid fa-triangle-exclamation"></i><span>Vùng bị hạn: TVDI ≥ 0.625 (8 cấp theo thang TVDI)</span></div>';
        } else if (key === 'lst') {
            const bins = [
                [null, 25, '< 25 °C', 'Mát – mặt nước, rừng ngập mặn'],
                [25, 30, '25 – 30 °C', 'Ôn hòa – thực vật dày'],
                [30, 35, '30 – 35 °C', 'Ấm – nông nghiệp, cây xanh'],
                [35, 40, '35 – 40 °C', 'Nóng – đô thị, đất trống'],
                [40, 45, '40 – 45 °C', 'Rất nóng – đảo nhiệt đô thị'],
                [45, null, '≥ 45 °C', 'Cực nóng – mái tôn, bê tông'],
            ];
            rows = bins.map(([a, b, range, label]) => {
                const rep = a === null ? b - 1 : (b === null ? a + 1 : (a + b) / 2);
                return { color: rgbCss(interpolateColor('lst', rep)), range, label, cls: (a !== null && a >= 40) ? 'is-drought' : '' };
            });
            footer = '<div class="legend-v-footer"><i class="fa-solid fa-temperature-arrow-up"></i><span>Ngưỡng nóng tham chiếu: LST ≥ 40 °C</span></div>';
        } else {
            const bins = [
                [null, 0, '< 0', 'Mặt nước'],
                [0, 0.2, '0 – 0.2', 'Đất trống / bê tông đô thị'],
                [0.2, 0.4, '0.2 – 0.4', 'Thực vật thưa'],
                [0.4, 0.6, '0.4 – 0.6', 'Thực vật trung bình'],
                [0.6, null, '≥ 0.6', 'Thực vật dày, rừng'],
            ];
            rows = bins.map(([a, b, range, label]) => {
                const rep = a === null ? -0.1 : (b === null ? 0.75 : (a + b) / 2);
                return { color: rgbCss(interpolateColor('ndvi', rep)), range, label, cls: '' };
            });
            footer = '<div class="legend-v-footer"><i class="fa-solid fa-seedling"></i><span>Ngưỡng thiếu cây xanh tham chiếu: NDVI &lt; 0.2</span></div>';
        }
        bodyEl.innerHTML = `
            <div class="legend-v-list">
                ${rows.map(r => `
                    <div class="legend-v-item ${r.cls}">
                        <span class="legend-v-color" style="background-color: ${r.color};"></span>
                        <span class="legend-v-range">${r.range}</span>
                        <span class="legend-v-label">${r.label}</span>
                    </div>`).join('')}
            </div>
            ${footer}`;
    }
}

// --- 6. Đồng hồ hệ thống trên thanh tiêu đề ---
function startHeaderClock() {
    const el = document.getElementById('header-clock-text');
    const box = document.getElementById('header-clock');
    if (!el) return;
    const tick = () => {
        const now = new Date();
        el.innerText = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        if (box) box.title = now.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
    };
    tick();
    setInterval(tick, 1000);
}
