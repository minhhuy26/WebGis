/**
 * ============================================================================
 * WebGIS TVDI TP. Hồ Chí Minh – Google Earth Engine & PostGIS Integration
 * Giai đoạn 2017 – 2025 | Dữ liệu viễn thám Landsat 8/9
 * Giao diện và trực quan hóa đồng bộ 100% với Google Earth Engine Code Editor
 * ============================================================================
 */

// --- 1. Trạng thái ứng dụng (State) ---
const state = {
    dates: [],                  // 216 mốc ngày thực tế + 4 mốc dự báo 2026
    forecastDates: [],          // Mốc ngày dự báo tương lai
    currentDate: '',            // Mốc ngày đang chọn (YYYY-MM-DD)
    currentDateIndex: 0,        // Vị trí mốc ngày hiện tại
    stepUnit: 'day',            // Đơn vị tăng/giảm mốc thời gian: 'day' (1 ngày) | 'cycle' (15 ngày)
    activeRasterLayer: 'tvdi',  // 'tvdi' | 'ndvi' | 'lst'
    isAIMode: true,             // Mặc định khởi động vào chế độ Dự báo AI Realtime
    showAIPredictionLine: true, // Hiển thị đường AI trên biểu đồ
    aiMetrics: null,
    currentSeriesData: null,
    currentSeriesTitle: '',
    baseMaps: {},
    activeBaseMap: 'esri_light',
    displayMode: 'pixel',       // 'pixel' (ảnh raster) | 'ward' (tô màu theo phường/xã)
    aggregation: 'cycle',       // 'cycle' (kỳ 15 ngày) | 'month' | 'year' | 'period' (trung bình giai đoạn)
    observedDates: [],          // Các mốc quan trắc Landsat thực tế (2017–2025)
    currentView: null,          // Dữ liệu đang hiển thị: { kind: 'forecast'|'cycle'|'aggregate', date, start, end, nDates }
    currentDataKey: '',         // Khóa nhận diện bộ dữ liệu đang hiển thị (dùng cho bộ đệm raster)
    rasterSource: 'idw',        // 'gee' (ảnh 30 m từ Google Earth Engine) | 'idw' (nội suy lưới ô) | 'ward'
    loadSeq: 0,                 // Bộ đếm yêu cầu tải dữ liệu (bỏ qua phản hồi cũ khi đổi ngày liên tục)
    rasterSeq: 0,
    wardsSeq: 0,
    overallSeriesCache: null,   // Chuỗi trung bình toàn vùng (dùng cho biên khô/ướt trong biểu đồ tam giác TVDI)
    mapDecor: {
        title: true,
        graticule: true,
        mask: true,
    },
    map3d: {
        map: null,
        ready: false,
        exaggeration: 1,
        rotating: false,
    },
    analysisCharts: {},
    layerOpacities: {
        gridPoints: 1.0,
        gridCells: 0.85,
        tvdi: 1.0,
        ndvi: 1.0,
        lst: 1.0,
        boundary: 1.0,
        wardsBoundary: 0.9,
    },
    layerVisibility: {
        gridPoints: false,      // Mặc định tắt (như trong GEE screenshot)
        gridCells: false,       // Lưới đa giác ô 5km
        tvdi: true,             // Lớp chỉ số đang chọn (LST / NDVI / TVDI) – bật / tắt chung
        ndvi: true,
        lst: true,
        boundary: true,         // Mặc định bật
        wardsBoundary: true,    // Mặc định bật hiển thị ranh giới 168 phường/xã
    },
    selectedCellId: null,
    selectedCellProps: null,
    selectedPoint: null,
    selectedMarker: null,
    isPlaying: false,
    playTimer: null,
    timeSeriesChart: null,
    chartTab: 'overall',
    chartMode: '15days', // '15days' | 'history'
    currentHistoricalSeries: null,
    currentGridData: null,
    boundaryGeoJson: null,
    wardsBoundaryGeoJson: null,
    geeStatus: { initialized: false, project_id: '' },
    geeTileLayer: null,
    localRasterLayer: null,

    // Phân quyền & Quản lý phiên làm việc (Yêu cầu 7)
    auth: {
        role: localStorage.getItem('tvdi_token') ? 'user' : 'guest',
        token: localStorage.getItem('tvdi_token') || null,
        full_name: 'Người dùng',
        is_admin: false,
        permissions: ['view', 'stats'],
    },

    // Chế độ xem 2D / 3D (Yêu cầu 4)
    viewMode: '2d', // '2d' | '3d'

    // Trình chiếu Animation theo chuỗi thời gian (Yêu cầu 4)
    animation: {
        isPlaying: false,
        timer: null,
        speedMs: 1200,
    },

    // Danh sách & Bộ lọc xếp hạng 167 Phường (Yêu cầu 1 & 2)
    wards: {
        list: [],
        allList: [],        // Toàn bộ 167 phường/xã (không lọc ngưỡng) – dùng tô màu bản đồ & 3D
        isForecast: false,
        sortBy: 'lst_desc', // 'lst_desc' | 'ndvi_asc' | 'tvdi_desc' | 'name_asc'
        thresholds: {
            min_lst: null,
            max_lst: null,
            min_ndvi: null,
            max_ndvi: null,
            min_tvdi: null,
            max_tvdi: null,
        },
        searchQuery: '',
        selectedWardId: null,
        markersLayer: null,
    },
};


const GEE_COLOR_PALETTES = {
    tvdi: {
        title: 'Thang màu TVDI (Độ khô hạn)',
        min: 0.0,
        max: 1.0,
        // 8 màu chuẩn từ file 'Thang màu Nhiệt độ-NDVI-TVDI.pdf' 
        colors: ['#066b00', '#0bc400', '#0ce100', '#00ff00', '#ffff00', '#ffcc00', '#ff6600', '#ff0000'],
        stops: [
            { val: 0.000, label: '0.000', color: '#066b00' },
            { val: 0.125, label: '0.125', color: '#0bc400' },
            { val: 0.250, label: '0.250', color: '#0ce100' },
            { val: 0.375, label: '0.375', color: '#00ff00' },
            { val: 0.500, label: '0.500', color: '#ffff00' },
            { val: 0.625, label: '0.625', color: '#ffcc00' },
            { val: 0.750, label: '0.750', color: '#ff6600' },
            { val: 0.875, label: '0.875', color: '#ff0000' },
            { val: 1.000, label: '1.000', color: '#ff0000' }
        ]
    },
    lst: {
        title: 'Thang màu Nhiệt độ bề mặt đất LST (°C)',
        // Bảng màu theo 'Thang màu Nhiệt độ-NDVI-TVDI.pdf'; dải hiển thị mặc định 25–45 °C (chỉnh được trong bảng Lớp bản đồ)
        min: 25,
        max: 45,
        colors: ['#0000FF', '#0066FF', '#00FFFF', '#00FF00', '#FFFF00', '#FFCC00', '#FF6600', '#FF0000'],
        stops: [
            { val: 25, label: '25 °C (Mát)', color: '#0000FF' },
            { val: 30, label: '30 °C', color: '#00E6FF' },
            { val: 35, label: '35 °C', color: '#80FF00' },
            { val: 40, label: '40 °C', color: '#FFB300' },
            { val: 45, label: '45 °C (Rất nóng)', color: '#FF0000' }
        ]
    },
    ndvi: {
        title: 'Thang màu Chỉ số thực vật NDVI',
        min: -0.2,
        max: 1.0,
        colors: ['#FF0000', '#FF7F00', '#FFFF00', '#ADFF2F', '#00FF00', '#00FFFF', '#007FFF', '#0000FF'],
        stops: [
            { val: -0.2, label: '-0.2 (Nước)', color: '#FF0000' },
            { val: 0.1, label: '0.1 (Đất trống)', color: '#FF7F00' },
            { val: 0.3, label: '0.3 (Thực vật thưa)', color: '#FFFF00' },
            { val: 0.5, label: '0.5 (Cây bụi)', color: '#00FF00' },
            { val: 0.7, label: '0.7 (Rừng rậm)', color: '#00FFFF' },
            { val: 1.0, label: '1.0 (Xanh đậm)', color: '#0000FF' }
        ]
    }
};

// Chuyển giá trị số sang màu RGBA tương ứng trong thang màu GEE (Chuẩn 100% PDF)
function interpolateColor(paletteKey, value) {
    if (value === null || value === undefined || isNaN(value)) {
        return [0, 0, 0, 0]; // Trong suốt nếu thiếu dữ liệu
    }

    const config = GEE_COLOR_PALETTES[paletteKey] || GEE_COLOR_PALETTES.tvdi;
    const norm = Math.max(0, Math.min(1, (value - config.min) / (config.max - config.min)));
    const colors = config.colors;
    const n = colors.length - 1;
    const idx = norm * n;
    const i = Math.floor(idx);
    const f = idx - i;

    if (i >= n) {
        const rgb = hexToRgb(colors[n]);
        return [rgb[0], rgb[1], rgb[2], 255];
    }

    const c1 = hexToRgb(colors[i]);
    const c2 = hexToRgb(colors[i + 1]);

    return [
        Math.round(c1[0] + f * (c2[0] - c1[0])),
        Math.round(c1[1] + f * (c2[1] - c1[1])),
        Math.round(c1[2] + f * (c2[2] - c1[2])),
        255
    ];
}

function hexToRgb(hex) {
    const bigint = parseInt(hex.replace('#', ''), 16);
    return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
}

// Dải hiển thị mặc định của từng thang màu (dùng cho nút "Mặc định" trong bảng Lớp bản đồ)
const DEFAULT_VIZ_RANGE = {
    tvdi: { min: 0, max: 1 },
    lst: { min: 25, max: 45 },
    ndvi: { min: -0.2, max: 1 },
};

// Thông tin hiển thị của 3 chỉ số viễn thám
const INDEX_META = {
    lst: {
        label: 'LST',
        unit: '°C',
        name: 'Nhiệt độ bề mặt đất',
        legendTitle: 'LST (°C) – Nhiệt độ bề mặt đất',
        mapTitle: 'BẢN ĐỒ NHIỆT ĐỘ BỀ MẶT (LST)',
        icon: 'fa-temperature-half',
        low: 'Mát',
        high: 'Nóng',
        decimals: 1,
        step: 0.5,
    },
    ndvi: {
        label: 'NDVI',
        unit: '',
        name: 'Chỉ số thực vật',
        legendTitle: 'NDVI – Chỉ số thực vật',
        mapTitle: 'BẢN ĐỒ CHỈ SỐ THỰC VẬT (NDVI)',
        icon: 'fa-leaf',
        low: 'Ít thực vật',
        high: 'Thực vật dày',
        decimals: 3,
        step: 0.05,
    },
    tvdi: {
        label: 'TVDI',
        unit: '',
        name: 'Chỉ số khô hạn thực vật',
        legendTitle: 'TVDI – Chỉ số khô hạn thực vật',
        mapTitle: 'BẢN ĐỒ CHỈ SỐ KHÔ HẠN (TVDI)',
        icon: 'fa-droplet',
        low: 'Ẩm',
        high: 'Khô hạn',
        decimals: 3,
        step: 0.05,
    },
};

// Lấy giá trị chỉ số từ thuộc tính ô lưới (TVDI dự báo dùng tvdi_pred khi không có tvdi)
function getIndexValue(props, key) {
    if (!props) return null;
    let v;
    if (key === 'lst') v = props.lst_c;
    else if (key === 'ndvi') v = props.ndvi;
    else v = (props.tvdi !== null && props.tvdi !== undefined) ? props.tvdi : props.tvdi_pred;
    if (v === null || v === undefined || v === '' || isNaN(v)) return null;
    return Number(v);
}

function formatIndexValue(value, key, withUnit = true) {
    if (value === null || value === undefined || isNaN(value)) return '--';
    const meta = INDEX_META[key] || INDEX_META.tvdi;
    const txt = Number(value).toFixed(meta.decimals);
    return (withUnit && meta.unit) ? `${txt} ${meta.unit}` : txt;
}

function rgbCss(rgb) {
    return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

// Màu chữ dễ đọc (đen / trắng) trên nền màu cấp độ
function readableTextColor(hex) {
    if (!hex || hex[0] !== '#') return '#0f172a';
    const [r, g, b] = hexToRgb(hex);
    return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#0f172a' : '#ffffff';
}

// Mốc ngày thuộc chế độ Dự báo AI (tương lai hoặc từ năm 2026 trở đi – không có ảnh Landsat thực tế)
function isForecastDate(dateStr) {
    if (!dateStr) return false;
    return state.forecastDates.includes(dateStr) || dateStr >= '2026-01-01' || dateStr >= getTodayDateStr();
}

// --- 2b. Bộ nội suy không gian IDW dùng chung (raster pixel, giá trị điểm nhấp chuột, cột 3D) ---
// Tham số giữ nguyên thuật toán nội suy của hệ thống: bán kính 2 ô lưới, hệ số làm mịn 0.4·d²
const IDW_PARAMS = {
    spacing: 0.05,                  // khoảng cách tâm ô lưới (~5,5 km)
    radius: 0.10,                   // bán kính tìm kiếm (độ) = 2 × khoảng cách ô
    damping: 0.05 * 0.05 * 0.4,     // hệ số làm mịn, khử đốm tròn quanh tâm ô
    pixelDeg: 0.0025,               // kích thước pixel raster hiển thị (~275 m)
};
const NODATA_RGBA = [203, 213, 225, 210];   // Màu "Không có dữ liệu"

function buildIdwIndex(features, key) {
    const pts = [];
    (features || []).forEach(f => {
        const p = f.properties || {};
        const v = getIndexValue(p, key);
        if (v !== null && isFinite(p.lon) && isFinite(p.lat)) {
            pts.push({ lon: Number(p.lon), lat: Number(p.lat), v, p });
        }
    });
    const size = IDW_PARAMS.radius;
    const bins = new Map();
    pts.forEach(pt => {
        const k = `${Math.floor(pt.lon / size)}:${Math.floor(pt.lat / size)}`;
        if (!bins.has(k)) bins.set(k, []);
        bins.get(k).push(pt);
    });
    return { pts, bins, size };
}

// Trả về { value, nearest, distKm } hoặc null nếu không có ô dữ liệu nào trong bán kính tìm kiếm
function idwQuery(index, lon, lat) {
    if (!index || index.pts.length === 0) return null;
    const bx = Math.floor(lon / index.size);
    const by = Math.floor(lat / index.size);
    const r2 = IDW_PARAMS.radius * IDW_PARAMS.radius;
    let num = 0, den = 0, best = null, bestD2 = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            const arr = index.bins.get(`${bx + dx}:${by + dy}`);
            if (!arr) continue;
            for (let i = 0; i < arr.length; i++) {
                const pt = arr[i];
                const ex = lon - pt.lon;
                const ey = lat - pt.lat;
                const d2 = ex * ex + ey * ey;
                if (d2 < bestD2) {
                    bestD2 = d2;
                    best = pt;
                }
                if (d2 <= r2) {
                    const w = 1.0 / (d2 + IDW_PARAMS.damping);
                    num += pt.v * w;
                    den += w;
                }
            }
        }
    }
    if (!best || den === 0) return null;
    return { value: num / den, nearest: best.p, distKm: Math.sqrt(bestD2) * 111.0 };
}

// Hình học phần đất liền TP.HCM (bỏ đặc khu Côn Đảo – ngoài lưới ô viễn thám) để cắt raster
let mainlandGeomCache = null;
function getMainlandGeometry() {
    if (!state.boundaryGeoJson || !state.boundaryGeoJson.features) return null;
    if (mainlandGeomCache && mainlandGeomCache.src === state.boundaryGeoJson) return mainlandGeomCache;

    const rings = [];
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    state.boundaryGeoJson.features.forEach(feat => {
        const geom = feat.geometry;
        if (!geom) return;
        const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
        polys.forEach(poly => {
            if (!poly || !poly[0] || !poly[0].some(pt => pt[1] >= 10.0)) return;
            poly.forEach((ring, ri) => {
                rings.push(ring);
                if (ri === 0) {
                    ring.forEach(pt => {
                        if (pt[0] < minLon) minLon = pt[0];
                        if (pt[0] > maxLon) maxLon = pt[0];
                        if (pt[1] < minLat) minLat = pt[1];
                        if (pt[1] > maxLat) maxLat = pt[1];
                    });
                }
            });
        });
    });
    if (rings.length === 0) return null;
    const pad = IDW_PARAMS.pixelDeg;
    mainlandGeomCache = {
        src: state.boundaryGeoJson,
        rings,
        bbox: [minLon - pad, minLat - pad, maxLon + pad, maxLat + pad],
    };
    return mainlandGeomCache;
}

// Lưới giá trị nội suy (đệm theo bộ dữ liệu + chỉ số) – dùng chung cho raster 2D, cột 3D và biểu đồ
const rasterGridCache = { key: null, grid: null };
function computeRasterGrid(layerKey) {
    if (!state.currentGridData || !state.currentGridData.features) return null;
    const geo = getMainlandGeometry();
    if (!geo) return null;

    const cacheKey = `${state.currentDataKey}|${layerKey}`;
    if (rasterGridCache.key === cacheKey && rasterGridCache.grid) return rasterGridCache.grid;

    const px = IDW_PARAMS.pixelDeg;
    const [minLon, minLat, maxLon, maxLat] = geo.bbox;
    const w = Math.ceil((maxLon - minLon) / px);
    const h = Math.ceil((maxLat - minLat) / px);

    // Mặt nạ đất liền: tô đa giác ranh giới lên canvas rồi đọc kênh alpha
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = w;
    maskCanvas.height = h;
    const mctx = maskCanvas.getContext('2d');
    mctx.beginPath();
    geo.rings.forEach(ring => {
        ring.forEach((pt, i) => {
            const x = (pt[0] - minLon) / px;
            const y = (maxLat - pt[1]) / px;
            if (i === 0) mctx.moveTo(x, y);
            else mctx.lineTo(x, y);
        });
        mctx.closePath();
    });
    mctx.fillStyle = '#000';
    mctx.fill('evenodd');
    const maskData = mctx.getImageData(0, 0, w, h).data;

    const index = buildIdwIndex(state.currentGridData.features, layerKey);
    const values = new Float32Array(w * h);
    const status = new Uint8Array(w * h);   // 0: ngoài ranh giới, 1: không có dữ liệu, 2: có giá trị
    for (let y = 0; y < h; y++) {
        const lat = maxLat - (y + 0.5) * px;
        for (let x = 0; x < w; x++) {
            const i = y * w + x;
            if (maskData[i * 4 + 3] < 128) continue;
            const r = idwQuery(index, minLon + (x + 0.5) * px, lat);
            if (r) {
                values[i] = r.value;
                status[i] = 2;
            } else {
                status[i] = 1;
            }
        }
    }

    const grid = { w, h, px, minLon, maxLat, maxLon: minLon + w * px, minLat: maxLat - h * px, values, status, layerKey };
    rasterGridCache.key = cacheKey;
    rasterGridCache.grid = grid;
    return grid;
}

// Giá trị của lưới nội suy tại tọa độ (lat, lon) – null nếu ngoài vùng / không có dữ liệu
function sampleRasterGrid(grid, lat, lon) {
    if (!grid) return null;
    const x = Math.floor((lon - grid.minLon) / grid.px);
    const y = Math.floor((grid.maxLat - lat) / grid.px);
    if (x < 0 || y < 0 || x >= grid.w || y >= grid.h) return null;
    const i = y * grid.w + x;
    return grid.status[i] === 2 ? grid.values[i] : null;
}

// --- 3. Khởi tạo Bản đồ Leaflet ---
let map, boundaryLayerGroup, pointsLayerGroup, gridCellsLayerGroup, rasterLayerGroup, selectionLayerGroup, wardsBoundaryLayerGroup, wardHighlightLayerGroup, maskLayerGroup;

function initMap() {
    // Tọa độ tâm TP.HCM mở rộng (kinh độ 106.84520, vĩ độ 10.86585 theo GEE_tphcm.docx)
    map = L.map('map', {
        center: [10.86585, 106.84520],
        zoom: 9,
        minZoom: 7,
        maxZoom: 16,
        zoomSnap: 0.25,         // Mức zoom lẻ 0.25 để khung nhìn 2D khớp chính xác với camera 3D khi chuyển qua lại
        zoomControl: false,     // Nút phóng to / thu nhỏ nằm trong thanh công cụ bản đồ bên phải
    });
    state.map = map;

    // Thứ tự lớp cố định: nền < mặt nạ ngoài vùng < raster chỉ số < lưới tọa độ < ranh giới & đối tượng
    [['maskPane', 380], ['rasterPane', 390], ['graticulePane', 395], ['labelsPane', 397]].forEach(([name, z]) => {
        const pane = map.createPane(name);
        pane.style.zIndex = z;
        pane.style.pointerEvents = 'none';
    });

    // Bản đồ nền: đường phố, vệ tinh, địa hình, nền sáng/tối... (định nghĩa trong map-decor.js)
    state.baseMaps = createBaseMapLayers();
    setBaseMap(state.activeBaseMap);

    // Các layer group theo thứ tự hiển thị chuẩn GIS
    maskLayerGroup = L.layerGroup().addTo(map);
    rasterLayerGroup = L.layerGroup().addTo(map);
    gridCellsLayerGroup = L.layerGroup().addTo(map);
    wardsBoundaryLayerGroup = L.layerGroup().addTo(map);
    pointsLayerGroup = L.layerGroup().addTo(map);
    boundaryLayerGroup = L.layerGroup().addTo(map);
    selectionLayerGroup = L.layerGroup().addTo(map);
    wardHighlightLayerGroup = L.layerGroup().addTo(map);

    // Gộp Chế độ bản đồ + Lớp viễn thám TVDI thành 1 control duy nhất của Leaflet
    setupUnifiedLayersControl();

    // Công cụ bản đồ: mũi tên Bắc, về toàn vùng, phóng to/thu nhỏ, lưới tọa độ, thước tỷ lệ, tọa độ con trỏ
    setupMapDecorations();

    // Bắt sự kiện click trên bản đồ để chọn ô gần nhất
    map.on('click', handleMapClick);

    // Tải ranh giới từ PostGIS và ranh giới chi tiết 168 phường/xã
    loadBoundary();
    loadWardsBoundary();

    setTimeout(() => map.invalidateSize(), 250);
}

// --- 4. Tải ranh giới hành chính TP.HCM mở rộng ---
async function loadBoundary() {
    try {
        const res = await fetch('/api/regions/boundary');
        const data = await res.json();
        if (data.features && data.features.length > 0) {
            state.boundaryGeoJson = data;
            renderBoundary();
            // Nếu dữ liệu ô lưới đã tải, vẽ lại raster để cắt chuẩn xác theo ranh giới
            if (state.currentGridData) {
                const dateStr = state.dates[state.currentDateIndex];
                const isFuture = state.forecastDates.includes(dateStr) || (dateStr && dateStr >= '2026-01-01');
                renderActiveRaster(isFuture);
            }
        }
    } catch (err) {
        console.error('Lỗi tải ranh giới TP.HCM:', err);
    }
}

function renderBoundary() {
    boundaryLayerGroup.clearLayers();
    renderOutsideMask();
    if (!state.boundaryGeoJson || !state.layerVisibility.boundary) return;

    // Ranh giới vùng nghiên cứu: nét đậm màu tối có quầng trắng (rõ trên cả nền sáng lẫn ảnh vệ tinh)
    const halo = L.geoJSON(state.boundaryGeoJson, {
        interactive: false,
        style: {
            color: '#ffffff',
            weight: 4.5,
            opacity: 0.85 * state.layerOpacities.boundary,
            fill: false,
        }
    });
    const line = L.geoJSON(state.boundaryGeoJson, {
        interactive: false,
        style: {
            color: '#111827',
            weight: 1.9,
            opacity: state.layerOpacities.boundary,
            fill: false,
        }
    });
    boundaryLayerGroup.addLayer(halo);
    boundaryLayerGroup.addLayer(line);
}

// Làm mờ vùng bên ngoài ranh giới TP.HCM để nổi bật khu vực nghiên cứu
function renderOutsideMask() {
    if (!maskLayerGroup) return;
    maskLayerGroup.clearLayers();
    if (!state.mapDecor.mask || !state.boundaryGeoJson || !state.boundaryGeoJson.features) return;

    const holes = [];
    state.boundaryGeoJson.features.forEach(feat => {
        const geom = feat.geometry;
        if (!geom) return;
        const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
        polys.forEach(poly => {
            if (poly && poly[0]) holes.push(poly[0].map(pt => [pt[1], pt[0]]));
        });
    });
    const world = [[-85, -180], [-85, 180], [85, 180], [85, -180]];
    const isDark = state.activeBaseMap === 'esri_dark';
    maskLayerGroup.addLayer(L.polygon([world, ...holes], {
        pane: 'maskPane',
        stroke: false,
        fillColor: isDark ? '#020617' : '#ffffff',
        fillOpacity: isDark ? 0.45 : 0.42,
        interactive: false,
    }));
}

// --- 4b. Tải và hiển thị ranh giới 168 phường/xã TP.HCM mở rộng ---
async function loadWardsBoundary() {
    try {
        const res = await fetch('/api/regions/wards-boundary');
        if (res.ok) {
            const data = await res.json();
            state.wardsBoundaryGeoJson = data;
            renderWardsBoundary();
        }
    } catch (err) {
        console.error('Lỗi tải ranh giới phường xã:', err);
    }
}

// --- Tiện ích tìm kiếm & chuẩn hóa tiếng Việt cho 167 Phường / Xã ---
function removeVietnameseTones(str) {
    if (!str) return '';
    str = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    str = str.replace(/[đĐ]/g, m => (m === 'đ' ? 'd' : 'D'));
    return str.toLowerCase().trim();
}

function findWardByFeatureOrCoords(feature, latlng) {
    const list = (state.wards.allList && state.wards.allList.length) ? state.wards.allList : (state.wards.list || []);
    if (!list.length) return null;

    const p = (feature && feature.properties) || {};
    const featFullName = removeVietnameseTones(p.fullName || '');
    const featName = removeVietnameseTones(p.name || '');

    // 1. Khớp chính xác tên đầy đủ (danh mục 167 phường/xã sinh từ chính ranh giới này)
    let found = featFullName ? list.find(w => removeVietnameseTones(w.name || '') === featFullName) : null;
    if (found) return found;

    // 1b. Khớp gần đúng theo tên phường / xã
    found = list.find(w => {
        const wName = removeVietnameseTones(w.name || '');
        return (wName && featFullName && (wName === featFullName || featFullName.includes(wName) || wName.includes(featFullName))) ||
               (wName && featName && (wName === featName || featName.includes(wName) || wName.includes(featName)));
    });
    if (found) return found;

    // 2. Nếu không khớp tên, tìm phường có tọa độ gần điểm click nhất
    if (latlng) {
        let minDist = Infinity;
        let nearest = null;
        for (const w of list) {
            const dist = Math.hypot(w.lat - latlng.lat, w.lon - latlng.lng);
            if (dist < minDist) {
                minDist = dist;
                nearest = w;
            }
        }
        if (minDist < 0.15) {
            return nearest;
        }
    }
    return null;
}

function findFeatureForWard(ward) {
    if (!state.wardsBoundaryGeoJson || !state.wardsBoundaryGeoJson.features) return null;
    const wName = removeVietnameseTones(ward.name || '');

    // Khớp chính xác tên đầy đủ
    let feat = state.wardsBoundaryGeoJson.features.find(f => removeVietnameseTones((f.properties || {}).fullName || '') === wName);
    if (feat) return feat;

    // Khớp gần đúng theo tên
    feat = state.wardsBoundaryGeoJson.features.find(f => {
        const p = f.properties || {};
        const pFull = removeVietnameseTones(p.fullName || '');
        const pName = removeVietnameseTones(p.name || '');
        return (wName && pFull && (pFull === wName || pFull.includes(wName) || wName.includes(pFull))) ||
               (wName && pName && (pName === wName || pName.includes(wName) || wName.includes(pName)));
    });
    if (feat) return feat;

    // Khớp theo tâm hình học gần nhất
    let minDist = Infinity;
    let bestFeat = null;
    for (const f of state.wardsBoundaryGeoJson.features) {
        if (!f.geometry) continue;
        const coords = f.geometry.coordinates;
        let ring = coords;
        if (f.geometry.type === 'Polygon') ring = coords[0];
        else if (f.geometry.type === 'MultiPolygon' && coords[0]) ring = coords[0][0];
        if (Array.isArray(ring) && ring.length > 0) {
            let sumLat = 0, sumLon = 0, count = 0;
            for (const pt of ring) {
                if (Array.isArray(pt) && pt.length >= 2) {
                    sumLon += pt[0];
                    sumLat += pt[1];
                    count++;
                }
            }
            if (count > 0) {
                const cLat = sumLat / count;
                const cLon = sumLon / count;
                const d = Math.hypot(cLat - ward.lat, cLon - ward.lon);
                if (d < minDist) {
                    minDist = d;
                    bestFeat = f;
                }
            }
        }
    }
    return minDist < 0.12 ? bestFeat : null;
}

// Bảng tra giá trị chỉ số của từng phường/xã theo tên chuẩn hóa (khớp với ranh giới GeoJSON)
function buildWardValueMap(key) {
    const m = new Map();
    const list = (state.wards.allList && state.wards.allList.length) ? state.wards.allList : (state.wards.list || []);
    const prop = key === 'lst' ? 'lst_c' : key;
    list.forEach(w => {
        const v = w[prop];
        m.set(removeVietnameseTones(w.name), {
            ward: w,
            value: (v === null || v === undefined || isNaN(v)) ? null : Number(v),
        });
    });
    return m;
}

function isWardFilterActive() {
    const t = state.wards.thresholds;
    return Object.keys(t).some(k => t[k] !== null);
}

function renderWardsBoundary() {
    if (!wardsBoundaryLayerGroup) return;
    wardsBoundaryLayerGroup.clearLayers();
    if (!state.wardsBoundaryGeoJson) return;

    const isChoropleth = state.displayMode === 'ward';
    if (!state.layerVisibility.wardsBoundary && !isChoropleth) return;

    const opacity = state.layerOpacities.wardsBoundary !== undefined ? state.layerOpacities.wardsBoundary : 0.9;
    const lineOpacity = state.layerVisibility.wardsBoundary ? opacity : 0;
    const key = state.activeRasterLayer;
    const fillOpacity = state.layerVisibility[key] ? (state.layerOpacities[key] ?? 1) * 0.92 : 0;
    const valueMap = isChoropleth ? buildWardValueMap(key) : null;
    const matchedIds = (isChoropleth && isWardFilterActive()) ? new Set((state.wards.list || []).map(w => w.ward_id)) : null;

    const styleFor = (feature) => {
        // Trên lớp pixel: nét ranh giới mảnh, nhạt để không lấn át màu ảnh
        const base = {
            color: isChoropleth ? '#1f2937' : '#334155',
            weight: isChoropleth ? 0.8 : 0.6,
            opacity: isChoropleth ? lineOpacity : lineOpacity * 0.55,
            fillColor: 'transparent',
            fillOpacity: 0,
        };
        if (!isChoropleth) return base;
        const p = feature.properties || {};
        const info = valueMap.get(removeVietnameseTones(p.fullName || p.name || ''));
        if (!info || info.value === null) {
            return { ...base, fillColor: rgbCss(NODATA_RGBA), fillOpacity: 0.75 * fillOpacity };
        }
        if (matchedIds && !matchedIds.has(info.ward.ward_id)) {
            return { ...base, fillColor: '#e2e8f0', fillOpacity: 0.55 * fillOpacity };
        }
        return { ...base, fillColor: rgbCss(interpolateColor(key, info.value)), fillOpacity };
    };

    const layer = L.geoJSON(state.wardsBoundaryGeoJson, {
        style: styleFor,
        onEachFeature: function (feature, l) {
            const p = feature.properties || {};
            const wardName = p.fullName || p.name || 'Phường / Xã';
            const area = p.areaKm2 ? `<div style="font-size: 11px; color: #64748b; margin-top: 2px;"><i class="fa-solid fa-chart-area"></i> Diện tích: ${p.areaKm2} km²</div>` : '';

            let valueHtml = '';
            if (isChoropleth) {
                const info = valueMap.get(removeVietnameseTones(wardName));
                if (info && info.value !== null) {
                    const filteredOut = matchedIds && !matchedIds.has(info.ward.ward_id);
                    valueHtml = `<div style="font-size: 11.5px; margin-top: 3px;">${INDEX_META[key].label}: <b>${formatIndexValue(info.value, key)}</b>${filteredOut ? ' <span style="color:#94a3b8;">(không thỏa ngưỡng lọc)</span>' : ''}</div>`;
                } else {
                    valueHtml = '<div style="font-size: 11px; margin-top: 3px; color: #64748b;">Không có dữ liệu viễn thám</div>';
                }
            }

            l.bindTooltip(`
                <div style="font-family: inherit; font-size: 12px; line-height: 1.4; padding: 2px 4px;">
                    <div style="font-weight: 700; color: #0f172a;"><i class="fa-solid fa-map-pin" style="color: #2563eb; margin-right: 4px;"></i>${wardName}</div>
                    ${valueHtml}
                    ${area}
                </div>
            `, {
                sticky: true,
                direction: 'top',
                className: 'ward-boundary-tooltip'
            });

            l.on({
                click: function (e) {
                    L.DomEvent.stopPropagation(e);
                    const matchedWard = findWardByFeatureOrCoords(feature, e.latlng);
                    if (matchedWard) {
                        selectWard(matchedWard.ward_id, true);
                    }
                },
                mouseover: function () {
                    l.setStyle(isChoropleth
                        ? { weight: 2.4, color: '#0f172a', opacity: 1 }
                        : { weight: 2.2, color: '#0284c7', opacity: 1, fillColor: '#38bdf8', fillOpacity: 0.15 });
                    l.bringToFront();
                },
                mouseout: function () {
                    l.setStyle(styleFor(feature));
                }
            });
        }
    });

    wardsBoundaryLayerGroup.addLayer(layer);
}

