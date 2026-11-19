const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.join(__dirname, '..', 'frontend');
const ctx = vm.createContext({
    L: { ImageOverlay: { extend: () => ({}) } },
    document: { addEventListener() {} },
    localStorage: { getItem: () => null },
    meta: JSON.parse(fs.readFileSync(path.join(root, 'data/raster/meta.json'), 'utf8')),
});
for (const name of ['app', 'map-decor', 'pixel-raster']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'js', name + '.js'), 'utf8'), ctx);
}
vm.runInContext('pixelRaster.meta = meta', ctx);
const run = code => vm.runInContext(code, ctx);

test('historical map draws the dated grid when the PNG does not cover the view', () => {
    for (const key of ['lst', 'ndvi', 'tvdi']) {
        const month = ctx.meta.indices[key.toUpperCase()].months[0];
        ctx.key = key;
        ctx.view = { kind: 'cycle', date: month + '-01' };
        assert.equal(run('resolvePixelSource(key, view)'), null);
        ctx.view = { kind: 'aggregate', agg: 'period', start: '2017-01-01', end: '2025-12-12' };
        assert.equal(run('resolvePixelSource(key, view)'), null);
        ctx.view = { kind: 'aggregate', agg: 'year', start: '2017-01-01', end: '2017-12-31' };
        assert.equal(run('resolvePixelSource(key, view)'), null);
        ctx.view = { kind: 'aggregate', agg: 'month', start: month + '-01', end: month + '-16' };
        assert.equal(run('resolvePixelSource(key, view)'), null);
        const [year, m] = month.split('-').map(Number);
        ctx.view.end = month + '-' + new Date(Date.UTC(year, m, 0)).getUTCDate();
        assert.ok(run('resolvePixelSource(key, view)').url.endsWith(month.replace('-', '_') + '.png'));
        ctx.view = { kind: 'forecast', date: month + '-01' };
        assert.ok(run('resolvePixelSource(key, view)').url.includes('_DETAIL_'));
    }
});

test('ward CSV keeps the source date and requested date with each value', () => {
    run(`state.currentView = {key:'example'};
        state.wards.list = [{name:'Xã A', tvdi:.6}];
        state.wards.source = {viewKey:'example', requested:'2025-12-14', actual:'2025-12-12'};
        downloadTextFile = (name, csv) => { globalThis.file = {name,csv} };
        logUserAction = () => {};
        exportWardsCSV();`);
    assert.match(ctx.file.name, /2025-12-12/);
    assert.match(ctx.file.csv.split('\n')[1], /2025-12-14,,,2025-12-12/);
});

test('monthly quality uses the series version, index and spatial scope', () => {
    const rows = [];
    const node = { querySelector: () => ({}), replaceChildren() { rows.length = 0; },
        insertRow() { const cells = []; rows.push(cells); return {
            insertCell() { const cell = {}; cells.push(cell); return cell; } }; } };
    const nodes = { 'monthly-validation-rows': node, 'monthly-validation': node,
        'monthly-validation-summary': {}, 'monthly-validation-note': {} };
    ctx.document.getElementById = id => nodes[id];
    ctx.series = { start_date:'2026-11-01', end_date:'2027-10-01', scope:'overall',
        monthly_evaluation:JSON.parse(fs.readFileSync(path.join(root, '../backend/models/rf_metrics.json'), 'utf8')).monthly_evaluation };
    run("showMonthlyValidation(series, 'tvdi')");
    assert.match(nodes['monthly-validation-summary'].textContent, /TVDI.*toàn vùng/);
    assert.match(nodes['monthly-validation-note'].textContent, /11 đến 22 tháng/);
    assert.equal(rows.length, 12);
    ctx.series.scope = 'cell';
    run("showMonthlyValidation(series, 'lst')");
    assert.match(nodes['monthly-validation-summary'].textContent, /ô lưới.*°C/);
    ctx.series.monthly_evaluation = null;
    run("showMonthlyValidation(series, 'tvdi')");
    assert.match(nodes['monthly-validation-summary'].textContent, /Chưa có kiểm định/);
});
