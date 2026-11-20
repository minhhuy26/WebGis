const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.join(__dirname, '..', 'frontend');

function loadAppContext({ withWindow = false, elements = {} } = {}) {
    const baseDoc = {
        readyState: 'complete',
        addEventListener() {},
        getElementById: (id) => elements[id] || null,
        querySelectorAll: () => [],
        createElement: () => ({
            width: 0,
            height: 0,
            getContext: () => ({
                beginPath() {},
                moveTo() {},
                lineTo() {},
                closePath() {},
                fill() {},
                stroke() {},
                fillRect() {},
                strokeRect() {},
                fillText() {},
                save() {},
                restore() {},
                rect() {},
                clip() {},
                drawImage() {},
                createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
                getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
                putImageData() {},
            }),
            toDataURL: () => 'data:image/png;base64,',
        }),
    };
    const sandbox = {
        L: { ImageOverlay: { extend: () => ({}) } },
        document: baseDoc,
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    };
    if (withWindow) {
        sandbox.window = sandbox;
    }
    const ctx = vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8'), ctx);
    return ctx;
}

test('app.js works without window and exposes window.state + INDEX_META colors when window exists', () => {
    const noWinCtx = loadAppContext({ withWindow: false });
    assert.equal(typeof vm.runInContext('state', noWinCtx), 'object');

    const winCtx = loadAppContext({ withWindow: true });
    assert.equal(winCtx.window.state, vm.runInContext('state', winCtx));
    const colors = vm.runInContext('[INDEX_META.lst.color, INDEX_META.ndvi.color, INDEX_META.tvdi.color]', winCtx);
    colors.forEach((c) => assert.match(c, /^#[0-9a-f]{6}$/i));
});

test('TreeBenefitModule handles empty and zero overlap_factor without NaN', () => {
    const winObj = {
        document: { readyState: 'complete', addEventListener() {}, getElementById: () => null, querySelectorAll: () => [] },
        Chart: undefined,
        state: { wards: { allList: [] } },
    };
    winObj.window = winObj;
    const ctx = vm.createContext(winObj);
    vm.runInContext(fs.readFileSync(path.join(root, 'js', 'tree-benefit.js'), 'utf8'), ctx);

    const resEmptyF = winObj.TreeBenefitModule.computeBenefits({ n: 1000, t: 10, c: 20, b: 12, s: 15, r: 300, f: '' });
    assert.equal(Number.isFinite(resEmptyF.shade_m2), true);
    assert.equal(resEmptyF.shade_m2, 15000);

    const resZeroF = winObj.TreeBenefitModule.computeBenefits({ n: 1000, t: 10, c: 20, b: 12, s: 15, r: 300, f: 0 });
    assert.equal(resZeroF.shade_m2, 0);
});

test('renderAdminUsersTable neutralizes XSS payloads and uses data attributes instead of inline onclick', () => {
    const tbody = { innerHTML: '' };
    const ctx = loadAppContext({
        withWindow: true,
        elements: { 'tbody-admin-users': tbody },
    });
    vm.runInContext(`
        adminUsersCache = [{
            username: "evil'\\"><img src=x onerror=alert(1)>",
            full_name: "Bad ' \\" <img src=x onerror=alert(2)>",
            role: 'user',
            is_blocked: false,
            created_at: '2026-11-20',
            last_login: '2026-11-20'
        }];
        renderAdminUsersTable();
    `, ctx);
    assert.equal(tbody.innerHTML.includes('onclick='), false);
    assert.equal(tbody.innerHTML.includes('<img'), false);
    assert.equal(tbody.innerHTML.includes('data-action="pwd"'), true);
});

test('bulletin and map-composer legends use GEE_COLOR_PALETTES without undefined or NaN', () => {
    const texts = [];
    const fillStyles = [];
    const mockCtx = {
        save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
        fill() {}, rect() {}, clip() {}, stroke() {}, strokeRect() {}, drawImage() {},
        setLineDash() {}, scale() {}, translate() {}, arc() {},
        fillRect() { fillStyles.push(this.fillStyle); },
        fillText(t) { texts.push(String(t)); },
        createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData() {},
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        font: '',
        textAlign: 'left',
        textBaseline: 'alphabetic',
    };
    const ctx = vm.createContext({
        L: { ImageOverlay: { extend: () => ({}) } },
        document: {
            readyState: 'complete',
            addEventListener() {},
            getElementById: () => null,
            querySelectorAll: () => [],
            createElement: () => ({
                width: 0,
                height: 0,
                getContext: () => mockCtx,
                toDataURL: () => 'data:image/png;base64,ok',
            }),
        },
        localStorage: { getItem: () => null },
        describeCurrentView: () => 'Kỳ test',
        wardPeriodLabel: () => '',
    });
    ctx.window = ctx;
    vm.runInContext(fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8'), ctx);
    vm.runInContext(fs.readFileSync(path.join(root, 'js', 'bulletin.js'), 'utf8'), ctx);
    vm.runInContext(fs.readFileSync(path.join(root, 'js', 'map-composer.js'), 'utf8'), ctx);

    vm.runInContext("renderBulletinMapDataUrl('lst', 'Test LST')", ctx);
    vm.runInContext("_mcDrawLegendPanel(document.createElement('canvas').getContext('2d'), 0, 0, 260, { layerKey: 'lst', showWards: false })", ctx);

    assert.equal(texts.some((t) => /undefined|NaN/.test(t)), false, `Unexpected legend label: ${texts.join(', ')}`);
    assert.equal(texts.some((t) => t.includes('25')), true);
    assert.equal(texts.some((t) => t.includes('45')), true);
    assert.equal(fillStyles.some((s) => /^rgb\(\d+,\d+,\d+\)$/.test(s) && s !== 'rgb(0,0,0)'), true);
});

test('non-admin daily_7d labels in bulletin.js and map-decor.js keep simulation notice without technical jargon', () => {
    const ctx = loadAppContext({ withWindow: true });
    ctx.isAdminUser = () => false;
    vm.runInContext(fs.readFileSync(path.join(root, 'js', 'bulletin.js'), 'utf8'), ctx);
    vm.runInContext(fs.readFileSync(path.join(root, 'js', 'map-decor.js'), 'utf8'), ctx);

    const badgeHtml = vm.runInContext("_formatHorizonBadge('daily_7d')", ctx);
    const cleaned = vm.runInContext("_cleanBulletinTextForRole('Dự báo (Giả lập · Landsat 8/9). Số liệu dự báo 7 ngày được mô phỏng giả lập theo đặc trưng Landsat 8/9 để phục vụ theo dõi ngắn hạn.')", ctx);
    assert.match(badgeHtml, /Mô phỏng/i);
    assert.equal(/Landsat|Random Forest/i.test(badgeHtml), false);
    assert.match(cleaned, /Mô phỏng/i);
    assert.equal(/Landsat|Random Forest/i.test(cleaned), false);

    vm.runInContext("state.currentView = { kind: 'forecast', horizon: 'daily_7d', isSimulated: true, date: '2026-11-20' }", ctx);
    const viewDesc = vm.runInContext('describeCurrentView(false)', ctx);
    assert.match(viewDesc, /mô phỏng/i);
    assert.equal(/Landsat|Random Forest/i.test(viewDesc), false);
});

test('showMonthlyValidation flags weak R2 <= 0 with is-weak class, open=true and low-confidence heading', () => {
    const ctx = loadAppContext({ withWindow: true });
    const rows = [];
    const classes = new Set();
    const panel = {
        hidden: true,
        open: false,
        classList: {
            add: (c) => classes.add(c),
            remove: (c) => classes.delete(c),
            toggle: (c, force) => (force === undefined ? (classes.has(c) ? classes.delete(c) : classes.add(c)) : (force ? classes.add(c) : classes.delete(c))),
        },
        querySelector: () => ({}),
    };
    const body = {
        replaceChildren() { rows.length = 0; },
        insertRow() { const cells = []; rows.push(cells); return { insertCell() { const c = {}; cells.push(c); return c; } }; },
    };
    const nodes = {
        'monthly-validation': panel,
        'monthly-validation-summary': {},
        'monthly-validation-note': {},
        'monthly-validation-rows': body,
    };
    ctx.document.getElementById = (id) => nodes[id] || null;
    ctx.series = {
        start_date: '2026-11-01',
        end_date: '2027-10-01',
        scope: 'overall',
        monthly_evaluation: JSON.parse(fs.readFileSync(path.join(root, '../backend/models/rf_metrics.json'), 'utf8')).monthly_evaluation,
    };

    vm.runInContext("showMonthlyValidation(series, 'tvdi')", ctx);
    assert.equal(panel.open, true);
    assert.equal(classes.has('is-weak'), true);
    assert.match(nodes['monthly-validation-summary'].textContent, /Độ tin cậy thấp/);

    vm.runInContext("showMonthlyValidation(series, 'ndvi')", ctx);
    assert.equal(panel.open, false);
    assert.equal(classes.has('is-weak'), false);
});

test('filterAndSortWards filters thresholds, puts nulls last, and reassigns rank', () => {
    const ctx = loadAppContext({ withWindow: true });
    const sample = [
        { ward_id: 1, name: 'Phường A', lst_c: 32.0, ndvi: 0.30, tvdi: 0.50 },
        { ward_id: 2, name: 'Phường B', lst_c: null, ndvi: 0.15, tvdi: null },
        { ward_id: 3, name: 'Phường C', lst_c: 38.5, ndvi: 0.18, tvdi: 0.78 },
        { ward_id: 4, name: 'Phường D', lst_c: 35.0, ndvi: null, tvdi: 0.65 },
    ];
    ctx.sampleWards = sample;

    const byLst = vm.runInContext("filterAndSortWards(sampleWards, 'lst_desc', null)", ctx);
    assert.deepEqual(byLst.map(w => w.ward_id), [3, 4, 1, 2]);
    assert.deepEqual(byLst.map(w => w.rank), [1, 2, 3, 4]);

    const byNdvi = vm.runInContext("filterAndSortWards(sampleWards, 'ndvi_asc', null)", ctx);
    assert.deepEqual(byNdvi.map(w => w.ward_id), [2, 3, 1, 4]);

    const filteredTvdi = vm.runInContext("filterAndSortWards(sampleWards, 'tvdi_desc', { min_tvdi: 0.625 })", ctx);
    assert.deepEqual(filteredTvdi.map(w => w.ward_id), [3, 4]);
    assert.deepEqual(filteredTvdi.map(w => w.rank), [1, 2]);
});

test('TreeBenefitModule.computeBenefits handles fractional T < 1 and extended T = 60 matching backend', () => {
    const winObj = {
        document: { readyState: 'complete', addEventListener() {}, getElementById: () => null, querySelectorAll: () => [] },
        Chart: undefined,
        state: { wards: { allList: [] } },
    };
    winObj.window = winObj;
    const ctx = vm.createContext(winObj);
    vm.runInContext(fs.readFileSync(path.join(root, 'js', 'tree-benefit.js'), 'utf8'), ctx);

    const resHalfYear = winObj.TreeBenefitModule.computeBenefits({ n: 1000, t: 0.5, c: 20, b: 12, s: 15, r: 300, f: 1 });
    assert.equal(resHalfYear.timeline.length, 1);
    assert.equal(resHalfYear.timeline[0].year, 0.5);

    const resLong = winObj.TreeBenefitModule.computeBenefits({ n: 1000, t: 60, c: 20, b: 12, s: 15, r: 300, f: 1 });
    assert.equal(resLong.timeline.length, 60);
    assert.equal(resLong.timeline[59].year, 60);
});

test('style.css enforces header/toast z-index stacking and defines modal form classes', () => {
    const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
    const getZIndex = (selector) => {
        const idx = css.indexOf(`${selector} {`);
        assert.notEqual(idx, -1, `Missing selector: ${selector}`);
        const block = css.slice(idx, css.indexOf('}', idx) + 1);
        const m = block.match(/z-index:\s*(\d+)/);
        assert.ok(m, `Missing z-index in ${selector}`);
        return Number(m[1]);
    };

    const headerZ = getZIndex('.app-header');
    const toolbarZ = getZIndex('.toolbar');
    const backdropZ = getZIndex('.modal-backdrop');
    const toastZ = getZIndex('.app-toast');

    assert.ok(headerZ > toolbarZ, `Expected .app-header (${headerZ}) > .toolbar (${toolbarZ})`);
    assert.ok(backdropZ >= 10000, `Expected .modal-backdrop (${backdropZ}) >= 10000`);
    assert.ok(toastZ > 10005, `Expected .app-toast (${toastZ}) > 10005`);

    for (const cls of ['.login-field', '.login-alert', '.form-control', '.btn-sm', '.ward-search-dropdown.is-fixed', '.monthly-validation.is-weak']) {
        assert.ok(css.includes(cls), `Missing CSS class ${cls}`);
    }
});
