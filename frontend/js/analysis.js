/**
 * ============================================================================
 * WebGIS TVDI TP. Hồ Chí Minh – Biểu đồ phân tích nâng cao (tab "Biểu đồ")
 * 1. Không gian đặc trưng LST – NDVI (tam giác TVDI) kèm biên khô / biên ướt của kỳ ảnh
 * 2. Histogram phân bố giá trị chỉ số đang chọn trên các ô lưới
 * 3. Top 10 phường/xã theo chỉ số đang chọn
 * 4. Ma trận tương quan Pearson giữa LST, NDVI, TVDI
 * Dữ liệu: lưới ô đang hiển thị trên bản đồ (state.currentGridData) và bảng xếp hạng phường/xã.
 * ============================================================================
 */

function isAnalysisTabVisible() {
    const view = document.getElementById('sidebar-analysis-view');
    return !!view && view.style.display !== 'none';
}

// Vẽ lại các biểu đồ khi tab đang mở (hoặc khi bắt buộc – vừa mở tab)
function refreshAnalysisCharts(force = false) {
    if (typeof Chart === 'undefined') return;
    if (!force && !isAnalysisTabVisible()) return;
    try {
        const ctxEl = document.getElementById('analysis-context');
        if (ctxEl) {
            const key = state.activeRasterLayer;
            ctxEl.innerHTML = `<i class="fa-solid fa-calendar-day"></i> ${describeCurrentView(false)} · Lớp <strong>${INDEX_META[key].label}</strong>`;
        }
        renderScatterTriangle();
        renderHistogram();
        renderTopWards();
        renderCorrelationMatrix();
    } catch (e) {
        console.error('Lỗi vẽ biểu đồ phân tích:', e);
    }
}

function destroyAnalysisChart(name) {
    if (state.analysisCharts[name]) {
        state.analysisCharts[name].destroy();
        state.analysisCharts[name] = null;
    }
}

function getGridTriples() {
    const feats = (state.currentGridData && state.currentGridData.features) ? state.currentGridData.features : [];
    return feats
        .map(f => f.properties || {})
        .map(p => ({ lst: getIndexValue(p, 'lst'), ndvi: getIndexValue(p, 'ndvi'), tvdi: getIndexValue(p, 'tvdi'), cell: p.cell_id }))
        .filter(d => d.lst !== null && d.ndvi !== null && d.tvdi !== null);
}

function pearson(xs, ys) {
    const n = xs.length;
    if (n < 3) return null;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) {
        const dx = xs[i] - mx, dy = ys[i] - my;
        sxy += dx * dy;
        sxx += dx * dx;
        syy += dy * dy;
    }
    return (sxx > 0 && syy > 0) ? sxy / Math.sqrt(sxx * syy) : null;
}

// Hệ số biên khô (LST_max = a + b·NDVI) và biên ướt (LST_min) của kỳ ảnh đang xem
async function getEdgeParams() {
    const v = state.currentView;
    if (!v || v.kind !== 'cycle') return null;
    if (!state.overallSeriesCache) {
        try {
            const res = await fetch('/api/series/overall');
            if (!res.ok) return null;
            const data = await res.json();
            state.overallSeriesCache = data.series || [];
        } catch (e) {
            return null;
        }
    }
    const row = (state.overallSeriesCache || []).find(d => d.date === v.date);
    if (!row || !row.fit_ok || row.dry_a === null || row.dry_b === null) return null;
    return { a: row.dry_a, b: row.dry_b, tsMin: row.ts_min };
}

