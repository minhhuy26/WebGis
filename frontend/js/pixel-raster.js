/**
 * ============================================================================
 * WebGIS TVDI TP. Hồ Chí Minh – Lớp ảnh Pixel ~120 m (LST / NDVI / TVDI)
 * - Ảnh tháng Landsat 8/9 (GEE) mã hóa 8-bit: 0 = không có dữ liệu, 1..255 = giá trị
 *   (sinh bởi backend/scripts/build_pixel_rasters.py, phục vụ tại /static/data/raster/).
 * - Kỳ / mốc không có ảnh tháng (dự báo AI, kỳ thiếu ảnh): lưới ~5,5 km nội suy
 *   + thành phần chi tiết không gian 120 m theo khí hậu tháng ("chi tiết hóa").
 * - TVDI: ảnh GEE dùng biên khô / ướt khác PostGIS nên luôn "chi tiết hóa" – giá trị nền từ lưới
 *   của hệ thống, chi tiết 120 m từ ảnh Landsat cùng tháng (meta.indices.TVDI.residual).
 * - Tô màu phía trình duyệt theo thang màu đang chọn, cắt theo ranh giới đất liền,
 *   chuyển khung mờ dần (crossfade) để trình chiếu mượt.
 * Dùng chung `state`, `map`, `rasterLayerGroup` và các hàm màu khai báo trong app.js.
 * ============================================================================
 */

const PIXEL_BASE_URL = '/static/data/raster';
const PIXEL_CACHE_LIMIT = 24;       // số ảnh PNG đã giải mã giữ trong bộ nhớ (~1,3 MB / ảnh)
const PIXEL_FIELD_CACHE_LIMIT = 4;  // số trường giá trị đã tính (dùng lại khi lùi / tiến khung)
const PIXEL_FADE_MS = 380;

const pixelRaster = {
    meta: null,
    metaPromise: null,
    decoded: new Map(),     // url -> Promise<Uint8Array>
    fields: new Map(),      // cacheKey -> field
    field: null,            // trường giá trị đang hiển thị
    geo: null,              // lưới tọa độ & mặt nạ ranh giới (tính một lần)
};

// Lớp phủ dùng trực tiếp phần tử <canvas> (không phải mã hóa lại thành ảnh PNG)
const CanvasOverlay = L.ImageOverlay.extend({
    _initImage: function () {
        const el = this._image = this._url;
        L.DomUtil.addClass(el, 'leaflet-image-layer');
        if (this._zoomAnimated) L.DomUtil.addClass(el, 'leaflet-zoom-animated');
        if (this.options.className) L.DomUtil.addClass(el, this.options.className);
        el.onselectstart = L.Util.falseFn;
        el.onmousemove = L.Util.falseFn;
        this._updateOpacity();
    },
});

function mercY(lat) {
    return Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
}

function loadPixelMeta() {
    if (!pixelRaster.metaPromise) {
        pixelRaster.metaPromise = fetch(`${PIXEL_BASE_URL}/meta.json`)
            .then(r => (r.ok ? r.json() : null))
            .then(meta => { pixelRaster.meta = meta; return meta; })
            .catch(() => null);
    }
    return pixelRaster.metaPromise;
}

function pixelUrl(key, name) {
    const idx = key.toUpperCase();
    return `${PIXEL_BASE_URL}/${idx}/${idx}_${name}.png`;
}

// Giải mã ảnh PNG xám 8-bit thành mảng mã (kênh R)
function decodePixelPng(url) {
    if (pixelRaster.decoded.has(url)) {
        const p = pixelRaster.decoded.get(url);
        pixelRaster.decoded.delete(url);       // đưa lên cuối (LRU)
        pixelRaster.decoded.set(url, p);
        return p;
    }
    const p = new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const c = document.createElement('canvas');
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            const ctx = c.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(img, 0, 0);
            const rgba = ctx.getImageData(0, 0, c.width, c.height).data;
            const out = new Uint8Array(c.width * c.height);
            for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4];
            resolve(out);
        };
        img.onerror = () => reject(new Error(`Không tải được ${url}`));
        img.src = url;
    });
    p.catch(() => pixelRaster.decoded.delete(url));
    pixelRaster.decoded.set(url, p);
    while (pixelRaster.decoded.size > PIXEL_CACHE_LIMIT) {
        pixelRaster.decoded.delete(pixelRaster.decoded.keys().next().value);
    }
    return p;
}

