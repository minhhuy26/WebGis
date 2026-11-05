/**
 * ============================================================================
 * WebGIS TVDI TP. Hồ Chí Minh – Bản đồ 3D (MapLibre GL JS)
 * - Chế độ "Phường/Xã": khối 3D cho 167 phường/xã, chiều cao & màu theo chỉ số đang chọn.
 * - Chế độ "Pixel": cột 3D ~1,3 km lấy trung bình từ lớp pixel 120 m (cùng dữ liệu với bản đồ 2D).
 * - Chuyển 2D ↔ 3D liền mạch: camera 3D đặt đúng tâm / mức zoom của bản đồ 2D, mờ dần giữa
 *   hai bản đồ rồi nghiêng camera và "mọc" khối lên (ngược lại khi quay về 2D).
 * Nền bản đồ đồng bộ với lựa chọn "Bản đồ nền" của bản đồ 2D.
 * ============================================================================
 */

const MAP3D_DEFAULT_VIEW = { center: [106.80, 10.80], zoom: 8.5, pitch: 58, bearing: -14 };
const MAP3D_ENTER_VIEW = { pitch: 55, bearing: -12 };
const MAP3D_PIXEL_STEP = 0.012;     // Kích thước cột pixel 3D (độ, ~1,3 km)
const MAP3D_MAX_HEIGHT = 9000;      // Chiều cao tối đa (m) khi hệ số phóng đại = 1
const MAP3D_FADE_MS = 420;          // Thời gian mờ dần giữa bản đồ 2D và 3D (khớp CSS)
const MAP3D_EMPTY_FC = { type: 'FeatureCollection', features: [] };

function map3dTileUrls(def) {
    if (!def || !def.url) return null;
    const url = def.url.replace('{r}', '');
    if (url.includes('{s}')) {
        return (def.subdomains || 'abc').split('').map(s => url.replace('{s}', s));
    }
    return [url];
}

function build3DStyle() {
    return {
        version: 8,
        sources: {},
        layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#e5e7eb' } }],
    };
}

const wait3D = (ms) => new Promise(r => setTimeout(r, ms));
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function init3DMap() {
    if (state.map3d.map) return true;
    if (typeof maplibregl === 'undefined') {
        showToast('Không tải được thư viện bản đồ 3D (MapLibre GL). Vui lòng kiểm tra kết nối Internet.');
        return false;
    }

    let m;
    try {
        m = new maplibregl.Map({
            container: 'map-3d-container',
            style: build3DStyle(),
            center: MAP3D_DEFAULT_VIEW.center,
            zoom: MAP3D_DEFAULT_VIEW.zoom,
            pitch: 0,
            bearing: 0,
            maxPitch: 80,
            minZoom: 6,
            maxZoom: 16,
            fadeDuration: 0,
            attributionControl: { compact: true },
        });
    } catch (e) {
        console.error('Không khởi tạo được bản đồ 3D:', e);
        showToast('Trình duyệt không hỗ trợ WebGL nên không thể hiển thị bản đồ 3D.');
        return false;
    }

    // Phóng to / thu nhỏ / hướng Bắc dùng chung cụm nút công cụ bên phải (map-decor.js)
    m.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right');
    state.map3d.map = m;
    state.map3d.ready = false;
    state.map3d.growth = 0;
    state.map3d.readyPromise = new Promise(resolve => {
        m.on('load', () => {
            add3DLayers(m);
            state.map3d.ready = true;
            apply3DBasemap();
            update3DData();
            resolve();
        });
    });

    // Lỗi tải ô nền (mất mạng) không làm gián đoạn bản đồ
    m.on('error', (e) => {
        const msg = e && e.error && e.error.message ? e.error.message : '';
        if (msg) console.warn('Bản đồ 3D:', msg);
    });

    // Dừng xoay tự động khi người dùng tương tác; mũi tên Bắc xoay theo camera
    ['mousedown', 'touchstart', 'wheel'].forEach(ev => m.on(ev, () => stop3DRotation()));
    m.on('rotate', () => setNorthArrowBearing(m.getBearing()));
    return true;
}

// Vùng ngoài ranh giới TP.HCM được làm mờ giống bản đồ 2D
function build3DMaskGeoJSON() {
    if (!state.boundaryGeoJson || !state.boundaryGeoJson.features) return MAP3D_EMPTY_FC;
    const holes = [];
    state.boundaryGeoJson.features.forEach(feat => {
        const geom = feat.geometry;
        if (!geom) return;
        const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
        polys.forEach(poly => { if (poly && poly[0]) holes.push(poly[0]); });
    });
    const world = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
    return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [world, ...holes] }, properties: {} };
}

