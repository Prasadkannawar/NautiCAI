/* ═══════════════════════════════════════════════
   NautiCAI — Dashboard JavaScript
   Real AI Detection via FastAPI + YOLOv8
═══════════════════════════════════════════════ */

const API_BASE = 'http://localhost:8010';
window.API_BASE = API_BASE;



/* Class colour map — matches api.py */
const CLASS_COLORS = {
    'corrosion': '#e74c3c',
    'marine growth': '#f0a500',
    'debris': '#e67e22',
    'healthy surface': '#00c8b0',
    'healthy': '#00c8b0',
};
const DEFAULT_COLOR = '#7a9eb5';

function classColor(name) {
    return CLASS_COLORS[(name || '').toLowerCase().trim()] || DEFAULT_COLOR;
}

/* ── Upload drag-and-drop ─────────────────────── */
const uploadZone = document.getElementById('upload-zone');
const fileInput = document.getElementById('file-input');
const folderInput = document.getElementById('folder-input');
let uploadedFile = null;       // single‑file compat
let uploadedFiles = [];        // batch array
let uploadMode = 'image';      // 'image' | 'video' | 'folder'

uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
});
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    handleFiles(Array.from(e.dataTransfer.files));
});
fileInput.addEventListener('change', (e) => {
    handleFiles(Array.from(e.target.files));
});
folderInput.addEventListener('change', (e) => {
    const allFiles = Array.from(e.target.files);
    // Filter to images only when selecting a folder
    const imageFiles = allFiles.filter(f => f.type.startsWith('image/'));
    handleFiles(imageFiles);
});

/* Set upload type — each button directly opens its picker */
window.setUploadType = function (type) {
    uploadMode = type;
    document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
    const btnId = type === 'folder' ? 'btn-folder' : (type === 'video' ? 'btn-video' : 'btn-image');
    document.getElementById(btnId)?.classList.add('active');

    if (type === 'folder') {
        folderInput.value = '';
        folderInput.click();
    } else if (type === 'video') {
        fileInput.accept = 'video/*';
        fileInput.removeAttribute('multiple');
        fileInput.value = '';
        fileInput.click();
    } else {
        fileInput.accept = 'image/*';
        fileInput.setAttribute('multiple', '');
        fileInput.value = '';
        fileInput.click();
    }
};

/* Upload zone click → open the picker matching current mode */
let _pickerOpen = false;
function openPicker() {
    if (_pickerOpen) return;
    _pickerOpen = true;
    setTimeout(() => { _pickerOpen = false; }, 800);

    if (uploadMode === 'folder') {
        folderInput.value = '';
        folderInput.click();
    } else {
        fileInput.value = '';
        fileInput.click();
    }
}

uploadZone.addEventListener('click', (e) => {
    // Ignore clicks on the file inputs themselves or the browse link
    if (e.target === fileInput || e.target === folderInput) return;
    if (e.target.id === 'upload-link-btn') return;
    openPicker();
});

/* "browse" link */
document.getElementById('upload-link-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openPicker();
});

/* Handle incoming files (single or multiple) */
function handleFiles(files) {
    if (!files || files.length === 0) return;

    uploadedFiles = files;
    uploadedFile = files[0];  // keep single-file compat

    const batchBadge = document.getElementById('batch-badge');
    const batchCount = document.getElementById('batch-count');

    if (files.length > 1) {
        batchBadge.style.display = 'block';
        batchCount.textContent = files.length;
    } else {
        batchBadge.style.display = 'none';
    }

    // Show first file preview
    const f = files[0];
    const previewImg = document.getElementById('preview-image');
    const previewVid = document.getElementById('preview-video');
    const placeholder = document.getElementById('preview-placeholder');

    placeholder.style.display = 'none';

    if (f.type.startsWith('image/')) {
        previewImg.src = URL.createObjectURL(f);
        previewImg.style.display = 'block';
        previewVid.style.display = 'none';
    } else if (f.type.startsWith('video/')) {
        previewVid.src = URL.createObjectURL(f);
        previewVid.style.display = 'block';
        previewImg.style.display = 'none';
    }

    // Visual upload confirmation
    uploadZone.style.borderColor = 'var(--teal)';
    uploadZone.style.background = 'rgba(0,200,176,0.06)';
    setTimeout(() => {
        uploadZone.style.borderColor = '';
        uploadZone.style.background = '';
    }, 2000);
}