// --- 5. Tải dữ liệu viễn thám và cập nhật các lớp bản đồ ---

// Ngày quan trắc Landsat (đầu kỳ 15 ngày) chứa ngày được chọn
function getObservedPeriodStart(dateStr) {
    const obs = state.observedDates;
    if (!obs || obs.length === 0) return dateStr;
    let start = obs[0];
    for (let i = 0; i < obs.length; i++) {
        if (obs[i] <= dateStr) start = obs[i];
        else break;
    }
    return start;
}

function lastDayOfMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// Xác định bộ dữ liệu cần hiển thị cho mốc ngày: dự báo AI, kỳ quan trắc 15 ngày hoặc trung bình theo khoảng
function resolveDataView(dateStr) {
    if (isForecastDate(dateStr)) {
        return { kind: 'forecast', date: dateStr, key: `forecast:${dateStr}` };
    }
    const obs = state.observedDates || [];
    const agg = state.aggregation;
    if (agg === 'month' || agg === 'year' || agg === 'period') {
        let start, end;
        if (agg === 'period') {
            start = obs.length ? obs[0] : START_DATE_STR;
            end = obs.length ? obs[obs.length - 1] : '2025-12-31';
        } else if (agg === 'year') {
            start = `${dateStr.substring(0, 4)}-01-01`;
            end = `${dateStr.substring(0, 4)}-12-31`;
        } else {
            const y = parseInt(dateStr.substring(0, 4), 10);
            const m = parseInt(dateStr.substring(5, 7), 10);
            start = `${dateStr.substring(0, 7)}-01`;
            end = `${dateStr.substring(0, 7)}-${String(lastDayOfMonth(y, m)).padStart(2, '0')}`;
        }
        const nDates = obs.filter(d => d >= start && d <= end).length;
        return { kind: 'aggregate', agg, date: dateStr, start, end, nDates, key: `agg:${start}:${end}` };
    }
    const periodStart = getObservedPeriodStart(dateStr);
    const next = obs.find(d => d > periodStart);
    const periodEnd = next ? addDays(next, -1) : addDays(periodStart, 14);
    return { kind: 'cycle', date: periodStart, start: periodStart, end: periodEnd, key: `cycle:${periodStart}` };
}

async function loadDataForCurrentDate() {
    const dateStr = state.currentDate || state.dates[state.currentDateIndex];
    if (!dateStr) return;

    const isFuture = isForecastDate(dateStr);
    updateTimelineUI(dateStr, isFuture);
    applyModeConstraints(isFuture);

    const view = resolveDataView(dateStr);
    const seq = ++state.loadSeq;

    // Cùng một bộ dữ liệu (ví dụ lùi/tiến trong cùng kỳ hoặc cùng năm khi tổng hợp) -> không cần tải lại
    if (state.currentGridData && state.currentDataKey === view.key) {
        state.currentView = view;
        updateMapTitle();
        if (state.chartMode === '15days') loadChartData();
        return;
    }

    try {
        let url;
        if (view.kind === 'forecast') url = `/api/prediction/grid/${dateStr}`;
        else if (view.kind === 'aggregate') url = `/api/grid/aggregate?start=${view.start}&end=${view.end}`;
        else url = `/api/grid/${view.date}`;

        let res = await fetch(url);
        if (!res.ok && view.kind === 'cycle') {
            // Nếu ngày không có trong Landsat thực tế thì gọi AI nội suy
            res = await fetch(`/api/prediction/grid/${dateStr}`);
            view.kind = 'forecast';
            view.key = `forecast:${dateStr}`;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (seq !== state.loadSeq) return;   // Đã có yêu cầu mới hơn (đổi ngày liên tục / animation)

        state.currentGridData = data;
        state.currentView = view;
        state.currentDataKey = view.key;

        // Render các lớp tương ứng
        renderActiveRaster(view.kind === 'forecast');
        renderGridCells();
        renderGridCentroidPoints();
        updateMapTitle();

        // Tải thống kê toàn vùng
        loadRegionalStats(dateStr, isFuture, data);

        // Cập nhật danh sách 167 phường xã theo mốc thời gian đang chọn
        if (typeof loadWardsData === 'function') {
            loadWardsData(dateStr);
        }

        // Cập nhật bản đồ 3D và các biểu đồ phân tích
        if (state.viewMode === '3d') update3DData();
        refreshAnalysisCharts();

        // Cập nhật thông tin điểm khảo sát đang chọn nếu có (phường/xã đang chọn được cập nhật sau khi tải bảng xếp hạng)
        if (state.selectedPoint && state.selectedPoint.isWard) {
            // refreshSelectedWardDetail() chạy trong loadWardsData
        } else if (state.selectedPoint) {
            const interp = getInterpolatedValueAtLatLng(state.selectedPoint.lat, state.selectedPoint.lon, 'tvdi');
            if (interp) {
                state.selectedPoint.interp = interp;
                const theme = getDroughtUITheme(interp.value);
                renderPointDetail(state.selectedPoint.lat, state.selectedPoint.lon, interp.value, theme, state.selectedPoint.locationName);
                if (state.selectedMarker) {
                    state.selectedMarker.setStyle({ fillColor: theme.badgeBg });
                    state.selectedMarker.setTooltipContent(`
                        <div style="font-size: 11px; line-height: 1.4;">
                            <strong><i class="fa-solid fa-location-dot" style="color: #2563eb;"></i> ${state.selectedPoint.locationName}</strong><br>
                            <span>Tọa độ: ${state.selectedPoint.lat.toFixed(4)}°N, ${state.selectedPoint.lon.toFixed(4)}°E</span><br>
                            <span>Chỉ số TVDI: <b style="color: ${theme.scoreColor}; font-weight: 800;">${interp.value.toFixed(3)}</b></span><br>
                            <span>Cấp độ: <b>${theme.label}</b></span>
                        </div>
                    `);
                }
            } else {
                selectionLayerGroup.clearLayers();
                state.selectedPoint = null;
                state.selectedMarker = null;
                state.selectedCellId = null;
                state.selectedCellProps = null;
            }
        } else if (state.selectedCellId) {
            const currentCell = data.features.find(f => f.properties.cell_id === state.selectedCellId);
            if (currentCell) {
                renderSelectedCell(currentCell.properties);
            }
        }

        // Tự động đồng bộ biểu đồ dự báo 15 ngày theo mốc ngày mới đang chọn
        if (state.chartMode === '15days') {
            loadChartData();
        }
    } catch (err) {
        console.error('Lỗi khi tải dữ liệu mốc ngày:', err);
    }
}

// Ràng buộc theo chế độ: mô hình AI chỉ dự báo TVDI và không tổng hợp theo khoảng thời gian
function applyModeConstraints(isFuture) {
    document.querySelectorAll('#index-switch .seg-btn, #index-cards .index-card').forEach(btn => {
        const key = btn.dataset.index;
        const locked = isFuture && key !== 'tvdi';
        btn.classList.toggle('is-locked', locked);
        btn.disabled = locked;
        if (btn.classList.contains('seg-btn')) {
            btn.title = locked
                ? 'Mô hình AI chỉ dự báo TVDI – chọn chế độ "Giám sát thực tế" (2017–2025) để xem LST / NDVI'
                : `${INDEX_META[key].name} ${INDEX_META[key].label}${INDEX_META[key].unit ? ' (' + INDEX_META[key].unit + ')' : ''}`;
        }
    });
    if (isFuture && state.activeRasterLayer !== 'tvdi') {
        setActiveIndex('tvdi', { silent: true });
        showToast('Mốc dự báo AI chỉ có chỉ số TVDI – bản đồ đã chuyển sang lớp TVDI.');
    }

    const toolbar = document.querySelector('.toolbar');
    if (toolbar) toolbar.classList.toggle('is-forecast', !!isFuture);

    const aggSelect = document.getElementById('aggregation-select');
    if (aggSelect) {
        aggSelect.disabled = isFuture;
        aggSelect.title = isFuture
            ? 'Chỉ áp dụng cho dữ liệu quan trắc Landsat 2017–2025 (chế độ Giám sát thực tế)'
            : 'Cách tổng hợp giá trị quan trắc Landsat (2017–2025)';
        if (isFuture && state.aggregation !== 'cycle') {
            state.aggregation = 'cycle';
            aggSelect.value = 'cycle';
        }
    }
}

// --- 6. Render lớp ảnh viễn thám độ phân giải cao (GEE Live Tile hoặc Nội suy Canvas) ---
function clearRasterLayers() {
    rasterLayerGroup.clearLayers();
    state.geeTileLayer = null;
    state.localRasterLayer = null;
}

async function renderActiveRaster() {
    const token = ++state.rasterSeq;
    const layer = state.activeRasterLayer; // 'tvdi' | 'ndvi' | 'lst'
    renderLegend(layer);

    // Chế độ Phường/Xã: tô màu theo đa giác phường, không vẽ raster pixel
    if (state.displayMode === 'ward') {
        clearRasterLayers();
        state.rasterSource = 'ward';
        updateMapTitle();
        return;
    }

    const isVisible = state.layerVisibility[layer];
    const opacity = state.layerOpacities[layer];
    if (!isVisible || !state.currentGridData) {
        clearRasterLayers();
        return;
    }

    const view = state.currentView || {};

    // 6.1 Dữ liệu quan trắc thực tế: ưu tiên ảnh Landsat 30 m trực tiếp từ Google Earth Engine
    if (view.kind !== 'forecast' && state.geeStatus && state.geeStatus.initialized) {
        try {
            const cfg = GEE_COLOR_PALETTES[layer];
            const startDate = view.start || view.date;
            let url = `/api/gee/tile/${layer}/${startDate}?vmin=${cfg.min}&vmax=${cfg.max}`;
            if (view.kind === 'aggregate') url += `&end=${view.end}`;
            const res = await fetch(url);
            if (token !== state.rasterSeq) return;
            if (res.ok) {
                const geeData = await res.json();
                if (token !== state.rasterSeq) return;
                if (geeData.tile_url) {
                    clearRasterLayers();
                    state.geeTileLayer = L.tileLayer(geeData.tile_url, {
                        opacity: opacity,
                        maxZoom: 18,
                        pane: 'rasterPane',
                        attribution: '&copy; Google Earth Engine | Landsat 8/9'
                    });
                    rasterLayerGroup.addLayer(state.geeTileLayer);
                    state.rasterSource = 'gee';
                    updateMapTitle();
                    return;
                }
            }
        } catch (e) {
            console.warn('Không thể tải tile từ GEE API, chuyển sang chế độ nội suy:', e);
        }
        if (token !== state.rasterSeq) return;
    }

    // 6.2 Ảnh pixel ~120 m: ảnh tháng Landsat hoặc lưới chi tiết hóa (xem pixel-raster.js)
    const drawn = await renderPixelRaster(layer, opacity, token);
    if (token !== state.rasterSeq) return;
    if (drawn) {
        state.rasterSource = 'pixel';
        renderLegend(layer);
        updateMapTitle();
        if (state.viewMode === '3d') update3DData();
        return;
    }

    // 6.3 Không có ảnh pixel: bề mặt nội suy IDW từ lưới ô, cắt theo ranh giới
    clearRasterLayers();
    renderSmoothRasterCanvas(layer, opacity);
    state.rasterSource = 'idw';
    updateMapTitle();
}

// Ảnh raster pixel (~275 m) nội suy IDW từ lưới ô ~5,5 km, cắt chuẩn theo ranh giới đất liền TP.HCM
function renderSmoothRasterCanvas(layerKey, opacity) {
    const grid = computeRasterGrid(layerKey);
    if (!grid) return;

    const canvas = document.createElement('canvas');
    canvas.width = grid.w;
    canvas.height = grid.h;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(grid.w, grid.h);
    const data = img.data;

    for (let i = 0; i < grid.w * grid.h; i++) {
        const st = grid.status[i];
        if (st === 0) continue;   // Ngoài ranh giới: trong suốt
        const rgba = st === 2 ? interpolateColor(layerKey, grid.values[i]) : NODATA_RGBA;
        const o = i * 4;
        data[o] = rgba[0];
        data[o + 1] = rgba[1];
        data[o + 2] = rgba[2];
        data[o + 3] = rgba[3];
    }
    ctx.putImageData(img, 0, 0);

    // Đưa canvas lên bản đồ dưới dạng ImageOverlay khớp chính xác tọa độ (pixel sắc nét khi phóng to)
    const bounds = [[grid.minLat, grid.minLon], [grid.maxLat, grid.maxLon]];
    state.localRasterLayer = L.imageOverlay(canvas.toDataURL(), bounds, {
        opacity: opacity,
        interactive: false,
        pane: 'rasterPane',
        className: 'raster-pixelated',
    });
    rasterLayerGroup.addLayer(state.localRasterLayer);
}

// --- 7. Vô hiệu hóa lớp lưới ô đa giác 5km thô ráp theo yêu cầu người dùng ---
// Hệ thống chuyển sang hoàn toàn chế độ viễn thám liên tục (Continuous Smooth Raster)
function renderGridCells() {
    if (gridCellsLayerGroup) gridCellsLayerGroup.clearLayers();
}

// Lớp điểm lấy mẫu viễn thám (mặc định tắt)
function renderGridCentroidPoints() {
    if (!pointsLayerGroup) return;
    pointsLayerGroup.clearLayers();
    if (!state.layerVisibility.gridPoints || !state.currentGridData) return;

    const opacity = state.layerOpacities.gridPoints;

    state.currentGridData.features.forEach(f => {
        const p = f.properties;
        const marker = L.circleMarker([p.lat, p.lon], {
            radius: 2.5,
            color: '#000000',
            weight: 1,
            fillColor: '#000000',
            fillOpacity: 0.85 * opacity,
        });

        marker.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            selectCell(p);
        });

        pointsLayerGroup.addLayer(marker);
    });
}

// --- 7b. Tra cứu địa danh hành chính theo tọa độ (Spatial Administrative Lookup) ---
function getLocalAdminArea(lat, lon) {
    // 1. Tỉnh Bình Thuận (vùng giáp ranh Sơn Mỹ, Hàm Tân, La Gi)
    if (lon >= 107.45 && lat >= 10.45 && lat <= 10.80) {
        if (lat <= 10.65 && lon >= 107.48) return 'Khu vực Sơn Mỹ, Huyện Hàm Tân, Tỉnh Bình Thuận';
        return 'Huyện Hàm Tân, Tỉnh Bình Thuận';
    }

    // 2. Tỉnh Bà Rịa - Vũng Tàu
    if (lon >= 107.05 && lat >= 10.30 && lat <= 10.78) {
        if (lon >= 107.35 && lat >= 10.48 && lat <= 10.68) return 'Xã Bình Châu, Huyện Xuyên Mộc, Bà Rịa - Vũng Tàu';
        if (lon >= 107.30 && lat >= 10.45 && lat <= 10.75) return 'Huyện Xuyên Mộc, Tỉnh Bà Rịa - Vũng Tàu';
        if (lon >= 107.18 && lon < 107.32 && lat >= 10.35 && lat <= 10.52) return 'Huyện Đất Đỏ, Tỉnh Bà Rịa - Vũng Tàu';
        if (lon >= 107.15 && lon < 107.25 && lat >= 10.35 && lat <= 10.48) return 'Huyện Long Điền, Tỉnh Bà Rịa - Vũng Tàu';
        if (lon >= 107.05 && lon < 107.16 && lat >= 10.30 && lat <= 10.44) return 'TP. Vũng Tàu, Tỉnh Bà Rịa - Vũng Tàu';
        if (lon >= 107.10 && lon < 107.25 && lat >= 10.45 && lat <= 10.58) return 'TP. Bà Rịa, Tỉnh Bà Rịa - Vũng Tàu';
        if (lon >= 107.00 && lon < 107.18 && lat >= 10.53 && lat <= 10.72) return 'Thị xã Phú Mỹ, Tỉnh Bà Rịa - Vũng Tàu';
        if (lon >= 107.15 && lon < 107.32 && lat >= 10.55 && lat <= 10.76) return 'Huyện Châu Đức, Tỉnh Bà Rịa - Vũng Tàu';
    }

    // 3. Tỉnh Đồng Nai (giáp ranh phía Đông TP.HCM)
    if (lon >= 106.82 && lon <= 107.05 && lat >= 10.62 && lat <= 11.00) {
        if (lat < 10.75 && lon >= 106.85) return 'Huyện Nhơn Trạch, Tỉnh Đồng Nai';
        if (lat >= 10.75 && lat < 10.92 && lon >= 106.90) return 'Huyện Long Thành, Tỉnh Đồng Nai';
        if (lat >= 10.92) return 'TP. Biên Hòa, Tỉnh Đồng Nai';
    }

    // 4. Tỉnh Bình Dương (phía Bắc TP.HCM)
    if (lat >= 10.88 && lat <= 11.45 && lon >= 106.40 && lon <= 106.95) {
        if (lat >= 10.88 && lat <= 10.96 && lon >= 106.74) return 'TP. Dĩ An, Tỉnh Bình Dương';
        if (lat >= 10.88 && lat <= 10.98 && lon >= 106.66 && lon < 106.75) return 'TP. Thuận An, Tỉnh Bình Dương';
        if (lat >= 10.95 && lat <= 11.05 && lon >= 106.60 && lon <= 106.72) return 'TP. Thủ Dầu Một, Tỉnh Bình Dương';
        if (lat >= 11.02 && lat <= 11.20 && lon >= 106.55 && lon <= 106.70) return 'Thị xã Bến Cát, Tỉnh Bình Dương';
        if (lat >= 11.02 && lat <= 11.18 && lon >= 106.70 && lon <= 106.88) return 'TP. Tân Uyên, Tỉnh Bình Dương';
        if (lat >= 11.18 && lat <= 11.40 && lon >= 106.75) return 'Huyện Bắc Tân Uyên / Phú Giáo, Bình Dương';
        if (lat >= 11.18 && lat <= 11.40 && lon >= 106.50 && lon < 106.75) return 'Huyện Bàu Bàng, Tỉnh Bình Dương';
        if (lon < 106.50 && lat >= 11.15) return 'Huyện Dầu Tiếng, Tỉnh Bình Dương';
    }

    // 5. TP. Hồ Chí Minh
    if (lat >= 10.35 && lat <= 11.20 && lon >= 106.42 && lon <= 106.95) {
        if (lat <= 10.70 && lon >= 106.80) return 'Huyện Cần Giờ, TP. Hồ Chí Minh';
        if (lat >= 10.60 && lat <= 10.74 && lon >= 106.68 && lon <= 106.78) return 'Huyện Nhà Bè, TP. Hồ Chí Minh';
        if (lat >= 10.71 && lat <= 10.76 && lon >= 106.68 && lon <= 106.76) return 'Quận 7, TP. Hồ Chí Minh';
        if (lat >= 10.60 && lat <= 10.85 && lon >= 106.48 && lon <= 106.65) return 'Huyện Bình Chánh, TP. Hồ Chí Minh';
        if (lat >= 10.74 && lat <= 10.90 && lon >= 106.72 && lon <= 106.88) return 'TP. Thủ Đức, TP. Hồ Chí Minh';
        if (lat >= 10.75 && lat <= 10.80 && lon >= 106.67 && lon <= 106.72) return 'Quận 1 / Quận 3 / Quận 4, TP. Hồ Chí Minh';
        if (lat >= 10.74 && lat <= 10.78 && lon >= 106.64 && lon < 106.68) return 'Quận 5 / Quận 10 / Quận 11, TP. Hồ Chí Minh';
        if (lat >= 10.78 && lat <= 10.84 && lon >= 106.66 && lon <= 106.72) return 'Quận Bình Thạnh / Phú Nhuận, TP. Hồ Chí Minh';
        if (lat >= 10.82 && lat <= 10.87 && lon >= 106.64 && lon <= 106.70) return 'Quận Gò Vấp, TP. Hồ Chí Minh';
        if (lat >= 10.78 && lat <= 10.84 && lon >= 106.61 && lon <= 106.66) return 'Quận Tân Bình / Tân Phú, TP. Hồ Chí Minh';
        if (lat >= 10.73 && lat <= 10.81 && lon >= 106.57 && lon <= 106.63) return 'Quận Bình Tân / Quận 6 / Quận 8, TP. Hồ Chí Minh';
        if (lat >= 10.83 && lat <= 10.90 && lon >= 106.60 && lon <= 106.72) return 'Quận 12, TP. Hồ Chí Minh';
        if (lat >= 10.84 && lat <= 10.95 && lon >= 106.52 && lon <= 106.65) return 'Huyện Hóc Môn, TP. Hồ Chí Minh';
        if (lat >= 10.95 && lat <= 11.20 && lon >= 106.40 && lon <= 106.65) return 'Huyện Củ Chi, TP. Hồ Chí Minh';
    }

    // 6. Tỉnh Long An (giáp ranh phía Tây / Tây Nam)
    if (lon < 106.60 && lat < 10.75) {
        if (lat < 10.65) return 'Khu vực Cần Đước / Cần Giuộc, Tỉnh Long An';
        return 'Huyện Bến Lức, Tỉnh Long An';
    }

    return 'Khu vực nghiên cứu TP. Hồ Chí Minh';
}

const adminLocationCache = new Map();