function add3DLayers(m) {
    m.addSource('mask3d', { type: 'geojson', data: build3DMaskGeoJSON() });
    m.addSource('pixels3d', { type: 'geojson', data: MAP3D_EMPTY_FC });
    m.addSource('wards3d', { type: 'geojson', data: MAP3D_EMPTY_FC });
    m.addSource('boundary3d', { type: 'geojson', data: state.boundaryGeoJson || MAP3D_EMPTY_FC });

    m.addLayer({
        id: 'mask3d-fill',
        type: 'fill',
        source: 'mask3d',
        paint: { 'fill-color': '#ffffff', 'fill-opacity': state.mapDecor.mask ? 0.42 : 0 },
    });
    const heightExpr = map3dHeightExpr();
    m.addLayer({
        id: 'pixels3d-ext',
        type: 'fill-extrusion',
        source: 'pixels3d',
        paint: {
            'fill-extrusion-color': ['get', 'color'],
            'fill-extrusion-height': heightExpr,
            'fill-extrusion-base': 0,
            'fill-extrusion-opacity': 0.95,
        },
    });
    m.addLayer({
        id: 'wards3d-ext',
        type: 'fill-extrusion',
        source: 'wards3d',
        paint: {
            'fill-extrusion-color': ['get', 'color'],
            'fill-extrusion-height': heightExpr,
            'fill-extrusion-base': 0,
            'fill-extrusion-opacity': 0.92,
        },
    });
    m.addLayer({
        id: 'boundary3d-line',
        type: 'line',
        source: 'boundary3d',
        paint: { 'line-color': '#111827', 'line-width': 1.6, 'line-opacity': 0.85 },
    });

    // Chú thích khi rê chuột & chọn đối tượng
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10, className: 'map3d-popup' });
    ['wards3d-ext', 'pixels3d-ext'].forEach(layerId => {
        m.on('mousemove', layerId, (e) => {
            const f = e.features && e.features[0];
            if (!f) return;
            m.getCanvas().style.cursor = 'pointer';
            const p = f.properties || {};
            const key = state.activeRasterLayer;
            const title = layerId === 'wards3d-ext' ? (p.name || 'Phường / Xã') : `${e.lngLat.lat.toFixed(4)}°N, ${e.lngLat.lng.toFixed(4)}°E`;
            const valTxt = (p.value === null || p.value === undefined || p.value === '') ? 'Không có dữ liệu' : formatIndexValue(Number(p.value), key);
            popup.setLngLat(e.lngLat)
                .setHTML(`<div class="map3d-popup-body"><strong>${title}</strong><br>${INDEX_META[key].label}: <b>${valTxt}</b></div>`)
                .addTo(m);
        });
        m.on('mouseleave', layerId, () => {
            m.getCanvas().style.cursor = '';
            popup.remove();
        });
    });
    m.on('click', 'wards3d-ext', (e) => {
        const f = e.features && e.features[0];
        const id = f && f.properties ? Number(f.properties.ward_id) : NaN;
        if (!isNaN(id) && id > 0) selectWard(id, true);
    });
    m.on('click', 'pixels3d-ext', (e) => {
        handleMapClick({ latlng: { lat: e.lngLat.lat, lng: e.lngLat.lng } });
    });
}

// Đồng bộ bản đồ nền 3D với lựa chọn của bản đồ 2D
function apply3DBasemap() {
    const m = state.map3d.map;
    if (!m || !state.map3d.ready) return;
    if (m.getLayer('basemap')) m.removeLayer('basemap');
    if (m.getSource('basemap')) m.removeSource('basemap');
    const def = BASEMAP_DEFS[state.activeBaseMap];
    const tiles = map3dTileUrls(def);
    if (!tiles) return;
    m.addSource('basemap', {
        type: 'raster',
        tiles,
        tileSize: 256,
        maxzoom: def.maxZoom || 19,
        attribution: def.attribution || '',
    });
    m.addLayer({ id: 'basemap', type: 'raster', source: 'basemap', paint: { 'raster-fade-duration': 0 } }, 'mask3d-fill');
}

function apply3DMask() {
    const m = state.map3d.map;
    if (!m || !state.map3d.ready) return;
    if (m.getSource('mask3d')) m.getSource('mask3d').setData(build3DMaskGeoJSON());
    if (m.getLayer('mask3d-fill')) m.setPaintProperty('mask3d-fill', 'fill-opacity', state.mapDecor.mask ? 0.42 : 0);
}

function heightForValue(value, key) {
    const cfg = GEE_COLOR_PALETTES[key];
    const t = Math.max(0, Math.min(1, (value - cfg.min) / (cfg.max - cfg.min)));
    return Math.round(150 + t * MAP3D_MAX_HEIGHT);
}