// Kinh / vĩ độ tâm từng cột / hàng pixel và mặt nạ ranh giới đất liền TP.HCM
function getPixelGeometry() {
    const meta = pixelRaster.meta;
    const geo = getMainlandGeometry();
    if (!meta || !geo) return null;
    if (pixelRaster.geo && pixelRaster.geo.src === geo) return pixelRaster.geo;

    const [west, south, east, north] = meta.bounds;
    const w = meta.width, h = meta.height;
    const yN = mercY(north), yS = mercY(south);
    const lons = new Float64Array(w);
    const lats = new Float64Array(h);
    for (let x = 0; x < w; x++) lons[x] = west + (x + 0.5) / w * (east - west);
    for (let y = 0; y < h; y++) {
        const my = yN - (y + 0.5) / h * (yN - yS);
        lats[y] = (2 * Math.atan(Math.exp(my)) - Math.PI / 2) * 180 / Math.PI;
    }

    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.beginPath();
    geo.rings.forEach(ring => {
        ring.forEach((pt, i) => {
            const px = (pt[0] - west) / (east - west) * w;
            const py = (yN - mercY(pt[1])) / (yN - yS) * h;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        });
        ctx.closePath();
    });
    ctx.fillStyle = '#000';
    ctx.fill('evenodd');
    const alpha = ctx.getImageData(0, 0, w, h).data;
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < mask.length; i++) mask[i] = alpha[i * 4 + 3] >= 128 ? 1 : 0;

    pixelRaster.geo = { src: geo, w, h, west, south, east, north, yN, yS, lons, lats, mask };
    return pixelRaster.geo;
}

// Ảnh Landsat ứng với mốc đang xem: { name, when } hoặc null nếu không có
function findPixelImage(info, view) {
    const month = (view.date || view.start || '').substring(0, 7);
    if (view.kind === 'cycle' || (view.kind === 'aggregate' && view.agg === 'month')) {
        if (info.months.includes(month)) return { name: month.replace('-', '_'), when: `tháng ${month.substring(5)}/${month.substring(0, 4)}` };
    } else if (view.kind === 'aggregate' && view.agg === 'year') {
        const y = view.start.substring(0, 4);
        if (info.years.includes(y)) return { name: `Y_${y}`, when: `TB năm ${y}` };
    } else if (view.kind === 'aggregate' && view.agg === 'period') {
        return { name: 'ALL', when: `TB ${info.months[0].substring(0, 4)}–${info.months[info.months.length - 1].substring(0, 4)}` };
    }
    return null;
}

// Chọn nguồn ảnh cho mốc đang xem: ảnh tháng / TB năm / TB giai đoạn, hoặc chi tiết hóa lưới
function resolvePixelSource(key, view) {
    const info = pixelRaster.meta && pixelRaster.meta.indices[key.toUpperCase()];
    if (!info || !view) return null;
    const month = (view.date || view.start || '').substring(0, 7);
    const img = view.kind === 'forecast' ? null : findPixelImage(info, view);
    if (img && info.residual) {
        // Ảnh chỉ chứa chi tiết 120 m: cộng vào lưới của hệ thống để giữ đúng thang giá trị
        return { type: 'downscale', url: pixelUrl(key, img.name), detail: info.detail, label: `lưới ~5,5 km + chi tiết 120 m ảnh Landsat ${img.when}` };
    }
    if (img) {
        return { type: 'image', url: pixelUrl(key, img.name), label: `ảnh Landsat ${img.when} · pixel 120 m` };
    }
    if (!info.detail || !month) return null;
    const mm = month.substring(5, 7);
    return {
        type: 'downscale',
        url: pixelUrl(key, `DETAIL_${mm}`),
        detail: info.detail,
        label: view.kind === 'forecast'
            ? 'lưới dự báo ~5,5 km chi tiết hóa 120 m theo ảnh Landsat cùng tháng'
            : 'lưới quan trắc ~5,5 km chi tiết hóa 120 m (tháng này không có ảnh Landsat)',
    };
}