/* Keep old handleFile for compat */
function handleFile(file) { handleFiles([file]); }

/* ── Run AI Detection — calls real FastAPI ────── */
window.runAIDetection = async function () {
    if (uploadedFiles.length === 0 && !uploadedFile) {
        showToast('Please upload an image, video, or folder first.', 'warn');
        return;
    }

    const files = uploadedFiles.length > 0 ? uploadedFiles : [uploadedFile];
    const isBatch = files.length > 1;

    const emptyState = document.getElementById('empty-state');
    const loadingState = document.getElementById('loading-state');
    const resultsEl = document.getElementById('results-content');

    emptyState.style.display = 'none';
    resultsEl.style.display = 'none';
    loadingState.style.display = 'flex';

    const progressBar = document.getElementById('progress-bar');
    const stageLabel = document.querySelector('.progress-stage') || { textContent: '' };
    progressBar.style.width = '0%';

    try {
        let mergedData = null;

        if (isBatch) {
            /* ── Batch: process each file sequentially ── */
            const allDetections = [];
            const allAnnotatedImages = [];  // { filename, image, detections }
            let lastMetrics = null;
            let totalInfMs = 0;
            let inspId = '';

            for (let i = 0; i < files.length; i++) {
                const pct = Math.round(((i + 1) / files.length) * 95);
                progressBar.style.width = pct + '%';
                stageLabel.textContent = `Analyzing file ${i + 1} of ${files.length}: ${files[i].name}`;

                const formData = new FormData();
                formData.append('file', files[i]);

                const response = await fetch(`${API_BASE}/detect`, { method: 'POST', body: formData });
                if (!response.ok) {
                    const err = await response.json().catch(() => ({ detail: 'Unknown error' }));
                    console.warn(`File ${files[i].name} failed:`, err.detail);
                    continue;
                }

                const data = await response.json();
                const fileDetections = data.detections || [];
                allDetections.push(...fileDetections);

                // Store each annotated image
                allAnnotatedImages.push({
                    filename: files[i].name,
                    image: data.annotated_image || null,
                    detections: fileDetections,
                    summary: data.summary || null,
                });

                lastMetrics = data.model_metrics || lastMetrics;
                inspId = data.inspection_id || inspId;
                totalInfMs += data.summary?.inference_time_ms || 0;
            }

            // Recalculate summary from aggregated detections
            const maxConf = allDetections.length ? Math.max(...allDetections.map(d => d.confidence)) : 0;
            const avgConf = allDetections.length ? allDetections.reduce((a, d) => a + d.confidence, 0) / allDetections.length : 0;
            let risk = 'SAFE';
            if (maxConf > 0.85) risk = 'HIGH';
            else if (maxConf > 0.60) risk = 'MEDIUM';
            else if (maxConf > 0) risk = 'LOW';

            mergedData = {
                inspection_id: inspId || 'BATCH-' + Date.now(),
                detections: allDetections,
                annotated_image: allAnnotatedImages.length > 0 ? allAnnotatedImages[0].image : null,
                annotated_images: allAnnotatedImages,
                summary: {
                    total: allDetections.length,
                    risk_level: risk,
                    avg_confidence: Math.round(avgConf * 10000) / 10000,
                    inference_time_ms: totalInfMs,
                    files_processed: files.length,
                },
                model_metrics: lastMetrics || { precision: 0, recall: 0, map50: 0, map5095: 0 },
                timestamp: new Date().toISOString(),
            };

        } else {
            /* ── Single file: existing flow ── */
            const stages = [
                { pct: 15, label: 'Uploading file...' },
                { pct: 35, label: 'Preprocessing image...' },
                { pct: 60, label: 'Running YOLOv8 inference...' },
                { pct: 80, label: 'Detecting objects...' },
                { pct: 90, label: 'Post-processing results...' },
            ];
            let stageIdx = 0;
            const stageTimer = setInterval(() => {
                if (stageIdx < stages.length) {
                    progressBar.style.width = stages[stageIdx].pct + '%';
                    stageLabel.textContent = stages[stageIdx].label;
                    stageIdx++;
                }
            }, 600);

            const formData = new FormData();
            formData.append('file', files[0]);

            const response = await fetch(`${API_BASE}/detect`, { method: 'POST', body: formData });
            clearInterval(stageTimer);

            if (!response.ok) {
                const err = await response.json().catch(() => ({ detail: 'Unknown error' }));
                throw new Error(err.detail || `HTTP ${response.status}`);
            }

            mergedData = await response.json();
        }

        progressBar.style.width = '100%';
        stageLabel.textContent = isBatch
            ? `Batch complete! ${files.length} files analyzed, ${mergedData.detections.length} detections.`
            : 'Analysis complete!';
        await sleep(400);

        loadingState.style.display = 'none';
        showResults(mergedData);

    } catch (err) {
        loadingState.style.display = 'none';
        emptyState.style.display = 'flex';
        progressBar.style.width = '0%';

        if (err.message.includes('fetch') || err.message.includes('Failed')) {
            showToast('API offline — showing demo results. Start api.py to use real detection.', 'warn');
            showDemoResults();
        } else {
            showToast(`Detection error: ${err.message}`, 'error');
        }
    }
};