// Cột pixel 3D: trung bình lớp pixel 120 m đang hiển thị (hoặc lưới nội suy khi chưa có ảnh pixel)
function build3DPixelColumns(key) {
    const features = [];
    const field = getActivePixelField(key);
    const grid = field ? null : computeRasterGrid(key);
    const box = field ? getPixelBounds() : (grid ? { west: grid.minLon, south: grid.minLat, east: grid.maxLon, north: grid.maxLat } : null);
    if (!box) return features;

    const step = MAP3D_PIXEL_STEP;
    const half = step * 0.5;
    const pad = step * 0.48;
    for (let lat = box.south + half; lat < box.north; lat += step) {
        for (let lon = box.west + half; lon < box.east; lon += step) {
            let v;
            if (field) {
                v = pixelBlockMean(field, lat, lon, half);
                if (v === undefined || v === null) continue;
            } else {
                v = sampleRasterGrid(grid, lat, lon);
                if (v === null) continue;
            }
            features.push({
                type: 'Feature',
                geometry: {
                    type: 'Polygon',
                    coordinates: [[
                        [lon - pad, lat - pad], [lon + pad, lat - pad],
                        [lon + pad, lat + pad], [lon - pad, lat + pad], [lon - pad, lat - pad],
                    ]],
                },
                properties: { value: v, color: rgbCss(interpolateColor(key, v)), h: heightForValue(v, key) },
            });
        }
    }
    return features;
}

// Cập nhật dữ liệu khối 3D theo chỉ số, kiểu hiển thị và mốc thời gian hiện tại
function update3DData() {
    const m = state.map3d.map;
    if (!m || !state.map3d.ready) return;
    const key = state.activeRasterLayer;

    if (m.getSource('boundary3d') && state.boundaryGeoJson) {
        m.getSource('boundary3d').setData(state.boundaryGeoJson);
    }
    apply3DMask();

    if (state.displayMode === 'ward') {
        const valueMap = buildWardValueMap(key);
        const features = ((state.wardsBoundaryGeoJson && state.wardsBoundaryGeoJson.features) || []).map(f => {
            const name = (f.properties && (f.properties.fullName || f.properties.name)) || '';
            const info = valueMap.get(removeVietnameseTones(name));
            const ok = info && info.value !== null;
            return {
                type: 'Feature',
                geometry: f.geometry,
                properties: {
                    name,
                    ward_id: ok ? info.ward.ward_id : 0,
                    value: ok ? info.value : null,
                    color: ok ? rgbCss(interpolateColor(key, info.value)) : rgbCss(NODATA_RGBA),
                    h: ok ? heightForValue(info.value, key) : 60,
                },
            };
        });
        m.getSource('wards3d').setData({ type: 'FeatureCollection', features });
        m.getSource('pixels3d').setData(MAP3D_EMPTY_FC);
    } else {
        m.getSource('pixels3d').setData({ type: 'FeatureCollection', features: build3DPixelColumns(key) });
        m.getSource('wards3d').setData(MAP3D_EMPTY_FC);
    }
}

// Chiều cao khối = h × hệ số phóng đại × mức "mọc" (0 → 1 khi chuyển cảnh); tối thiểu 1 m để mặt khối luôn hiện màu
function map3dHeightExpr() {
    const k = (state.map3d.exaggeration || 1) * (state.map3d.growth ?? 1);
    return ['+', 1, ['*', ['get', 'h'], k]];
}

function apply3DExaggeration() {
    const m = state.map3d.map;
    if (!m || !state.map3d.ready) return;
    const expr = map3dHeightExpr();
    ['pixels3d-ext', 'wards3d-ext'].forEach(id => {
        if (m.getLayer(id)) m.setPaintProperty(id, 'fill-extrusion-height', expr);
    });
}

function animate3DGrowth(to, duration) {
    cancelAnimationFrame(state.map3d.growRaf);
    const from = state.map3d.growth ?? 1;
    return new Promise(resolve => {
        const t0 = performance.now();
        const step = (now) => {
            const t = Math.min(1, (now - t0) / duration);
            state.map3d.growth = from + (to - from) * easeInOutCubic(t);
            apply3DExaggeration();
            if (t < 1) state.map3d.growRaf = requestAnimationFrame(step);
            else resolve();
        };
        state.map3d.growRaf = requestAnimationFrame(step);
    });
}

// Chờ bản đồ 3D vẽ xong ô nền (tối đa `timeout` ms) để lúc hiện lên không bị trống
function wait3DIdle(m, timeout) {
    return new Promise(resolve => {
        if (m.loaded() && m.areTilesLoaded()) { resolve(); return; }
        const done = () => { clearTimeout(timer); m.off('idle', done); resolve(); };
        const timer = setTimeout(done, timeout);
        m.on('idle', done);
    });
}