// Nội suy song tuyến trên lưới IDW (~275 m) – mịn hơn lấy pixel gần nhất
function sampleGridSmooth(grid, lat, lon) {
    const fx = (lon - grid.minLon) / grid.px - 0.5;
    const fy = (grid.maxLat - lat) / grid.px - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    let s = 0, ws = 0;
    for (let dy = 0; dy <= 1; dy++) {
        const y = y0 + dy;
        if (y < 0 || y >= grid.h) continue;
        for (let dx = 0; dx <= 1; dx++) {
            const x = x0 + dx;
            if (x < 0 || x >= grid.w) continue;
            const i = y * grid.w + x;
            if (grid.status[i] !== 2) continue;
            const wgt = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty);
            s += grid.values[i] * wgt;
            ws += wgt;
        }
    }
    return ws > 1e-6 ? s / ws : NaN;
}

async function buildPixelField(key, source) {
    const meta = pixelRaster.meta;
    const geo = getPixelGeometry();
    if (!geo) return null;
    const info = meta.indices[key.toUpperCase()];
    const n = geo.w * geo.h;
    const values = new Float32Array(n).fill(NaN);

    if (source.type === 'image') {
        const enc = await decodePixelPng(source.url);
        const [lo, hi] = info.encode;
        const k = (hi - lo) / 254;
        for (let i = 0; i < n; i++) {
            if (geo.mask[i] && enc[i]) values[i] = lo + (enc[i] - 1) * k;
        }
    } else {
        const grid = computeRasterGrid(key);
        if (!grid) return null;
        let enc = null;
        try {
            enc = await decodePixelPng(source.url);
        } catch (e) {
            enc = null;
        }
        const [dlo, dhi] = source.detail;
        const dk = (dhi - dlo) / 254;
        for (let y = 0; y < geo.h; y++) {
            const lat = geo.lats[y];
            const row = y * geo.w;
            for (let x = 0; x < geo.w; x++) {
                const i = row + x;
                if (!geo.mask[i]) continue;
                const base = sampleGridSmooth(grid, lat, geo.lons[x]);
                if (isNaN(base)) continue;
                values[i] = base + ((enc && enc[i]) ? dlo + (enc[i] - 1) * dk : 0);
            }
        }
    }
    return { key, values, type: source.type, label: source.label };
}

async function getPixelField(key, view, dataKey) {
    const source = resolvePixelSource(key, view);
    if (!source) return null;
    const cacheKey = `${dataKey}|${key}|${source.url}`;
    if (pixelRaster.fields.has(cacheKey)) return pixelRaster.fields.get(cacheKey);
    const field = await buildPixelField(key, source);
    if (!field) return null;
    field.cacheKey = cacheKey;
    field.dataKey = dataKey;
    pixelRaster.fields.set(cacheKey, field);
    while (pixelRaster.fields.size > PIXEL_FIELD_CACHE_LIMIT) {
        pixelRaster.fields.delete(pixelRaster.fields.keys().next().value);
    }
    return field;
}