async function renderScatterTriangle() {
    const canvas = document.getElementById('chart-scatter');
    const note = document.getElementById('scatter-note');
    if (!canvas) return;
    destroyAnalysisChart('scatter');

    const isForecast = state.currentView && state.currentView.kind === 'forecast';
    const pts = isForecast ? [] : getGridTriples();
    if (pts.length === 0) {
        if (note) note.innerHTML = isForecast
            ? '<i class="fa-solid fa-circle-info"></i> Mốc dự báo AI chỉ có chỉ số TVDI. Chọn chế độ <strong>Giám sát thực tế</strong> (2017–2025) để xem không gian LST – NDVI.'
            : '<i class="fa-solid fa-circle-info"></i> Không có ô lưới đủ dữ liệu LST & NDVI tại thời điểm này.';
        return;
    }

    const dataKey = state.currentDataKey;
    const edges = await getEdgeParams();
    if (dataKey !== state.currentDataKey) return;   // Dữ liệu đã đổi trong lúc chờ
    destroyAnalysisChart('scatter');

    const datasets = [{
        type: 'scatter',
        label: 'Ô lưới ~5,5 km',
        data: pts.map(d => ({ x: d.ndvi, y: d.lst, tvdi: d.tvdi })),
        pointRadius: 3.2,
        pointHoverRadius: 5,
        pointBackgroundColor: pts.map(d => rgbCss(interpolateColor('tvdi', d.tvdi))),
        pointBorderColor: 'rgba(15, 23, 42, 0.35)',
        pointBorderWidth: 0.6,
    }];
    if (edges) {
        datasets.push({
            type: 'line',
            label: `Biên khô: LST = ${edges.a.toFixed(1)} ${edges.b >= 0 ? '+' : '−'} ${Math.abs(edges.b).toFixed(1)}·NDVI`,
            data: [{ x: 0.1, y: edges.a + edges.b * 0.1 }, { x: 0.95, y: edges.a + edges.b * 0.95 }],
            borderColor: '#dc2626',
            borderWidth: 2,
            pointRadius: 0,
            fill: false,
        });
        if (edges.tsMin !== null && edges.tsMin !== undefined) {
            datasets.push({
                type: 'line',
                label: `Biên ướt: LST = ${edges.tsMin.toFixed(1)} °C`,
                data: [{ x: 0.1, y: edges.tsMin }, { x: 0.95, y: edges.tsMin }],
                borderColor: '#2563eb',
                borderWidth: 2,
                borderDash: [6, 4],
                pointRadius: 0,
                fill: false,
            });
        }
    }

    state.analysisCharts.scatter = new Chart(canvas.getContext('2d'), {
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 9 }, color: '#475569' } },
                tooltip: {
                    callbacks: {
                        label: (c) => c.dataset.type === 'scatter' || c.raw.tvdi !== undefined
                            ? `NDVI ${c.raw.x.toFixed(3)} · LST ${c.raw.y.toFixed(1)} °C · TVDI ${c.raw.tvdi.toFixed(3)}`
                            : c.dataset.label,
                    }
                }
            },
            scales: {
                x: { type: 'linear', min: -0.1, max: 1, title: { display: true, text: 'NDVI', font: { size: 10, weight: 'bold' } }, ticks: { font: { size: 9 } } },
                y: { type: 'linear', title: { display: true, text: 'LST (°C)', font: { size: 10, weight: 'bold' } }, ticks: { font: { size: 9 } } },
            }
        }
    });

    if (note) {
        const r = pearson(pts.map(d => d.ndvi), pts.map(d => d.lst));
        // Hệ số góc hồi quy tuyến tính LST theo NDVI
        const n = pts.length;
        const mx = pts.reduce((s, d) => s + d.ndvi, 0) / n;
        const my = pts.reduce((s, d) => s + d.lst, 0) / n;
        const sxy = pts.reduce((s, d) => s + (d.ndvi - mx) * (d.lst - my), 0);
        const sxx = pts.reduce((s, d) => s + (d.ndvi - mx) ** 2, 0);
        const slope = sxx > 0 ? sxy / sxx : null;
        const edgeTxt = edges ? ' Đường đỏ / xanh là biên khô – biên ướt dùng để tính TVDI của kỳ ảnh.' : (state.currentView && state.currentView.kind === 'aggregate' ? ' (Biên khô – ướt chỉ hiển thị khi xem theo từng kỳ 15 ngày.)' : '');
        note.innerHTML = `<i class="fa-solid fa-lightbulb"></i> ${n} ô lưới · r(LST, NDVI) = <strong>${r !== null ? r.toFixed(2) : '--'}</strong>` +
            (slope !== null ? ` · NDVI tăng 0,1 ⇒ LST thay đổi <strong>${(slope * 0.1).toFixed(2)} °C</strong>.` : '.') +
            ` Màu điểm theo TVDI (xanh: ẩm → đỏ: khô).${edgeTxt}`;
    }
}