async function getAdministrativeLocation(lat, lon) {
    const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
    if (adminLocationCache.has(key)) return adminLocationCache.get(key);

    const localInfo = getLocalAdminArea(lat, lon);

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=14&addressdetails=1`;
        const resp = await fetch(url, { signal: controller.signal, headers: { 'Accept-Language': 'vi' } });
        clearTimeout(timeoutId);

        if (resp.ok) {
            const data = await resp.json();
            if (data && data.address) {
                const a = data.address;
                const ward = a.suburb || a.village || a.town || a.quarter || a.hamlet || a.neighbourhood || '';
                const district = a.county || a.district || a.city_district || '';
                const city = a.city || a.state || a.province || '';
                const parts = [ward, district, city].filter(Boolean);
                if (parts.length > 0) {
                    const fullText = parts.join(', ');
                    adminLocationCache.set(key, fullText);
                    return fullText;
                }
            }
        }
    } catch (err) {
        // Fallback silently to local spatial area
    }

    adminLocationCache.set(key, localInfo);
    return localInfo;
}

// --- 7c. Thuật toán kiểm tra điểm nằm trong đa giác ranh giới TP.HCM (Ray-Casting Point-in-Polygon) ---
function isPointInRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];
        const intersect = ((yi > y) !== (yj > y)) &&
            (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

function isPointInStudyBoundary(lat, lon) {
    if (!state.boundaryGeoJson || !state.boundaryGeoJson.features || state.boundaryGeoJson.features.length === 0) {
        // Fallback kiểm tra phạm vi tọa độ đất liền nếu dữ liệu ranh giới chưa sẵn sàng
        return lat >= 10.34 && lat <= 11.51 && lon >= 106.32 && lon <= 107.58;
    }

    // Tọa độ GeoJSON: [lon, lat] -> lon là x, lat là y
    for (let f = 0; f < state.boundaryGeoJson.features.length; f++) {
        const geom = state.boundaryGeoJson.features[f].geometry;
        if (!geom) continue;

        if (geom.type === 'Polygon') {
            const rings = geom.coordinates;
            if (rings && rings.length > 0 && rings[0].some(pt => pt[1] >= 10.0)) {
                if (isPointInRing(lon, lat, rings[0])) {
                    let inHole = false;
                    for (let h = 1; h < rings.length; h++) {
                        if (isPointInRing(lon, lat, rings[h])) {
                            inHole = true;
                            break;
                        }
                    }
                    if (!inHole) return true;
                }
            }
        } else if (geom.type === 'MultiPolygon') {
            const polys = geom.coordinates;
            for (let p = 0; p < polys.length; p++) {
                const rings = polys[p];
                if (rings && rings.length > 0 && rings[0].some(pt => pt[1] >= 10.0)) {
                    if (isPointInRing(lon, lat, rings[0])) {
                        let inHole = false;
                        for (let h = 1; h < rings.length; h++) {
                            if (isPointInRing(lon, lat, rings[h])) {
                                inHole = true;
                                break;
                            }
                        }
                        if (!inHole) return true;
                    }
                }
            }
        }
    }

    return false;
}

function renderOutsideBoundaryNotice(clickLat, clickLon) {
    const container = document.getElementById('cell-detail-content');
    if (!container) return;
    container.innerHTML = `
        <div class="notice-card notice-warn">
            <i class="fa-solid fa-location-crosshairs"></i>
            <div>
                <strong>Ngoài vùng nghiên cứu</strong>
                <span>${clickLat.toFixed(4)}°N, ${clickLon.toFixed(4)}°E nằm ngoài đất liền TP.HCM. Hãy nhấp vào vùng có màu trên bản đồ.</span>
            </div>
        </div>
    `;
}

// Thông báo khi điểm nhấp nằm trong ranh giới nhưng không có ô lưới nào có dữ liệu trong bán kính nội suy
function renderNoDataNotice(clickLat, clickLon) {
    const container = document.getElementById('cell-detail-content');
    if (!container) return;
    container.innerHTML = `
        <div class="notice-card">
            <i class="fa-solid fa-cloud"></i>
            <div>
                <strong>Không có dữ liệu tại vị trí này</strong>
                <span>${clickLat.toFixed(4)}°N, ${clickLon.toFixed(4)}°E bị mây che trong kỳ ảnh. Hãy chọn kỳ khác hoặc xem trung bình tháng / năm.</span>
            </div>
        </div>
    `;
}

// Tìm đa giác phường/xã (ranh giới 2025) chứa điểm (lat, lon)
function findWardFeatureAt(lat, lon) {
    const gj = state.wardsBoundaryGeoJson;
    if (!gj || !gj.features) return null;
    for (const f of gj.features) {
        const geom = f.geometry;
        if (!geom) continue;
        if (!f._bbox) {
            let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
            const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
            polys.forEach(poly => (poly[0] || []).forEach(pt => {
                if (pt[0] < a) a = pt[0];
                if (pt[1] < b) b = pt[1];
                if (pt[0] > c) c = pt[0];
                if (pt[1] > d) d = pt[1];
            }));
            Object.defineProperty(f, '_bbox', { value: [a, b, c, d], enumerable: false });
        }
        const bb = f._bbox;
        if (lon < bb[0] || lon > bb[2] || lat < bb[1] || lat > bb[3]) continue;
        const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
        for (const poly of polys) {
            if (poly[0] && isPointInRing(lon, lat, poly[0])) {
                let inHole = false;
                for (let h = 1; h < poly.length; h++) {
                    if (isPointInRing(lon, lat, poly[h])) { inHole = true; break; }
                }
                if (!inHole) return f;
            }
        }
    }
    return null;
}

// --- 8. Tính toán giá trị chỉ số nội suy liên tục chuẩn xác tại đúng tọa độ (Lat, Lon) ---
// Dùng chung bộ nội suy IDW với lớp raster pixel để màu hiển thị và giá trị khi nhấp hoàn toàn trùng khớp
const idwIndexCache = { key: null, index: null };
function getInterpolatedValueAtLatLng(lat, lon, layerKey = 'tvdi') {
    if (!state.currentGridData || !state.currentGridData.features || state.currentGridData.features.length === 0) return null;

    // BẮT BUỘC điểm phải nằm trong ranh giới đất liền TP.HCM
    if (!isPointInStudyBoundary(lat, lon)) {
        return null;
    }

    const cacheKey = `${state.currentDataKey}|${layerKey}`;
    if (idwIndexCache.key !== cacheKey) {
        idwIndexCache.key = cacheKey;
        idwIndexCache.index = buildIdwIndex(state.currentGridData.features, layerKey);
    }
    const r = idwQuery(idwIndexCache.index, lon, lat);
    if (!r) return null;

    // Đang xem lớp pixel 120 m của đúng chỉ số này: lấy giá trị pixel để khớp với màu trên bản đồ
    const px = pixelValueAt(lat, lon, layerKey);

    return {
        value: px !== null ? px : r.value,
        nearestCell: r.nearest,
        distanceKm: parseFloat(r.distKm.toFixed(1))
    };
}

// --- 8b. Xử lý khi nhấp chuột vào bất kỳ điểm nào trên bản đồ ---
async function handleMapClick(e) {
    if (!state.currentGridData || !state.currentGridData.features || state.currentGridData.features.length === 0) return;

    const clickLat = e.latlng.lat;
    const clickLon = e.latlng.lng;

    // KIỂM TRA ĐIỀU KIỆN TIÊN QUYẾT: Vị trí nhấp chuột BẮT BUỘC phải nằm trong ranh giới TP.HCM & phụ cận
    if (!isPointInStudyBoundary(clickLat, clickLon)) {
        // Xóa ngay lập tức điểm và marker chọn trên biển/ngoài vùng
        selectionLayerGroup.clearLayers();
        state.selectedPoint = null;
        state.selectedMarker = null;
        state.selectedCellId = null;
        state.selectedCellProps = null;

        // Cập nhật thông báo trực quan ngoài phạm vi
        renderOutsideBoundaryNotice(clickLat, clickLon);

        // Chuyển biểu đồ về toàn vùng
        state.chartTab = 'overall';
        const tabCell = document.getElementById('tab-cell-chart');
        const tabOverall = document.getElementById('tab-overall-chart');
        if (tabCell) tabCell.classList.remove('active');
        if (tabOverall) tabOverall.classList.add('active');
        loadChartData();
        return;
    }

    // Tính giá trị TVDI nội suy liên tục chuẩn xác tại đúng tọa độ click
    const interp = getInterpolatedValueAtLatLng(clickLat, clickLon, 'tvdi');
    if (!interp) {
        selectionLayerGroup.clearLayers();
        state.selectedPoint = null;
        state.selectedMarker = null;
        state.selectedCellId = null;
        state.selectedCellProps = null;
        renderNoDataNotice(clickLat, clickLon);
        return;
    }

    // Tra cứu địa danh hành chính theo ranh giới phường/xã chính thức 2025 (đa giác chứa điểm nhấp)
    const wardFeat = findWardFeatureAt(clickLat, clickLon);
    const initialLocation = wardFeat
        ? `${wardFeat.properties.fullName}, TP. Hồ Chí Minh`
        : getLocalAdminArea(clickLat, clickLon);

    // Kích hoạt hiển thị ngay lập tức
    selectLocation(clickLat, clickLon, interp, initialLocation);
    if (wardFeat) return;

    // Cập nhật tên địa danh chi tiết từ OpenStreetMap (nếu có mạng)
    getAdministrativeLocation(clickLat, clickLon).then(refinedLocation => {
        if (refinedLocation && refinedLocation !== initialLocation && state.selectedPoint) {
            state.selectedPoint.locationName = refinedLocation;
            const locEl = document.getElementById('selected-location-name');
            if (locEl) locEl.innerText = refinedLocation;
            if (state.selectedMarker) {
                const theme = getDroughtUITheme(interp.value);
                state.selectedMarker.setTooltipContent(`
                    <div style="font-size: 11px; line-height: 1.4;">
                        <strong><i class="fa-solid fa-location-dot" style="color: #2563eb;"></i> ${refinedLocation}</strong><br>
                        <span>Tọa độ: ${clickLat.toFixed(4)}°N, ${clickLon.toFixed(4)}°E</span><br>
                        <span>Chỉ số TVDI: <b style="color: ${theme.scoreColor}; font-weight: 800;">${interp.value.toFixed(3)}</b></span><br>
                        <span>Cấp độ: <b>${theme.label}</b></span>
                    </div>
                `);
            }
        }
    });
}

function selectLocation(lat, lon, interp, locationName) {
    state.selectedPoint = { lat, lon, interp, locationName };
    state.selectedCellId = interp.nearestCell ? interp.nearestCell.cell_id : null;
    state.selectedCellProps = interp.nearestCell;

    // Bỏ chọn phường/xã trước đó (nếu có)
    state.wards.selectedWardId = null;
    if (wardHighlightLayerGroup) wardHighlightLayerGroup.clearLayers();

    // Xóa layer đánh dấu cũ
    selectionLayerGroup.clearLayers();

    const theme = getDroughtUITheme(interp.value);

    // Vẽ marker điểm chọn đẹp mắt, rõ ràng
    const marker = L.circleMarker([lat, lon], {
        radius: 8,
        color: '#1e3a8a',
        weight: 3,
        fillColor: theme.badgeBg,
        fillOpacity: 1.0,
    });

    marker.bindTooltip(`
        <div style="font-size: 11px; line-height: 1.4;">
            <strong><i class="fa-solid fa-location-dot" style="color: #2563eb;"></i> ${locationName}</strong><br>
            <span>Tọa độ: ${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E</span><br>
            <span>Chỉ số TVDI: <b style="color: ${theme.scoreColor}; font-weight: 800;">${interp.value.toFixed(3)}</b></span><br>
            <span>Cấp độ: <b>${theme.label}</b></span>
        </div>
    `, { direction: 'top', offset: [0, -10] });

    selectionLayerGroup.addLayer(marker);
    state.selectedMarker = marker;

    renderPointDetail(lat, lon, interp.value, theme, locationName);

    if (state.selectedCellId) {
        state.chartTab = 'cell';
        const tabCell = document.getElementById('tab-cell-chart');
        const tabOverall = document.getElementById('tab-overall-chart');
        if (tabCell) tabCell.classList.add('active');
        if (tabOverall) tabOverall.classList.remove('active');
        loadChartData();
    }
}

function selectCell(props, clickInfo = null) {
    const lat = clickInfo ? clickInfo.clickLat : props.lat;
    const lon = clickInfo ? clickInfo.clickLon : props.lon;
    if (!isPointInStudyBoundary(lat, lon)) {
        renderOutsideBoundaryNotice(lat, lon);
        return;
    }
    const rawVal = (props.tvdi !== null && props.tvdi !== undefined && !isNaN(props.tvdi))
        ? props.tvdi
        : ((props.tvdi_pred !== null && props.tvdi_pred !== undefined && !isNaN(props.tvdi_pred)) ? props.tvdi_pred : null);
    const interp = getInterpolatedValueAtLatLng(lat, lon, 'tvdi') || {
        value: rawVal,
        nearestCell: props,
        distanceKm: 0
    };
    const wardFeat = findWardFeatureAt(lat, lon);
    const locationName = wardFeat ? `${wardFeat.properties.fullName}, TP. Hồ Chí Minh` : getLocalAdminArea(lat, lon);
    selectLocation(lat, lon, interp, locationName);
}

// --- 8b. Bảng màu giao diện chuẩn 8 cấp độ khô hạn TVDI (Thang màu Nhiệt độ-NDVI-TVDI.pdf) ---
function getDroughtUITheme(tvdi) {
    if (tvdi === null || tvdi === undefined || isNaN(tvdi)) {
        return {
            level: 0,
            levelCode: 'N/A',
            label: 'Không có dữ liệu',
            desc: 'Chưa có số liệu ghi nhận tại thời điểm quan sát.',
            badgeBg: '#f1f5f9',
            badgeText: '#475569',
            badgeBorder: '#cbd5e1',
            barColor: '#cbd5e1',
            bgColor: '#f8fafc',
            borderColor: '#cbd5e1',
            titleColor: '#475569',
            scoreColor: '#475569',
            icon: 'fa-circle-question'
        };
    }
    if (tvdi <= 0.125) {
        // CẤP 1: Rất ẩm / Ngập nước – Xanh lục rất đậm #066b00
        return {
            level: 1,
            levelCode: 'CẤP 1',
            label: 'Rất ẩm / Ngập nước',
            desc: 'Đất bão hòa nước hoặc ngập úng, thực vật phát triển mạnh.',
            badgeBg: '#066b00',
            badgeText: '#ffffff',
            badgeBorder: '#044d00',
            barColor: '#066b00',
            bgColor: '#f0fdf4',
            borderColor: '#066b00',
            titleColor: '#14532d',
            scoreColor: '#066b00',
            icon: 'fa-water'
        };
    } else if (tvdi <= 0.250) {
        // CẤP 2: Ẩm ướt – Xanh lục đậm #0bc400
        return {
            level: 2,
            levelCode: 'CẤP 2',
            label: 'Ẩm ướt',
            desc: 'Đất có độ ẩm cao, điều kiện sinh trưởng rất thuận lợi.',
            badgeBg: '#0bc400',
            badgeText: '#ffffff',
            badgeBorder: '#099a00',
            barColor: '#0bc400',
            bgColor: '#ecfdf5',
            borderColor: '#0bc400',
            titleColor: '#065f46',
            scoreColor: '#099a00',
            icon: 'fa-droplet'
        };
    } else if (tvdi <= 0.375) {
        // CẤP 3: Đủ ẩm, phát triển tốt – Xanh lá #0ce100
        return {
            level: 3,
            levelCode: 'CẤP 3',
            label: 'Đủ ẩm, phát triển tốt',
            desc: 'Độ ẩm đất đầy đủ, thực vật phát triển tốt.',
            badgeBg: '#0ce100',
            badgeText: '#0f172a',
            badgeBorder: '#0ab800',
            barColor: '#0ce100',
            bgColor: '#ecfdf5',
            borderColor: '#0ce100',
            titleColor: '#065f46',
            scoreColor: '#0ab800',
            icon: 'fa-seedling'
        };
    } else if (tvdi <= 0.500) {
        // CẤP 4: Bình thường – Xanh lá tươi #00ff00
        return {
            level: 4,
            levelCode: 'CẤP 4',
            label: 'Bình thường',
            desc: 'Độ ẩm đất ở mức bình thường, thực vật ổn định.',
            badgeBg: '#00ff00',
            badgeText: '#0f172a',
            badgeBorder: '#00cc00',
            barColor: '#00ff00',
            bgColor: '#f0fdf4',
            borderColor: '#00cc00',
            titleColor: '#14532d',
            scoreColor: '#00aa00',
            icon: 'fa-leaf'
        };
    } else if (tvdi <= 0.625) {
        // CẤP 5: Bắt đầu khô hạn nhẹ – Vàng tươi #ffff00
        return {
            level: 5,
            levelCode: 'CẤP 5',
            label: 'Bắt đầu khô hạn nhẹ',
            desc: 'Đất bắt đầu thiếu nước nhẹ, thực vật chịu áp lực.',
            badgeBg: '#ffff00',
            badgeText: '#0f172a',
            badgeBorder: '#eab308',
            barColor: '#ffff00',
            bgColor: '#fefce8',
            borderColor: '#eab308',
            titleColor: '#854d0e',
            scoreColor: '#ca8a04',
            icon: 'fa-triangle-exclamation'
        };
    } else if (tvdi <= 0.750) {
        // CẤP 6: Hạn vừa – Vàng cam #ffcc00
        return {
            level: 6,
            levelCode: 'CẤP 6',
            label: 'Hạn vừa',
            desc: 'Đất thiếu nước rõ rệt, thực vật bắt đầu héo.',
            badgeBg: '#ffcc00',
            badgeText: '#0f172a',
            badgeBorder: '#d4a000',
            barColor: '#ffcc00',
            bgColor: '#fffbeb',
            borderColor: '#d4a000',
            titleColor: '#78350f',
            scoreColor: '#b45309',
            icon: 'fa-sun'
        };
    } else if (tvdi <= 0.875) {
        // CẤP 7: Hạn nặng – Cam đậm #ff6600
        return {
            level: 7,
            levelCode: 'CẤP 7',
            label: 'Hạn nặng',
            desc: 'Đất thiếu hụt độ ẩm nghiêm trọng, thực vật héo rũ.',
            badgeBg: '#ff6600',
            badgeText: '#ffffff',
            badgeBorder: '#ea580c',
            barColor: '#ff6600',
            bgColor: '#fff7ed',
            borderColor: '#ff6600',
            titleColor: '#7c2d12',
            scoreColor: '#c2410c',
            icon: 'fa-fire'
        };
    } else {
        // CẤP 8: Hạn gay gắt / Khô khốc – Đỏ #ff0000
        return {
            level: 8,
            levelCode: 'CẤP 8',
            label: 'Hạn gay gắt / Khô khốc',
            desc: 'Đất kiệt nước nghiêm trọng, cây trồng suy thoái hoặc chết khô.',
            badgeBg: '#ff0000',
            badgeText: '#ffffff',
            badgeBorder: '#b91c1c',
            barColor: '#ff0000',
            bgColor: '#fef2f2',
            borderColor: '#dc2626',
            titleColor: '#7f1d1d',
            scoreColor: '#b91c1c',
            icon: 'fa-radiation'
        };
    }
}

// --- 9. Hiển thị thông tin điểm khảo sát ở Sidebar (Tối ưu địa danh hành chính & Chuẩn màu TVDI) ---
function renderPointDetail(lat, lon, tvdiVal, theme, locationName, values = null) {
    const container = document.getElementById('cell-detail-content');
    if (!container) return;

    const tvdiPercent = tvdiVal !== null ? Math.max(0, Math.min(100, Math.round(tvdiVal * 100))) : 0;

    // Giá trị LST & NDVI tại vị trí (nội suy cùng thuật toán với bản đồ); mốc dự báo AI chỉ có TVDI
    const isForecastView = state.currentView && state.currentView.kind === 'forecast';
    let lstVal = values ? values.lst : null;
    let ndviVal = values ? values.ndvi : null;
    if (!values && !isForecastView) {
        const iL = getInterpolatedValueAtLatLng(lat, lon, 'lst');
        const iN = getInterpolatedValueAtLatLng(lat, lon, 'ndvi');
        lstVal = iL ? iL.value : null;
        ndviVal = iN ? iN.value : null;
    }
    const chip = (key, val) => {
        const ok = val !== null && val !== undefined && !isNaN(val) && !isForecastView;
        const rgb = ok ? interpolateColor(key, val) : [226, 232, 240];
        return `
            <div class="point-index-chip" title="${INDEX_META[key].name}${ok ? '' : ' – không có trong dự báo AI'}">
                <span class="point-index-swatch" style="background: ${rgbCss(rgb)};"></span>
                <span class="point-index-name">${INDEX_META[key].label}</span>
                <strong>${ok ? formatIndexValue(val, key) : '—'}</strong>
            </div>`;
    };

    container.innerHTML = `
        <div class="cell-coords-tag" style="background: #f8fafc; padding: 10px 13px; border-radius: 8px; font-size: 0.82rem; color: #334155; margin-bottom: 10px; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
            <div style="font-weight: 700; color: #1e293b; font-size: 0.9rem; margin-bottom: 5px; display: flex; align-items: center; gap: 7px;">
                <i class="fa-solid fa-location-dot" style="color: #2563eb; font-size: 1rem;"></i>
                <span id="selected-location-name">${locationName}</span>
            </div>
            <div style="color: #64748b; font-size: 0.77rem; display: flex; align-items: center; padding-top: 3px; border-top: 1px dashed #e2e8f0;">
                <span><i class="fa-solid fa-crosshairs" style="color: #2563eb; margin-right: 4px;"></i>${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E</span>
            </div>
        </div>

        <div class="point-index-row">
            ${chip('lst', lstVal)}
            ${chip('ndvi', ndviVal)}
        </div>

        <div class="tvdi-gauge-container">
            <div class="tvdi-gauge-header">
                <span style="font-size: 0.82rem; font-weight: 600; color: #475569;">Chỉ số khô hạn TVDI:</span>
                <span class="tvdi-gauge-score" style="background-color: ${theme.badgeBg}; color: ${theme.badgeText}; border: 1.5px solid ${theme.badgeBorder}; padding: 2px 10px; border-radius: 6px; font-weight: 800; font-size: 1.3rem; display: inline-flex; align-items: center; box-shadow: 0 1px 4px rgba(0,0,0,0.08);">
                    ${tvdiVal !== null ? tvdiVal.toFixed(3) : '--'}
                </span>
            </div>
            <div class="tvdi-gauge-track">
                <div class="tvdi-gauge-fill" style="width: ${tvdiPercent}%; background-color: ${theme.barColor};"></div>
            </div>
            <div class="tvdi-gauge-scale">
                <span>0.0</span>
                <span>0.25</span>
                <span>0.50</span>
                <span>0.75</span>
                <span>1.0</span>
            </div>
        </div>

        <div class="cell-status-banner" style="background-color: ${theme.bgColor}; border: 1px solid ${theme.borderColor}80; border-left: 5px solid ${theme.borderColor}; padding: 11px 13px; margin: 10px 0; border-radius: 6px;">
            <div style="font-weight: 700; color: ${theme.titleColor}; font-size: 0.95rem; display: flex; align-items: center; gap: 8px;">
                <span style="background-color: ${theme.badgeBg}; color: ${theme.badgeText}; border: 1px solid ${theme.badgeBorder}; padding: 2px 7px; border-radius: 4px; font-size: 0.72rem; font-weight: 800; letter-spacing: 0.3px; display: inline-flex; align-items: center; gap: 4px;">
                    <i class="fa-solid ${theme.icon}"></i> ${theme.levelCode}
                </span>
                <span>${theme.label}</span>
            </div>
            <div style="font-size: 0.8rem; color: #475569; margin-top: 6px; line-height: 1.45;">
                ${theme.desc}
            </div>
        </div>
    `;
}

function renderSelectedCell(props, clickInfo = null) {
    const lat = clickInfo ? clickInfo.clickLat : props.lat;
    const lon = clickInfo ? clickInfo.clickLon : props.lon;
    const tvdiVal = (props.tvdi !== null && props.tvdi !== undefined && !isNaN(props.tvdi))
        ? props.tvdi
        : ((props.tvdi_pred !== null && props.tvdi_pred !== undefined && !isNaN(props.tvdi_pred)) ? props.tvdi_pred : null);
    const theme = getDroughtUITheme(tvdiVal);
    const locationName = getLocalAdminArea(lat, lon);
    renderPointDetail(lat, lon, tvdiVal, theme, locationName);
}

// --- 10. Tải và Vẽ biểu đồ Chuỗi thời gian (Dự báo 15 ngày Realtime vs Lịch sử 2017–2025) ---
async function loadChartData() {
    const isCell = (state.chartTab === 'cell');
    const cellId = state.selectedCellId;
    const is15Days = (state.chartMode === '15days');
    const isCompare = (state.chartMode === 'compare');
    const idxKey = state.activeRasterLayer;

    const hint = document.getElementById('chart-hint');
    const quickStats = document.getElementById('chart-quick-stats');
    const locBar = document.getElementById('chart-location-bar');
    const trendWrapper = document.getElementById('stat-tvdi-trend-wrapper');
    const titleEl = document.getElementById('chart-card-title');
    if (titleEl) {
        titleEl.innerText = is15Days
            ? 'Dự báo TVDI 15 ngày (AI)'
            : (isCompare ? 'TVDI thực tế vs dự báo AI' : `Chuỗi thời gian ${INDEX_META[idxKey].label}`);
    }

    if (isCell && !cellId) {
        if (hint) {
            hint.style.display = 'block';
            hint.innerHTML = is15Days
                ? '<i class="fa-solid fa-hand-pointer"></i> Nhấp vào một điểm trên bản đồ hoặc chọn <strong>"Toàn vùng"</strong> để xem dự báo 15 ngày.'
                : `<i class="fa-solid fa-hand-pointer"></i> Nhấp vào một điểm trên bản đồ hoặc chọn <strong>"Toàn vùng"</strong> để xem chuỗi biến thiên ${isCompare ? 'TVDI' : INDEX_META[idxKey].label} 2017–2025.`;
        }
        if (quickStats) quickStats.style.display = 'none';
        if (locBar) locBar.style.display = 'none';
        if (state.timeSeriesChart) {
            state.timeSeriesChart.destroy();
            state.timeSeriesChart = null;
        }
        return;
    }

    if (hint) hint.style.display = 'none';
    if (quickStats) quickStats.style.display = 'grid';
    if (locBar) locBar.style.display = 'flex';

    if (is15Days) {
        if (trendWrapper) trendWrapper.style.display = 'flex';
        const target = isCell ? cellId : 'overall';
        try {
            const startDate = state.currentDate || getTodayDateStr();
            const res = await fetch(`/api/prediction/series/15days/${target}?start_date=${startDate}`);
            const data = await res.json();
            render15DayChart(data);
        } catch (err) {
            console.error('Lỗi khi tải dự báo 15 ngày:', err);
        }
    } else if (isCompare) {
        // So sánh TVDI thực tế (Landsat) và dự báo của mô hình Random Forest
        if (trendWrapper) trendWrapper.style.display = 'flex';
        try {
            const res = await fetch(isCell ? `/api/prediction/series/${cellId}` : '/api/prediction/series/overall');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            renderCompareChart(data.series || []);
        } catch (err) {
            console.error('Lỗi khi tải chuỗi so sánh Thực tế vs AI:', err);
        }
    } else {
        // Chế độ Lịch sử (2017–2025): Dữ liệu quan trắc viễn thám thực tế từ Landsat
        try {
            const url = isCell
                ? `/api/series/${cellId}`
                : `/api/series/overall`;
            const res = await fetch(url);
            const data = await res.json();
            const locName = state.selectedPoint ? state.selectedPoint.locationName : '';
            const coordsStr = state.selectedPoint
                ? ` – ${locName} (${state.selectedPoint.lat.toFixed(4)}°N, ${state.selectedPoint.lon.toFixed(4)}°E)`
                : (state.selectedCellProps ? ` (${state.selectedCellProps.lat.toFixed(4)}°N, ${state.selectedCellProps.lon.toFixed(4)}°E)` : '');
            const title = isCell
                ? `Chuỗi quan sát viễn thám Landsat 2017–2025${coordsStr}`
                : `Chuỗi quan sát viễn thám Landsat 2017–2025 – Toàn vùng TP.HCM`;
            state.currentHistoricalSeries = data.series;
            if (!isCell) state.overallSeriesCache = data.series;
            renderHistoricalChart(data.series, title);
        } catch (err) {
            console.error('Lỗi khi tải lịch sử 2017-2025:', err);
        }
    }
}

async function loadCellTimeSeries(cellId) {
    state.selectedCellId = cellId;
    state.chartTab = 'cell';
    const tabCell = document.getElementById('tab-cell-chart');
    const tabOverall = document.getElementById('tab-overall-chart');
    if (tabCell) tabCell.classList.add('active');
    if (tabOverall) tabOverall.classList.remove('active');
    await loadChartData();
}

async function loadOverallTimeSeries() {
    state.chartTab = 'overall';
    const tabCell = document.getElementById('tab-cell-chart');
    const tabOverall = document.getElementById('tab-overall-chart');
    if (tabOverall) tabOverall.classList.add('active');
    if (tabCell) tabCell.classList.remove('active');
    await loadChartData();
}

function render15DayChart(data) {
    if (!data || !data.series || data.series.length === 0) return;
    const series = data.series;
    state.currentSeriesData = series;

    // Cập nhật thanh tiêu đề & vị trí trực quan phía trên
    const locBar = document.getElementById('chart-location-bar');
    const locNameEl = document.getElementById('chart-loc-name');
    const rangeTextEl = document.getElementById('chart-range-text');

    if (locBar) locBar.style.display = 'flex';
    if (locNameEl) {
        if (data.scope === 'cell') {
            const locName = state.selectedPoint ? state.selectedPoint.locationName : '';
            const coords = state.selectedPoint
                ? ` (${state.selectedPoint.lat.toFixed(4)}°N, ${state.selectedPoint.lon.toFixed(4)}°E)`
                : (state.selectedCellProps ? ` (${state.selectedCellProps.lat.toFixed(4)}°N, ${state.selectedCellProps.lon.toFixed(4)}°E)` : '');
            locNameEl.innerText = locName ? `${locName}${coords}` : `Điểm chọn${coords}`;
            locNameEl.title = locNameEl.innerText;
        } else {
            locNameEl.innerText = 'Toàn vùng TP. Hồ Chí Minh';
            locNameEl.title = 'Toàn vùng TP. Hồ Chí Minh';
        }
    }
    if (rangeTextEl) {
        const startShort = data.start_date.substring(5).replace('-', '/');
        const endShort = data.end_date.substring(5).replace('-', '/');
        rangeTextEl.innerText = `15 ngày: ${startShort} → ${endShort}`;
    }

    const trendWrapper = document.getElementById('stat-tvdi-trend-wrapper');
    if (trendWrapper) trendWrapper.style.display = 'flex';
    setStatPills([
        { label: 'Trung bình', value: Number(data.avg_tvdi).toFixed(3) },
        { label: 'Cao nhất', value: Number(data.max_tvdi).toFixed(3) },
        { label: 'Thấp nhất', value: Number(data.min_tvdi).toFixed(3) },
        { label: 'Xu hướng', value: `<span style="color: ${data.trend_color}; font-weight: 700;"><i class="fa-solid ${data.trend_icon}"></i> ${data.trend_label}</span>` },
    ]);

    if (state.timeSeriesChart) {
        state.timeSeriesChart.destroy();
    }

    const ctx = document.getElementById('timeSeriesChart').getContext('2d');

    // Format labels gọn gàng dạng "24/10", "25/10"...
    const labels = series.map(d => {
        const parts = d.date.split('-');
        return `${parts[2]}/${parts[1]}`;
    });
    const tvdiVals = series.map(d => d.tvdi_pred);

    // Gradient màu tím indigo hiện đại uốn lượn dưới đường cong
    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0, 'rgba(99, 102, 241, 0.40)');
    gradient.addColorStop(0.5, 'rgba(139, 92, 246, 0.15)');
    gradient.addColorStop(1, 'rgba(99, 102, 241, 0.01)');

    state.timeSeriesChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Dự báo TVDI',
                data: tvdiVals,
                borderColor: '#4f46e5',
                borderWidth: 2.6,
                backgroundColor: gradient,
                fill: true,
                tension: 0.38,
                pointRadius: 2.5,
                pointBackgroundColor: '#4f46e5',
                pointBorderColor: '#ffffff',
                pointBorderWidth: 1.5,
                pointHoverRadius: 6,
                pointHoverBackgroundColor: '#4f46e5',
                pointHoverBorderColor: '#ffffff',
                pointHoverBorderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                title: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.94)',
                    padding: 8,
                    titleFont: { size: 11, weight: 'bold' },
                    bodyFont: { size: 11 },
                    callbacks: {
                        title: function (items) {
                            const d = series[items[0].dataIndex];
                            return `⚡ Ngày ${d.day_index} (${d.date})`;
                        },
                        label: function (context) {
                            const d = series[context.dataIndex];
                            const theme = getDroughtUITheme(d.tvdi_pred);
                            return [
                                `  Dự báo TVDI: ${d.tvdi_pred.toFixed(3)}`,
                                `  Cấp độ: ${theme.label}`
                            ];
                        }
                    }
                }
            },
            scales: {
                x: {
                    ticks: {
                        font: { size: 9, weight: '500' },
                        color: '#64748b',
                        maxRotation: 0,
                        autoSkip: true,
                        maxTicksLimit: 7
                    },
                    grid: { display: false }
                },
                y: {
                    type: 'linear',
                    min: 0,
                    max: 1.0,
                    ticks: {
                        stepSize: 0.2,
                        font: { size: 9 },
                        color: '#64748b',
                        callback: (v) => v.toFixed(1)
                    },
                    title: {
                        display: true,
                        text: 'Chỉ số TVDI [0 – 1]',
                        font: { size: 9, weight: 'bold' },
                        color: '#64748b'
                    },
                    grid: { color: 'rgba(226, 232, 240, 0.6)' }
                }
            }
        }
    });
}

// Cập nhật 4 ô thống kê nhanh phía trên biểu đồ: [{ label, value }]
function setStatPills(items) {
    const ids = ['stat-tvdi-avg', 'stat-tvdi-max', 'stat-tvdi-min', 'stat-tvdi-trend'];
    ids.forEach((id, i) => {
        const valEl = document.getElementById(id);
        if (!valEl || !items[i]) return;
        const pill = valEl.closest('.stat-pill');
        const labelEl = pill ? pill.querySelector('.stat-pill-label') : null;
        if (labelEl) labelEl.innerText = items[i].label;
        valEl.innerHTML = items[i].value;
    });
}

// Cấu hình trục tung theo từng chỉ số
function getIndexAxisConfig(key, values) {
    if (key === 'tvdi') {
        return { min: 0, max: 1, stepSize: 0.2, title: 'Chỉ số khô hạn TVDI [0 – 1]', fmt: v => v.toFixed(1) };
    }
    const valid = values.filter(v => v !== null && v !== undefined && !isNaN(v));
    const lo = valid.length ? Math.min(...valid) : 0;
    const hi = valid.length ? Math.max(...valid) : 1;
    if (key === 'lst') {
        return { min: Math.floor((lo - 1) / 5) * 5, max: Math.ceil((hi + 1) / 5) * 5, stepSize: 5, title: 'Nhiệt độ bề mặt LST (°C)', fmt: v => v.toFixed(0) };
    }
    return { min: Math.max(-0.2, Math.floor((lo - 0.05) * 10) / 10), max: Math.min(1, Math.ceil((hi + 0.05) * 10) / 10), stepSize: 0.2, title: 'Chỉ số thực vật NDVI', fmt: v => v.toFixed(1) };
}

function renderHistoricalChart(seriesData, title) {
    if (!seriesData || seriesData.length === 0) return;
    state.currentSeriesData = seriesData;
    state.currentSeriesTitle = title;

    const key = state.activeRasterLayer;
    const meta = INDEX_META[key];
    const prop = key === 'lst' ? 'lst_c' : key;

    const locBar = document.getElementById('chart-location-bar');
    const locNameEl = document.getElementById('chart-loc-name');
    const rangeTextEl = document.getElementById('chart-range-text');
    const trendWrapper = document.getElementById('stat-tvdi-trend-wrapper');

    if (locBar) locBar.style.display = 'flex';
    if (locNameEl) {
        if (state.chartTab === 'cell') {
            const locName = state.selectedPoint ? state.selectedPoint.locationName : '';
            const coords = state.selectedPoint
                ? ` (${state.selectedPoint.lat.toFixed(4)}°N, ${state.selectedPoint.lon.toFixed(4)}°E)`
                : (state.selectedCellProps ? ` (${state.selectedCellProps.lat.toFixed(4)}°N, ${state.selectedCellProps.lon.toFixed(4)}°E)` : '');
            locNameEl.innerText = locName ? `${locName}${coords}` : `Điểm chọn${coords}`;
            locNameEl.title = locNameEl.innerText;
        } else {
            locNameEl.innerText = 'Toàn vùng TP. Hồ Chí Minh';
            locNameEl.title = 'Toàn vùng TP. Hồ Chí Minh';
        }
    }
    if (rangeTextEl) {
        rangeTextEl.innerText = `2017 – 2025 (${seriesData.length} kỳ)`;
    }

    const labels = seriesData.map(d => d.date);
    const actualVals = seriesData.map(d => {
        if (key === 'tvdi' && d.tvdi_actual !== undefined && d.tvdi_actual !== null) return d.tvdi_actual;
        const v = d[prop];
        return (v !== undefined && v !== null && !d.is_future) ? v : null;
    });
    // Dải P5 – P95 của các ô lưới (chỉ có ở chuỗi toàn vùng)
    const hasBand = state.chartTab !== 'cell' && seriesData.some(d => d[`${key}_p5`] !== undefined && d[`${key}_p5`] !== null);
    const p5Vals = hasBand ? seriesData.map(d => d[`${key}_p5`]) : [];
    const p95Vals = hasBand ? seriesData.map(d => d[`${key}_p95`]) : [];

    // Thống kê nhanh giai đoạn 2017–2025
    const validActual = actualVals.filter(v => v !== null);
    if (validActual.length > 0) {
        const sum = validActual.reduce((a, b) => a + b, 0);
        setStatPills([
            { label: 'Trung bình', value: formatIndexValue(sum / validActual.length, key) },
            { label: 'Cao nhất', value: formatIndexValue(Math.max(...validActual), key) },
            { label: 'Thấp nhất', value: formatIndexValue(Math.min(...validActual), key) },
            { label: 'Nguồn', value: '<span style="color: #64748b; font-weight: 700;">Landsat 8/9</span>' },
        ]);
    }
    if (trendWrapper) trendWrapper.style.display = 'flex';

    if (state.timeSeriesChart) {
        state.timeSeriesChart.destroy();
    }

    const lineColor = { lst: '#dc2626', ndvi: '#16a34a', tvdi: '#d97706' }[key];
    const ctx = document.getElementById('timeSeriesChart').getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
    if (key === 'ndvi') {
        gradient.addColorStop(0, 'rgba(22, 163, 74, 0.35)');
        gradient.addColorStop(1, 'rgba(22, 163, 74, 0.03)');
    } else {
        gradient.addColorStop(0, 'rgba(239, 68, 68, 0.40)');
        gradient.addColorStop(0.5, 'rgba(234, 179, 8, 0.20)');
        gradient.addColorStop(1, 'rgba(16, 185, 129, 0.05)');
    }

    const datasets = [];
    if (hasBand) {
        datasets.push({
            label: 'P5',
            data: p5Vals,
            borderColor: 'rgba(0,0,0,0)',
            backgroundColor: 'rgba(0,0,0,0)',
            pointRadius: 0,
            pointHoverRadius: 0,
            fill: false,
            spanGaps: true,
        });
        datasets.push({
            label: 'Khoảng P5 – P95',
            data: p95Vals,
            borderColor: 'rgba(0,0,0,0)',
            backgroundColor: key === 'ndvi' ? 'rgba(22, 163, 74, 0.14)' : 'rgba(239, 68, 68, 0.13)',
            pointRadius: 0,
            pointHoverRadius: 0,
            fill: '-1',
            spanGaps: true,
        });
    }
    datasets.push({
        label: `${meta.label} thực tế (Landsat)`,
        data: actualVals,
        borderColor: lineColor,
        backgroundColor: hasBand ? 'rgba(0,0,0,0)' : gradient,
        fill: !hasBand,
        tension: 0.25,
        pointRadius: hasBand ? 1.6 : 0,
        pointBackgroundColor: lineColor,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: lineColor,
        pointHoverBorderColor: '#ffffff',
        pointHoverBorderWidth: 2,
        borderWidth: 2,
        spanGaps: true,
    });

    const axis = getIndexAxisConfig(key, [...actualVals, ...p5Vals, ...p95Vals]);

    state.timeSeriesChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                title: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.94)',
                    padding: 8,
                    titleFont: { size: 11, weight: 'bold' },
                    bodyFont: { size: 11 },
                    filter: (item) => item.dataset.label !== 'P5',
                    callbacks: {
                        label: function (context) {
                            const val = context.parsed.y;
                            if (val === null || isNaN(val)) return null;
                            if (context.dataset.label === 'Khoảng P5 – P95') {
                                const lo = p5Vals[context.dataIndex];
                                return `  P5 – P95: ${formatIndexValue(lo, key, false)} – ${formatIndexValue(val, key)}`;
                            }
                            const dLabel = key === 'tvdi' ? ` (${getDroughtUITheme(val).label})` : '';
                            return `  ${meta.label} trung bình: ${formatIndexValue(val, key)}${dLabel}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    ticks: { maxTicksLimit: 8, font: { size: 9 }, color: '#64748b', maxRotation: 0 },
                    grid: { display: false }
                },
                y: {
                    type: 'linear',
                    min: axis.min,
                    max: axis.max,
                    ticks: {
                        stepSize: axis.stepSize,
                        font: { size: 9 },
                        color: '#64748b',
                        callback: (v) => axis.fmt(v)
                    },
                    title: { display: true, text: axis.title, font: { size: 9, weight: 'bold' }, color: '#64748b' },
                    grid: { color: 'rgba(226, 232, 240, 0.6)' }
                }
            }
        }
    });
}

// Biểu đồ so sánh TVDI thực tế (Landsat) và giá trị dự báo của mô hình Random Forest
function renderCompareChart(series) {
    if (!series || series.length === 0) return;
    const locBar = document.getElementById('chart-location-bar');
    const locNameEl = document.getElementById('chart-loc-name');
    const rangeTextEl = document.getElementById('chart-range-text');
    if (locBar) locBar.style.display = 'flex';
    if (locNameEl) {
        const txt = state.chartTab === 'cell'
            ? (state.selectedPoint ? state.selectedPoint.locationName : 'Điểm chọn')
            : 'Toàn vùng TP. Hồ Chí Minh';
        locNameEl.innerText = txt;
        locNameEl.title = txt;
    }

    const labels = series.map(d => d.date);
    const actual = series.map(d => (d.tvdi_actual === null || d.tvdi_actual === undefined) ? null : d.tvdi_actual);
    const predTest = series.map(d => (!d.is_future && d.tvdi_pred !== null && d.tvdi_pred !== undefined) ? d.tvdi_pred : null);
    const predFuture = series.map(d => (d.is_future && d.tvdi_pred !== null && d.tvdi_pred !== undefined) ? d.tvdi_pred : null);
    if (rangeTextEl) rangeTextEl.innerText = `${labels[0].substring(0, 4)} – ${labels[labels.length - 1].substring(0, 4)}`;

    // Chỉ số đánh giá trên các mốc có đồng thời giá trị thực tế và dự báo (tập kiểm tra)
    const pairs = series.filter(d => d.tvdi_actual !== null && d.tvdi_actual !== undefined && d.tvdi_pred !== null && d.tvdi_pred !== undefined && !d.is_future);
    let r2Txt = '--', rmseTxt = '--', maeTxt = '--';
    if (pairs.length >= 2) {
        const n = pairs.length;
        const meanA = pairs.reduce((s, d) => s + d.tvdi_actual, 0) / n;
        let ssRes = 0, ssTot = 0, absSum = 0;
        pairs.forEach(d => {
            const err = d.tvdi_actual - d.tvdi_pred;
            ssRes += err * err;
            ssTot += (d.tvdi_actual - meanA) ** 2;
            absSum += Math.abs(err);
        });
        r2Txt = ssTot > 0 ? (1 - ssRes / ssTot).toFixed(3) : '--';
        rmseTxt = Math.sqrt(ssRes / n).toFixed(3);
        maeTxt = (absSum / n).toFixed(3);
    }
    setStatPills([
        { label: 'R²', value: r2Txt },
        { label: 'RMSE', value: rmseTxt },
        { label: 'MAE', value: maeTxt },
        { label: 'Số mốc kiểm tra', value: `<span style="color: #4f46e5; font-weight: 700;">${pairs.length}</span>` },
    ]);

    if (state.timeSeriesChart) state.timeSeriesChart.destroy();
    const ctx = document.getElementById('timeSeriesChart').getContext('2d');
    state.timeSeriesChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: 'Thực tế (Landsat)', data: actual, borderColor: '#dc2626', backgroundColor: '#dc2626', borderWidth: 1.8, pointRadius: 0, pointHoverRadius: 4, tension: 0.25, spanGaps: true },
                { label: 'Dự báo AI (kiểm tra)', data: predTest, borderColor: '#4f46e5', backgroundColor: '#4f46e5', borderWidth: 1.8, borderDash: [5, 3], pointRadius: 0, pointHoverRadius: 4, tension: 0.25, spanGaps: true },
                { label: 'Dự báo AI (tương lai)', data: predFuture, borderColor: '#9333ea', backgroundColor: 'rgba(147, 51, 234, 0.10)', borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.3, fill: true, spanGaps: true },
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: true, position: 'top', labels: { boxWidth: 10, boxHeight: 2, font: { size: 9 }, color: '#475569' } },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.94)',
                    padding: 8,
                    titleFont: { size: 11, weight: 'bold' },
                    bodyFont: { size: 11 },
                    callbacks: {
                        label: (c) => (c.parsed.y === null || isNaN(c.parsed.y)) ? null : `  ${c.dataset.label}: ${c.parsed.y.toFixed(3)}`
                    }
                }
            },
            scales: {
                x: { ticks: { maxTicksLimit: 8, font: { size: 9 }, color: '#64748b', maxRotation: 0 }, grid: { display: false } },
                y: {
                    min: 0, max: 1,
                    ticks: { stepSize: 0.2, font: { size: 9 }, color: '#64748b', callback: (v) => v.toFixed(1) },
                    title: { display: true, text: 'Chỉ số khô hạn TVDI [0 – 1]', font: { size: 9, weight: 'bold' }, color: '#64748b' },
                    grid: { color: 'rgba(226, 232, 240, 0.6)' }
                }
            }
        }
    });
}