function colorizePixelField(field) {
    const geo = pixelRaster.geo;
    const cfg = GEE_COLOR_PALETTES[field.key];
    const steps = 512;
    const lut = new Uint8Array(steps * 3);
    for (let s = 0; s < steps; s++) {
        const rgb = interpolateColor(field.key, cfg.min + (cfg.max - cfg.min) * s / (steps - 1));
        lut[s * 3] = rgb[0];
        lut[s * 3 + 1] = rgb[1];
        lut[s * 3 + 2] = rgb[2];
    }
    const span = cfg.max - cfg.min;
    const canvas = document.createElement('canvas');
    canvas.width = geo.w;
    canvas.height = geo.h;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(geo.w, geo.h);
    const d = img.data;
    const v = field.values;
    for (let i = 0; i < v.length; i++) {
        if (!geo.mask[i]) continue;
        const o = i * 4;
        const val = v[i];
        if (val !== val) {           // NaN: mây che phủ / không có dữ liệu
            d[o] = NODATA_RGBA[0];
            d[o + 1] = NODATA_RGBA[1];
            d[o + 2] = NODATA_RGBA[2];
            d[o + 3] = NODATA_RGBA[3];
            continue;
        }
        let s = Math.round((val - cfg.min) / span * (steps - 1));
        s = s < 0 ? 0 : (s >= steps ? steps - 1 : s);
        d[o] = lut[s * 3];
        d[o + 1] = lut[s * 3 + 1];
        d[o + 2] = lut[s * 3 + 2];
        d[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
}

// Thay lớp raster đang hiển thị bằng lớp mới: lớp mới hiện dần đè lên lớp cũ, xong mới gỡ lớp cũ
// (lớp cũ giữ nguyên độ đậm bên dưới nên khi trình chiếu bản đồ không bị nháy trắng)
function swapRasterOverlay(newLayer, opacity) {
    const old = rasterLayerGroup.getLayers();
    newLayer.setOpacity(0);
    rasterLayerGroup.addLayer(newLayer);
    requestAnimationFrame(() => requestAnimationFrame(() => newLayer.setOpacity(opacity)));
    setTimeout(() => old.forEach(l => rasterLayerGroup.removeLayer(l)), PIXEL_FADE_MS + 60);
}

/**
 * Vẽ lớp pixel 120 m cho chỉ số `key`. Trả về true nếu đã vẽ (hoặc yêu cầu đã cũ),
 * false nếu không có ảnh pixel phù hợp (app.js chuyển sang nội suy IDW).
 */
async function renderPixelRaster(key, opacity, token) {
    const meta = await loadPixelMeta();
    if (!meta || !getPixelGeometry()) return false;
    let field;
    try {
        field = await getPixelField(key, state.currentView, state.currentDataKey);
    } catch (e) {
        console.warn('Lớp pixel 120 m:', e);
        field = null;
    }
    if (token !== state.rasterSeq) return true;
    if (!field) return false;

    pixelRaster.field = field;
    const g = pixelRaster.geo;
    const layer = new CanvasOverlay(colorizePixelField(field), [[g.south, g.west], [g.north, g.east]], {
        opacity: 0,
        interactive: false,
        pane: 'rasterPane',
        className: 'raster-pixelated raster-fade',
    });
    swapRasterOverlay(layer, opacity);
    state.localRasterLayer = layer;
    state.geeTileLayer = null;
    return true;
}

// Trường giá trị pixel đang hiển thị (đúng chỉ số & bộ dữ liệu hiện tại) hoặc null
function getActivePixelField(key) {
    const f = pixelRaster.field;
    if (!f || f.key !== key || f.dataKey !== state.currentDataKey) return null;
    if (state.displayMode !== 'pixel' || state.rasterSource !== 'pixel') return null;
    return f;
}

function pixelIndexAt(lat, lon) {
    const g = pixelRaster.geo;
    if (!g) return -1;
    const x = Math.floor((lon - g.west) / (g.east - g.west) * g.w);
    const y = Math.floor((g.yN - mercY(lat)) / (g.yN - g.yS) * g.h);
    if (x < 0 || y < 0 || x >= g.w || y >= g.h) return -1;
    return y * g.w + x;
}

// Giá trị pixel tại tọa độ (null nếu ngoài vùng / mây che / lớp pixel không hoạt động)
function pixelValueAt(lat, lon, key) {
    const f = getActivePixelField(key);
    if (!f) return null;
    const i = pixelIndexAt(lat, lon);
    if (i < 0) return null;
    const v = f.values[i];
    return v === v ? v : null;
}

// Trung bình các pixel hợp lệ trong ô [lat ± half, lon ± half] (dùng cho cột 3D)
function pixelBlockMean(field, lat, lon, half) {
    const g = pixelRaster.geo;
    const x0 = Math.max(0, Math.floor((lon - half - g.west) / (g.east - g.west) * g.w));
    const x1 = Math.min(g.w - 1, Math.floor((lon + half - g.west) / (g.east - g.west) * g.w));
    const y0 = Math.max(0, Math.floor((g.yN - mercY(lat + half)) / (g.yN - g.yS) * g.h));
    const y1 = Math.min(g.h - 1, Math.floor((g.yN - mercY(lat - half)) / (g.yN - g.yS) * g.h));
    let s = 0, n = 0, inside = 0;
    for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
            const i = y * g.w + x;
            if (!g.mask[i]) continue;
            inside++;
            const v = field.values[i];
            if (v === v) { s += v; n++; }
        }
    }
    if (inside === 0) return undefined;     // ô nằm ngoài ranh giới
    return n > 0 ? s / n : null;
}

function getPixelBounds() {
    const g = pixelRaster.geo;
    return g ? { west: g.west, south: g.south, east: g.east, north: g.north } : null;
}