/* ── Show real results from API ─────────────────── */
let _galleryImages = [];  // batch images array
let _galleryIdx = 0;      // current gallery index

function showResults(data) {
    const resultsEl = document.getElementById('results-content');
    resultsEl.style.display = 'flex';
    window.latestInspectionData = data;

    const galleryNav = document.getElementById('gallery-nav');
    const isBatch = data.annotated_images && data.annotated_images.length > 1;

    if (isBatch) {
        // Batch mode — set up gallery
        _galleryImages = data.annotated_images;
        _galleryIdx = 0;
        galleryNav.style.display = 'block';
        showGalleryImage(0);
    } else {
        // Single image mode
        _galleryImages = [];
        galleryNav.style.display = 'none';
        if (data.annotated_image) {
            drawAnnotatedImage(data.annotated_image, data.detections);
        } else {
            drawBoxesOverUpload(data.detections);
        }
    }

    // Render per-object detection list
    renderDetectionList(data.detections);

    // Update confidence bar
    const avgConf = data.summary.avg_confidence;
    const avgPct = Math.round(avgConf * 100);
    setTimeout(() => {
        const bar = document.getElementById('conf-bar');
        const val = document.getElementById('conf-value');
        if (bar) bar.style.width = avgPct + '%';
        if (val) val.textContent = avgPct + '%';
    }, 300);

    updateSummaryStats(data);
    populateAndShowReport(data);
    resultsEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ── Gallery navigation for batch images ── */
function showGalleryImage(idx) {
    if (!_galleryImages.length) return;
    _galleryIdx = Math.max(0, Math.min(idx, _galleryImages.length - 1));
    const item = _galleryImages[_galleryIdx];

    // Draw on canvas
    if (item.image) {
        drawAnnotatedImage(item.image, item.detections || []);
    }

    // Update counter and filename
    const counter = document.getElementById('gallery-counter');
    const filename = document.getElementById('gallery-filename');
    if (counter) counter.textContent = `${_galleryIdx + 1} / ${_galleryImages.length}`;
    if (filename) filename.textContent = item.filename || '';

    // Disable prev/next at boundaries
    const prevBtn = document.getElementById('gallery-prev');
    const nextBtn = document.getElementById('gallery-next');
    if (prevBtn) prevBtn.disabled = _galleryIdx === 0;
    if (nextBtn) nextBtn.disabled = _galleryIdx === _galleryImages.length - 1;
}

window.galleryNav = function (dir) {
    showGalleryImage(_galleryIdx + dir);
};

/* ── Draw the base64 annotated image on canvas ── */
function drawAnnotatedImage(b64DataUri, detections) {
    const canvas = document.getElementById('result-canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();

    img.onload = () => {
        // Resize canvas to image aspect
        const maxW = canvas.parentElement ? canvas.parentElement.offsetWidth || 640 : 640;
        const scale = Math.min(maxW / img.width, 1);
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // Because OpenCV already drew boxes on the image,
        // we optionally re-draw a HUD overlay border
        ctx.strokeStyle = 'rgba(0,200,176,0.25)';
        ctx.lineWidth = 1;
        ctx.strokeRect(0, 0, canvas.width, canvas.height);
    };

    img.src = b64DataUri;
}

/* ── Draw boxes on canvas over uploaded image ─── */
function drawBoxesOverUpload(detections) {
    const canvas = document.getElementById('result-canvas');
    const ctx = canvas.getContext('2d');
    const previewImg = document.getElementById('preview-image');

    const draw = (img) => {
        const W = canvas.width, H = canvas.height;

        // Scale factor (the preview image may have different natural dimensions)
        const scaleX = W / (img.naturalWidth || img.width || W);
        const scaleY = H / (img.naturalHeight || img.height || H);

        ctx.clearRect(0, 0, W, H);
        ctx.drawImage(img, 0, 0, W, H);

        detections.forEach(det => {
            const x1 = det.x1 * scaleX, y1 = det.y1 * scaleY;
            const x2 = det.x2 * scaleX, y2 = det.y2 * scaleY;
            const w = x2 - x1, h = y2 - y1;
            const color = classColor(det.class_name);
            const confPct = Math.round(det.confidence * 100) + '%';

            // Box glow
            ctx.shadowColor = color;
            ctx.shadowBlur = 10;
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.strokeRect(x1, y1, w, h);
            ctx.shadowBlur = 0;

            // Corner marks
            const cs = 10;
            ctx.strokeStyle = color;
            ctx.lineWidth = 3;
            [[x1, y1, cs, cs], [x2, y1, -cs, cs], [x1, y2, cs, -cs], [x2, y2, -cs, -cs]].forEach(([cx, cy, dx, dy]) => {
                ctx.beginPath(); ctx.moveTo(cx + dx, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + dy); ctx.stroke();
            });

            // Label
            const label = `${det.class_name}  ${confPct}`;
            ctx.font = 'bold 11px "JetBrains Mono", monospace';
            const tw = ctx.measureText(label).width + 14;
            const lh = 18;
            const ly = Math.max(y1 - lh - 2, 2);
            ctx.fillStyle = color;
            ctx.fillRect(x1, ly, tw, lh + 4);
            ctx.fillStyle = '#0a1520';
            ctx.fillText(label, x1 + 7, ly + lh - 1);
        });

        // Detection count
        const cLabel = `${detections.length} detection${detections.length !== 1 ? 's' : ''} found`;
        ctx.font = '600 11px "JetBrains Mono", monospace';
        const cw = ctx.measureText(cLabel).width + 16;
        ctx.fillStyle = 'rgba(5,10,15,0.8)';
        ctx.fillRect(W - cw - 4, H - 26, cw, 22);
        ctx.fillStyle = '#00c8b0';
        ctx.fillText(cLabel, W - cw, H - 9);
    };

    // If image already loaded
    if (previewImg && previewImg.naturalWidth) {
        draw(previewImg);
    } else if (previewImg) {
        previewImg.addEventListener('load', () => draw(previewImg), { once: true });
    }
}

/* ── Render per-object detection rows ──────────── */
function renderDetectionList(detections) {
    const list = document.getElementById('detections-list');
    list.innerHTML = '';

    if (!detections || detections.length === 0) {
        list.innerHTML = '<div style="color:var(--text-3);font-family:var(--font-mono);font-size:13px;padding:16px 0;">No objects detected</div>';
        return;
    }

    // Group by class to show counts
    const groups = {};
    detections.forEach(d => {
        const key = d.class_name;
        if (!groups[key]) groups[key] = { name: key, confs: [], total: 0 };
        groups[key].confs.push(d.confidence);
        groups[key].total++;
    });

    Object.values(groups).forEach(g => {
        const avgConf = g.confs.reduce((a, b) => a + b, 0) / g.confs.length;
        const confPct = Math.round(avgConf * 100);
        const color = classColor(g.name);

        const row = document.createElement('div');
        row.className = 'detection-row';

        row.innerHTML = `
      <div class="dr-dot" style="background:${color};box-shadow:0 0 8px ${color}40;"></div>
      <div class="dr-label">${g.name}</div>
      <div class="dr-count">${g.total} detected</div>
      <div class="dr-conf" style="color:${color};">${confPct}%</div>
    `;
        list.appendChild(row);
    });

    // Individual boxes with per-detection confidence
    const perBox = document.getElementById('per-detection-boxes');
    if (!perBox) return;
    perBox.innerHTML = '';

    detections.forEach((d, i) => {
        const color = classColor(d.class_name);
        const confPct = Math.round(d.confidence * 100);
        const box = document.createElement('div');
        box.className = 'per-det-item';
        box.style.cssText = `
      display:flex;align-items:center;gap:10px;
      padding:8px 12px;margin-bottom:4px;
      border-left:2px solid ${color};
      background:rgba(0,0,0,0.2);
      font-family:var(--font-mono);font-size:12px;
    `;
        box.innerHTML = `
      <span style="color:${color};min-width:18px;font-weight:700;">#${i + 1}</span>
      <span style="color:var(--text-2);flex:1;">${d.class_name}</span>
      <span style="
        padding:2px 8px;background:${color}22;border:1px solid ${color}44;
        border-radius:2px;color:${color};font-weight:700;
      ">${confPct}%</span>
    `;
        perBox.appendChild(box);
    });
}

/* ── Update summary HUD numbers on results panel ─ */
function updateSummaryStats(data) {
    const s = data.summary;
    const $id = (id) => document.getElementById(id);

    if ($id('result-total')) $id('result-total').textContent = s.total;
    if ($id('result-risk')) $id('result-risk').textContent = s.risk_level;
    if ($id('result-inf-ms')) $id('result-inf-ms').textContent = s.inference_time_ms + ' ms';
    if ($id('result-insp-id')) $id('result-insp-id').textContent = data.inspection_id;

    // Colour the risk badge
    const riskEl = $id('result-risk');
    if (riskEl) {
        const rColors = { HIGH: '#e74c3c', MEDIUM: '#f0a500', LOW: '#00c8b0', SAFE: '#00c8b0' };
        riskEl.style.color = rColors[s.risk_level] || 'var(--text-1)';
    }
}

/* ── Reveal report section with real data ────────── */
function populateAndShowReport(data) {
    const reportSection = document.getElementById('report');
    if (!reportSection) return;

    // Show the report section
    reportSection.style.display = '';
    reportSection.removeAttribute('hidden');

    const s = data.summary;
    const mm = data.model_metrics;

    // Patch report card fields
    const setEl = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };

    setEl('rpt-inspection-id', data.inspection_id);
    setEl('rpt-date', new Date(data.timestamp).toLocaleString());
    setEl('rpt-risk', s.risk_level);
    setEl('rpt-total', s.total + ' anomalies detected');
    setEl('rpt-inf-time', s.inference_time_ms + ' ms');
    setEl('rpt-precision', (mm.precision * 100).toFixed(1) + '%');
    setEl('rpt-recall', (mm.recall * 100).toFixed(1) + '%');
    setEl('rpt-map50', (mm.map50 * 100).toFixed(1) + '%');

    // Risk banner colour
    const riskBanner = document.getElementById('rpt-risk-banner');
    if (riskBanner) {
        riskBanner.className = riskBanner.className.replace(/rpt-risk-\w+/g, '');
        const cls = { HIGH: 'rpt-risk-high', MEDIUM: 'rpt-risk-moderate', LOW: 'rpt-risk-low', SAFE: 'rpt-risk-low' };
        riskBanner.classList.add(cls[s.risk_level] || 'rpt-risk-low');
    }

    updateReportSummaryCounts(data.detections || []);
    updateReportAnnotatedImage(data);

    // Detection breakdown in report
    const breakdown = document.getElementById('rpt-detection-breakdown');
    if (breakdown && data.detections) {
        const normalizeReportClass = (name) => {
            const key = (name || '').toLowerCase().trim();
            if (!key) return key;
            if (key.includes('corrosion')) return 'corrosion';
            if (key.includes('marine') && key.includes('growth')) return 'marine growth';
            if (key.includes('debris')) return 'debris';
            if (key.includes('healthy')) return 'healthy';
            return key;
        };
        const groups = {};
        data.detections.forEach(d => {
            const key = normalizeReportClass(d.class_name);
            if (!groups[key]) groups[key] = { total: 0, maxConf: 0 };
            groups[key].total++;
            groups[key].maxConf = Math.max(groups[key].maxConf, d.confidence);
        });

        breakdown.innerHTML = Object.entries(groups).map(([cls, g]) => {
            const pct = Math.round(g.maxConf * 100);
            const color = classColor(cls);
            return `
        <div style="margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;">
            <span style="color:var(--text-2);">${cls}</span>
            <span style="font-family:var(--font-mono);color:${color};">${pct}%</span>
          </div>
          <div style="height:4px;background:var(--border-dim);border-radius:2px;">
            <div style="width:${pct}%;height:100%;background:${color};border-radius:2px;transition:width 0.8s;"></div>
          </div>
        </div>`;
        }).join('');
    }

    // Scroll to report
    setTimeout(() => {
        reportSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 600);
}

function updateReportSummaryCounts(detections) {
    const counts = {
        corrosion: 0,
        'marine growth': 0,
        debris: 0,
        healthy: 0,
        'healthy surface': 0,
    };

    const normalizeReportClass = (name) => {
        const key = (name || '').toLowerCase().trim();
        if (!key) return key;
        if (key.includes('corrosion') || key.includes('corrision')) return 'corrosion';
        if (key.includes('marine') && key.includes('growth')) return 'marine growth';
        if (key.includes('debris')) return 'debris';
        if (key.includes('healthy')) return 'healthy';
        return key;
    };

    detections.forEach(d => {
        const key = normalizeReportClass(d.class_name);
        if (counts[key] !== undefined) {
            counts[key] += 1;
        }
    });

    const healthyCount = counts.healthy + counts['healthy surface'];

    const setCount = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };

    setCount('rpt-count-corrosion', counts.corrosion);
    setCount('rpt-count-growth', counts['marine growth']);
    setCount('rpt-count-debris', counts.debris);
    setCount('rpt-count-healthy', healthyCount);
}

function updateReportAnnotatedImage(data) {
    const imgEl = document.getElementById('rpt-annotated-img');
    const layer = document.getElementById('rpt-bbox-layer');
    const empty = document.getElementById('rpt-annotated-empty');
    const rptGallery = document.getElementById('rpt-gallery');
    const rptGrid = document.getElementById('rpt-gallery-grid');
    if (!imgEl || !layer) return;

    const isBatch = data.annotated_images && data.annotated_images.length > 1;

    if (isBatch && rptGallery && rptGrid) {
        // Show first image as main
        const first = data.annotated_images[0];
        if (first && first.image) {
            imgEl.src = first.image;
            imgEl.style.display = 'block';
            if (empty) empty.style.display = 'none';
        }
        layer.innerHTML = '';

        // Build thumbnail gallery grid
        rptGallery.style.display = 'block';
        rptGrid.innerHTML = data.annotated_images.map((item, i) => {
            const src = item.image || '';
            const detCount = item.detections ? item.detections.length : 0;
            if (!src) return '';
            return `<div style="cursor:pointer;border:1px solid var(--border-dim);border-radius:4px;overflow:hidden;background:var(--bg-2);transition:border-color 0.2s;"
                        onmouseover="this.style.borderColor='var(--teal)'" onmouseout="this.style.borderColor='var(--border-dim)'"
                        onclick="document.getElementById('rpt-annotated-img').src='${src}';">
                <img src="${src}" alt="${item.filename}" style="width:100%;height:100px;object-fit:cover;display:block;" />
                <div style="padding:4px 6px;font-size:10px;font-family:var(--font-mono);">
                    <div style="color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${item.filename}">${item.filename}</div>
                    <div style="color:var(--teal);">${detCount} detection${detCount !== 1 ? 's' : ''}</div>
                </div>
            </div>`;
        }).join('');
        return;
    }

    // Single image mode (original logic)
    if (rptGallery) rptGallery.style.display = 'none';
    const annotatedSrc = data.annotated_image || '';
    const previewImg = document.getElementById('preview-image');
    const fallbackSrc = previewImg && previewImg.src ? previewImg.src : '';
    const imgSrc = annotatedSrc || fallbackSrc;

    layer.innerHTML = '';

    if (!imgSrc) {
        imgEl.style.display = 'none';
        if (empty) empty.style.display = 'flex';
        return;
    }

    imgEl.src = imgSrc;
    imgEl.style.display = 'block';
    if (empty) empty.style.display = 'none';

    if (annotatedSrc || !data.detections || data.detections.length === 0) {
        return;
    }

    const draw = () => {
        layer.innerHTML = '';
        const iw = imgEl.naturalWidth || imgEl.width;
        const ih = imgEl.naturalHeight || imgEl.height;
        if (!iw || !ih) return;

        data.detections.forEach(det => {
            const x1 = (det.x1 / iw) * 100;
            const y1 = (det.y1 / ih) * 100;
            const x2 = (det.x2 / iw) * 100;
            const y2 = (det.y2 / ih) * 100;
            const w = x2 - x1;
            const h = y2 - y1;
            const color = classColor(det.class_name);
            const confPct = Math.round(det.confidence * 100) + '%';

            const box = document.createElement('div');
            box.className = 'rpt-bbox';
            box.style.cssText = `top:${y1}%;left:${x1}%;width:${w}%;height:${h}%;border-color:${color};`;

            const label = document.createElement('div');
            label.className = 'rpt-bbox-label';
            label.style.cssText = `background:${color};color:#0a1520;`;
            label.textContent = `${det.class_name} ${confPct}`;
            box.appendChild(label);

            layer.appendChild(box);
        });
    };

    if (imgEl.complete) draw();
    else imgEl.addEventListener('load', draw, { once: true });
}

/* ── Demo fallback (when API is offline) ────────── */
const DEMO_DETECTIONS = [
    { class_name: 'Corrosion', confidence: 0.94, x1: 58, y1: 62, x2: 198, y2: 222 },
    { class_name: 'Corrosion', confidence: 0.91, x1: 328, y1: 305, x2: 448, y2: 445 },
    { class_name: 'Marine Growth', confidence: 0.88, x1: 554, y1: 155, x2: 668, y2: 277 },
    { class_name: 'Debris', confidence: 0.81, x1: 420, y1: 40, x2: 524, y2: 152 },
    { class_name: 'Healthy Surface', confidence: 0.99, x1: 618, y1: 318, x2: 778, y2: 458 },
    { class_name: 'Marine Growth', confidence: 0.85, x1: 110, y1: 380, x2: 244, y2: 502 },
];

function showDemoResults() {
    const emptyState = document.getElementById('empty-state');
    const resultsEl = document.getElementById('results-content');
    emptyState.style.display = 'none';
    resultsEl.style.display = 'flex';

    const demoData = {
        inspection_id: 'DEMO-0000',
        detections: DEMO_DETECTIONS,
        annotated_image: null,
        summary: {
            total: DEMO_DETECTIONS.length,
            risk_level: 'MEDIUM',
            avg_confidence: 0.897,
            max_confidence: 0.99,
            inference_time_ms: 42,
        },
        model_metrics: { precision: 0.886, recall: 0.844, map50: 0.882, map5095: 0.782 },
        timestamp: new Date().toISOString(),
    };
    window.latestInspectionData = demoData;

    drawBoxesOverUpload(DEMO_DETECTIONS);
    renderDetectionList(DEMO_DETECTIONS);

    const bar = document.getElementById('conf-bar');
    const val = document.getElementById('conf-value');
    if (bar) bar.style.width = '90%';
    if (val) val.textContent = '90%';

    updateSummaryStats(demoData);
    populateAndShowReport(demoData);

    resultsEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ── Navigate to report section ─────────────────── */
window.generateReport = function () {
    const reportSection = document.getElementById('report');
    if (reportSection) {
        reportSection.scrollIntoView({ behavior: 'smooth' });
        const demoCard = document.getElementById('report-demo');
        if (demoCard) {
            demoCard.style.borderColor = 'var(--teal)';
            demoCard.style.boxShadow = '0 0 40px rgba(0,200,176,0.3)';
            setTimeout(() => {
                demoCard.style.borderColor = '';
                demoCard.style.boxShadow = '';
            }, 2000);
        }
    }
};

/* ── Utilities ──────────────────────────────────── */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function showToast(msg, type = 'info') {
    const colors = { info: '#00c8b0', warn: '#f0a500', error: '#e74c3c' };
    const toast = document.createElement('div');
    toast.style.cssText = `
    position:fixed;bottom:28px;right:28px;z-index:9999;
    background:var(--bg-panel);border:1px solid ${colors[type]};
    color:var(--text-1);padding:12px 20px;border-radius:4px;
    font-family:var(--font-mono);font-size:13px;
    box-shadow:0 4px 24px rgba(0,0,0,0.6);max-width:380px;line-height:1.5;
  `;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
}