function renderHistogram() {
    const canvas = document.getElementById('chart-hist');
    const statsEl = document.getElementById('hist-stats');
    const titleEl = document.getElementById('hist-title');
    if (!canvas) return;
    destroyAnalysisChart('hist');

    const key = state.activeRasterLayer;
    const meta = INDEX_META[key];
    if (titleEl) titleEl.innerText = `Phân bố giá trị ${meta.label} trên các ô lưới`;
    const feats = (state.currentGridData && state.currentGridData.features) ? state.currentGridData.features : [];
    const vals = feats.map(f => getIndexValue(f.properties, key)).filter(v => v !== null).sort((a, b) => a - b);
    if (vals.length === 0) {
        if (statsEl) statsEl.innerHTML = '<span class="analysis-empty">Không có dữ liệu.</span>';
        return;
    }

    const n = vals.length;
    const mean = vals.reduce((a, b) => a + b, 0) / n;
    const median = n % 2 ? vals[(n - 1) / 2] : (vals[n / 2 - 1] + vals[n / 2]) / 2;
    const std = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
    if (statsEl) {
        statsEl.innerHTML = [
            ['Trung bình', formatIndexValue(mean, key)],
            ['Trung vị', formatIndexValue(median, key)],
            ['Độ lệch chuẩn', formatIndexValue(std, key)],
            ['Số ô', n],
        ].map(([l, v]) => `<div class="analysis-stat"><span>${l}</span><strong>${v}</strong></div>`).join('');
    }

    // Độ rộng nhóm: LST 1 °C, NDVI & TVDI 0,05
    const width = key === 'lst' ? 1 : 0.05;
    const lo = Math.floor(vals[0] / width) * width;
    const hi = Math.ceil((vals[n - 1] + 1e-9) / width) * width;
    const nBins = Math.max(1, Math.round((hi - lo) / width));
    const counts = new Array(nBins).fill(0);
    vals.forEach(v => {
        const idx = Math.min(nBins - 1, Math.floor((v - lo) / width + 1e-9));
        counts[idx]++;
    });
    const centers = counts.map((_, i) => lo + (i + 0.5) * width);
    const labels = centers.map(c => key === 'lst' ? `${(c - width / 2).toFixed(0)}–${(c + width / 2).toFixed(0)}` : (c - width / 2).toFixed(2));

    state.analysisCharts.hist = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Số ô lưới',
                data: counts,
                backgroundColor: centers.map(c => rgbCss(interpolateColor(key, c))),
                borderColor: 'rgba(15, 23, 42, 0.25)',
                borderWidth: 0.6,
                barPercentage: 1.0,
                categoryPercentage: 0.98,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { title: (items) => `${meta.label}: ${items[0].label}${meta.unit ? ' ' + meta.unit : ''}`, label: (c) => ` ${c.parsed.y} ô lưới (${(c.parsed.y / n * 100).toFixed(1)}%)` } }
            },
            scales: {
                x: { ticks: { font: { size: 8 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }, grid: { display: false }, title: { display: true, text: `${meta.label}${meta.unit ? ' (' + meta.unit + ')' : ''}`, font: { size: 9, weight: 'bold' } } },
                y: { beginAtZero: true, ticks: { font: { size: 9 }, precision: 0 }, title: { display: true, text: 'Số ô lưới', font: { size: 9, weight: 'bold' } } },
            }
        }
    });
}