function renderChart(seriesData, title) {
    renderHistoricalChart(seriesData, title);
}

// --- 11. Thống kê cấp độ khô hạn toàn vùng (Tối ưu TVDI & Hỗ trợ Dự báo AI) ---
// Thẻ giá trị trung bình toàn vùng của 3 chỉ số LST / NDVI / TVDI
function updateIndexCards(gridData, isFuture) {
    const feats = (gridData && gridData.features) ? gridData.features : [];
    ['lst', 'ndvi', 'tvdi'].forEach(key => {
        const vals = feats.map(f => getIndexValue(f.properties, key)).filter(v => v !== null);
        const valEl = document.getElementById(`card-val-${key}`);
        const subEl = document.getElementById(`card-sub-${key}`);
        const noData = vals.length === 0 || (isFuture && key !== 'tvdi');
        if (valEl) valEl.innerText = noData ? '--' : formatIndexValue(vals.reduce((a, b) => a + b, 0) / vals.length, key, false);
        if (subEl) {
            subEl.innerText = (isFuture && key !== 'tvdi')
                ? 'Không dự báo'
                : (noData ? 'Không có dữ liệu' : (isFuture ? 'TB dự báo toàn vùng' : 'TB toàn vùng'));
        }
    });
    // Mốc dự báo AI chỉ có TVDI: ẩn 2 thẻ LST / NDVI trống cho gọn
    const cards = document.getElementById('index-cards');
    if (cards) cards.classList.toggle('is-forecast', !!isFuture);

    const tag = document.getElementById('stats-period-tag');
    if (tag) tag.innerText = describeCurrentView(true);
}

async function loadRegionalStats(dateStr, isFuture = false, gridData = null) {
    try {
        let avgTvdi = '--';
        let droughtPercent = '0';
        let droughtCellCount = 0;
        let totalActive = 272;
        let breakdown = [];

        const classDefs = [
            { level: 1, label: 'Rất ẩm / Ngập nước', color: '#066b00', min: 0.000, max: 0.125 },
            { level: 2, label: 'Ẩm ướt', color: '#0bc400', min: 0.125, max: 0.250 },
            { level: 3, label: 'Đủ ẩm, phát triển tốt', color: '#0ce100', min: 0.250, max: 0.375 },
            { level: 4, label: 'Bình thường', color: '#00ff00', min: 0.375, max: 0.500 },
            { level: 5, label: 'Bắt đầu khô hạn nhẹ', color: '#ffff00', min: 0.500, max: 0.625 },
            { level: 6, label: 'Hạn vừa', color: '#ffcc00', min: 0.625, max: 0.750 },
            { level: 7, label: 'Hạn nặng', color: '#ff6600', min: 0.750, max: 0.875 },
            { level: 8, label: 'Hạn gay gắt / Khô khốc', color: '#ff0000', min: 0.875, max: 1.000 }
        ];

        if (gridData && gridData.features && gridData.features.length > 0) {
            const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 };
            let validCells = 0;
            let sumTvdi = 0;
            droughtCellCount = 0;

            gridData.features.forEach(f => {
                const p = f.properties || {};
                const val = (p.tvdi !== null && p.tvdi !== undefined && !isNaN(p.tvdi))
                    ? p.tvdi
                    : ((p.tvdi_pred !== null && p.tvdi_pred !== undefined && !isNaN(p.tvdi_pred)) ? p.tvdi_pred : null);

                if (val !== null) {
                    validCells++;
                    sumTvdi += val;
                    const theme = getDroughtUITheme(val);
                    if (counts[theme.level] !== undefined) {
                        counts[theme.level]++;
                    }
                    if (val >= 0.625) {
                        droughtCellCount++;
                    }
                }
            });

            totalActive = validCells || gridData.total_cells || 272;
            if (validCells > 0) {
                avgTvdi = (sumTvdi / validCells).toFixed(3);
                droughtPercent = ((droughtCellCount / validCells) * 100).toFixed(1);
            }

            breakdown = classDefs.map(c => {
                const cnt = counts[c.level] || 0;
                const pct = totalActive > 0 ? ((cnt / totalActive) * 100).toFixed(1) : '0.0';
                return {
                    level: c.level,
                    label: c.label,
                    color: c.color,
                    cell_count: cnt,
                    percentage: pct
                };
            });
        } else {
            const res = await fetch(`/api/stats/summary/${dateStr}`);
            const data = await res.json();
            totalActive = data.total_active_cells ?? data.cells_with_data ?? 0;
            avgTvdi = data.avg_tvdi !== null ? data.avg_tvdi : '--';

            breakdown = data.classes || data.breakdown || [];
            breakdown.forEach(item => {
                if (item.level >= 6 || item.min_tvdi >= 0.625) {
                    droughtCellCount += item.cell_count;
                }
            });
            droughtPercent = totalActive > 0 ? ((droughtCellCount / totalActive) * 100).toFixed(1) : 0;
        }

        const avgEl = document.getElementById('metric-avg-tvdi');
        const pctEl = document.getElementById('metric-drought-percent');
        if (avgEl) avgEl.innerHTML = isFuture ? `${avgTvdi} <small class="metric-tag">Dự báo AI</small>` : avgTvdi;
        if (pctEl) pctEl.innerText = `${droughtPercent}%`;

        updateIndexCards(gridData, isFuture);

        const listContainer = document.getElementById('drought-breakdown-list');
        if (listContainer) {
            listContainer.innerHTML = '';
            breakdown.forEach(item => {
                const row = document.createElement('div');
                row.className = 'drought-bar-item drought-row';
                row.innerHTML = `
                    <div class="drought-bar-header drought-info">
                        <span class="drought-bar-label drought-name">
                            <span class="drought-bar-color-dot drought-color-box" style="background-color: ${item.color};"></span>
                            ${item.label}
                        </span>
                        <span class="drought-bar-count drought-count">${item.percentage}% diện tích</span>
                    </div>
                    <div class="progress-track progress-bar-bg">
                        <div class="progress-fill" style="width: ${item.percentage}%; background-color: ${item.color};"></div>
                    </div>
                `;
                listContainer.appendChild(row);
            });
        }
    } catch (err) {
        console.error('Lỗi khi tải thống kê toàn vùng:', err);
    }
}

// --- 12. Bản đồ nền (đường phố, vệ tinh, địa hình, nền sáng / tối...) ---
function setBaseMap(type) {
    if (!state.baseMaps || !(type in state.baseMaps)) return;
    Object.entries(state.baseMaps).forEach(([k, layer]) => {
        if (k !== type && layer && map && map.hasLayer(layer)) {
            map.removeLayer(layer);
        }
    });
    const newLayer = state.baseMaps[type];
    if (newLayer && map && !map.hasLayer(newLayer)) {
        newLayer.addTo(map);
        if (typeof newLayer.bringToBack === 'function') newLayer.bringToBack();
    }
    state.activeBaseMap = type;
    const mapEl = document.getElementById('map');
    if (mapEl) mapEl.classList.toggle('no-basemap', !newLayer);

    // Đồng bộ nút chọn bản đồ nền trên bảng lớp bản đồ
    document.querySelectorAll('#basemap-switch [data-basemap]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.basemap === type);
    });

    renderOutsideMask();   // Màu lớp làm mờ phụ thuộc nền sáng / tối
    if (typeof apply3DBasemap === 'function') apply3DBasemap();
}

// Bảng lớp bản đồ nổi (góc trên trái bản đồ): bản đồ nền + bảng tùy chỉnh hiển thị.
// Nằm ngoài Leaflet nên vẫn dùng được khi chuyển sang bản đồ 3D.
function setupUnifiedLayersControl() {
    const basemapSwitch = document.getElementById('basemap-switch');
    if (basemapSwitch) {
        basemapSwitch.innerHTML = Object.entries(BASEMAP_DEFS).map(([key, def]) => `
            <button type="button" class="basemap-btn bm-${key}${key === state.activeBaseMap ? ' active' : ''}" data-basemap="${key}" title="Bản đồ nền: ${def.name}">
                <i class="fa-solid ${def.icon}"></i><span>${def.name}</span>
            </button>`).join('');
        basemapSwitch.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-basemap]');
            if (btn) setBaseMap(btn.dataset.basemap);
        });
    }

    const panel = document.getElementById('unified-layers-panel');
    if (!panel) return;
    panel.innerHTML = `
                    <div class="unified-layers-panel-header">
                        <div class="header-title">
                            <i class="fa-solid fa-sliders"></i>
                            <span>Tùy chỉnh hiển thị</span>
                        </div>
                        <button class="btn-close-panel" id="btn-close-layers-panel" title="Đóng bảng">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>

                    <div class="unified-panel-body">
                        <div class="unified-section">
                            <div class="gee-layers-list">
                                <!-- Lớp chỉ số đang chọn (LST / NDVI / TVDI) -->
                                <div class="gee-layer-item highlight">
                                    <label class="gee-layer-checkbox">
                                        <input type="checkbox" id="chk-tvdi" checked>
                                        <span class="gee-layer-title" id="raster-layer-title">Lớp chỉ số TVDI</span>
                                    </label>
                                    <div class="slider-control">
                                        <input type="range" id="alpha-tvdi" class="gee-slider" min="0" max="1" step="0.05" value="1.0" title="Độ trong suốt">
                                        <span class="slider-val" id="val-alpha-tvdi">100%</span>
                                    </div>
                                </div>

                                <div class="gee-layer-item">
                                    <label class="gee-layer-checkbox">
                                        <input type="checkbox" id="chk-boundary" checked>
                                        <span class="gee-layer-title">Ranh giới toàn vùng</span>
                                    </label>
                                    <div class="slider-control">
                                        <input type="range" id="alpha-boundary" class="gee-slider" min="0" max="1" step="0.05" value="1.0" title="Độ trong suốt">
                                        <span class="slider-val" id="val-alpha-boundary">100%</span>
                                    </div>
                                </div>

                                <div class="gee-layer-item">
                                    <label class="gee-layer-checkbox">
                                        <input type="checkbox" id="chk-wards-boundary" checked>
                                        <span class="gee-layer-title">Ranh giới phường / xã</span>
                                    </label>
                                    <div class="slider-control">
                                        <input type="range" id="alpha-wards-boundary" class="gee-slider" min="0" max="1" step="0.05" value="0.9" title="Độ trong suốt">
                                        <span class="slider-val" id="val-alpha-wards-boundary">90%</span>
                                    </div>
                                </div>

                                <div class="gee-layer-item">
                                    <label class="gee-layer-checkbox">
                                        <input type="checkbox" id="chk-grid-points">
                                        <span class="gee-layer-title">Tâm ô lưới quan trắc (5,5 km)</span>
                                    </label>
                                    <div class="slider-control">
                                        <input type="range" id="alpha-grid-points" class="gee-slider" min="0" max="1" step="0.05" value="1.0" title="Độ trong suốt">
                                        <span class="slider-val" id="val-alpha-grid">100%</span>
                                    </div>
                                </div>

                                <label class="gee-layer-checkbox layer-toggle-row">
                                    <input type="checkbox" id="chk-outside-mask" checked>
                                    <span class="gee-layer-title">Làm mờ ngoài vùng nghiên cứu</span>
                                </label>
                                <label class="gee-layer-checkbox layer-toggle-row">
                                    <input type="checkbox" id="chk-graticule" checked>
                                    <span class="gee-layer-title">Lưới tọa độ kinh – vĩ độ</span>
                                </label>
                                <label class="gee-layer-checkbox layer-toggle-row">
                                    <input type="checkbox" id="chk-map-title" checked>
                                    <span class="gee-layer-title">Khung tiêu đề bản đồ</span>
                                </label>
                            </div>
                        </div>

                        <div class="unified-divider"></div>

                        <div class="unified-section">
                            <div class="unified-section-title">
                                <i class="fa-solid fa-palette"></i>
                                <span>Dải màu – <span id="viz-range-label">TVDI</span></span>
                            </div>
                            <div class="viz-range-row">
                                <input type="number" id="viz-min" class="viz-range-input" title="Giá trị nhỏ nhất của thang màu">
                                <span>–</span>
                                <input type="number" id="viz-max" class="viz-range-input" title="Giá trị lớn nhất của thang màu">
                                <button type="button" id="viz-reset" class="viz-range-reset" title="Về dải mặc định"><i class="fa-solid fa-rotate-left"></i></button>
                            </div>
                        </div>
                    </div>
    `;

    const dock = document.getElementById('map-dock');
    const btnUnified = document.getElementById('btn-unified-layers');
    const btnClose = document.getElementById('btn-close-layers-panel');
    const btnDock = document.getElementById('btn-dock-toggle');
    const setPanelOpen = (open) => {
        panel.classList.toggle('collapsed', !open);
        if (btnUnified) btnUnified.classList.toggle('active', open);
    };

    if (btnUnified) {
        btnUnified.addEventListener('click', (e) => {
            e.stopPropagation();
            setPanelOpen(panel.classList.contains('collapsed'));
        });
    }
    if (btnClose) {
        btnClose.addEventListener('click', (e) => {
            e.stopPropagation();
            setPanelOpen(false);
        });
    }
    if (btnDock && dock) {
        btnDock.addEventListener('click', () => {
            const collapsed = !dock.classList.contains('is-collapsed');
            dock.classList.toggle('is-collapsed', collapsed);
            if (collapsed) setPanelOpen(false);
        });
    }

    // Đóng bảng tùy chỉnh khi bấm ra ngoài bảng lớp bản đồ
    document.addEventListener('click', (e) => {
        if (dock && !dock.contains(e.target) && !panel.classList.contains('collapsed')) setPanelOpen(false);
    });
    if (dock) {
        L.DomEvent.disableClickPropagation(dock);
        L.DomEvent.disableScrollPropagation(dock);
    }

    const chkTitle = document.getElementById('chk-map-title');
    if (chkTitle) {
        chkTitle.addEventListener('change', (e) => {
            state.mapDecor.title = e.target.checked;
            const card = document.getElementById('map-title-card');
            if (card) card.style.display = state.mapDecor.title ? '' : 'none';
        });
    }

    // Dải màu hiển thị
    const vizMin = document.getElementById('viz-min');
    const vizMax = document.getElementById('viz-max');
    const vizReset = document.getElementById('viz-reset');
    const applyRange = () => {
        const key = state.activeRasterLayer;
        const cfg = GEE_COLOR_PALETTES[key];
        const lo = parseFloat(vizMin.value);
        const hi = parseFloat(vizMax.value);
        if (isNaN(lo) || isNaN(hi) || lo >= hi) {
            showToast('Dải màu không hợp lệ: giá trị nhỏ nhất phải bé hơn giá trị lớn nhất.');
            updateVizRangeInputs();
            return;
        }
        cfg.min = lo;
        cfg.max = hi;
        refreshIndexVisuals();
    };
    if (vizMin) vizMin.addEventListener('change', applyRange);
    if (vizMax) vizMax.addEventListener('change', applyRange);
    if (vizReset) {
        vizReset.addEventListener('click', () => {
            const key = state.activeRasterLayer;
            GEE_COLOR_PALETTES[key].min = DEFAULT_VIZ_RANGE[key].min;
            GEE_COLOR_PALETTES[key].max = DEFAULT_VIZ_RANGE[key].max;
            updateVizRangeInputs();
            refreshIndexVisuals();
        });
    }
    updateVizRangeInputs();

    // Thiết lập các sự kiện cho lớp dữ liệu TVDI
    bindTVDILayerControls();
}

function updateVizRangeInputs() {
    const key = state.activeRasterLayer;
    const cfg = GEE_COLOR_PALETTES[key];
    const meta = INDEX_META[key];
    const label = document.getElementById('viz-range-label');
    const vizMin = document.getElementById('viz-min');
    const vizMax = document.getElementById('viz-max');
    const rasterTitle = document.getElementById('raster-layer-title');
    if (label) label.innerText = `${meta.label}${meta.unit ? ' (' + meta.unit + ')' : ''}`;
    if (vizMin) { vizMin.value = cfg.min; vizMin.step = meta.step; }
    if (vizMax) { vizMax.value = cfg.max; vizMax.step = meta.step; }
    if (rasterTitle) rasterTitle.innerText = `Lớp chỉ số ${meta.label}`;
}

// Vẽ lại mọi thành phần phụ thuộc chỉ số / thang màu đang chọn
function refreshIndexVisuals() {
    renderActiveRaster();
    if (state.displayMode === 'ward') renderWardsBoundary();
    if (state.viewMode === '3d') update3DData();
    refreshAnalysisCharts();
    updateMapTitle();
}