// Chờ lớp nền 2D tải xong ô ảnh tại khung nhìn mới (tối đa `timeout` ms)
function waitLeafletTiles(timeout) {
    let layer = state.baseMaps && state.baseMaps[state.activeBaseMap];
    if (layer && layer.getLayers) layer = layer.getLayers()[0];
    if (!layer || typeof layer.isLoading !== 'function') return wait3D(120);
    return new Promise(resolve => {
        const done = () => { clearTimeout(timer); layer.off('load', done); resolve(); };
        const timer = setTimeout(done, timeout);
        layer.on('load', done);
        setTimeout(() => { if (!layer.isLoading()) done(); }, 60);
    });
}

// 2D → 3D: đặt camera 3D trùng khung nhìn 2D, mờ dần sang 3D, nghiêng camera & mọc khối
async function enter3DView() {
    if (!init3DMap()) return false;
    const m = state.map3d.map;
    const container = document.getElementById('map-3d-container');
    const mapEl = document.getElementById('map');
    const c = map.getCenter();

    m.resize();
    m.stop();
    // Leaflet dùng ô 256 px, MapLibre định nghĩa mức zoom theo ô 512 px -> lệch đúng 1 mức
    m.jumpTo({ center: [c.lng, c.lat], zoom: map.getZoom() - 1, pitch: 0, bearing: 0 });
    state.map3d.growth = 0;
    await state.map3d.readyPromise;
    if (state.viewMode !== '3d') return true;
    apply3DBasemap();
    update3DData();
    apply3DExaggeration();
    await wait3DIdle(m, 900);
    if (state.viewMode !== '3d') return true;

    container.classList.add('is-visible');
    await wait3D(MAP3D_FADE_MS);
    if (state.viewMode !== '3d') return true;
    mapEl.classList.add('is-behind');
    m.easeTo({ ...MAP3D_ENTER_VIEW, duration: 1300, easing: easeInOutCubic });
    await animate3DGrowth(1, 1300);
    return true;
}

// 3D → 2D: hạ khối & đưa camera về nhìn thẳng, đồng bộ khung nhìn sang bản đồ 2D rồi mờ dần
async function exit3DView() {
    const m = state.map3d.map;
    const container = document.getElementById('map-3d-container');
    const mapEl = document.getElementById('map');
    stop3DRotation();
    if (!m) {
        container.classList.remove('is-visible');
        mapEl.classList.remove('is-behind');
        return;
    }

    // Mức zoom đích phải biểu diễn được trên Leaflet (zoomSnap 0.25) để hai bản đồ khớp tuyệt đối
    const snap = map.options.zoomSnap || 1;
    const z2d = Math.min(map.getMaxZoom(), Math.max(map.getMinZoom(), Math.round((m.getZoom() + 1) / snap) * snap));
    m.stop();
    m.easeTo({ pitch: 0, bearing: 0, zoom: z2d - 1, duration: 900, easing: easeInOutCubic });
    await animate3DGrowth(0, 900);
    await wait3D(30);

    const c = m.getCenter();
    mapEl.classList.remove('is-behind');
    map.invalidateSize();
    map.setView([c.lat, c.lng], z2d, { animate: false });
    await waitLeafletTiles(700);
    container.classList.remove('is-visible');
    setNorthArrowBearing(0);
}

function resize3DMap() {
    if (state.map3d.map) state.map3d.map.resize();
}

function reset3DCamera() {
    stop3DRotation();
    if (!state.map3d.map) return;
    state.map3d.map.flyTo({ ...MAP3D_DEFAULT_VIEW, duration: 1200 });
}

// Xoay camera chậm quanh khu vực nghiên cứu
function start3DRotation() {
    const m = state.map3d.map;
    if (!m || state.map3d.rotating) return;
    state.map3d.rotating = true;
    const btn = document.getElementById('btn-3d-rotate');
    if (btn) btn.classList.add('active');
    const step = () => {
        if (!state.map3d.rotating || state.viewMode !== '3d') {
            state.map3d.rotating = false;
            if (btn) btn.classList.remove('active');
            return;
        }
        m.setBearing(m.getBearing() + 0.12);
        requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}

function stop3DRotation() {
    state.map3d.rotating = false;
    const btn = document.getElementById('btn-3d-rotate');
    if (btn) btn.classList.remove('active');
}

// Bay tới phường/xã được chọn khi đang ở chế độ 3D
function flyTo3D(lat, lon) {
    const m = state.map3d.map;
    if (!m || state.viewMode !== '3d') return;
    stop3DRotation();
    m.flyTo({ center: [lon, lat], zoom: 11.5, pitch: 60, duration: 1200 });
}