function renderTopWards() {
    const canvas = document.getElementById('chart-top10');
    const titleEl = document.getElementById('top-title');
    if (!canvas) return;
    destroyAnalysisChart('top');

    const key = state.activeRasterLayer;
    const meta = INDEX_META[key];
    const prop = key === 'lst' ? 'lst_c' : key;
    const ascending = key === 'ndvi';   // NDVI: ít cây xanh nhất; LST, TVDI: cao nhất
    if (titleEl) titleEl.innerText = ascending ? 'Top 10 phường/xã NDVI thấp nhất (ít cây xanh)' : `Top 10 phường/xã ${meta.label} cao nhất`;

    const list = ((state.wards.allList && state.wards.allList.length) ? state.wards.allList : (state.wards.list || []))
        .filter(w => w[prop] !== null && w[prop] !== undefined && !isNaN(w[prop]));
    if (list.length === 0) return;
    const top = [...list].sort((a, b) => ascending ? a[prop] - b[prop] : b[prop] - a[prop]).slice(0, 10);
    // LST: trục bắt đầu gần giá trị nhỏ nhất để thấy rõ chênh lệch giữa các phường/xã
    const xMin = key === 'lst' ? Math.floor(Math.min(...top.map(w => w[prop])) - 1) : undefined;

    state.analysisCharts.top = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: top.map(w => `${w.name.replace(/^(Phường|Xã) /, '')} (${formatIndexValue(w[prop], key, false)})`),
            datasets: [{
                label: meta.label,
                data: top.map(w => w[prop]),
                backgroundColor: top.map(w => rgbCss(interpolateColor(key, w[prop]))),
                borderColor: 'rgba(15, 23, 42, 0.3)',
                borderWidth: 0.6,
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            onClick: (evt, elements) => {
                if (elements && elements.length) selectWard(top[elements[0].index].ward_id, true);
            },
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { title: (items) => top[items[0].dataIndex].name, label: (c) => ` ${meta.label}: ${formatIndexValue(c.parsed.x, key)}` } }
            },
            scales: {
                x: { min: xMin, beginAtZero: key !== 'lst', ticks: { font: { size: 9 } }, title: { display: true, text: `${meta.label}${meta.unit ? ' (' + meta.unit + ')' : ''}`, font: { size: 9, weight: 'bold' } } },
                y: { ticks: { font: { size: 9 } } },
            }
        }
    });
}

function renderCorrelationMatrix() {
    const el = document.getElementById('corr-matrix');
    if (!el) return;
    const isForecast = state.currentView && state.currentView.kind === 'forecast';
    const pts = isForecast ? [] : getGridTriples();
    if (pts.length < 3) {
        el.innerHTML = `<div class="analysis-empty">${isForecast ? 'Mốc dự báo AI chỉ có TVDI – không tính được tương quan giữa các chỉ số.' : 'Không đủ dữ liệu.'}</div>`;
        return;
    }
    const keys = ['lst', 'ndvi', 'tvdi'];
    const series = { lst: pts.map(d => d.lst), ndvi: pts.map(d => d.ndvi), tvdi: pts.map(d => d.tvdi) };
    const cell = (r) => {
        if (r === null) return '<td>--</td>';
        const a = Math.min(1, Math.abs(r));
        const bg = r >= 0 ? `rgba(220, 38, 38, ${0.12 + a * 0.6})` : `rgba(37, 99, 235, ${0.12 + a * 0.6})`;
        return `<td style="background:${bg}; color:${a > 0.55 ? '#fff' : '#0f172a'}">${r.toFixed(2)}</td>`;
    };
    el.innerHTML = `
        <table>
            <thead><tr><th></th>${keys.map(k => `<th>${INDEX_META[k].label}</th>`).join('')}</tr></thead>
            <tbody>
                ${keys.map(r => `<tr><th>${INDEX_META[r].label}</th>${keys.map(c => cell(r === c ? 1 : pearson(series[r], series[c]))).join('')}</tr>`).join('')}
            </tbody>
        </table>
        <div class="corr-legend"><span class="neg">Tương quan nghịch</span><span class="pos">Tương quan thuận</span></div>`;
}