// Chọn lớp chỉ số hiển thị: LST | NDVI | TVDI
function setActiveIndex(key, opts = {}) {
    if (!INDEX_META[key]) return;
    if (key !== 'tvdi' && isForecastDate(state.currentDate)) {
        showToast('Mô hình AI chỉ dự báo chỉ số TVDI. Chọn "Giám sát thực tế" (2017–2025) để xem LST / NDVI.');
        return;
    }
    const changed = state.activeRasterLayer !== key;
    state.activeRasterLayer = key;
    document.querySelectorAll('#index-switch .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.index === key));
    document.querySelectorAll('#index-cards .index-card').forEach(b => b.classList.toggle('active', b.dataset.index === key));
    updateVizRangeInputs();
    if (!changed && !opts.force) return;

    refreshIndexVisuals();
    if (state.chartMode === 'history') loadChartData();

    // Bảng xếp hạng phường/xã sắp xếp theo chỉ số đang xem (LST cao→thấp, NDVI thấp→cao, TVDI cao→thấp)
    const sortBtn = document.getElementById({ lst: 'btn-sort-lst', ndvi: 'btn-sort-ndvi', tvdi: 'btn-sort-tvdi' }[key]);
    const wantSort = { lst: 'lst_desc', ndvi: 'ndvi_asc', tvdi: 'tvdi_desc' }[key];
    if (sortBtn && state.wards.sortBy !== wantSort) sortBtn.click();
    if (!opts.silent) logUserAction('Đổi lớp chỉ số', `Hiển thị lớp ${INDEX_META[key].label}`);
}

// Kiểu hiển thị: ảnh pixel hoặc tô màu theo phường/xã
function setDisplayMode(mode) {
    if (mode !== 'pixel' && mode !== 'ward') return;
    state.displayMode = mode;
    document.querySelectorAll('#display-switch .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.display === mode));
    renderActiveRaster();
    renderWardsBoundary();
    if (state.viewMode === '3d') update3DData();
    updateMapTitle();
}

// Tổng hợp theo thời gian: kỳ 15 ngày | trung bình tháng | năm | toàn giai đoạn
function setAggregation(value) {
    if (!['cycle', 'month', 'year', 'period'].includes(value)) return;
    const sel = document.getElementById('aggregation-select');
    state.aggregation = value;
    if (sel && sel.value !== value) sel.value = value;

    if (value !== 'cycle' && isForecastDate(state.currentDate)) {
        // Tổng hợp chỉ áp dụng cho dữ liệu quan trắc: chuyển về kỳ quan trắc gần nhất
        state.isAIMode = false;
        setStepUnit('cycle');
        const obs = state.observedDates;
        if (obs.length) setDate(obs[obs.length - 1]);
        return;
    }
    loadDataForCurrentDate();
}

// Gắn sự kiện cho các nút chọn chỉ số, kiểu hiển thị, bản đồ nền và tổng hợp thời gian
function setupMapDisplayControls() {
    document.querySelectorAll('#index-switch .seg-btn, #index-cards .index-card').forEach(btn => {
        btn.addEventListener('click', () => setActiveIndex(btn.dataset.index));
    });
    document.querySelectorAll('#display-switch .seg-btn').forEach(btn => {
        btn.addEventListener('click', () => setDisplayMode(btn.dataset.display));
    });

    const aggSelect = document.getElementById('aggregation-select');
    if (aggSelect) {
        aggSelect.value = state.aggregation;
        aggSelect.addEventListener('change', (e) => setAggregation(e.target.value));
    }
}

function bindTVDILayerControls() {
    // 1. Lớp chỉ số đang chọn (áp dụng chung cho LST / NDVI / TVDI)
    const chkTVDI = document.getElementById('chk-tvdi');
    const alphaTVDI = document.getElementById('alpha-tvdi');
    const valAlphaTVDI = document.getElementById('val-alpha-tvdi');

    if (chkTVDI) {
        chkTVDI.addEventListener('change', (e) => {
            ['tvdi', 'lst', 'ndvi'].forEach(k => { state.layerVisibility[k] = e.target.checked; });
            renderActiveRaster();
            if (state.displayMode === 'ward') renderWardsBoundary();
        });
    }
    if (alphaTVDI) {
        alphaTVDI.addEventListener('input', (e) => {
            const v = parseFloat(e.target.value);
            ['tvdi', 'lst', 'ndvi'].forEach(k => { state.layerOpacities[k] = v; });
            if (valAlphaTVDI) valAlphaTVDI.innerText = Math.round(v * 100) + '%';
            if (state.geeTileLayer) state.geeTileLayer.setOpacity(v);
            else if (state.localRasterLayer) state.localRasterLayer.setOpacity(v);
        });
        alphaTVDI.addEventListener('change', () => {
            if (state.displayMode === 'ward') renderWardsBoundary();
        });
    }

    // 1b. Làm mờ ngoài vùng nghiên cứu & lưới tọa độ
    const chkMask = document.getElementById('chk-outside-mask');
    if (chkMask) {
        chkMask.addEventListener('change', (e) => {
            state.mapDecor.mask = e.target.checked;
            renderOutsideMask();
            apply3DMask();
        });
    }
    const chkGraticule = document.getElementById('chk-graticule');
    if (chkGraticule) {
        chkGraticule.addEventListener('change', (e) => setGraticuleVisible(e.target.checked));
    }

    // 2. Ranh giới TPHCM mới
    const chkBoundary = document.getElementById('chk-boundary');
    const alphaBoundary = document.getElementById('alpha-boundary');
    const valAlphaBoundary = document.getElementById('val-alpha-boundary');

    if (chkBoundary) {
        chkBoundary.addEventListener('change', (e) => {
            state.layerVisibility.boundary = e.target.checked;
            renderBoundary();
        });
    }
    if (alphaBoundary) {
        alphaBoundary.addEventListener('input', (e) => {
            state.layerOpacities.boundary = parseFloat(e.target.value);
            if (valAlphaBoundary) valAlphaBoundary.innerText = Math.round(state.layerOpacities.boundary * 100) + '%';
            renderBoundary();
        });
    }

    // 2b. Ranh giới 168 Phường / Xã
    const chkWards = document.getElementById('chk-wards-boundary');
    const alphaWards = document.getElementById('alpha-wards-boundary');
    const valAlphaWards = document.getElementById('val-alpha-wards-boundary');

    if (chkWards) {
        chkWards.addEventListener('change', (e) => {
            state.layerVisibility.wardsBoundary = e.target.checked;
            renderWardsBoundary();
        });
    }
    if (alphaWards) {
        alphaWards.addEventListener('input', (e) => {
            state.layerOpacities.wardsBoundary = parseFloat(e.target.value);
            if (valAlphaWards) valAlphaWards.innerText = Math.round(state.layerOpacities.wardsBoundary * 100) + '%';
            renderWardsBoundary();
        });
    }

    // 3. Tâm ô lưới
    const chkGrid = document.getElementById('chk-grid-points');
    const alphaGrid = document.getElementById('alpha-grid-points');
    const valAlphaGrid = document.getElementById('val-alpha-grid');

    if (chkGrid) {
        chkGrid.addEventListener('change', (e) => {
            state.layerVisibility.gridPoints = e.target.checked;
            renderGridCentroidPoints();
        });
    }
    if (alphaGrid) {
        alphaGrid.addEventListener('input', (e) => {
            state.layerOpacities.gridPoints = parseFloat(e.target.value);
            if (valAlphaGrid) valAlphaGrid.innerText = Math.round(state.layerOpacities.gridPoints * 100) + '%';
            renderGridCentroidPoints();
        });
    }
}

function setupGEELayerControls() {
    // Các sự kiện của lớp dữ liệu đã được gắn trong setupUnifiedLayersControl() (tránh gắn trùng 2 lần)
}

// --- 14. Kiểm tra & Quản lý Kết nối Google Earth Engine ---
async function checkGEEConnection() {
    try {
        const res = await fetch('/api/gee/status');
        const data = await res.json();
        state.geeStatus = data;

        const badge = document.getElementById('gee-header-badge');
        const alertBox = document.getElementById('gee-modal-status');
        const projInput = document.getElementById('gee-project-input');

        if (data.project_id && data.project_id !== '(Mặc định)') {
            projInput.value = data.project_id;
        }

        const dropBadge = document.getElementById('gee-dropdown-badge');

        if (data.initialized) {
            if (badge) badge.innerHTML = '<span style="color: #4ade80; font-weight: 600;">GEE Live: Đã kết nối</span>';
            if (dropBadge) {
                dropBadge.innerText = 'Đã kết nối';
                dropBadge.style.color = '#16a34a';
                dropBadge.style.background = 'rgba(34, 197, 94, 0.15)';
            }
            if (alertBox) {
                alertBox.className = 'gee-modal-alert success';
                alertBox.innerHTML = `<strong><i class="fa-solid fa-circle-check"></i> Đã kết nối thành công với Google Earth Engine!</strong><br>Dự án: <code>${data.project_id}</code>. Lớp ảnh viễn thám 30m đang được truyền trực tiếp từ Google Cloud.`;
            }
        } else if (data.needs_project) {
            if (badge) badge.innerHTML = '<span style="color: #38bdf8; font-weight: 600;"><i class="fa-solid fa-key"></i> GEE: Cần Project ID</span>';
            if (dropBadge) {
                dropBadge.innerText = 'Cần Project';
                dropBadge.style.color = '#0284c7';
                dropBadge.style.background = 'rgba(2, 132, 199, 0.15)';
            }
            if (alertBox) {
                alertBox.className = 'gee-modal-alert warning';
                alertBox.innerHTML = `<strong><i class="fa-solid fa-circle-check" style="color: #16a34a;"></i> Tài khoản Google đã xác thực thành công!</strong><br>Để hoàn tất, Google Earth Engine yêu cầu bạn nhập <strong>Project ID</strong> (tên Cloud Project của bạn trên GEE Code Editor, ví dụ: <code>ee-tenban</code> hoặc mã project Cloud).`;
            }
        } else {
            if (badge) badge.innerHTML = '<span style="color: #facc15;">GEE: Chưa kết nối</span>';
            if (dropBadge) {
                dropBadge.innerText = 'Chưa kết nối';
                dropBadge.style.color = '#ca8a04';
                dropBadge.style.background = 'rgba(234, 179, 8, 0.15)';
            }
            if (alertBox) {
                alertBox.className = 'gee-modal-alert warning';
                alertBox.innerHTML = `<strong><i class="fa-solid fa-triangle-exclamation"></i> Chưa xác thực tài khoản Google Earth Engine.</strong><br>${data.error || 'Hệ thống đang hiển thị lớp ảnh viễn thám nội suy chuẩn GEE.'}`;
            }
        }
    } catch (err) {
        console.error('Lỗi khi kiểm tra kết nối GEE:', err);
    }
}

function setupGEEModal() {
    const modal = document.getElementById('gee-modal');
    const btnOpen = document.getElementById('btn-gee-modal');
    const btnClose = document.getElementById('btn-close-gee-modal');
    const btnCancel = document.getElementById('btn-cancel-gee');
    const btnSave = document.getElementById('btn-save-gee-project');
    const projInput = document.getElementById('gee-project-input');

    if (btnOpen) {
        btnOpen.addEventListener('click', () => {
            if (!state.auth.is_admin) {
                showToast('Chức năng Google Earth Engine (GEE) chỉ dành cho Quản trị viên (Admin). Vui lòng đăng nhập!');
                const loginModal = document.getElementById('login-modal');
                if (loginModal) loginModal.style.display = 'flex';
                return;
            }
            checkGEEConnection();
            if (modal) modal.style.display = 'flex';
        });
    }

    const closeModal = () => { if (modal) modal.style.display = 'none'; };
    if (btnClose) btnClose.addEventListener('click', closeModal);
    if (btnCancel) btnCancel.addEventListener('click', closeModal);

    if (btnSave && projInput) {
        btnSave.addEventListener('click', async () => {
            if (!state.auth.is_admin) {
                showToast('Chức năng yêu cầu quyền Quản trị viên (Admin)!');
                return;
            }
            const projectId = projInput.value.trim();
            btnSave.disabled = true;
            btnSave.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang kết nối...';

            try {
                const res = await fetch('/api/gee/set-project', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${state.auth.token}`
                    },
                    body: JSON.stringify({ project_id: projectId })
                });
                const result = await res.json();
                await checkGEEConnection();
                renderActiveRaster();
                showToast('Đã lưu cấu hình Google Earth Engine thành công!');
            } catch (e) {
                alert('Lỗi kết nối: ' + e.message);
            } finally {
                btnSave.disabled = false;
                btnSave.innerHTML = '<i class="fa-solid fa-link"></i> Lưu & Thử kết nối';
            }
        });
    }
}

// --- Hằng số & Hàm tiện ích xử lý thời gian linh hoạt (Theo ngày & Theo kỳ) ---
const START_DATE_STR = '2017-01-01';
const END_DATE_STR = '2027-12-31'; // Chặn tuyệt đối đến hết năm 2027, không nhảy qua 2028

function dateToDayIndex(dateStr) {
    if (!dateStr) return 0;
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = Date.UTC(y, m - 1, d);
    const [sy, sm, sd] = START_DATE_STR.split('-').map(Number);
    const sdt = Date.UTC(sy, sm - 1, sd);
    return Math.round((dt - sdt) / 86400000);
}

function dayIndexToDate(idx) {
    const [sy, sm, sd] = START_DATE_STR.split('-').map(Number);
    const dt = new Date(Date.UTC(sy, sm - 1, sd + idx));
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dt.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function addDays(dateStr, days) {
    const idx = dateToDayIndex(dateStr);
    return dayIndexToDate(idx + days);
}

// Lấy chuỗi ngày hiện tại của máy tính/trình duyệt người dùng (YYYY-MM-DD)
function getTodayDateStr() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function getTomorrowDateStr() {
    return addDays(getTodayDateStr(), 1);
}

function getDiffDaysFromToday(dateStr) {
    return dateToDayIndex(dateStr) - dateToDayIndex(getTodayDateStr());
}

// Thiết lập bước nhảy (1 Ngày vs 15 Ngày/Kỳ)
function setStepUnit(unit) {
    state.stepUnit = unit;
    const btnStepDay = document.getElementById('btn-step-day');
    const btnStepCycle = document.getElementById('btn-step-cycle');
    if (btnStepDay && btnStepCycle) {
        if (unit === 'day') {
            btnStepDay.classList.add('active');
            btnStepCycle.classList.remove('active');
        } else {
            btnStepCycle.classList.add('active');
            btnStepDay.classList.remove('active');
        }
    }
    updateButtonTooltips();
}

function updateButtonTooltips() {
    const btnPrev = document.getElementById('btn-toolbar-prev') || document.getElementById('btn-timeline-prev');
    const btnNext = document.getElementById('btn-toolbar-next') || document.getElementById('btn-timeline-next');
    const curr = state.currentDate || getTodayDateStr();
    const diff = getDiffDaysFromToday(curr);

    if (btnPrev) btnPrev.title = 'Lùi 1 ngày (-1 ngày)';
    if (btnNext) {
        btnNext.title = (diff === 0) ? 'Tiến 1 ngày (Xem Ngày mai)' : 'Tiến 1 ngày (+1 ngày)';
    }
}

// Thiết lập mốc ngày chính (hỗ trợ bất kỳ ngày nào do người dùng chọn hoặc tăng/giảm)
function setDate(targetDateStr) {
    if (!targetDateStr) return;
    if (targetDateStr < START_DATE_STR) targetDateStr = START_DATE_STR;
    if (targetDateStr > END_DATE_STR) targetDateStr = END_DATE_STR;

    state.currentDate = targetDateStr;

    // Cập nhật currentDateIndex nếu có trong state.dates, hoặc vị trí gần nhất
    let idx = state.dates.indexOf(targetDateStr);
    if (idx !== -1) {
        state.currentDateIndex = idx;
    } else {
        const found = state.dates.findIndex(d => d >= targetDateStr);
        state.currentDateIndex = found !== -1 ? found : state.dates.length - 1;
    }

    const year = targetDateStr.substring(0, 4);

    // Đồng bộ slider nếu có
    const slider = document.getElementById('timeline-range');
    if (slider) {
        slider.value = dateToDayIndex(targetDateStr);
    }

    // Danh sách kỳ trong ô chọn nhanh theo năm của mốc đang xem
    if (state.dateSelectYear !== year) populateDatesForYear(year);

    // Đồng bộ dropdown Mốc kỳ
    const dateSelect = document.getElementById('date-select');
    if (dateSelect) {
        dateSelect.value = targetDateStr;
        if (dateSelect.value !== targetDateStr) {
            let customOpt = document.getElementById('opt-custom-date');
            if (!customOpt) {
                customOpt = document.createElement('option');
                customOpt.id = 'opt-custom-date';
                dateSelect.appendChild(customOpt);
            }
            customOpt.value = targetDateStr;
            customOpt.text = cycleOptionLabel(targetDateStr, null);
            dateSelect.value = targetDateStr;
        }
    }

    // Đồng bộ ô chọn ngày Date Picker trên Toolbar
    const toolbarDatePicker = document.getElementById('toolbar-date-picker');
    if (toolbarDatePicker && toolbarDatePicker.value !== targetDateStr) {
        toolbarDatePicker.value = targetDateStr;
    }

    // Vô hiệu hóa nút tiến / lùi khi ở biên
    const btnPrev = document.getElementById('btn-toolbar-prev') || document.getElementById('btn-timeline-prev');
    const btnNext = document.getElementById('btn-toolbar-next') || document.getElementById('btn-timeline-next');
    if (btnPrev) btnPrev.disabled = (targetDateStr <= START_DATE_STR);
    if (btnNext) btnNext.disabled = (targetDateStr >= END_DATE_STR);

    updateButtonTooltips();
    loadDataForCurrentDate();
}

// Tương thích ngược với các lệnh gọi setTimelineIndex
function setTimelineIndex(index) {
    if (index < 0 || index >= state.dates.length) return;
    setDate(state.dates[index]);
}

// --- 15. Khởi tạo mốc thời gian và điều khiển Timeline (Hỗ trợ theo ngày & theo chu kỳ) ---
async function initTimeline() {
    try {
        const [datesRes, forecastRes] = await Promise.all([
            fetch('/api/dates'),
            fetch('/api/prediction/dates').catch(() => ({ ok: false, json: async () => [] }))
        ]);

        const dates = await datesRes.json();
        state.observedDates = [...dates].sort();
        let forecastDates = [];
        if (forecastRes.ok) {
            try {
                forecastDates = await forecastRes.json();
            } catch (e) {
                forecastDates = [];
            }
        }

        const todayStr = getTodayDateStr();
        if (!forecastDates.includes(todayStr) && todayStr <= END_DATE_STR) {
            forecastDates.push(todayStr);
        }

        // Lọc nghiêm ngặt: chỉ nhận các mốc đến hết 31/12/2027, tuyệt đối không nhảy qua 2028
        state.forecastDates = forecastDates.filter(d => d <= END_DATE_STR).sort();
        state.dates = [...new Set([...dates, ...state.forecastDates])].filter(d => d <= END_DATE_STR).sort();

        if (state.dates.length === 0) return;

        // Khởi tạo thanh trượt: theo đơn vị ngày từ START_DATE_STR đến END_DATE_STR
        const slider = document.getElementById('timeline-range');
        if (slider) {
            slider.min = 0;
            slider.max = dateToDayIndex(END_DATE_STR);
            slider.step = 1;
        }
        // Kích hoạt chế độ AI Realtime khi vào ngày hiện tại
        state.isAIMode = true;
        state.stepUnit = 'day'; // Mặc định bước nhảy là 1 ngày để tăng/giảm tự nhiên

        const targetYear = todayStr.substring(0, 4);
        populateDatesForYear(targetYear);

        // Nạp ngày ban đầu là Hôm nay
        setDate(todayStr);

        // Event listeners (an toàn với kiểm tra null)
        const dateSelect = document.getElementById('date-select');
        const toolbarDatePicker = document.getElementById('toolbar-date-picker');

        if (dateSelect) {
            dateSelect.addEventListener('change', (e) => {
                if (e.target.value) setDate(e.target.value);
            });
        }

        if (toolbarDatePicker) {
            toolbarDatePicker.addEventListener('change', (e) => {
                if (e.target.value) setDate(e.target.value);
            });
        }

        if (slider) {
            slider.addEventListener('input', (e) => {
                const chosenDate = dayIndexToDate(parseInt(e.target.value));
                setDate(chosenDate);
            });
        }

        // Nút Giảm / Tăng mốc thời gian trên Toolbar (hỗ trợ nhấp chuột và nhấn giữ để tua)
        const btnPrevDate = document.getElementById('btn-toolbar-prev') || document.getElementById('btn-timeline-prev');
        const btnNextDate = document.getElementById('btn-toolbar-next') || document.getElementById('btn-timeline-next');

        // Tiến / lùi theo đúng chu kỳ 15 ngày (Landsat 15-day cycle)
        const stepPrev = () => {
            if (!state.dates || state.dates.length === 0) return;
            const curr = state.currentDate || getTodayDateStr();
            let idx = state.dates.indexOf(curr);
            if (idx > 0) {
                setDate(state.dates[idx - 1]);
            } else if (idx === -1) {
                const prev = [...state.dates].reverse().find(d => d < curr);
                if (prev) setDate(prev);
            }
        };

        const stepNext = () => {
            if (!state.dates || state.dates.length === 0) return;
            const curr = state.currentDate || getTodayDateStr();
            let idx = state.dates.indexOf(curr);
            if (idx !== -1 && idx < state.dates.length - 1) {
                setDate(state.dates[idx + 1]);
            } else if (idx === -1) {
                const next = state.dates.find(d => d > curr);
                if (next) setDate(next);
            }
        };

        if (btnPrevDate) attachHoldRepeat(btnPrevDate, stepPrev);
        if (btnNextDate) attachHoldRepeat(btnNextDate, stepNext);

        // Nút tắt tiện ích: Hôm nay trên Toolbar
        const btnToolbarToday = document.getElementById('btn-toolbar-today');
        const goToday = () => setDate(getTodayDateStr());
        if (btnToolbarToday) btnToolbarToday.addEventListener('click', goToday);

    } catch (err) {
        console.error('Lỗi khởi tạo mốc thời gian:', err);
    }
}

// Hàm hỗ trợ nhấn giữ nút để tăng/giảm liên tục mượt mà
function attachHoldRepeat(button, action) {
    if (!button) return;
    let timer = null;
    let interval = null;
    let didRepeat = false;

    const start = (e) => {
        if (e.type === 'mousedown' && e.button !== 0) return;
        if (button.disabled) return;
        didRepeat = false;
        timer = setTimeout(() => {
            didRepeat = true;
            interval = setInterval(() => {
                if (button.disabled) {
                    stop();
                } else {
                    action();
                }
            }, 120);
        }, 350);
    };

    const stop = () => {
        if (timer) { clearTimeout(timer); timer = null; }
        if (interval) { clearInterval(interval); interval = null; }
    };

    button.addEventListener('mousedown', start);
    button.addEventListener('mouseup', stop);
    button.addEventListener('mouseleave', stop);

    button.addEventListener('touchstart', start, { passive: true });
    button.addEventListener('touchend', stop);
    button.addEventListener('touchcancel', stop);

    button.addEventListener('click', (e) => {
        e.preventDefault();
        if (didRepeat) {
            didRepeat = false;
            return;
        }
        action();
    });
}

// Nhãn ngắn của một mốc trong ô chọn kỳ (ngày đầy đủ đã hiện ở ô lịch bên cạnh)
function cycleOptionLabel(d, cycleNo) {
    const diff = getDiffDaysFromToday(d);
    if (diff === 0) return 'Hôm nay';
    if (diff === 1) return 'Ngày mai';
    const isFuture = state.forecastDates.includes(d) || d >= '2026-01-01';
    if (isFuture) return diff > 0 ? `Dự báo +${diff} ngày` : `Dự báo · ${d.substring(8, 10)}/${d.substring(5, 7)}`;
    return cycleNo ? `Kỳ ${cycleNo} · ${d.substring(8, 10)}/${d.substring(5, 7)}` : `Ngày ${d.substring(8, 10)}/${d.substring(5, 7)}`;
}

function populateDatesForYear(year) {
    const dateSelect = document.getElementById('date-select');
    if (!dateSelect) return;
    state.dateSelectYear = year;
    dateSelect.innerHTML = '';
    state.dates.filter(d => d.startsWith(year)).forEach((d, i) => {
        const opt = document.createElement('option');
        opt.value = d;
        opt.text = cycleOptionLabel(d, i + 1);
        dateSelect.appendChild(opt);
    });
}

function updateTimelineUI(dateStr, isFuture = false) {
    const sliderDateLabel = document.getElementById('slider-date-label');
    const btnCardToday = document.getElementById('btn-card-today');
    const statsDateBadge = document.getElementById('stats-date-badge');
    const toolbarDatePicker = document.getElementById('toolbar-date-picker');

    const diff = getDiffDaysFromToday(dateStr);
    const isToday = (diff === 0);
    const isTomorrow = (diff === 1);

    // Cập nhật trạng thái nút duy nhất [⚡ Hôm nay] trên thanh trượt
    if (btnCardToday) {
        if (isToday) {
            btnCardToday.classList.add('active');
            btnCardToday.title = 'Đang ở Hôm nay (Thời gian thực) - Nhấp để làm mới';
        } else {
            btnCardToday.classList.remove('active');
            btnCardToday.title = 'Nhấp để quay về Hôm nay (Thời gian thực)';
        }
    }

    // Đồng bộ nút chọn chế độ (Giám sát thực tế vs Dự báo AI)
    const btnModeMonitor = document.getElementById('btn-mode-monitor');
    const btnModeForecast = document.getElementById('btn-mode-forecast');
    if (btnModeMonitor && btnModeForecast) {
        if (isFuture || diff >= 0 || dateStr >= '2026-01-01') {
            btnModeForecast.classList.add('active');
            btnModeMonitor.classList.remove('active');
        } else {
            btnModeMonitor.classList.add('active');
            btnModeForecast.classList.remove('active');
        }
    }

    if (toolbarDatePicker && toolbarDatePicker.value !== dateStr) {
        toolbarDatePicker.value = dateStr;
    }

    const btnToolbarToday = document.getElementById('btn-toolbar-today');
    if (btnToolbarToday) {
        if (isToday) {
            btnToolbarToday.classList.add('active');
            btnToolbarToday.title = 'Đang ở Hôm nay (Thời gian thực)';
        } else {
            btnToolbarToday.classList.remove('active');
            btnToolbarToday.title = 'Nhấp để quay về Hôm nay (Thời gian thực)';
        }
    }

    let badgeHtml = '';
    let statusText = '';
    if (isToday) {
        badgeHtml = '<span class="pill-rf pill-realtime"><i class="fa-solid fa-bolt"></i> Hôm nay</span>';
        statusText = 'Thời gian thực (Realtime)';
    } else if (isTomorrow) {
        badgeHtml = '<span class="pill-rf pill-tomorrow"><i class="fa-solid fa-wand-magic-sparkles"></i> Ngày mai</span>';
        statusText = 'Dự báo ngày mai (+1 ngày)';
    } else if (diff > 1) {
        badgeHtml = `<span class="pill-rf pill-forecast"><i class="fa-solid fa-wand-magic-sparkles"></i> +${diff} ngày</span>`;
        statusText = `Dự báo AI (+${diff} ngày)`;
    } else if (diff === -1) {
        badgeHtml = '<span class="pill-rf pill-yesterday"><i class="fa-solid fa-clock-rotate-left"></i> Hôm qua</span>';
        statusText = 'Hôm qua (-1 ngày)';
    } else if (dateStr >= '2026-01-01') {
        badgeHtml = '<span class="pill-rf pill-forecast"><i class="fa-solid fa-wand-magic-sparkles"></i> Dự báo AI</span>';
        statusText = 'Dự báo AI 2026';
    } else {
        badgeHtml = '<span class="pill-rf pill-landsat"><i class="fa-solid fa-satellite"></i> Landsat</span>';
        statusText = 'Quan sát Landsat 8/9';
    }

    if (sliderDateLabel) {
        sliderDateLabel.innerText = dateStr;
    }

    if (statsDateBadge) {
        statsDateBadge.innerHTML = `${badgeHtml} <span>${dateStr}</span>`;
    }

    const miniTimelineLabel = document.getElementById('timeline-mini-label');
    if (miniTimelineLabel) {
        miniTimelineLabel.innerHTML = `${badgeHtml} <span>${dateStr}</span>`;
    }
}

// --- 16. Chuyển Tab & Chế độ Biểu đồ (Ô lưới / Toàn vùng & Dự báo 15 ngày / Lịch sử 2017–2025) ---
function setupChartTabs() {
    const tabCell = document.getElementById('tab-cell-chart');
    const tabOverall = document.getElementById('tab-overall-chart');

    if (tabCell) {
        tabCell.addEventListener('click', () => {
            tabCell.classList.add('active');
            if (tabOverall) tabOverall.classList.remove('active');
            state.chartTab = 'cell';
            loadChartData();
        });
    }

    if (tabOverall) {
        tabOverall.addEventListener('click', () => {
            tabOverall.classList.add('active');
            if (tabCell) tabCell.classList.remove('active');
            state.chartTab = 'overall';
            loadChartData();
        });
    }
}

function setupChartModes() {
    // '15days': dự báo 15 ngày | 'history': lịch sử 2017–2025 theo chỉ số đang chọn | 'compare': thực tế vs AI
    const modes = [
        { btn: document.getElementById('btn-mode-15days'), mode: '15days' },
        { btn: document.getElementById('btn-mode-history'), mode: 'history' },
        { btn: document.getElementById('btn-mode-compare'), mode: 'compare' },
    ].filter(m => m.btn);

    modes.forEach(m => {
        m.btn.addEventListener('click', () => {
            modes.forEach(o => o.btn.classList.toggle('active', o === m));
            state.chartMode = m.mode;
            loadChartData();
        });
    });
}

// --- 17. Khởi tạo Thông số & Tương tác Mô hình AI Random Forest ---
async function initAIMetrics() {
    try {
        const res = await fetch('/api/prediction/metrics');
        if (!res.ok) return;
        const data = await res.json();
        state.aiMetrics = data;

        // Cập nhật thông số ở Card 4 Sidebar
        const r2El = document.getElementById('rf-r2-val');
        const rmseEl = document.getElementById('rf-rmse-val');
        const maeEl = document.getElementById('rf-mae-val');

        const r2 = data.overall_metrics?.r2_score;
        const rmse = data.overall_metrics?.rmse;
        const mae = data.overall_metrics?.mae;

        if (r2El && r2 !== undefined) r2El.innerText = r2.toFixed(3);
        if (rmseEl && rmse !== undefined) rmseEl.innerText = rmse.toFixed(3);
        if (maeEl && mae !== undefined) maeEl.innerText = mae.toFixed(3);

        // Bản đồ giải nghĩa tên các biến đặc trưng đầu vào
        const featDescMap = {
            'lag1': 'Giá trị kỳ trước liền kề (15 ngày)',
            'cell_mean': 'TVDI trung bình nhiều năm của ô',
            'diff_lag': 'Biến thiên kỳ trước (lag1 - lag2)',
            'lag3': 'Giá trị 3 kỳ trước (45 ngày)',
            'lag24': 'Cùng kỳ năm ngoái (1 năm trước)',
            'month': 'Tháng quan sát trong năm (chu kỳ mùa)',
            'cos_period': 'Thành phần chu kỳ Cosine theo năm',
            'sin_period': 'Thành phần chu kỳ Sine theo năm',
            'lat': 'Vĩ độ không gian (Bắc - Nam)',
            'lon': 'Kinh độ không gian (Đông - Tây)',
            'rolling_mean3': 'Trung bình trượt 3 kỳ gần nhất',
            'lag2': 'Giá trị 2 kỳ trước (30 ngày)'
        };

        // Cập nhật Feature Importance trong AI Modal
        const featContainer = document.getElementById('ai-features-bar-list');
        if (featContainer && data.feature_importances) {
            featContainer.innerHTML = '';
            data.feature_importances.forEach(f => {
                const pct = f.importance_percent !== undefined ? f.importance_percent.toFixed(1) : (f.importance * 100).toFixed(1);
                const featName = f.feature || f.name;
                const desc = featDescMap[featName] || f.desc || featName;
                const row = document.createElement('div');
                row.className = 'ai-feat-row';
                row.style.marginBottom = '6px';
                row.innerHTML = `
                    <div style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 3px;">
                        <span><strong style="color: #1e293b;">${featName}</strong> <span style="color: #64748b;">(${desc})</span></span>
                        <span style="font-weight: 700; color: #8b5cf6;">${pct}%</span>
                    </div>
                    <div class="ai-feat-progress-bg">
                        <div class="ai-feat-progress-fill" style="width: ${pct}%;"></div>
                    </div>
                `;
                featContainer.appendChild(row);
            });
        }
    } catch (e) {
        console.warn('Lỗi khi tải thông số AI:', e);
    }
}

function setupAIControls() {
    // 1. Chuyển chế độ: Giám sát thực tế (2017–2025) vs Dự báo AI (Realtime & Tương lai)
    const btnMonitor = document.getElementById('btn-mode-monitor');
    const btnForecast = document.getElementById('btn-mode-forecast');

    if (btnForecast) {
        btnForecast.addEventListener('click', () => {
            state.isAIMode = true;
            btnForecast.classList.add('active');
            if (btnMonitor) btnMonitor.classList.remove('active');
            setStepUnit('day');
            setDate(getTodayDateStr());
        });
    }

    if (btnMonitor) {
        btnMonitor.addEventListener('click', () => {
            state.isAIMode = false;
            btnMonitor.classList.add('active');
            if (btnForecast) btnForecast.classList.remove('active');
            setStepUnit('cycle');

            // Nếu đang đứng ở mốc dự báo (>= 2026), chuyển về mốc quan sát thực tế gần nhất
            const currDate = state.currentDate || state.dates[state.currentDateIndex];
            if (state.forecastDates.includes(currDate) || currDate >= '2026-01-01') {
                const idx2025 = state.dates.findIndex(d => d.startsWith('2025-03'));
                if (idx2025 !== -1) setDate(state.dates[idx2025]);
                else setDate(state.dates[0]);
            }
        });
    }

    // 3. Modal thông số AI
    const modalAI = document.getElementById('ai-modal');
    const btnOpenAI = document.getElementById('btn-ai-modal');
    const btnCloseAI1 = document.getElementById('btn-close-ai-modal');
    const btnCloseAI2 = document.getElementById('btn-close-ai-modal-footer');

    if (btnOpenAI && modalAI) {
        btnOpenAI.addEventListener('click', () => {
            modalAI.style.display = 'flex';
        });
    }

    const closeAI = () => {
        if (modalAI) modalAI.style.display = 'none';
    };

    if (btnCloseAI1) btnCloseAI1.addEventListener('click', closeAI);
    if (btnCloseAI2) btnCloseAI2.addEventListener('click', closeAI);

    // Đóng popup khi bấm ra ngoài vùng mờ hoặc ấn phím Escape
    document.querySelectorAll('.modal-backdrop').forEach(modalEl => {
        modalEl.addEventListener('click', (e) => {
            if (e.target === modalEl) {
                modalEl.style.display = 'none';
            }
        });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal-backdrop').forEach(m => {
                if (m.style.display === 'flex' || m.style.display === 'block') {
                    m.style.display = 'none';
                }
            });
            const userMenu = document.getElementById('user-dropdown-menu');
            if (userMenu) userMenu.style.display = 'none';
            const btnUserProfile = document.getElementById('btn-user-profile');
            if (btnUserProfile) btnUserProfile.classList.remove('is-open');
        }
    });
}

// --- 18. Thiết lập các nút Thu gọn / Mở rộng cho Chú giải & Thanh trượt nổi ---
function setupCollapsibleWidgets() {
    // 1. Thu gọn / Mở rộng Chú giải bản đồ (Mặc định đóng, mở rộng dọc 8 cấp)
    const legendCard = document.getElementById('map-legend');
    const btnToggleLegend = document.getElementById('btn-toggle-legend');

    if (legendCard && btnToggleLegend) {
        // Thang màu luôn hiển thị; nút mũi tên mở / đóng bảng phân cấp chi tiết bên dưới
        const toggleLegend = () => {
            const expanded = !legendCard.classList.contains('is-expanded');
            legendCard.classList.toggle('is-expanded', expanded);
            btnToggleLegend.innerHTML = expanded
                ? '<i class="fa-solid fa-chevron-down"></i>'
                : '<i class="fa-solid fa-chevron-up"></i>';
            btnToggleLegend.title = expanded ? 'Thu gọn bảng phân cấp' : 'Xem bảng phân cấp chi tiết';
        };

        const legendHeader = legendCard.querySelector('.legend-header');
        if (legendHeader) {
            legendHeader.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleLegend();
            });
        }
    }

    // 2. Thu gọn / Mở rộng Thanh trượt thời gian nổi
    const timelineCard = document.getElementById('timeline-slider-card');
    const btnToggleTimeline = document.getElementById('btn-toggle-timeline');
    const miniTrigger = document.getElementById('timeline-mini-trigger');

    if (btnToggleTimeline && timelineCard) {
        btnToggleTimeline.addEventListener('click', (e) => {
            e.stopPropagation();
            timelineCard.classList.add('collapsed');
        });
    }

    if (miniTrigger && timelineCard) {
        miniTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            timelineCard.classList.remove('collapsed');
        });
    }
}

// --- 18b. Xuất báo cáo PDF A4 & Dữ liệu Excel CSV (Ý 1) ---
function exportToCSV() {
    if (!state.currentGridData || !state.currentGridData.features || state.currentGridData.features.length === 0) {
        alert('Chưa có dữ liệu không gian ô lưới cho mốc ngày hiện tại!');
        return;
    }

    const dateStr = state.currentDate || (state.dates && state.dates[state.currentDateIndex]) || getTodayDateStr();
    const rows = [];

    // Tiêu đề cột chuẩn nghiệp vụ GIS & Viễn thám
    rows.push([
        'Mã ô lưới (Cell ID)',
        'Kinh độ (Longitude)',
        'Vĩ độ (Latitude)',
        'Chỉ số TVDI [0-1]',
        'Nhiệt độ bề mặt LST (°C)',
        'Chỉ số thực vật NDVI',
        'Phân cấp hạn',
        'Tên cấp độ hạn hán',
        'Mô tả diễn giải'
    ]);

    state.currentGridData.features.forEach((f, idx) => {
        const p = f.properties || {};
        const cellId = p.cell_id !== undefined ? p.cell_id : (p.id !== undefined ? p.id : `CELL_${idx + 1}`);
        const lon = (p.lon !== undefined && p.lon !== null) ? Number(p.lon).toFixed(5) : '';
        const lat = (p.lat !== undefined && p.lat !== null) ? Number(p.lat).toFixed(5) : '';

        const rawTvdi = (p.tvdi !== undefined && p.tvdi !== null && !isNaN(p.tvdi))
            ? p.tvdi
            : ((p.tvdi_pred !== undefined && p.tvdi_pred !== null && !isNaN(p.tvdi_pred)) ? p.tvdi_pred : null);

        const tvdiStr = rawTvdi !== null ? Number(rawTvdi).toFixed(4) : '';
        const lstStr = (p.lst_c !== undefined && p.lst_c !== null && !isNaN(p.lst_c)) ? Number(p.lst_c).toFixed(2) : '';
        const ndviStr = (p.ndvi !== undefined && p.ndvi !== null && !isNaN(p.ndvi)) ? Number(p.ndvi).toFixed(3) : '';

        const theme = getDroughtUITheme(rawTvdi);
        const levelCode = theme.levelCode;
        const label = `"${(theme.label || '').replace(/"/g, '""')}"`;
        const desc = `"${(theme.desc || '').replace(/"/g, '""')}"`;

        rows.push([
            cellId,
            lon,
            lat,
            tvdiStr,
            lstStr,
            ndviStr,
            levelCode,
            label,
            desc
        ]);
    });

    const bom = '\uFEFF';
    const csvContent = bom + rows.map(r => r.join(',')).join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Bao_cao_Du_lieu_TVDI_TPHCM_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function generateReportPaper() {
    const reportPaper = document.getElementById('report-paper');
    if (!reportPaper) return;

    const dateStr = state.currentDate || (state.dates && state.dates[state.currentDateIndex]) || getTodayDateStr();
    const todayStr = getTodayDateStr();
    const isFuture = state.forecastDates.includes(dateStr) || dateStr >= '2026-01-01' || dateStr >= todayStr;

    // Ngày tháng tiếng Việt trang trọng
    const now = new Date();
    const repDay = String(now.getDate()).padStart(2, '0');
    const repMonth = String(now.getMonth() + 1).padStart(2, '0');
    const repYear = now.getFullYear();

    const modeTitle = isFuture ? 'Dự báo chuỗi thời gian AI (Mô hình Random Forest)' : 'Dữ liệu vệ tinh viễn thám thực tế Landsat 8/9';

    // 8 cấp độ khô hạn
    const classDefs = [
        { level: 1, label: 'Rất ẩm / Ngập nước', range: '≤ 0.125', color: '#066b00', risk: 'Nguy cơ ngập úng cao, thực bì bão hòa' },
        { level: 2, label: 'Ẩm ướt', range: '0.125 – 0.250', color: '#0bc400', risk: 'An toàn, sinh trưởng lý tưởng' },
        { level: 3, label: 'Đủ ẩm, phát triển tốt', range: '0.250 – 0.375', color: '#0ce100', risk: 'Bình thường, điều kiện tốt' },
        { level: 4, label: 'Bình thường', range: '0.375 – 0.500', color: '#00ff00', risk: 'Ổn định, duy trì quan trắc định kỳ' },
        { level: 5, label: 'Bắt đầu khô hạn nhẹ', range: '0.500 – 0.625', color: '#ffff00', risk: 'Cảnh báo cấp 1: Chớm thiếu ẩm' },
        { level: 6, label: 'Hạn vừa', range: '0.625 – 0.750', color: '#ffcc00', risk: 'Cảnh báo cấp 2: Hạn hán vừa, thực bì héo nhẹ' },
        { level: 7, label: 'Hạn nặng', range: '0.750 – 0.875', color: '#ff6600', risk: 'Báo động cấp 3: Nguy cơ cháy rừng cao' },
        { level: 8, label: 'Hạn gay gắt / Khô khốc', range: '> 0.875', color: '#ff0000', risk: 'Báo động khẩn cấp: Đất kiệt nước nghiêm trọng' }
    ];

    const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 };
    let validCells = 0;
    let sumTvdi = 0;
    let maxTvdi = -Infinity;
    let minTvdi = Infinity;
    let maxCell = null;
    let minCell = null;
    let droughtCellCount = 0;

    let sumLst = 0, validLstCount = 0;
    let sumNdvi = 0, validNdviCount = 0;

    if (state.currentGridData && state.currentGridData.features && state.currentGridData.features.length > 0) {
        state.currentGridData.features.forEach(f => {
            const p = f.properties || {};
            const val = (p.tvdi !== null && p.tvdi !== undefined && !isNaN(p.tvdi))
                ? p.tvdi
                : ((p.tvdi_pred !== null && p.tvdi_pred !== undefined && !isNaN(p.tvdi_pred)) ? p.tvdi_pred : null);

            if (val !== null) {
                validCells++;
                sumTvdi += val;
                if (val > maxTvdi) {
                    maxTvdi = val;
                    maxCell = p;
                }
                if (val < minTvdi) {
                    minTvdi = val;
                    minCell = p;
                }
                const theme = getDroughtUITheme(val);
                if (counts[theme.level] !== undefined) counts[theme.level]++;
                if (val >= 0.625) droughtCellCount++;
            }

            if (p.lst_c !== undefined && p.lst_c !== null && !isNaN(p.lst_c)) {
                sumLst += Number(p.lst_c);
                validLstCount++;
            }
            if (p.ndvi !== undefined && p.ndvi !== null && !isNaN(p.ndvi)) {
                sumNdvi += Number(p.ndvi);
                validNdviCount++;
            }
        });
    }

    const totalActive = validCells || 272;
    const avgTvdi = validCells > 0 ? (sumTvdi / validCells).toFixed(3) : '--';
    const maxTvdiStr = maxTvdi !== -Infinity ? maxTvdi.toFixed(3) : '--';
    const minTvdiStr = minTvdi !== Infinity ? minTvdi.toFixed(3) : '--';
    const droughtPct = validCells > 0 ? ((droughtCellCount / validCells) * 100).toFixed(1) : '0.0';
    const avgLstStr = validLstCount > 0 ? (sumLst / validLstCount).toFixed(1) + ' °C' : 'Chưa có dữ liệu';
    const avgNdviStr = validNdviCount > 0 ? (sumNdvi / validNdviCount).toFixed(3) : 'Chưa có dữ liệu';

    // Đánh giá tổng thể
    let overallEval = 'Bình thường';
    if (avgTvdi !== '--') {
        const avgNum = parseFloat(avgTvdi);
        overallEval = getDroughtUITheme(avgNum).label;
    }

    // Khuyến nghị tự động hóa thông minh
    let recomHtml = '';
    const droughtNum = parseFloat(droughtPct) || 0;
    if (droughtNum >= 30) {
        recomHtml = `
            <div class="rep-recom-box" style="border-left-color: #dc2626; background: #fef2f2; color: #991b1b;">
                <div style="font-weight: 700; margin-bottom: 6px;"><i class="fa-solid fa-triangle-exclamation"></i> MỨC ĐỘ NGUY CƠ: BÁO ĐỘNG HẠN HÁN DIỆN RỘNG (CẤP ĐỘ III - KHẨN CẤP)</div>
                <p style="margin: 0 0 6px 0;">1. <strong>Tài nguyên nước & Nông nghiệp:</strong> Diện tích khô hạn nghiêm trọng chiếm <strong>${droughtPct}%</strong> tổng địa bàn TP.HCM (${droughtCellCount} ô lưới). Khẩn trương kích hoạt phương án tưới tiết kiệm, ưu tiên cấp nước cho vùng chuyên canh lúa, rau hoa màu tại Củ Chi, Hóc Môn, Bình Chánh.</p>
                <p style="margin: 0 0 6px 0;">2. <strong>Phòng chống cháy rừng (PCCC):</strong> Nâng cấp báo động cháy rừng tại Ban Quản lý Rừng phòng hộ Cần Giờ lên <strong>Cấp IV – Cấp V (Cực kỳ nguy hiểm)</strong>. Nghiêm cấm mọi hành vi sử dụng lửa trong và ven rừng, duy trì tuần tra tháp canh 24/24.</p>
                <p style="margin: 0;">3. <strong>Môi trường & Cấp nước sinh hoạt:</strong> Theo dõi chặt chẽ ranh mặn 4‰ trên sông Sài Gòn và Đồng Nai nhằm điều tiết lịch lấy nước cho các nhà máy nước mặt TP.HCM.</p>
            </div>
        `;
    } else if (droughtNum >= 10) {
        recomHtml = `
            <div class="rep-recom-box" style="border-left-color: #f59e0b; background: #fffbeb; color: #92400e;">
                <div style="font-weight: 700; margin-bottom: 6px;"><i class="fa-solid fa-triangle-exclamation"></i> MỨC ĐỘ NGUY CƠ: CẢNH BÁO KHÔ HẠN CỤC BỘ (CẤP ĐỘ II - TRUNG BÌNH)</div>
                <p style="margin: 0 0 6px 0;">1. <strong>Tài nguyên nước:</strong> Có <strong>${droughtPct}%</strong> diện tích đạt ngưỡng khô hạn (TVDI ≥ 0.625). Đề nghị các trạm thủy nông cơ sở đo đạc độ ẩm tầng đất mặt và kiểm tra hệ thống cống ngăn triều kết hợp giữ ngọt.</p>
                <p style="margin: 0 0 6px 0;">2. <strong>Cảnh báo PCCC rừng:</strong> Duy trì mức cảnh báo cháy rừng ở <strong>Cấp III (Mức độ cao)</strong> tại các dải rừng tràm, đước có lớp thảm mục khô dày.</p>
                <p style="margin: 0;">3. <strong>Dự báo định kỳ:</strong> Tiếp tục đối soát chu kỳ dự báo 15 ngày tiếp theo từ mô hình AI để chuẩn bị phương án điều tiết nước hồ Dầu Tiếng.</p>
            </div>
        `;
    } else {
        recomHtml = `
            <div class="rep-recom-box" style="border-left-color: #16a34a; background: #f0fdf4; color: #166534;">
                <div style="font-weight: 700; margin-bottom: 6px;"><i class="fa-solid fa-circle-check"></i> MỨC ĐỘ NGUY CƠ: AN TOÀN – ĐỦ ẨM (CẤP ĐỘ I - BÌNH THƯỜNG)</div>
                <p style="margin: 0 0 6px 0;">1. <strong>Hiện trạng:</strong> Độ ẩm đất và thực vật trên toàn địa bàn TP. Hồ Chí Minh duy trì mức độ ổn định (TVDI trung bình = <strong>${avgTvdi}</strong>, tỷ lệ khô hạn chỉ <strong>${droughtPct}%</strong>).</p>
                <p style="margin: 0 0 6px 0;">2. <strong>Giám sát:</strong> Tiếp tục thu thập chuỗi dữ liệu ảnh viễn thám Landsat 8/9 và cập nhật kết quả dự báo AI chu kỳ 15 ngày định kỳ.</p>
                <p style="margin: 0;">3. <strong>Vận hành hồ đập:</strong> Duy trì quy trình tích trữ và xả nước thông thường của mùa khô.</p>
            </div>
        `;
    }

    // Bảng chuỗi thời gian gần nhất
    let seriesSectionHtml = '';
    if (state.currentSeriesData && state.currentSeriesData.length > 0) {
        const recentSeries = state.currentSeriesData.slice(-6);
        const seriesRows = recentSeries.map(s => {
            const sVal = s.tvdi_pred !== undefined ? s.tvdi_pred : (s.tvdi_actual !== undefined ? s.tvdi_actual : s.tvdi);
            const sTheme = getDroughtUITheme(sVal);
            const valFormatted = (sVal !== null && sVal !== undefined) ? Number(sVal).toFixed(3) : '--';
            return `
                <tr>
                    <td class="center"><strong>${s.date}</strong></td>
                    <td class="center">${s.is_future || s.tvdi_pred !== undefined ? 'AI Dự báo' : 'Vệ tinh Landsat'}</td>
                    <td class="center" style="font-weight: 700; color: ${sTheme.scoreColor};">${valFormatted}</td>
                    <td class="center"><span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: ${sTheme.barColor}; margin-right: 5px;"></span>${sTheme.levelCode}</td>
                    <td>${sTheme.label}</td>
                </tr>
            `;
        }).join('');

        seriesSectionHtml = `
            <div class="rep-section">
                <div class="rep-sec-title">IV. Diễn biến chuỗi thời gian & Xu hướng dự báo gần nhất</div>
                <table class="rep-table">
                    <thead>
                        <tr>
                            <th style="width: 18%;">Mốc quan sát</th>
                            <th style="width: 22%;">Phương thức đo đạc</th>
                            <th style="width: 18%;">Chỉ số TVDI</th>
                            <th style="width: 16%;">Phân cấp</th>
                            <th>Diễn giải trạng thái</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${seriesRows}
                    </tbody>
                </table>
            </div>
        `;
    }

    reportPaper.innerHTML = `
        <!-- Quốc hiệu & Tiêu ngữ -->
        <div class="rep-top-header">
            <div class="rep-unit">
                ỦY BAN NHÂN DÂN THÀNH PHỐ HỒ CHÍ MINH<br>
                <strong>SỞ TÀI NGUYÊN VÀ MÔI TRƯỜNG</strong><br>
                TRUNG TÂM VIỄN THÁM & HỆ THỐNG THÔNG TIN ĐỊA LÝ
            </div>
            <div class="rep-motto">
                <strong>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</strong><br>
                <strong>Độc lập – Tự do – Hạnh phúc</strong><br>
                <em>TP. Hồ Chí Minh, ngày ${repDay} tháng ${repMonth} năm ${repYear}</em>
            </div>
        </div>

        <!-- Tiêu đề báo cáo -->
        <div class="rep-title-group">
            <h2>BÁO CÁO GIÁM SÁT & DỰ BÁO CHỈ SỐ KHÔ HẠN TVDI</h2>
            <div style="font-size: 0.95rem; font-weight: 700; color: #1e3a8a; margin-top: 4px;">
                ĐỊA BÀN: THÀNH PHỐ HỒ CHÍ MINH
            </div>
            <div class="rep-title-date">
                (Kỳ quan sát: <strong>${dateStr}</strong> | Nguồn dữ liệu: <strong>${modeTitle}</strong>)
            </div>
        </div>

        <!-- Phần I: Thông tin chung -->
        <div class="rep-section">
            <div class="rep-sec-title">I. Thông tin chung & Căn cứ kỹ thuật</div>
            <div class="rep-grid-info">
                <div class="rep-info-item">
                    <strong>Khu vực nghiên cứu:</strong> Toàn bộ ranh giới hành chính TP. Hồ Chí Minh
                </div>
                <div class="rep-info-item">
                    <strong>Hệ tọa độ & Chiếu:</strong> WGS 84 / UTM Zone 48N (EPSG: 4326/32648)
                </div>
                <div class="rep-info-item">
                    <strong>Độ phân giải không gian:</strong> Lưới ô vuông đồng đều kích thước 5.0 km × 5.0 km
                </div>
                <div class="rep-info-item">
                    <strong>Tổng số ô lưới phân tích:</strong> 289 ô (${totalActive} ô đất liền hoạt động)
                </div>
                <div class="rep-info-item">
                    <strong>Nguồn dữ liệu đầu vào:</strong> Vệ tinh Landsat 8/9 OLI/TIRS (Kênh B4, B5, B10)
                </div>
                <div class="rep-info-item">
                    <strong>Mô hình toán & AI:</strong> Không gian nhiệt độ – thực vật (Ts/NDVI) & Machine Learning Random Forest
                </div>
            </div>
        </div>

        <!-- Phần II: Các chỉ số thống kê khô hạn trọng yếu -->
        <div class="rep-section">
            <div class="rep-sec-title">II. Tổng hợp các chỉ số khô hạn toàn vùng (Kỳ ${dateStr})</div>
            <table class="rep-table">
                <thead>
                    <tr>
                        <th style="width: 32%;">Tên chỉ số</th>
                        <th style="width: 22%;">Giá trị thống kê</th>
                        <th style="width: 18%;">Đơn vị tính</th>
                        <th>Đánh giá kỹ thuật</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><strong>TVDI Trung bình toàn vùng (Average)</strong></td>
                        <td class="center" style="font-size: 1rem; font-weight: 800; color: #2563eb;">${avgTvdi}</td>
                        <td class="center">[ 0.0 – 1.0 ]</td>
                        <td>Đánh giá tổng thể: <strong>${overallEval}</strong></td>
                    </tr>
                    <tr>
                        <td><strong>TVDI Cực đại (Điểm khô hạn nhất)</strong></td>
                        <td class="center" style="font-weight: 700; color: #dc2626;">${maxTvdiStr}</td>
                        <td class="center">[ 0.0 – 1.0 ]</td>
                        <td>${maxCell ? `Ô lưới ID ${maxCell.cell_id || ''} (${Number(maxCell.lat).toFixed(4)}°N, ${Number(maxCell.lon).toFixed(4)}°E)` : 'Điểm khô nhất trên lưới'}</td>
                    </tr>
                    <tr>
                        <td><strong>TVDI Cực tiểu (Điểm ẩm nhất)</strong></td>
                        <td class="center" style="font-weight: 700; color: #16a34a;">${minTvdiStr}</td>
                        <td class="center">[ 0.0 – 1.0 ]</td>
                        <td>${minCell ? `Ô lưới ID ${minCell.cell_id || ''} (${Number(minCell.lat).toFixed(4)}°N, ${Number(minCell.lon).toFixed(4)}°E)` : 'Điểm ẩm nhất trên lưới'}</td>
                    </tr>
                    <tr>
                        <td><strong>Tỷ lệ diện tích hạn hán (TVDI ≥ 0.625)</strong></td>
                        <td class="center" style="font-weight: 800; color: ${droughtNum >= 20 ? '#dc2626' : '#ea580c'};">${droughtPct}%</td>
                        <td class="center">% diện tích</td>
                        <td>Tổng cộng <strong>${droughtCellCount}</strong> ô lưới thuộc cấp hạn vừa, hạn nặng và khô khốc</td>
                    </tr>
                    <tr>
                        <td><strong>Nhiệt độ bề mặt đất LST trung bình</strong></td>
                        <td class="center" style="font-weight: 700; color: #b45309;">${avgLstStr}</td>
                        <td class="center">Độ C (°C)</td>
                        <td>Nhiệt độ phát xạ viễn thám từ kênh hồng ngoại nhiệt TIRS</td>
                    </tr>
                    <tr>
                        <td><strong>Chỉ số thực vật NDVI trung bình</strong></td>
                        <td class="center" style="font-weight: 700; color: #15803d;">${avgNdviStr}</td>
                        <td class="center">[ -1.0 – 1.0 ]</td>
                        <td>Mật độ và sức khỏe sinh khối thực bì bao phủ bề mặt</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <!-- Phần III: Bảng phân cấp 8 cấp độ hạn hán -->
        <div class="rep-section">
            <div class="rep-sec-title">III. Phân bố diện tích theo 8 cấp độ khô hạn chuẩn TVDI</div>
            <table class="rep-table">
                <thead>
                    <tr>
                        <th style="width: 10%;">Cấp độ</th>
                        <th style="width: 14%;">Khoảng TVDI</th>
                        <th style="width: 25%;">Tên cấp độ hạn</th>
                        <th style="width: 13%;">Số ô lưới</th>
                        <th style="width: 14%;">Tỷ lệ (%)</th>
                        <th>Mức độ rủi ro & Cảnh báo</th>
                    </tr>
                </thead>
                <tbody>
                    ${classDefs.map(c => {
        const cnt = counts[c.level] || 0;
        const pct = totalActive > 0 ? ((cnt / totalActive) * 100).toFixed(1) : '0.0';
        return `
                            <tr>
                                <td class="center"><span style="display:inline-block; width:12px; height:12px; border-radius:2px; background:${c.color}; vertical-align:middle; margin-right:4px;"></span><strong>CẤP ${c.level}</strong></td>
                                <td class="center"><code>${c.range}</code></td>
                                <td><strong>${c.label}</strong></td>
                                <td class="center">${cnt} ô</td>
                                <td class="center" style="font-weight: 700;">${pct}%</td>
                                <td style="font-size: 0.8rem;">${c.risk}</td>
                            </tr>
                        `;
    }).join('')}
                </tbody>
            </table>
        </div>

        <!-- Phần IV: Diễn biến chuỗi thời gian nếu có -->
        ${seriesSectionHtml}

        <!-- Phần V: Đánh giá nguy cơ & Khuyến nghị quản lý -->
        <div class="rep-section">
            <div class="rep-sec-title">V. Đánh giá nguy cơ & Khuyến nghị quản lý tài nguyên</div>
            ${recomHtml}
        </div>

        <!-- Phần VI: Chữ ký phê duyệt -->
        <div class="rep-signatures">
            <div class="rep-sig-col">
                <div class="sig-title">
                    NGƯỜI LẬP BÁO CÁO<br>
                    <em>(Ký, ghi rõ họ tên)</em>
                </div>
                <div class="sig-name">Kỹ sư Hệ thống GIS & Viễn thám</div>
            </div>
            <div class="rep-sig-col">
                <div class="sig-title">
                    GIÁM ĐỐC TRUNG TÂM<br>
                    <em>(Ký tên, đóng dấu)</em>
                </div>
                <div class="sig-name">Lãnh đạo đơn vị phê duyệt</div>
            </div>
        </div>
    `;
}

function setupReportModal() {
    const btnOpen = document.getElementById('btn-open-report');
    const modal = document.getElementById('report-modal');
    const btnClose = document.getElementById('btn-close-report-modal');
    const btnCloseFooter = document.getElementById('btn-close-report-footer');
    const btnPrint = document.getElementById('btn-print-report');
    const btnExcel = document.getElementById('btn-export-excel');

    if (!btnOpen || !modal) return;

    btnOpen.addEventListener('click', async () => {
        const isLoggedIn = !!state.auth.token && (state.auth.role === 'admin' || state.auth.role === 'user');
        if (!isLoggedIn) {
            showToast('Bạn phải đăng nhập để sử dụng dịch vụ này!');
            const loginModal = document.getElementById('login-modal');
            if (loginModal) {
                loginModal.style.display = 'flex';
                const loginAlert = document.getElementById('login-alert');
                if (loginAlert) {
                    loginAlert.style.display = 'block';
                    loginAlert.className = 'gee-modal-alert warning';
                    loginAlert.innerHTML = '<i class="fa-solid fa-lock"></i> Bạn phải đăng nhập để sử dụng dịch vụ Xuất báo cáo!';
                }
                const loginUname = document.getElementById('login-username');
                if (loginUname) loginUname.focus();
            }
            return;
        }

        if (!state.currentGridData) {
            await loadDataForCurrentDate();
        }
        generateReportPaper();
        modal.style.display = 'flex';
    });

    const closeModal = () => {
        modal.style.display = 'none';
    };

    if (btnClose) btnClose.addEventListener('click', closeModal);
    if (btnCloseFooter) btnCloseFooter.addEventListener('click', closeModal);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    if (btnPrint) {
        btnPrint.addEventListener('click', () => {
            const isLoggedIn = !!state.auth.token && (state.auth.role === 'admin' || state.auth.role === 'user');
            if (!isLoggedIn) {
                showToast('Bạn phải đăng nhập để sử dụng dịch vụ này!');
                modal.style.display = 'none';
                const loginModal = document.getElementById('login-modal');
                if (loginModal) loginModal.style.display = 'flex';
                return;
            }
            window.print();
        });
    }

    if (btnExcel) {
        btnExcel.addEventListener('click', () => {
            const isLoggedIn = !!state.auth.token && (state.auth.role === 'admin' || state.auth.role === 'user');
            if (!isLoggedIn) {
                showToast('Bạn phải đăng nhập để sử dụng dịch vụ này!');
                modal.style.display = 'none';
                const loginModal = document.getElementById('login-modal');
                if (loginModal) loginModal.style.display = 'flex';
                return;
            }
            exportToCSV();
        });
    }

    const btnGeoJson = document.getElementById('btn-export-geojson');
    if (btnGeoJson) {
        btnGeoJson.addEventListener('click', () => {
            const isLoggedIn = !!state.auth.token && (state.auth.role === 'admin' || state.auth.role === 'user');
            if (!isLoggedIn) {
                showToast('Bạn phải đăng nhập để sử dụng dịch vụ này!');
                modal.style.display = 'none';
                const loginModal = document.getElementById('login-modal');
                if (loginModal) loginModal.style.display = 'flex';
                return;
            }
            exportToGeoJSON();
        });
    }
}

// Xuất lưới dữ liệu đang hiển thị ra GeoJSON (EPSG:4326) – mở trực tiếp được trong QGIS / ArcGIS
function exportToGeoJSON() {
    if (!state.currentGridData || !state.currentGridData.features || state.currentGridData.features.length === 0) {
        showToast('Chưa có dữ liệu không gian ô lưới cho mốc thời gian hiện tại!');
        return;
    }
    const view = state.currentView || {};
    const features = state.currentGridData.features
        .filter(f => f.geometry)
        .map(f => {
            const p = f.properties || {};
            const tvdi = getIndexValue(p, 'tvdi');
            const theme = getDroughtUITheme(tvdi);
            return {
                type: 'Feature',
                geometry: f.geometry,
                properties: {
                    cell_id: p.cell_id,
                    lon: p.lon,
                    lat: p.lat,
                    lst_c: getIndexValue(p, 'lst'),
                    ndvi: getIndexValue(p, 'ndvi'),
                    tvdi: tvdi,
                    drought_level: theme.level,
                    drought_label: theme.label,
                },
            };
        });
    const fc = {
        type: 'FeatureCollection',
        name: 'TVDI_TPHCM_grid',
        metadata: {
            description: describeCurrentView(false),
            source: view.kind === 'forecast' ? 'Dự báo AI Random Forest' : 'Landsat 8/9 C2 L2 – Google Earth Engine',
            crs: 'EPSG:4326',
            exported_at: new Date().toISOString(),
        },
        features,
    };
    const label = removeVietnameseTones(describeCurrentView(true)).replace(/[^0-9A-Za-z_-]+/g, '_');
    downloadTextFile(`Luoi_TVDI_TPHCM_${label}.geojson`, JSON.stringify(fc), 'application/geo+json');
    logUserAction('Xuất GeoJSON', `Xuất ${features.length} ô lưới (${describeCurrentView(true)})`);
}

// --- 18c. Tương tác vuốt mở Bottom Sheet trên Mobile (Ý 3) ---
function setupMobileSheet() {
    const sidebar = document.getElementById('app-sidebar');
    const fab = document.getElementById('fab-mobile-sheet');
    const handle = document.getElementById('mobile-sheet-handle');
    const toggleBtn = document.getElementById('btn-mobile-sidebar-toggle');
    if (!sidebar) return;

    function toggleSheet() {
        sidebar.classList.toggle('mobile-expanded');
        const isExp = sidebar.classList.contains('mobile-expanded');
        if (fab) {
            fab.innerHTML = isExp
                ? '<i class="fa-solid fa-map"></i> <span>Xem bản đồ</span>'
                : '<i class="fa-solid fa-chart-pie"></i> <span>Xem phân tích</span>';
        }
    }

    if (fab) fab.addEventListener('click', toggleSheet);
    if (handle) handle.addEventListener('click', toggleSheet);
    if (toggleBtn) toggleBtn.addEventListener('click', toggleSheet);

    // Khi nhấp vào bản đồ ở màn hình di động, đóng bottom sheet nếu đang mở
    const mapForMobile = state.map || map;
    if (mapForMobile) {
        mapForMobile.on('click', () => {
            if (window.innerWidth <= 768 && sidebar.classList.contains('mobile-expanded')) {
                sidebar.classList.remove('mobile-expanded');
                if (fab) {
                    fab.innerHTML = '<i class="fa-solid fa-chart-pie"></i> <span>Xem phân tích</span>';
                }
            }
        });
    }
}

// --- 18d. Thông báo Toast nổi ---
function showToast(message, duration = 3500) {
    let toast = document.getElementById('app-toast');
    if (!toast) return;
    toast.innerHTML = `<i class="fa-solid fa-circle-info" style="color: #38bdf8;"></i> <span>${message}</span>`;
    toast.style.display = 'flex';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
        toast.style.display = 'none';
    }, duration);
}

// --- 18d-2. Ghi nhận hành vi người dùng (Audit Log) ---
function logUserAction(action, details = '') {
    if (!state.auth || state.auth.role === 'guest' || !state.auth.token) return;
    try {
        fetch('/api/auth/log-activity', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${state.auth.token}`
            },
            body: JSON.stringify({ action, details })
        }).catch(() => { });
    } catch (e) { }
}

// --- 18e. Phân quyền & Quản lý Tài khoản (Admin vs User - Yêu cầu 7) ---
function setupAuth() {
    const userMenuWrapper = document.getElementById('user-menu-wrapper');
    const btnUserProfile = document.getElementById('btn-user-profile');
    const userDropdownMenu = document.getElementById('user-dropdown-menu');
    const userDropdownName = document.getElementById('user-dropdown-name');
    const userDropdownRole = document.getElementById('user-dropdown-role');
    const userDropdownAvatar = document.getElementById('user-dropdown-avatar');
    const adminDropdownTools = document.getElementById('admin-dropdown-tools');
    const btnDropdownLogout = document.getElementById('btn-dropdown-logout');
    const headerUserName = document.getElementById('header-user-name');

    const badgeRoleText = document.getElementById('badge-role-text');
    const btnAuth = document.getElementById('btn-auth-action');
    const authBtnLabel = document.getElementById('auth-btn-label');
    const authIcon = document.getElementById('auth-icon');
    const btnRegister = document.getElementById('btn-auth-register');

    // Login Modal elements
    const loginModal = document.getElementById('login-modal');
    const btnCloseLogin = document.getElementById('btn-close-login-modal');
    const btnCancelLogin = document.getElementById('btn-cancel-login');
    const btnSubmitLogin = document.getElementById('btn-submit-login');
    const linkToRegister = document.getElementById('link-to-register');
    const loginUname = document.getElementById('login-username');
    const loginPass = document.getElementById('login-password');
    const loginAlert = document.getElementById('login-alert');

    // Register Modal elements
    const registerModal = document.getElementById('register-modal');
    const btnCloseRegister = document.getElementById('btn-close-register-modal');
    const btnCancelRegister = document.getElementById('btn-cancel-register');
    const btnSubmitRegister = document.getElementById('btn-submit-register');
    const linkToLogin = document.getElementById('link-to-login');
    const regUsername = document.getElementById('reg-username');
    const regFullname = document.getElementById('reg-fullname');
    const regPassword = document.getElementById('reg-password');
    const regConfirm = document.getElementById('reg-confirm-password');
    const registerAlert = document.getElementById('register-alert');

    // Change Password Modal elements
    const changePwdModal = document.getElementById('change-pwd-modal');
    const btnOpenChangePwd = document.getElementById('btn-open-change-pwd');
    const btnCloseChangePwd = document.getElementById('btn-close-change-pwd-modal');
    const btnCancelChangePwd = document.getElementById('btn-cancel-change-pwd');
    const btnSubmitChangePwd = document.getElementById('btn-submit-change-pwd');
    const pwdOld = document.getElementById('pwd-old');
    const pwdNew = document.getElementById('pwd-new');
    const pwdConfirm = document.getElementById('pwd-confirm');
    const changePwdAlert = document.getElementById('change-pwd-alert');

    // Dropdown Settings elements
    const chkAlerts = document.getElementById('chk-setting-alerts');
    const chkSound = document.getElementById('chk-setting-sound');
    const btnDropGee = document.getElementById('btn-dropdown-gee');
    const btnDropRetrain = document.getElementById('btn-dropdown-retrain');

    const btnAdminRetrain = document.getElementById('btn-admin-retrain-ai');
    const retrainStatus = document.getElementById('retrain-status-text');

    window.updateAuthUI = updateAuthUI;
    function updateAuthUI() {
        const systemStatus = document.getElementById('system-status');
        const btnGeeModal = document.getElementById('btn-gee-modal');
        const adminBox = document.getElementById('admin-ai-action-box');
        const regBtn = document.getElementById('btn-auth-register');

        const isLoggedIn = !!state.auth.token && (state.auth.role === 'admin' || state.auth.role === 'user');

        if (isLoggedIn) {
            if (userMenuWrapper) userMenuWrapper.style.display = 'inline-flex';
            if (btnAuth) btnAuth.style.display = 'none';
            if (regBtn) regBtn.style.display = 'none';

            const uName = state.auth.full_name || state.auth.username || 'Người dùng';
            if (headerUserName) headerUserName.innerText = uName;
            if (userDropdownName) userDropdownName.innerText = uName;

            if (state.auth.is_admin || state.auth.role === 'admin') {
                if (badgeRoleText) {
                    badgeRoleText.className = 'badge-role admin';
                    badgeRoleText.innerHTML = `<i class="fa-solid fa-shield-halved"></i> <span id="header-user-name">${uName}</span>`;
                }
                if (userDropdownRole) userDropdownRole.innerText = 'Quản trị viên Hệ thống';
                if (userDropdownAvatar) {
                    userDropdownAvatar.className = 'user-dropdown-avatar admin';
                    userDropdownAvatar.innerHTML = '<i class="fa-solid fa-shield-halved"></i>';
                }
                if (adminDropdownTools) adminDropdownTools.style.display = 'block';
                if (systemStatus) systemStatus.style.display = 'inline-flex';
                if (adminBox) adminBox.style.display = 'block';
            } else {
                if (badgeRoleText) {
                    badgeRoleText.className = 'badge-role user';
                    badgeRoleText.innerHTML = `<i class="fa-solid fa-user-check"></i> <span id="header-user-name">${uName}</span>`;
                }
                if (userDropdownRole) userDropdownRole.innerText = 'Người dùng (Đã xác thực)';
                if (userDropdownAvatar) {
                    userDropdownAvatar.className = 'user-dropdown-avatar';
                    userDropdownAvatar.innerHTML = '<i class="fa-solid fa-user-check"></i>';
                }
                if (adminDropdownTools) adminDropdownTools.style.display = 'none';
                if (systemStatus) systemStatus.style.display = 'none';
                if (btnGeeModal) btnGeeModal.style.display = 'none';
                if (adminBox) adminBox.style.display = 'none';
            }
        } else {
            if (userMenuWrapper) userMenuWrapper.style.display = 'none';
            if (userDropdownMenu) userDropdownMenu.style.display = 'none';
            if (btnUserProfile) btnUserProfile.classList.remove('is-open');

            if (btnAuth) {
                btnAuth.style.display = 'inline-flex';
                btnAuth.classList.remove('is-logged-in');
                btnAuth.title = 'Đăng nhập tài khoản Người dùng hoặc Quản trị viên';
            }
            if (authBtnLabel) authBtnLabel.innerText = 'Đăng nhập';
            if (authIcon) authIcon.className = 'fa-solid fa-right-to-bracket';
            if (regBtn) regBtn.style.display = 'inline-flex';
            if (systemStatus) systemStatus.style.display = 'none';
            if (btnGeeModal) btnGeeModal.style.display = 'none';
            if (adminBox) adminBox.style.display = 'none';
        }
    }

    // Kiểm tra token lưu trữ
    const savedToken = localStorage.getItem('tvdi_token');
    if (savedToken) {
        fetch('/api/auth/me', {
            headers: { 'Authorization': `Bearer ${savedToken}` }
        })
            .then(r => r.json())
            .then(data => {
                if (data && (data.role === 'admin' || data.role === 'user')) {
                    state.auth = { ...data, token: savedToken };
                    updateAuthUI();
                } else {
                    localStorage.removeItem('tvdi_token');
                    state.auth.token = null;
                    state.auth.role = 'guest';
                    updateAuthUI();
                }
            })
            .catch(() => {
                localStorage.removeItem('tvdi_token');
                state.auth.token = null;
                state.auth.role = 'guest';
                updateAuthUI();
            });
    } else {
        state.auth.token = null;
        state.auth.role = 'guest';
        updateAuthUI();
    }

    // Toggle Dropdown người dùng
    if (btnUserProfile && userDropdownMenu) {
        btnUserProfile.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = userDropdownMenu.style.display === 'block';
            const willOpen = !isOpen;
            userDropdownMenu.style.display = willOpen ? 'block' : 'none';
            btnUserProfile.classList.toggle('is-open', willOpen);

            if (willOpen) {
                if (chkAlerts) chkAlerts.checked = state.autoAlertsEnabled !== false;
                if (chkSound) chkSound.checked = state.soundAlertsEnabled !== false;
            }
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('#user-menu-wrapper')) {
                userDropdownMenu.style.display = 'none';
                btnUserProfile.classList.remove('is-open');
            }
        });
    }

    // Nút Đăng xuất nằm gọn gàng bên trong menu User
    if (btnDropdownLogout) {
        btnDropdownLogout.addEventListener('click', () => {
            if (confirm('Bạn có chắc chắn muốn đăng xuất tài khoản?')) {
                localStorage.removeItem('tvdi_token');
                state.auth = {
                    role: 'guest',
                    token: null,
                    full_name: 'Khách',
                    is_admin: false,
                    permissions: ['view', 'stats'],
                };
                if (userDropdownMenu) userDropdownMenu.style.display = 'none';
                if (btnUserProfile) btnUserProfile.classList.remove('is-open');
                updateAuthUI();
                showToast('Đã đăng xuất tài khoản thành công.');
            }
        });
    }

    // Cài đặt 1: Đổi mật khẩu
    const closeChangePwd = () => {
        if (changePwdModal) changePwdModal.style.display = 'none';
        if (pwdOld) pwdOld.value = '';
        if (pwdNew) pwdNew.value = '';
        if (pwdConfirm) pwdConfirm.value = '';
        if (changePwdAlert) changePwdAlert.style.display = 'none';
    };

    if (btnOpenChangePwd) {
        btnOpenChangePwd.addEventListener('click', () => {
            if (userDropdownMenu) userDropdownMenu.style.display = 'none';
            if (btnUserProfile) btnUserProfile.classList.remove('is-open');
            if (changePwdModal) changePwdModal.style.display = 'flex';
            if (pwdOld) pwdOld.focus();
        });
    }

    if (btnCloseChangePwd) btnCloseChangePwd.addEventListener('click', closeChangePwd);
    if (btnCancelChangePwd) btnCancelChangePwd.addEventListener('click', closeChangePwd);

    if (btnSubmitChangePwd) {
        btnSubmitChangePwd.addEventListener('click', async () => {
            const oldVal = pwdOld ? pwdOld.value.trim() : '';
            const newVal = pwdNew ? pwdNew.value.trim() : '';
            const confVal = pwdConfirm ? pwdConfirm.value.trim() : '';

            if (!oldVal || !newVal || !confVal) {
                if (changePwdAlert) {
                    changePwdAlert.style.display = 'block';
                    changePwdAlert.className = 'login-alert warning';
                    changePwdAlert.innerText = 'Vui lòng điền đầy đủ các thông tin!';
                }
                return;
            }

            if (newVal.length < 6) {
                if (changePwdAlert) {
                    changePwdAlert.style.display = 'block';
                    changePwdAlert.className = 'login-alert warning';
                    changePwdAlert.innerText = 'Mật khẩu mới phải có ít nhất 6 ký tự!';
                }
                return;
            }

            if (newVal !== confVal) {
                if (changePwdAlert) {
                    changePwdAlert.style.display = 'block';
                    changePwdAlert.className = 'login-alert warning';
                    changePwdAlert.innerText = 'Mật khẩu mới và xác nhận mật khẩu không khớp!';
                }
                return;
            }

            try {
                const res = await fetch('/api/auth/change-password', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${state.auth.token}`
                    },
                    body: JSON.stringify({ old_password: oldVal, new_password: newVal })
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    closeChangePwd();
                    showToast('Đã đổi mật khẩu thành công!');
                } else {
                    if (changePwdAlert) {
                        changePwdAlert.style.display = 'block';
                        changePwdAlert.className = 'login-alert warning';
                        changePwdAlert.innerText = data.detail || 'Không thể đổi mật khẩu!';
                    }
                }
            } catch (e) {
                if (changePwdAlert) {
                    changePwdAlert.style.display = 'block';
                    changePwdAlert.className = 'login-alert warning';
                    changePwdAlert.innerText = 'Lỗi kết nối máy chủ xác thực!';
                }
            }
        });
    }

    // Cài đặt: Cảnh báo tự động hạn hán
    if (chkAlerts) {
        chkAlerts.addEventListener('change', () => {
            state.autoAlertsEnabled = chkAlerts.checked;
            showToast(chkAlerts.checked ? 'Đã bật cảnh báo hạn hán tự động (TVDI > 0.8).' : 'Đã tắt cảnh báo hạn hán tự động.');
        });
    }

    // Cài đặt: Âm thanh thông báo
    if (chkSound) {
        chkSound.addEventListener('change', () => {
            state.soundAlertsEnabled = chkSound.checked;
            showToast(chkSound.checked ? 'Đã bật âm thanh cảnh báo.' : 'Đã tắt âm thanh cảnh báo.');
        });
    }

    // Tiện ích Admin: Quản lý người dùng, GEE và Retrain
    const btnDropUsers = document.getElementById('btn-dropdown-users');
    if (btnDropUsers) {
        btnDropUsers.addEventListener('click', () => {
            if (userDropdownMenu) userDropdownMenu.style.display = 'none';
            if (btnUserProfile) btnUserProfile.classList.remove('is-open');
            openAdminUsersModal();
        });
    }

    if (btnDropGee) {
        btnDropGee.addEventListener('click', () => {
            if (userDropdownMenu) userDropdownMenu.style.display = 'none';
            if (btnUserProfile) btnUserProfile.classList.remove('is-open');
            const geeModal = document.getElementById('gee-modal');
            if (geeModal) geeModal.style.display = 'flex';
        });
    }

    if (btnDropRetrain) {
        btnDropRetrain.addEventListener('click', () => {
            if (userDropdownMenu) userDropdownMenu.style.display = 'none';
            if (btnUserProfile) btnUserProfile.classList.remove('is-open');
            const aiModal = document.getElementById('ai-modal');
            if (aiModal) {
                aiModal.style.display = 'flex';
                const adminBox = document.getElementById('admin-ai-action-box');
                if (adminBox) adminBox.scrollIntoView({ behavior: 'smooth' });
            }
        });
    }

    // Nút đăng nhập header (chỉ dùng khi chưa đăng nhập)
    if (btnAuth) {
        btnAuth.addEventListener('click', () => {
            if (loginModal) loginModal.style.display = 'flex';
            if (loginAlert) loginAlert.style.display = 'none';
            if (loginUname) loginUname.focus();
        });
    }

    if (btnRegister) {
        btnRegister.addEventListener('click', () => {
            if (registerModal) registerModal.style.display = 'flex';
            if (registerAlert) registerAlert.style.display = 'none';
            if (regUsername) regUsername.focus();
        });
    }

    const closeLogin = () => { if (loginModal) loginModal.style.display = 'none'; };
    const closeRegister = () => { if (registerModal) registerModal.style.display = 'none'; };

    if (btnCloseLogin) btnCloseLogin.addEventListener('click', closeLogin);
    if (btnCancelLogin) btnCancelLogin.addEventListener('click', closeLogin);

    if (btnCloseRegister) btnCloseRegister.addEventListener('click', closeRegister);
    if (btnCancelRegister) btnCancelRegister.addEventListener('click', closeRegister);

    // Chuyển đổi giữa 2 modal
    if (linkToRegister) {
        linkToRegister.addEventListener('click', (e) => {
            e.preventDefault();
            closeLogin();
            if (registerModal) registerModal.style.display = 'flex';
            if (registerAlert) registerAlert.style.display = 'none';
            if (regUsername) regUsername.focus();
        });
    }

    if (linkToLogin) {
        linkToLogin.addEventListener('click', (e) => {
            e.preventDefault();
            closeRegister();
            if (loginModal) loginModal.style.display = 'flex';
            if (loginAlert) loginAlert.style.display = 'none';
            if (loginUname) loginUname.focus();
        });
    }

    if (btnSubmitLogin) {
        btnSubmitLogin.addEventListener('click', async () => {
            const username = loginUname ? loginUname.value.trim() : '';
            const password = loginPass ? loginPass.value.trim() : '';
            if (!username || !password) {
                if (loginAlert) {
                    loginAlert.style.display = 'block';
                    loginAlert.className = 'gee-modal-alert warning';
                    loginAlert.innerText = 'Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu!';
                }
                return;
            }
            try {
                const res = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    localStorage.setItem('tvdi_token', data.token);
                    state.auth = {
                        role: data.role,
                        token: data.token,
                        full_name: data.full_name,
                        is_admin: data.role === 'admin',
                        permissions: data.permissions
                    };
                    updateAuthUI();
                    closeLogin();
                    const roleTitle = data.role === 'admin' ? 'Quản trị viên' : 'Người dùng';
                    showToast(`Chào mừng ${data.full_name}! Đã đăng nhập vai trò ${roleTitle}.`);
                } else {
                    if (loginAlert) {
                        loginAlert.style.display = 'block';
                        loginAlert.className = 'gee-modal-alert warning';
                        loginAlert.innerText = data.detail || 'Sai tên đăng nhập hoặc mật khẩu!';
                    }
                }
            } catch (err) {
                if (loginAlert) {
                    loginAlert.style.display = 'block';
                    loginAlert.className = 'gee-modal-alert warning';
                    loginAlert.innerText = 'Lỗi kết nối máy chủ xác thực!';
                }
            }
        });
    }

    if (btnSubmitRegister) {
        btnSubmitRegister.addEventListener('click', async () => {
            const username = regUsername ? regUsername.value.trim() : '';
            const fullname = regFullname ? regFullname.value.trim() : '';
            const password = regPassword ? regPassword.value.trim() : '';
            const confirmPass = regConfirm ? regConfirm.value.trim() : '';

            if (!username || !password) {
                if (registerAlert) {
                    registerAlert.style.display = 'block';
                    registerAlert.className = 'gee-modal-alert warning';
                    registerAlert.innerText = 'Vui lòng nhập đầy đủ Tên đăng nhập và Mật khẩu!';
                }
                return;
            }
            if (username.length < 3 || username.length > 30) {
                if (registerAlert) {
                    registerAlert.style.display = 'block';
                    registerAlert.className = 'gee-modal-alert warning';
                    registerAlert.innerText = 'Tên đăng nhập phải từ 3 đến 30 ký tự!';
                }
                return;
            }
            if (password.length < 6) {
                if (registerAlert) {
                    registerAlert.style.display = 'block';
                    registerAlert.className = 'gee-modal-alert warning';
                    registerAlert.innerText = 'Mật khẩu phải có ít nhất 6 ký tự!';
                }
                return;
            }
            if (password !== confirmPass) {
                if (registerAlert) {
                    registerAlert.style.display = 'block';
                    registerAlert.className = 'gee-modal-alert warning';
                    registerAlert.innerText = 'Mật khẩu xác nhận không khớp!';
                }
                return;
            }

            try {
                btnSubmitRegister.disabled = true;
                const res = await fetch('/api/auth/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username,
                        password,
                        full_name: fullname || username
                    })
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    localStorage.setItem('tvdi_token', data.token);
                    state.auth = {
                        role: data.role,
                        token: data.token,
                        full_name: data.full_name,
                        is_admin: false,
                        permissions: data.permissions
                    };
                    updateAuthUI();
                    closeRegister();
                    showToast(`Đăng ký thành công! Chào mừng ${data.full_name} đến với hệ thống.`);
                } else {
                    if (registerAlert) {
                        registerAlert.style.display = 'block';
                        registerAlert.className = 'gee-modal-alert warning';
                        registerAlert.innerText = data.detail || 'Không thể đăng ký tài khoản!';
                    }
                }
            } catch (err) {
                if (registerAlert) {
                    registerAlert.style.display = 'block';
                    registerAlert.className = 'gee-modal-alert warning';
                    registerAlert.innerText = 'Lỗi kết nối máy chủ xác thực!';
                }
            } finally {
                btnSubmitRegister.disabled = false;
            }
        });
    }

    // Xử lý nút Huấn luyện lại AI (Admin)
    if (btnAdminRetrain) {
        btnAdminRetrain.addEventListener('click', async () => {
            if (!state.auth.is_admin) {
                showToast('Chức năng yêu cầu quyền Quản trị viên (Admin)!');
                return;
            }
            btnAdminRetrain.disabled = true;
            if (retrainStatus) {
                retrainStatus.style.display = 'inline';
                retrainStatus.innerText = 'Đang tiến hành huấn luyện trong nền...';
            }
            try {
                const res = await fetch('/api/prediction/retrain', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${state.auth.token}` }
                });
                const d = await res.json();
                if (res.ok) {
                    if (retrainStatus) retrainStatus.innerText = 'Đã gửi yêu cầu huấn luyện thành công!';
                    showToast('Đã khởi chạy tiến trình huấn luyện mô hình AI Random Forest.');
                } else {
                    if (retrainStatus) retrainStatus.innerText = d.detail || 'Lỗi gửi yêu cầu';
                }
            } catch (e) {
                if (retrainStatus) retrainStatus.innerText = 'Lỗi kết nối server';
            } finally {
                setTimeout(() => {
                    btnAdminRetrain.disabled = false;
                    if (retrainStatus) retrainStatus.style.display = 'none';
                }, 4000);
            }
        });
    }

    // Khởi tạo trạng thái giao diện phân quyền ban đầu
    updateAuthUI();
}

// --- 18f. Tabs chuyển đổi Sidebar (Phân tích vs 167 Phường) ---
function setupSidebarTabs() {
    const tabs = [
        { btn: document.getElementById('nav-tab-stats'), view: document.getElementById('sidebar-stats-view') },
        { btn: document.getElementById('nav-tab-wards'), view: document.getElementById('sidebar-wards-view') },
        { btn: document.getElementById('nav-tab-analysis'), view: document.getElementById('sidebar-analysis-view') },
    ].filter(t => t.btn);

    if (tabs.length === 0) return;

    tabs.forEach(t => {
        t.btn.addEventListener('click', () => {
            tabs.forEach(o => {
                o.btn.classList.toggle('active', o === t);
                if (o.view) o.view.style.display = (o === t) ? 'flex' : 'none';
            });
            if (t.btn.id === 'nav-tab-wards' && (!state.wards.list || state.wards.list.length === 0)) {
                loadWardsData();
            }
            if (t.btn.id === 'nav-tab-analysis') {
                refreshAnalysisCharts(true);
            }
        });
    });
}

// --- 18g. Module Danh sách & Bộ lọc 167 Phường / Xã (Yêu cầu 1 & 2) ---
function setupWardsModule() {
    const btnSortLst = document.getElementById('btn-sort-lst');
    const btnSortNdvi = document.getElementById('btn-sort-ndvi');
    const btnSortTvdi = document.getElementById('btn-sort-tvdi');
    const btnApply = document.getElementById('btn-apply-filters');
    const btnReset = document.getElementById('btn-reset-filters');
    const threshLst = document.getElementById('thresh-lst');
    const threshTvdi = document.getElementById('thresh-tvdi');
    const threshNdvi = document.getElementById('thresh-ndvi');
    const searchInput = document.getElementById('ward-search-input');
    const presets = document.querySelectorAll('.btn-preset');

    // Layer Group cho Wards trên Leaflet
    if (map && !state.wards.markersLayer) {
        state.wards.markersLayer = L.featureGroup().addTo(map);
    }

    function setSort(mode) {
        state.wards.sortBy = mode;
        if (btnSortLst) btnSortLst.classList.toggle('active', mode === 'lst_desc');
        if (btnSortNdvi) btnSortNdvi.classList.toggle('active', mode === 'ndvi_asc');
        if (btnSortTvdi) btnSortTvdi.classList.toggle('active', mode === 'tvdi_desc');
        loadWardsData();
    }

    if (btnSortLst) btnSortLst.addEventListener('click', () => setSort('lst_desc'));
    if (btnSortNdvi) btnSortNdvi.addEventListener('click', () => setSort('ndvi_asc'));
    if (btnSortTvdi) btnSortTvdi.addEventListener('click', () => setSort('tvdi_desc'));

    if (btnApply) {
        btnApply.addEventListener('click', () => {
            state.wards.thresholds.min_lst = (threshLst && threshLst.value !== '') ? parseFloat(threshLst.value) : null;
            state.wards.thresholds.min_tvdi = (threshTvdi && threshTvdi.value !== '') ? parseFloat(threshTvdi.value) : null;
            state.wards.thresholds.max_ndvi = (threshNdvi && threshNdvi.value !== '') ? parseFloat(threshNdvi.value) : null;
            loadWardsData();
            showToast('Đã áp dụng bộ lọc ngưỡng chỉ số cho 167 phường.');
        });
    }

    if (btnReset) {
        btnReset.addEventListener('click', () => {
            if (threshLst) threshLst.value = '';
            if (threshTvdi) threshTvdi.value = '';
            if (threshNdvi) threshNdvi.value = '';
            if (searchInput) searchInput.value = '';
            state.wards.thresholds = { min_lst: null, max_lst: null, min_ndvi: null, max_ndvi: null, min_tvdi: null, max_tvdi: null };
            state.wards.searchQuery = '';
            presets.forEach(p => p.classList.remove('active'));
            loadWardsData();
            showToast('Đã đặt lại hiển thị toàn bộ 167 phường.');
        });
    }

    presets.forEach(btn => {
        btn.addEventListener('click', () => {
            const hasActive = btn.classList.contains('active');
            presets.forEach(p => p.classList.remove('active'));
            if (!hasActive) {
                btn.classList.add('active');
                if (btn.dataset.lst && threshLst) threshLst.value = btn.dataset.lst;
                if (btn.dataset.tvdi && threshTvdi) threshTvdi.value = btn.dataset.tvdi;
                if (btn.dataset.ndvi && threshNdvi) threshNdvi.value = btn.dataset.ndvi;
            } else {
                if (btn.dataset.lst && threshLst) threshLst.value = '';
                if (btn.dataset.tvdi && threshTvdi) threshTvdi.value = '';
                if (btn.dataset.ndvi && threshNdvi) threshNdvi.value = '';
            }
            if (btnApply) btnApply.click();
        });
    });

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            state.wards.searchQuery = e.target.value.trim().toLowerCase();
            renderWardsTable();
        });
    }

    const btnExportWards = document.getElementById('btn-export-wards-csv');
    if (btnExportWards) btnExportWards.addEventListener('click', exportWardsCSV);
}

async function loadWardsData(targetDate) {
    // Xếp hạng theo đúng bộ dữ liệu đang hiển thị: kỳ quan trắc chứa ngày chọn, trung bình theo khoảng hoặc dự báo AI
    const view = state.currentView;
    let d = targetDate || state.currentDate || '2024-03-01';
    let range = '';
    if (view && view.kind === 'cycle') d = view.date;
    else if (view && view.kind === 'aggregate') {
        d = view.start;
        range = `&start=${view.start}&end=${view.end}`;
    }
    const baseUrl = `/api/wards?date=${d}&sort_by=${state.wards.sortBy}${range}`;

    let url = baseUrl;
    const t = state.wards.thresholds;
    if (t.min_lst !== null) url += `&min_lst=${t.min_lst}`;
    if (t.max_lst !== null) url += `&max_lst=${t.max_lst}`;
    if (t.min_ndvi !== null) url += `&min_ndvi=${t.min_ndvi}`;
    if (t.max_ndvi !== null) url += `&max_ndvi=${t.max_ndvi}`;
    if (t.min_tvdi !== null) url += `&min_tvdi=${t.min_tvdi}`;
    if (t.max_tvdi !== null) url += `&max_tvdi=${t.max_tvdi}`;
    const filtered = url !== baseUrl;

    const seq = ++state.wardsSeq;
    try {
        const requests = [fetch(url)];
        if (filtered) requests.push(fetch(baseUrl));   // Danh sách đầy đủ để tô màu bản đồ phường/xã
        const responses = await Promise.all(requests);
        responses.forEach(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); });
        const [data, fullData] = await Promise.all(responses.map(r => r.json()));
        if (seq !== state.wardsSeq) return;   // Phản hồi cũ – đã có yêu cầu mới hơn

        state.wards.list = data.wards || [];
        state.wards.allList = filtered ? (fullData.wards || []) : state.wards.list;
        state.wards.isForecast = !!data.is_forecast;
        renderWardsSourceNote(data);
        renderWardsTable();
        renderWardsMapMarkers();
        if (state.displayMode === 'ward') renderWardsBoundary();
        if (state.viewMode === '3d' && state.displayMode === 'ward') update3DData();
        refreshSelectedWardDetail();
        refreshAnalysisCharts();
    } catch (e) {
        console.error('Lỗi nạp danh sách 167 phường:', e);
    }
}

// Ghi chú nguồn số liệu của bảng xếp hạng (mốc dự báo AI chỉ có TVDI do mô hình dự báo)
function renderWardsSourceNote(data) {
    const note = document.getElementById('wards-source-note');
    if (!note) return;
    if (data.is_forecast) {
        note.style.display = 'block';
        note.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Mốc dự báo AI: TVDI do mô hình Random Forest dự báo; LST và NDVI trong bảng là giá trị <strong>ước tính quy đổi từ TVDI</strong>, chỉ mang tính tham khảo.';
    } else if (state.currentView && state.currentView.kind === 'aggregate') {
        note.style.display = 'block';
        note.innerHTML = `<i class="fa-solid fa-calendar-week"></i> Giá trị trung bình ${describeCurrentView(true)} – nội suy IDW tại tâm phường/xã.`;
    } else {
        note.style.display = 'none';
        note.innerHTML = '';
    }
}

// Cập nhật thẻ chi tiết của phường/xã đang chọn theo số liệu mới (khi đổi ngày / chỉ số)
function refreshSelectedWardDetail() {
    const wid = state.wards.selectedWardId;
    if (!wid || !state.selectedPoint || !state.selectedPoint.isWard) return;
    const ward = (state.wards.allList || []).find(w => w.ward_id === wid) || (state.wards.list || []).find(w => w.ward_id === wid);
    if (!ward) return;
    const theme = getDroughtUITheme(ward.tvdi);
    const values = state.wards.isForecast ? { lst: null, ndvi: null } : { lst: ward.lst_c, ndvi: ward.ndvi };
    renderPointDetail(ward.lat, ward.lon, ward.tvdi, theme, state.selectedPoint.locationName, values);
}

// Xuất bảng xếp hạng phường/xã đang hiển thị ra CSV (UTF-8, mở được bằng Excel)
function exportWardsCSV() {
    const list = state.wards.list || [];
    if (!list.length) {
        showToast('Chưa có dữ liệu phường/xã để xuất.');
        return;
    }
    const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const rows = [['Hạng', 'Mã', 'Phường/Xã', 'Khu vực', 'Loại', 'Vĩ độ', 'Kinh độ', 'LST (°C)', 'NDVI', 'TVDI', 'Cấp độ khô hạn']];
    list.forEach(w => rows.push([w.rank, w.ward_id, q(w.name), q(w.district), q(w.type), w.lat, w.lon, w.lst_c, w.ndvi, w.tvdi, q(w.drought_label)]));
    const label = removeVietnameseTones(describeCurrentView(true)).replace(/[^0-9A-Za-z_-]+/g, '_');
    downloadTextFile(`Xep_hang_phuong_xa_${label}.csv`, '﻿' + rows.map(r => r.join(',')).join('\r\n'), 'text/csv;charset=utf-8;');
    logUserAction('Xuất CSV phường/xã', `Xuất ${list.length} phường/xã (${describeCurrentView(true)})`);
}

function downloadTextFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function renderWardsTable() {
    const tbody = document.getElementById('wards-table-body');
    const countEl = document.getElementById('wards-matched-count');
    const tabCount = document.getElementById('tab-wards-count');
    if (!tbody) return;

    let list = state.wards.list || [];
    if (state.wards.searchQuery) {
        // Tìm kiếm không phân biệt dấu tiếng Việt (vd: "thu duc" khớp "Thủ Đức")
        const q = removeVietnameseTones(state.wards.searchQuery);
        list = list.filter(w =>
            removeVietnameseTones(w.name).includes(q) ||
            removeVietnameseTones(w.district).includes(q) ||
            removeVietnameseTones(w.province).includes(q)
        );
    }

    if (countEl) countEl.innerText = list.length;
    if (tabCount) tabCount.innerText = list.length;

    if (list.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; padding: 24px; color: #94a3b8;">
                    <i class="fa-solid fa-filter-circle-xmark" style="font-size: 1.5rem; margin-bottom: 8px; display: block;"></i>
                    Không có phường nào thỏa mãn ngưỡng lọc đã chọn.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = list.map(w => {
        const isTop3 = w.rank <= 3;
        const isHot = w.lst_c >= 40.0;
        const isSelected = state.wards.selectedWardId === w.ward_id;

        return `
            <tr data-id="${w.ward_id}" class="${isSelected ? 'selected' : ''}">
                <td><span class="ward-rank-pill ${isTop3 ? 'top-3' : ''}">#${w.rank}</span></td>
                <td>
                    <div class="ward-name-cell">
                        <span class="ward-name-title">${w.name}</span>
                        <span class="ward-district-sub">${w.district}</span>
                    </div>
                </td>
                <td class="text-right">
                    <span class="ward-val-badge val-lst ${isHot ? 'hot' : ''}">${w.lst_c}°</span>
                </td>
                <td class="text-right">
                    <span class="ward-val-badge val-ndvi">${w.ndvi}</span>
                </td>
                <td class="text-right">
                    <span class="ward-val-badge val-tvdi" style="background-color: ${w.color}; color: ${readableTextColor(w.color)}; font-weight: 700;" title="${w.drought_label}">
                        ${w.tvdi}
                    </span>
                </td>
            </tr>
        `;
    }).join('');

    tbody.querySelectorAll('tr').forEach(tr => {
        tr.addEventListener('click', () => {
            const wId = parseInt(tr.dataset.id, 10);
            selectWard(wId);
        });
    });
}

function selectWard(wardId, updateInput = false) {
    const ward = (state.wards.list || []).find(w => w.ward_id === wardId)
        || (state.wards.allList || []).find(w => w.ward_id === wardId);
    if (!ward) return;
    state.wards.selectedWardId = wardId;

    // Cập nhật ô tìm kiếm trên thanh điều khiển nếu có yêu cầu
    if (updateInput) {
        const searchInput = document.getElementById('global-ward-search-input');
        const btnClear = document.getElementById('btn-clear-ward-search');
        if (searchInput) searchInput.value = ward.name;
        if (btnClear) btnClear.style.display = 'inline-flex';
        const box = document.getElementById('ward-search-container');
        if (box) box.classList.add('has-value');
    }

    // Highlight hàng trong bảng 167 phường ở sidebar
    const tbody = document.getElementById('wards-table-body');
    if (tbody) {
        tbody.querySelectorAll('tr').forEach(r => {
            const isMatch = parseInt(r.dataset.id, 10) === wardId;
            r.classList.toggle('selected', isMatch);
            if (isMatch) {
                r.scrollIntoView({ block: 'nearest' });
            }
        });
    }

    // Cập nhật Card 1 thông tin chi tiết khu vực tại Sidebar
    const theme = getDroughtUITheme(ward.tvdi);
    const locationName = `${ward.name}, ${ward.district} (${ward.province || 'TP.HCM'})`;
    const wardValues = state.wards.isForecast ? { lst: null, ndvi: null } : { lst: ward.lst_c, ndvi: ward.ndvi };
    selectionLayerGroup.clearLayers();
    state.selectedMarker = null;
    state.selectedPoint = { lat: ward.lat, lon: ward.lon, interp: null, locationName, isWard: true };
    renderPointDetail(ward.lat, ward.lon, ward.tvdi, theme, locationName, wardValues);

    // Đồng bộ biểu đồ chuỗi thời gian với ô lưới gần nhất (tâm ô có dữ liệu trong lưới đang hiển thị)
    const gridFeatures = (state.currentGridData && state.currentGridData.features) ? state.currentGridData.features : [];
    if (gridFeatures.length > 0) {
        let nearest = null;
        let minDist = Infinity;
        for (const f of gridFeatures) {
            const cell = f.properties || {};
            if (getIndexValue(cell, 'tvdi') === null) continue;
            const d = Math.hypot(cell.lat - ward.lat, cell.lon - ward.lon);
            if (d < minDist) {
                minDist = d;
                nearest = cell;
            }
        }
        if (nearest) {
            state.selectedCellId = nearest.cell_id;
            state.selectedCellProps = nearest;
            state.chartTab = 'cell';
            const tabCell = document.getElementById('tab-cell-chart');
            const tabOverall = document.getElementById('tab-overall-chart');
            if (tabCell) tabCell.classList.add('active');
            if (tabOverall) tabOverall.classList.remove('active');
            loadChartData();
        }
    }

    // Nổi bật ranh giới phường xã và điểm tâm trên bản đồ
    if (wardHighlightLayerGroup) {
        wardHighlightLayerGroup.clearLayers();
        const matchedFeat = findFeatureForWard(ward);
        if (matchedFeat) {
            const highlightGeoJson = L.geoJSON(matchedFeat, {
                style: {
                    color: '#2563eb',
                    weight: 3.5,
                    opacity: 1.0,
                    fillColor: '#38bdf8',
                    fillOpacity: 0.25,
                    className: 'ward-highlight-pulse'
                }
            });
            wardHighlightLayerGroup.addLayer(highlightGeoJson);
        }

        // Thêm điểm tròn trung tâm rực rỡ
        const highlightMarker = L.circleMarker([ward.lat, ward.lon], {
            radius: 8.5,
            color: '#1d4ed8',
            weight: 3,
            fillColor: ward.color || '#ea580c',
            fillOpacity: 1.0
        });
        wardHighlightLayerGroup.addLayer(highlightMarker);
    }

    // Ở chế độ 3D: bay camera tới phường/xã
    if (state.viewMode === '3d') flyTo3D(ward.lat, ward.lon);

    // Nếu ở chế độ 2D: Lập tức nhảy / lướt bản đồ đến khu vực đó và hiển thị Popup chỉ số
    if (state.viewMode === '2d' && map) {
        map.flyTo([ward.lat, ward.lon], 13.5, { duration: 1.0 });

        L.popup({ autoClose: true, closeOnClick: true, offset: [0, -7] })
            .setLatLng([ward.lat, ward.lon])
            .setContent(`
                <div style="font-family: inherit; min-width: 230px; padding: 4px;">
                    <div style="font-size: 0.72rem; color: #64748b; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; display: flex; justify-content: space-between; align-items: center;">
                        <span>${ward.type} • ${ward.district}</span>
                        <span style="background: #f1f5f9; padding: 1px 6px; border-radius: 4px; color: #334155;">#${ward.rank || '--'}</span>
                    </div>
                    <h3 style="margin: 3px 0 6px 0; font-size: 1.08rem; color: #0f172a; font-weight: 800;">
                        ${ward.name}
                    </h3>
                    <div style="font-size: 0.77rem; color: #475569; margin-bottom: 8px;">
                        <i class="fa-solid fa-map-location-dot" style="color: #2563eb; margin-right: 4px;"></i>${ward.province || 'TP. Hồ Chí Minh'}
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 8px;">
                        <div style="background: #fff7ed; padding: 5px 8px; border-radius: 6px; border: 1px solid #fed7aa;">
                            <span style="font-size: 0.68rem; color: #9a3412; font-weight: 600; display: block;">LST (Nhiệt độ):</span>
                            <strong style="font-size: 0.95rem; color: #c2410c;">${ward.lst_c}°C</strong>${state.wards.isForecast ? ' <small style="color:#9a3412;">(ước tính)</small>' : ''}
                        </div>
                        <div style="background: #f0fdf4; padding: 5px 8px; border-radius: 6px; border: 1px solid #bbf7d0;">
                            <span style="font-size: 0.68rem; color: #166534; font-weight: 600; display: block;">NDVI (Thực bì):</span>
                            <strong style="font-size: 0.95rem; color: #15803d;">${ward.ndvi}</strong>${state.wards.isForecast ? ' <small style="color:#166534;">(ước tính)</small>' : ''}
                        </div>
                    </div>
                    <div style="background: #fefce8; padding: 7px 9px; border-radius: 6px; border: 1px solid #fef08a; display: flex; align-items: center; justify-content: space-between;">
                        <div>
                            <span style="font-size: 0.7rem; color: #854d0e; font-weight: 600; display: block;">TVDI Khô hạn:</span>
                            <strong style="font-size: 1.05rem; font-weight: 800; color: ${ward.color || '#ea580c'};">${ward.tvdi}</strong>
                        </div>
                        <span style="background-color: ${ward.color || '#ea580c'}; color: #ffffff; padding: 3px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 700; text-shadow: 0 1px 2px rgba(0,0,0,0.2);">
                            ${ward.drought_label}
                        </span>
                    </div>
                </div>
            `)
            .openOn(map);
    }
}

function renderWardsMapMarkers() {
    if (!state.wards.markersLayer) return;
    state.wards.markersLayer.clearLayers();

    const isFiltered = (
        state.wards.thresholds.min_lst !== null ||
        state.wards.thresholds.max_lst !== null ||
        state.wards.thresholds.min_tvdi !== null ||
        state.wards.thresholds.max_tvdi !== null ||
        state.wards.thresholds.min_ndvi !== null ||
        state.wards.thresholds.max_ndvi !== null
    );

    // MẶC ĐỊNH KHI CHƯA LỌC NGƯỠNG VÀ CHƯA CHỌN PHƯỜNG:
    // Bản đồ giữ hoàn toàn sạch sẽ, chỉ fill màu viễn thám chủ đạo (theo Yêu cầu 3 của cô).
    // Tuyệt đối không tự động hiện chấm tròn nào làm rối mắt.
    if (!isFiltered && !state.wards.selectedWardId) {
        return;
    }

    const list = state.wards.list || [];
    list.forEach(w => {
        const isSelected = state.wards.selectedWardId === w.ward_id;

        // Nếu không lọc ngưỡng mà chỉ có 1 phường được chọn, chỉ hiển thị đúng phường đó
        if (!isFiltered && !isSelected) {
            return;
        }

        const markerColor = w.color || '#ea580c';
        const circle = L.circleMarker([w.lat, w.lon], {
            radius: isSelected ? 8 : (isFiltered ? 6.5 : 5),
            fillColor: markerColor,
            color: '#ffffff',
            weight: isSelected ? 3 : 1.5,
            opacity: 1,
            fillOpacity: 0.85,
        });

        circle.bindTooltip(`<strong>${w.name}</strong> (${w.district})<br>LST: ${w.lst_c}°C | TVDI: ${w.tvdi}`, {
            direction: 'top',
            offset: [0, -6],
            className: 'ward-map-tooltip'
        });

        circle.on('click', () => {
            selectWard(w.ward_id);
        });

        state.wards.markersLayer.addLayer(circle);
    });
}

// --- 18h. Chế độ xem 2D / 3D (Bản đồ 3D MapLibre GL – xem map3d.js) ---
async function setViewMode(mode) {
    if (mode === state.viewMode || state.map3d.switching) return;
    const btn2D = document.getElementById('btn-view-2d');
    const btn3D = document.getElementById('btn-view-3d');
    const map3dControls = document.getElementById('map-3d-controls');
    const mapContainer = document.getElementById('map-container');
    const setButtons = (m) => {
        if (btn3D) btn3D.classList.toggle('active', m === '3d');
        if (btn2D) btn2D.classList.toggle('active', m === '2d');
    };

    state.map3d.switching = true;
    if (mapContainer) mapContainer.classList.add('is-switching');
    try {
        if (mode === '3d') {
            if (!init3DMap()) return;
            state.viewMode = '3d';
            setButtons('3d');
            if (mapContainer) mapContainer.classList.add('is-3d');
            if (map3dControls) map3dControls.style.display = '';
            updateGraticule();
            updateMapTitle();
            await enter3DView();
            logUserAction('Chuyển chế độ xem', 'Bản đồ 3D');
        } else {
            state.viewMode = '2d';
            setButtons('2d');
            if (map3dControls) map3dControls.style.display = 'none';
            await exit3DView();
            if (mapContainer) mapContainer.classList.remove('is-3d');
            updateGraticule();
            updateMapTitle();
        }
    } finally {
        state.map3d.switching = false;
        if (mapContainer) mapContainer.classList.remove('is-switching');
    }
}

function setup3DView() {
    const btn2D = document.getElementById('btn-view-2d');
    const btn3D = document.getElementById('btn-view-3d');
    const btn3dReset = document.getElementById('btn-3d-reset-cam');
    const btn3dRotate = document.getElementById('btn-3d-rotate');
    const rangeExag = document.getElementById('range-3d-exag');
    const valExag = document.getElementById('val-3d-exag');

    if (!btn2D || !btn3D) return;

    btn3D.addEventListener('click', () => setViewMode('3d'));
    btn2D.addEventListener('click', () => setViewMode('2d'));

    if (btn3dReset) btn3dReset.addEventListener('click', reset3DCamera);
    if (btn3dRotate) {
        btn3dRotate.addEventListener('click', () => {
            if (state.map3d.rotating) stop3DRotation();
            else start3DRotation();
        });
    }
    if (rangeExag) {
        rangeExag.addEventListener('input', (e) => {
            state.map3d.exaggeration = parseFloat(e.target.value) || 1;
            if (valExag) valExag.innerText = state.map3d.exaggeration.toFixed(1);
            apply3DExaggeration();
        });
    }
}


// --- 18i. Trình chiếu Animation theo chuỗi thời gian (Yêu cầu 4) ---
function setupAnimationController() {
    const btnPlay = document.getElementById('btn-anim-play');
    const speedSelect = document.getElementById('anim-speed-select');
    const rangeSelect = document.getElementById('anim-range-select');
    const loopSelect = document.getElementById('anim-loop-select');
    const hudBadge = document.getElementById('anim-hud-badge');
    const hudText = document.getElementById('anim-hud-text');

    if (!btnPlay) return;

    function stopAnim(completed = false) {
        state.animation.isPlaying = false;
        if (state.animation.timer) {
            clearInterval(state.animation.timer);
            state.animation.timer = null;
        }
        btnPlay.classList.remove('is-playing');
        btnPlay.innerHTML = '<i class="fa-solid fa-play"></i> <span>Trình chiếu</span>';
        if (hudBadge) hudBadge.style.display = 'none';

        if (completed && typeof showToast === 'function') {
            showToast('Đã hoàn thành chuỗi trình chiếu thời gian.');
        }
    }

    // Xác định chính xác danh sách các mốc ngày theo khoảng thời gian người dùng chọn
    function getAnimationDates() {
        if (!state.dates || state.dates.length === 0) return [];

        const rangeMode = rangeSelect ? rangeSelect.value : 'auto';
        const currDate = state.currentDate || (state.dates && state.dates[state.currentDateIndex]) || '';
        const isForecastDate = state.forecastDates.includes(currDate) || currDate >= '2026-01-01' || state.isAIMode;

        const forecastList = state.dates.filter(d => state.forecastDates.includes(d) || d >= '2026-01-01');
        const historicalList = state.dates.filter(d => !state.forecastDates.includes(d) && d < '2026-01-01');

        // Chế độ tổng hợp theo tháng / năm: mỗi khung hình là một tháng / một năm quan trắc
        if (!isForecastDate && (state.aggregation === 'month' || state.aggregation === 'year')) {
            const keyLen = state.aggregation === 'month' ? 7 : 4;
            const seen = new Set();
            return historicalList.filter(d => {
                const k = d.substring(0, keyLen);
                if (seen.has(k)) return false;
                seen.add(k);
                return true;
            });
        }
        if (!isForecastDate && state.aggregation === 'period') {
            return [];
        }

        if (rangeMode === 'forecast' || (rangeMode === 'auto' && isForecastDate)) {
            // Chuỗi Dự báo AI (2026 – 2027)
            return forecastList.length > 0 ? forecastList : state.dates;
        } else if (rangeMode === 'year') {
            // Theo năm đang chọn trên giao diện
            const selYear = currDate.substring(0, 4);
            const yearList = state.dates.filter(d => d.startsWith(selYear));
            return yearList.length > 0 ? yearList : state.dates;
        } else if (rangeMode === 'monitor' || (rangeMode === 'auto' && !isForecastDate)) {
            // Chuỗi Quan sát viễn thám thực tế (2017 – 2025)
            return historicalList.length > 0 ? historicalList : state.dates;
        }

        return state.dates;
    }

    function startAnim() {
        const animDates = getAnimationDates();
        if (animDates.length === 0) {
            if (state.aggregation === 'period') {
                showToast('Đang xem trung bình toàn giai đoạn 2017–2025 (một khung hình). Chọn "Theo kỳ", "TB tháng" hoặc "TB năm" để trình chiếu.');
            }
            return;
        }

        state.animation.isPlaying = true;
        btnPlay.classList.add('is-playing');
        btnPlay.innerHTML = '<i class="fa-solid fa-pause"></i> <span>Tạm dừng</span>';
        if (hudBadge) hudBadge.style.display = 'inline-flex';

        const speed = speedSelect ? parseInt(speedSelect.value, 10) || 1200 : 1200;
        const loopMode = loopSelect ? loopSelect.value : 'stop';
        const aggKeyLen = (!isForecastDate(state.currentDate) && state.aggregation === 'month') ? 7
            : ((!isForecastDate(state.currentDate) && state.aggregation === 'year') ? 4 : 0);

        // Tìm vị trí hiện tại trong chuỗi animDates (theo tháng / năm khi đang tổng hợp)
        let subIndex = aggKeyLen
            ? animDates.findIndex(d => d.substring(0, aggKeyLen) === (state.currentDate || '').substring(0, aggKeyLen))
            : animDates.indexOf(state.currentDate);
        if (subIndex === -1 || subIndex >= animDates.length - 1) {
            // Nếu chưa thuộc chuỗi hoặc đang đứng ở mốc cuối cùng, bắt đầu lại từ mốc đầu tiên của chuỗi đó
            subIndex = 0;
            const startDate = animDates[0];
            setDate(startDate);
        }

        state.animation.timer = setInterval(async () => {
            subIndex++;
            if (subIndex >= animDates.length) {
                if (loopMode === 'loop') {
                    // Lặp lại từ mốc đầu tiên CỦA CHÍNH KHOẢNG NÀY (VD: đầu dự báo 2026-01-01, tuyệt đối không về 2017)
                    subIndex = 0;
                } else {
                    // Dừng ở mốc cuối cùng của chuỗi dự báo / khoảng thời gian
                    stopAnim(true);
                    return;
                }
            }

            const nextDate = animDates[subIndex];
            if (hudText) {
                const parts = nextDate.split('-');
                const month = parseInt(parts[1], 10);
                const season = (month >= 11 || month <= 4) ? 'MÙA KHÔ' : 'MÙA MƯA';
                const isFc = state.forecastDates.includes(nextDate) || nextDate >= '2026-01-01';
                const tag = isFc ? 'Dự báo AI' : 'Thực tế';
                if (aggKeyLen === 7) {
                    hudText.innerHTML = `Trình chiếu ${subIndex + 1}/${animDates.length} · <strong>Tháng ${parts[1]}/${parts[0]}</strong> · ${season.toLowerCase()}`;
                } else if (aggKeyLen === 4) {
                    hudText.innerHTML = `Trình chiếu ${subIndex + 1}/${animDates.length} · <strong>Năm ${parts[0]}</strong>`;
                } else {
                    hudText.innerHTML = `Trình chiếu ${subIndex + 1}/${animDates.length} · <strong>${parts[2]}/${parts[1]}/${parts[0]}</strong> · ${tag} · ${season.toLowerCase()}`;
                }
            }

            // Gọi setDate để cập nhật đồng bộ toàn bộ giao diện: bản đồ 2D, mô hình 3D, danh sách 167 phường, thống kê
            setDate(nextDate);
        }, speed);
    }

    btnPlay.addEventListener('click', () => {
        if (state.animation.isPlaying) {
            stopAnim();
        } else {
            startAnim();
        }
    });

    if (speedSelect) {
        speedSelect.addEventListener('change', () => {
            if (state.animation.isPlaying) {
                stopAnim();
                startAnim();
            }
        });
    }

    if (rangeSelect) {
        rangeSelect.addEventListener('change', () => {
            if (state.animation.isPlaying) {
                stopAnim();
                startAnim();
            }
        });
    }
}


// --- 18i. Quản trị viên: Quản lý Người dùng & Nhật ký Hoạt động (Audit Log) ---
let adminUsersCache = [];
let adminActivitiesCache = [];

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function openAdminUsersModal() {
    if (!state.auth || (!state.auth.is_admin && state.auth.role !== 'admin')) {
        showToast('Chức năng này yêu cầu quyền Quản trị viên (Admin)!');
        return;
    }
    const modal = document.getElementById('admin-users-modal');
    if (modal) {
        modal.style.display = 'flex';
        loadAdminUsers();
        loadAdminActivities();
    }
}

async function loadAdminUsers() {
    if (!state.auth || (!state.auth.is_admin && state.auth.role !== 'admin')) return;
    const tbody = document.getElementById('tbody-admin-users');
    const badgeTotal = document.getElementById('badge-total-users');
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 25px; color: #64748b;"><i class="fa-solid fa-spinner fa-spin"></i> Đang tải danh sách người dùng...</td></tr>';

    try {
        const res = await fetch('/api/auth/admin/users', {
            headers: { 'Authorization': `Bearer ${state.auth.token}` }
        });
        const data = await res.json();
        if (res.ok && data.success) {
            adminUsersCache = data.users || [];
            if (badgeTotal) badgeTotal.innerText = adminUsersCache.length;
            renderAdminUsersTable();
            populateActivityUserFilter();
        } else {
            if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #ef4444; padding: 20px;">Lỗi: ${data.detail || 'Không có quyền truy cập'}</td></tr>`;
        }
    } catch (e) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #ef4444; padding: 20px;">Lỗi kết nối máy chủ khi nạp tài khoản.</td></tr>';
    }
}

function renderAdminUsersTable() {
    const tbody = document.getElementById('tbody-admin-users');
    if (!tbody) return;

    const searchInput = document.getElementById('input-search-users');
    const statusSelect = document.getElementById('select-filter-user-status');
    const q = (searchInput ? searchInput.value : '').trim().toLowerCase();
    const st = statusSelect ? statusSelect.value : 'all';

    let filtered = adminUsersCache.filter(u => {
        const matchSearch = !q || u.username.toLowerCase().includes(q) || (u.full_name && u.full_name.toLowerCase().includes(q));
        const matchStatus = (st === 'all') || (st === 'active' && !u.is_blocked) || (st === 'blocked' && u.is_blocked);
        return matchSearch && matchStatus;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 30px; color: #94a3b8;"><i class="fa-solid fa-user-slash" style="font-size: 1.5rem; margin-bottom: 8px; display: block;"></i>Không tìm thấy tài khoản người dùng phù hợp.</td></tr>';
        return;
    }

    let html = '';
    filtered.forEach((u, idx) => {
        const isAdmin = u.role === 'admin';
        const isBlocked = !!u.is_blocked;
        const initial = (u.full_name || u.username || 'U').charAt(0).toUpperCase();

        const roleBadge = isAdmin
            ? '<span class="badge-role-tag admin"><i class="fa-solid fa-shield-halved"></i> Quản trị viên</span>'
            : '<span class="badge-role-tag user"><i class="fa-solid fa-user"></i> Người dùng</span>';

        const statusBadge = isBlocked
            ? '<span class="badge-status blocked"><i class="fa-solid fa-lock"></i> Đã bị khóa</span>'
            : '<span class="badge-status active"><i class="fa-solid fa-circle-check"></i> Hoạt động</span>';

        const isCurrentAdmin = u.username.toLowerCase() === (state.auth.username || '').toLowerCase();
        let actionButtons = '';

        if (isAdmin || isCurrentAdmin) {
            actionButtons = `
                <button class="btn-admin-action pwd" onclick="openAdminResetPassword('${u.username}', '${escapeHtml(u.full_name)}')" title="Đổi mật khẩu">
                    <i class="fa-solid fa-key"></i> Đổi MK
                </button>
                <button class="btn-admin-action logs" onclick="adminFilterUserLogs('${u.username}')" title="Xem nhật ký hoạt động">
                    <i class="fa-solid fa-clock-rotate-left"></i> Nhật ký
                </button>
            `;
        } else {
            actionButtons = `
                <button class="btn-admin-action ${isBlocked ? 'unblock' : 'block'}" onclick="adminToggleBlockUser('${u.username}', ${isBlocked})" title="${isBlocked ? 'Mở khóa tài khoản' : 'Khóa tài khoản này'}">
                    <i class="fa-solid ${isBlocked ? 'fa-lock-open' : 'fa-lock'}"></i> ${isBlocked ? 'Mở khóa' : 'Khóa'}
                </button>
                <button class="btn-admin-action pwd" onclick="openAdminResetPassword('${u.username}', '${escapeHtml(u.full_name)}')" title="Đổi mật khẩu cho người dùng này">
                    <i class="fa-solid fa-key"></i> Đổi MK
                </button>
                <button class="btn-admin-action logs" onclick="adminFilterUserLogs('${u.username}')" title="Xem nhật ký hoạt động của user này">
                    <i class="fa-solid fa-clock-rotate-left"></i> Nhật ký
                </button>
            `;
        }

        html += `
            <tr class="${isBlocked ? 'is-blocked' : ''}">
                <td style="text-align: center; font-weight: 600; color: #64748b;">${idx + 1}</td>
                <td>
                    <div class="user-identity">
                        <div class="user-avatar-sm ${isAdmin ? 'admin' : ''}">${initial}</div>
                        <div class="user-name-box">
                            <span class="user-uname">${escapeHtml(u.username)}</span>
                            <span class="user-fname">${escapeHtml(u.full_name || '')}</span>
                        </div>
                    </div>
                </td>
                <td>${roleBadge}</td>
                <td style="color: #64748b; font-size: 0.72rem;">${u.created_at || '—'}</td>
                <td style="color: #475569; font-size: 0.72rem; font-weight: 500;">${u.last_login || 'Chưa đăng nhập'}</td>
                <td>${statusBadge}</td>
                <td style="text-align: center;">
                    <div style="display: inline-flex; gap: 4px;">
                        ${actionButtons}
                    </div>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

function populateActivityUserFilter() {
    const sel = document.getElementById('select-filter-act-user');
    if (!sel) return;
    const currentVal = sel.value;
    let opts = '<option value="all">-- Toàn bộ hệ thống --</option>';
    adminUsersCache.forEach(u => {
        opts += `<option value="${escapeHtml(u.username)}">${escapeHtml(u.full_name || u.username)} (${escapeHtml(u.username)})</option>`;
    });
    sel.innerHTML = opts;
    if (currentVal) sel.value = currentVal;
}

async function loadAdminActivities(filterUser = 'all') {
    if (!state.auth || (!state.auth.is_admin && state.auth.role !== 'admin')) return;
    const tbody = document.getElementById('tbody-admin-activities');
    const badgeTotal = document.getElementById('badge-total-activities');
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 25px; color: #64748b;"><i class="fa-solid fa-spinner fa-spin"></i> Đang tải nhật ký hoạt động...</td></tr>';

    try {
        const uParam = (filterUser && filterUser !== 'all') ? `?username=${encodeURIComponent(filterUser)}` : '';
        const res = await fetch(`/api/auth/admin/activities${uParam}`, {
            headers: { 'Authorization': `Bearer ${state.auth.token}` }
        });
        const data = await res.json();
        if (res.ok && data.success) {
            adminActivitiesCache = data.activities || [];
            if (badgeTotal) badgeTotal.innerText = adminActivitiesCache.length;
            renderAdminActivitiesTable();
        } else {
            if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #ef4444; padding: 20px;">Lỗi: ${data.detail || ''}</td></tr>`;
        }
    } catch (e) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #ef4444; padding: 20px;">Lỗi kết nối máy chủ khi nạp nhật ký hoạt động.</td></tr>';
    }
}

function renderAdminActivitiesTable() {
    const tbody = document.getElementById('tbody-admin-activities');
    if (!tbody) return;

    const searchInput = document.getElementById('input-search-activities');
    const q = (searchInput ? searchInput.value : '').trim().toLowerCase();

    let filtered = adminActivitiesCache.filter(a => {
        return !q || (a.action && a.action.toLowerCase().includes(q)) || (a.details && a.details.toLowerCase().includes(q)) || (a.username && a.username.toLowerCase().includes(q));
    });

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 30px; color: #94a3b8;"><i class="fa-solid fa-clipboard-question" style="font-size: 1.5rem; margin-bottom: 8px; display: block;"></i>Không tìm thấy nhật ký hoạt động phù hợp.</td></tr>';
        return;
    }

    let html = '';
    filtered.forEach(a => {
        let actionIcon = 'fa-circle-info';
        let actionColor = '#0284c7';
        const actLower = (a.action || '').toLowerCase();

        if (actLower.includes('đăng nhập')) {
            actionIcon = actLower.includes('thất bại') || actLower.includes('từ chối') ? 'fa-triangle-exclamation' : 'fa-right-to-bracket';
            actionColor = actLower.includes('thất bại') || actLower.includes('từ chối') ? '#ef4444' : '#10b981';
        } else if (actLower.includes('đăng ký')) {
            actionIcon = 'fa-user-plus';
            actionColor = '#8b5cf6';
        } else if (actLower.includes('khóa')) {
            actionIcon = 'fa-lock';
            actionColor = '#f97316';
        } else if (actLower.includes('mật khẩu')) {
            actionIcon = 'fa-key';
            actionColor = '#3b82f6';
        } else if (actLower.includes('báo cáo')) {
            actionIcon = 'fa-file-pdf';
            actionColor = '#ec4899';
        } else if (actLower.includes('bản đồ') || actLower.includes('dự báo')) {
            actionIcon = 'fa-map-location-dot';
            actionColor = '#06b6d4';
        }

        html += `
            <tr>
                <td style="color: #64748b; font-size: 0.72rem; white-space: nowrap;"><i class="fa-regular fa-clock"></i> ${a.created_at || '—'}</td>
                <td><strong style="color: #0f172a;">${escapeHtml(a.username)}</strong></td>
                <td>
                    <span style="display: inline-flex; align-items: center; gap: 5px; font-weight: 600; color: ${actionColor};">
                        <i class="fa-solid ${actionIcon}"></i> ${escapeHtml(a.action)}
                    </span>
                </td>
                <td style="color: #334155; font-size: 0.74rem;">${escapeHtml(a.details || '')}</td>
                <td style="text-align: center; color: #94a3b8; font-size: 0.68rem; font-family: monospace;">${escapeHtml(a.ip_address || '127.0.0.1')}</td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

function setupAdminUserManagement() {
    const modal = document.getElementById('admin-users-modal');
    const btnClose = document.getElementById('btn-close-admin-users');
    const btnCloseFooter = document.getElementById('btn-close-admin-users-footer');
    const tabUsers = document.getElementById('tab-admin-users');
    const tabActivities = document.getElementById('tab-admin-activities');
    const viewUsers = document.getElementById('view-admin-users');
    const viewActivities = document.getElementById('view-admin-activities');

    const searchUsersInput = document.getElementById('input-search-users');
    const filterStatusSelect = document.getElementById('select-filter-user-status');
    const btnRefreshUsers = document.getElementById('btn-refresh-users');

    const filterActUserSelect = document.getElementById('select-filter-act-user');
    const searchActivitiesInput = document.getElementById('input-search-activities');
    const btnRefreshActivities = document.getElementById('btn-refresh-activities');

    const resetModal = document.getElementById('admin-reset-pwd-modal');
    const btnCloseReset = document.getElementById('btn-close-admin-reset-pwd');
    const btnCancelReset = document.getElementById('btn-cancel-admin-reset-pwd');
    const btnSubmitReset = document.getElementById('btn-submit-admin-reset-pwd');
    const resetNewPwd = document.getElementById('admin-reset-new-pwd');
    const resetConfirmPwd = document.getElementById('admin-reset-confirm-pwd');
    const resetAlert = document.getElementById('admin-reset-alert');
    let targetResetUsername = '';

    const closeModal = () => { if (modal) modal.style.display = 'none'; };
    if (btnClose) btnClose.addEventListener('click', closeModal);
    if (btnCloseFooter) btnCloseFooter.addEventListener('click', closeModal);

    if (tabUsers && tabActivities && viewUsers && viewActivities) {
        tabUsers.addEventListener('click', () => {
            tabUsers.classList.add('active');
            tabActivities.classList.remove('active');
            viewUsers.style.display = 'flex';
            viewActivities.style.display = 'none';
        });

        tabActivities.addEventListener('click', () => {
            tabActivities.classList.add('active');
            tabUsers.classList.remove('active');
            viewActivities.style.display = 'flex';
            viewUsers.style.display = 'none';
            if (adminActivitiesCache.length === 0) {
                loadAdminActivities();
            }
        });
    }

    if (btnRefreshUsers) btnRefreshUsers.addEventListener('click', loadAdminUsers);
    if (btnRefreshActivities) btnRefreshActivities.addEventListener('click', () => loadAdminActivities(filterActUserSelect ? filterActUserSelect.value : 'all'));

    if (searchUsersInput) searchUsersInput.addEventListener('input', renderAdminUsersTable);
    if (filterStatusSelect) filterStatusSelect.addEventListener('change', renderAdminUsersTable);

    if (filterActUserSelect) {
        filterActUserSelect.addEventListener('change', () => {
            loadAdminActivities(filterActUserSelect.value);
        });
    }
    if (searchActivitiesInput) searchActivitiesInput.addEventListener('input', renderAdminActivitiesTable);

    const closeResetModal = () => {
        if (resetModal) resetModal.style.display = 'none';
        if (resetNewPwd) resetNewPwd.value = '';
        if (resetConfirmPwd) resetConfirmPwd.value = '';
        if (resetAlert) resetAlert.style.display = 'none';
    };
    if (btnCloseReset) btnCloseReset.addEventListener('click', closeResetModal);
    if (btnCancelReset) btnCancelReset.addEventListener('click', closeResetModal);

    if (btnSubmitReset) {
        btnSubmitReset.addEventListener('click', async () => {
            const p1 = resetNewPwd.value.trim();
            const p2 = resetConfirmPwd.value.trim();
            if (!p1 || p1.length < 6) {
                if (resetAlert) {
                    resetAlert.style.display = 'block';
                    resetAlert.className = 'login-alert warning';
                    resetAlert.innerText = 'Mật khẩu mới phải có ít nhất 6 ký tự.';
                }
                return;
            }
            if (p1 !== p2) {
                if (resetAlert) {
                    resetAlert.style.display = 'block';
                    resetAlert.className = 'login-alert warning';
                    resetAlert.innerText = 'Mật khẩu xác nhận không khớp.';
                }
                return;
            }

            try {
                btnSubmitReset.disabled = true;
                btnSubmitReset.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang cập nhật...';
                const res = await fetch('/api/auth/admin/reset-password', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${state.auth.token}`
                    },
                    body: JSON.stringify({ username: targetResetUsername, new_password: p1 })
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    closeResetModal();
                    showToast(`Đã đổi mật khẩu cho tài khoản '${targetResetUsername}' thành công!`);
                    loadAdminUsers();
                } else {
                    if (resetAlert) {
                        resetAlert.style.display = 'block';
                        resetAlert.className = 'login-alert warning';
                        resetAlert.innerText = data.detail || 'Không thể cập nhật mật khẩu.';
                    }
                }
            } catch (err) {
                if (resetAlert) {
                    resetAlert.style.display = 'block';
                    resetAlert.className = 'login-alert warning';
                    resetAlert.innerText = 'Lỗi kết nối máy chủ.';
                }
            } finally {
                btnSubmitReset.disabled = false;
                btnSubmitReset.innerHTML = '<i class="fa-solid fa-check"></i> Cập nhật mật khẩu';
            }
        });
    }

    window.openAdminResetPassword = (uname, fname) => {
        targetResetUsername = uname;
        const targetUnameEl = document.getElementById('admin-reset-target-uname');
        const targetFnameEl = document.getElementById('admin-reset-target-fullname');
        if (targetUnameEl) targetUnameEl.innerText = uname;
        if (targetFnameEl) targetFnameEl.innerText = fname || uname;
        if (resetAlert) resetAlert.style.display = 'none';
        if (resetNewPwd) resetNewPwd.value = '';
        if (resetConfirmPwd) resetConfirmPwd.value = '';
        if (resetModal) resetModal.style.display = 'flex';
        if (resetNewPwd) resetNewPwd.focus();
    };

    window.adminToggleBlockUser = async (uname, currentBlocked) => {
        const actionText = currentBlocked ? 'Mở khóa' : 'Khóa';
        if (!confirm(`Bạn có chắc chắn muốn ${actionText.toLowerCase()} tài khoản '${uname}'?`)) return;

        try {
            const res = await fetch('/api/auth/admin/toggle-block', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${state.auth.token}`
                },
                body: JSON.stringify({ username: uname, blocked: !currentBlocked })
            });
            const data = await res.json();
            if (res.ok && data.success) {
                showToast(data.message);
                loadAdminUsers();
                loadAdminActivities();
            } else {
                alert(data.detail || 'Không thể thay đổi trạng thái tài khoản.');
            }
        } catch (e) {
            alert('Lỗi kết nối máy chủ.');
        }
    };

    window.adminFilterUserLogs = (uname) => {
        if (tabActivities) tabActivities.click();
        if (filterActUserSelect) {
            filterActUserSelect.value = uname;
            loadAdminActivities(uname);
        }
    };
}

// --- 18h. Module Tìm kiếm nhanh toàn cục 167 Phường / Xã ---
function setupGlobalWardSearch() {
    const searchInput = document.getElementById('global-ward-search-input');
    const searchContainer = document.getElementById('ward-search-container');
    const btnClear = document.getElementById('btn-clear-ward-search');
    const dropdown = document.getElementById('ward-search-dropdown');

    if (!searchInput || !dropdown) return;

    let highlightedIndex = -1;
    let results = [];

    // Bỏ dấu từng ký tự (giữ nguyên độ dài chuỗi) để tô đậm đúng đoạn khớp trên tên gốc có dấu
    const foldChars = (str) => Array.from(str || '').map(ch => removeVietnameseTones(ch) || ch).join('').toLowerCase();

    const highlight = (name, q) => {
        const chars = Array.from(name);
        const i = q ? foldChars(name).indexOf(q) : -1;
        if (i < 0) return escapeHtml(name);
        return escapeHtml(chars.slice(0, i).join('')) +
            `<mark>${escapeHtml(chars.slice(i, i + q.length).join(''))}</mark>` +
            escapeHtml(chars.slice(i + q.length).join(''));
    };

    const allWards = () => (state.wards.allList && state.wards.allList.length) ? state.wards.allList : (state.wards.list || []);

    const close = () => {
        dropdown.style.display = 'none';
        searchContainer.classList.remove('is-open');
        highlightedIndex = -1;
    };

    function render(items, q) {
        results = items;
        highlightedIndex = items.length ? 0 : -1;
        const key = state.activeRasterLayer;
        const prop = key === 'lst' ? 'lst_c' : key;

        if (!items.length) {
            dropdown.innerHTML = `<div class="ward-search-empty"><i class="fa-solid fa-magnifying-glass"></i> Không tìm thấy phường/xã “${escapeHtml(searchInput.value.trim())}”</div>`;
        } else {
            const head = q
                ? `<div class="ward-search-header"><span>Kết quả</span><span>${items.length} phường/xã</span></div>`
                : `<div class="ward-search-header"><span><i class="fa-solid fa-fire"></i> ${INDEX_META[key].label} cao nhất hiện tại</span><span>gõ tên để tìm</span></div>`;
            dropdown.innerHTML = head + items.map((w, idx) => {
                const v = w[prop];
                const has = v !== null && v !== undefined && !isNaN(v);
                const sw = has ? rgbCss(interpolateColor(key, Number(v))) : rgbCss(NODATA_RGBA);
                return `
                <div class="ward-search-item${idx === highlightedIndex ? ' highlighted' : ''}" data-id="${w.ward_id}" data-index="${idx}">
                    <span class="ward-item-swatch" style="background:${sw}"></span>
                    <div class="ward-item-main">
                        <div class="ward-item-name">${highlight(w.name || '', q)}</div>
                        <div class="ward-item-sub">${escapeHtml(w.district || '')}${w.rank ? ` · hạng #${w.rank}` : ''}</div>
                    </div>
                    <div class="ward-item-val">
                        <strong>${has ? formatIndexValue(Number(v), key, false) : '--'}</strong>
                        <small>${INDEX_META[key].label}${INDEX_META[key].unit ? ' ' + INDEX_META[key].unit : ''}</small>
                    </div>
                </div>`;
            }).join('');
        }
        dropdown.style.display = 'block';
        searchContainer.classList.add('is-open');
    }

    function doSearch() {
        const query = searchInput.value.trim();
        if (btnClear) btnClear.style.display = query ? 'inline-flex' : 'none';
        searchContainer.classList.toggle('has-value', !!query);

        const list = allWards();
        const key = state.activeRasterLayer;
        const prop = key === 'lst' ? 'lst_c' : key;
        if (!query) {
            // Chưa gõ: gợi ý các phường/xã có giá trị chỉ số đang xem cao nhất
            const top = list.filter(w => w[prop] !== null && w[prop] !== undefined && !isNaN(w[prop]))
                .sort((a, b) => (key === 'ndvi' ? a[prop] - b[prop] : b[prop] - a[prop]))
                .slice(0, 6);
            render(top, '');
            return;
        }

        const q = foldChars(query);
        const scored = [];
        list.forEach(w => {
            const name = foldChars(w.name || '');
            const bare = name.replace(/^(phuong|xa|dac khu)\s+/, '');
            const dist = foldChars(w.district || '');
            let score = -1;
            if (bare.startsWith(q) || name.startsWith(q)) score = 0;
            else if (name.includes(q)) score = 1;
            else if (dist.includes(q)) score = 2;
            if (score >= 0) scored.push({ w, score });
        });
        scored.sort((a, b) => a.score - b.score || (a.w.name || '').localeCompare(b.w.name || '', 'vi'));
        render(scored.slice(0, 12).map(s => s.w), q);
    }

    function choose(idx) {
        const w = results[idx];
        if (!w) return;
        searchInput.value = w.name;
        if (btnClear) btnClear.style.display = 'inline-flex';
        searchContainer.classList.add('has-value');
        close();
        searchInput.blur();
        selectWard(w.ward_id, false);
    }

    function updateHighlight() {
        dropdown.querySelectorAll('.ward-search-item').forEach((item, idx) => {
            item.classList.toggle('highlighted', idx === highlightedIndex);
            if (idx === highlightedIndex) item.scrollIntoView({ block: 'nearest' });
        });
    }

    searchInput.addEventListener('input', doSearch);
    searchInput.addEventListener('focus', () => {
        searchInput.select();
        doSearch();
    });

    dropdown.addEventListener('mousedown', (e) => e.preventDefault());   // giữ focus ô nhập khi bấm chọn
    dropdown.addEventListener('click', (e) => {
        const item = e.target.closest('.ward-search-item');
        if (item) choose(parseInt(item.dataset.index, 10));
    });

    if (btnClear) {
        btnClear.addEventListener('click', (e) => {
            e.stopPropagation();
            searchInput.value = '';
            btnClear.style.display = 'none';
            searchContainer.classList.remove('has-value');
            if (wardHighlightLayerGroup) wardHighlightLayerGroup.clearLayers();
            state.wards.selectedWardId = null;
            searchInput.focus();
        });
    }

    // Điều khiển bằng phím mũi tên, Enter, Esc
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            close();
            searchInput.blur();
            return;
        }
        if (dropdown.style.display === 'none') {
            if (e.key === 'ArrowDown') doSearch();
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            highlightedIndex = Math.min(results.length - 1, highlightedIndex + 1);
            updateHighlight();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            highlightedIndex = Math.max(0, highlightedIndex - 1);
            updateHighlight();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            choose(highlightedIndex >= 0 ? highlightedIndex : 0);
        }
    });

    // Phím tắt "/" để tìm nhanh
    document.addEventListener('keydown', (e) => {
        if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
        e.preventDefault();
        searchInput.focus();
    });

    // Đóng danh sách khi bấm ra ngoài
    document.addEventListener('click', (e) => {
        if (searchContainer && !searchContainer.contains(e.target)) close();
    });
}

// --- 19. Khởi động toàn bộ ứng dụng khi tài liệu sẵn sàng ---
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Kiểm tra trạng thái PostGIS
    try {
        const res = await fetch('/health');
        const h = await res.json();
        const statusEl = document.getElementById('system-status');
        if (statusEl && h.status === 'ok') {
            const dot = statusEl.querySelector('.status-dot');
            const txt = statusEl.querySelector('.status-text');
            if (dot) dot.className = 'status-dot online';
            if (txt) txt.innerText = 'PostGIS: Đã kết nối';
        }
    } catch (e) {
        console.warn('Lỗi kết nối máy chủ PostGIS:', e);
    }

    // 2. Khởi tạo bản đồ
    try {
        initMap();
    } catch (e) {
        console.error('Lỗi khởi tạo bản đồ:', e);
    }

    // 2b. Nút chọn chỉ số LST/NDVI/TVDI, kiểu hiển thị Pixel/Phường, bản đồ nền, tổng hợp thời gian & đồng hồ
    try {
        setupMapDisplayControls();
        startHeaderClock();
    } catch (e) {
        console.error('Lỗi thiết lập điều khiển hiển thị bản đồ:', e);
    }

    // 3. Thiết lập các nút điều khiển lớp GEE
    try {
        setupGEELayerControls();
    } catch (e) {
        console.error('Lỗi thiết lập lớp GEE:', e);
    }

    // 4. Thiết lập GEE Modal & kiểm tra trạng thái GEE Live
    try {
        setupGEEModal();
        await checkGEEConnection();
    } catch (e) {
        console.error('Lỗi kiểm tra GEE:', e);
    }

    // 5. Thiết lập biểu đồ
    try {
        setupChartTabs();
        setupChartModes();
    } catch (e) {
        console.error('Lỗi thiết lập Tabs & Chế độ biểu đồ:', e);
    }

    // 6. Thiết lập điều khiển và thông số AI
    try {
        setupAIControls();
        await initAIMetrics();
    } catch (e) {
        console.error('Lỗi thiết lập AI:', e);
    }

    // 7. Thiết lập nút ẩn / hiện cho Chú giải & Thanh trượt nổi
    try {
        setupCollapsibleWidgets();
    } catch (e) {
        console.error('Lỗi thiết lập nút ẩn/hiện:', e);
    }

    // 8. Khởi tạo chuỗi thời gian & mốc ngày
    try {
        await initTimeline();
    } catch (e) {
        console.error('Lỗi khởi tạo chuỗi thời gian:', e);
    }

    // 9. Nạp biểu đồ chu kỳ 15 ngày toàn vùng ban đầu
    try {
        await loadOverallTimeSeries();
    } catch (e) {
        console.error('Lỗi nạp dự báo 15 ngày ban đầu:', e);
    }

    // 10. Thiết lập Báo cáo xuất PDF A4 & Excel CSV (Ý 1)
    try {
        setupReportModal();
    } catch (e) {
        console.error('Lỗi thiết lập Báo cáo:', e);
    }

    // 11. Thiết lập tương tác Bottom Sheet trên Mobile (Ý 3)
    try {
        setupMobileSheet();
    } catch (e) {
        console.error('Lỗi thiết lập Mobile Sheet:', e);
    }

    // 12. Thiết lập Phân quyền Admin & Đăng nhập (Yêu cầu 7)
    try {
        setupAuth();
    } catch (e) {
        console.error('Lỗi thiết lập Phân quyền:', e);
    }

    // 13. Thiết lập Tabs chuyển đổi Sidebar (Phân tích vs 167 Phường)
    try {
        setupSidebarTabs();
    } catch (e) {
        console.error('Lỗi thiết lập Sidebar Tabs:', e);
    }

    // 14. Thiết lập Danh sách & Bộ lọc 167 Phường (Yêu cầu 1 & 2)
    try {
        setupWardsModule();
    } catch (e) {
        console.error('Lỗi thiết lập Module 167 Phường:', e);
    }

    // 15. Thiết lập Chế độ xem 2D / 3D (Yêu cầu 4)
    try {
        setup3DView();
    } catch (e) {
        console.error('Lỗi thiết lập 3D View:', e);
    }

    // 16. Thiết lập Trình chiếu Animation theo chuỗi thời gian (Yêu cầu 4)
    try {
        setupAnimationController();
    } catch (e) {
        console.error('Lỗi thiết lập Animation:', e);
    }

    // 17. Tải dữ liệu ban đầu cho 167 Phường
    try {
        await loadWardsData(state.currentDate);
    } catch (e) {
        console.error('Lỗi tải dữ liệu 167 Phường ban đầu:', e);
    }

    // 17b. Thiết lập Thanh tìm kiếm toàn cục 167 Phường / Xã
    try {
        setupGlobalWardSearch();
    } catch (e) {
        console.error('Lỗi thiết lập Tìm kiếm 167 Phường:', e);
    }

    // 18. Thiết lập Quản lý Người dùng & Nhật ký cho Admin
    try {
        setupAdminUserManagement();
    } catch (e) {
        console.error('Lỗi thiết lập Quản trị Người dùng:', e);
    }
});
