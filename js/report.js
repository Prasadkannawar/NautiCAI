/* ═══════════════════════════════════════════════
   NautiCAI — Report JavaScript
   PDF Generation & Contact Form
═══════════════════════════════════════════════ */

/* ── Download Report (simulated PDF) ─────────── */
window.downloadReport = function () {
  const btn = event.currentTarget || document.querySelector('.report-actions .btn-primary');
  const originalText = btn ? btn.innerHTML : '';
  const reportData = window.latestInspectionData || null;

  if (btn) {
    btn.innerHTML = `<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Generating PDF...`;
    btn.disabled = true;
    btn.style.opacity = '0.7';
  }

  setTimeout(() => {
    // Create a printable report data blob
    const reportHTML = generateReportHTML(reportData);
    const blob = new Blob([reportHTML], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = reportData?.inspection_id
      ? `NautiCAI_Inspection_Report_${reportData.inspection_id}.html`
      : 'NautiCAI_Inspection_Report_NCR-2026-0247.html';
    a.click();
    URL.revokeObjectURL(url);

    if (btn) {
      btn.innerHTML = originalText;
      btn.disabled = false;
      btn.style.opacity = '';
    }
  }, 1500);
};

function generateReportHTML(data) {
  const now = new Date();
  const timestamp = data?.timestamp ? new Date(data.timestamp) : now;
  const dateStr = timestamp.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  const reportId = data?.inspection_id || 'NCR-2026-0247';
  const detections = Array.isArray(data?.detections) ? data.detections : [];

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
    if (counts[key] !== undefined) counts[key] += 1;
  });

  const hasDetections = detections.length > 0;
  const corrosionCount = hasDetections ? counts.corrosion : 4;
  const growthCount = hasDetections ? counts['marine growth'] : 3;
  const debrisCount = hasDetections ? counts.debris : 2;
  const healthyCount = hasDetections ? (counts.healthy + counts['healthy surface']) : 3;
  const totalDetections = hasDetections ? detections.length : 12;

  const riskLevel = data?.summary?.risk_level || 'MODERATE';
  const riskText = riskLevel === 'SAFE' ? 'SAFE' : `${riskLevel} RISK`;
  const infTime = data?.summary?.inference_time_ms != null ? `${data.summary.inference_time_ms} ms` : '—';

  const colorMap = {
    corrosion: '#e74c3c',
    'marine growth': '#f39c12',
    debris: '#e67e22',
    'healthy surface': '#00b4a0',
    healthy: '#00b4a0',
  };

  const groupRows = Object.entries(counts)
    .filter(([name, count]) => count > 0)
    .map(([name, count]) => {
      const maxConf = detections
        .filter(d => normalizeReportClass(d.class_name) === name)
        .reduce((m, d) => Math.max(m, d.confidence || 0), 0);
      const pct = Math.round(maxConf * 100);
      const color = colorMap[name] || '#00b4a0';
      const label = name.replace(/\\b\\w/g, s => s.toUpperCase());
      return `
      <tr><td>${label}</td><td>${count}</td><td><div class="cb-wrap"><div class="cb-fill" style="width:${pct}%;background:${color};"></div></div></td><td style="color:${color};font-weight:600;">${pct}%</td></tr>`;
    })
    .join('');

  const confidenceRows = hasDetections ? groupRows : `
      <tr><td>Corrosion</td><td>4</td><td><div class="cb-wrap"><div class="cb-fill" style="width:94%;background:#e74c3c;"></div></div></td><td style="color:#e74c3c;font-weight:600;">94%</td></tr>
      <tr><td>Marine Growth</td><td>3</td><td><div class="cb-wrap"><div class="cb-fill" style="width:88%;background:#f39c12;"></div></div></td><td style="color:#f39c12;font-weight:600;">88%</td></tr>
      <tr><td>Debris</td><td>2</td><td><div class="cb-wrap"><div class="cb-fill" style="width:81%;background:#e67e22;"></div></div></td><td style="color:#e67e22;font-weight:600;">81%</td></tr>
      <tr><td>Healthy Surface</td><td>3</td><td><div class="cb-wrap"><div class="cb-fill" style="width:99%;background:#00b4a0;"></div></div></td><td style="color:#00b4a0;font-weight:600;">99%</td></tr>`;

  // Build annotated images section
  const isBatch = Array.isArray(data?.annotated_images) && data.annotated_images.length > 1;
  let annotatedSection = '';

  if (isBatch) {
    // Batch mode: render every image with per-image results
    annotatedSection = data.annotated_images.map((item, idx) => {
      const imgTag = item.image
        ? `<img src="${item.image}" alt="${item.filename}" style="width:100%;border-radius:6px;border:1px solid #e0e0e0;"/>`
        : `<div style="height:120px;display:flex;align-items:center;justify-content:center;color:#999;font-size:12px;border:1px solid #e0e0e0;border-radius:6px;">No annotated image</div>`;
      const dets = item.detections || [];
      const detCounts = {};
      dets.forEach(d => {
        const cls = normalizeReportClass(d.class_name);
        detCounts[cls] = (detCounts[cls] || 0) + 1;
      });
      const detSummary = Object.entries(detCounts)
        .map(([cls, cnt]) => {
          const color = colorMap[cls] || '#00b4a0';
          return `<span style="display:inline-block;margin:2px 4px;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:${color}20;color:${color};border:1px solid ${color}40;">${cls}: ${cnt}</span>`;
        }).join('') || '<span style="font-size:11px;color:#888;">No detections</span>';

      return `
      <div style="border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;margin-bottom:16px;page-break-inside:avoid;">
        <div style="padding:10px 14px;background:#f8fafb;border-bottom:1px solid #e0e0e0;display:flex;justify-content:space-between;align-items:center;">
          <div style="font-size:13px;font-weight:600;color:#0b1e2d;">${idx + 1}. ${item.filename}</div>
          <div style="font-size:12px;color:#666;">${dets.length} detection${dets.length !== 1 ? 's' : ''}</div>
        </div>
        ${imgTag}
        <div style="padding:8px 14px;background:#fafafa;border-top:1px solid #e0e0e0;">
          ${detSummary}
        </div>
      </div>`;
    }).join('');

    annotatedSection = `
      <div style="font-size:12px;color:#666;margin-bottom:12px;">${data.annotated_images.length} images analyzed in this batch inspection</div>
      ${annotatedSection}`;
  } else {
    // Single image mode
    const imgSrc = data?.annotated_image;
    const imgTag = imgSrc
      ? `<img src="${imgSrc}" alt="Annotated result" style="width:100%;border-radius:6px;border:1px solid #e0e0e0;"/>`
      : `<div style="height:200px;display:flex;align-items:center;justify-content:center;color:#00b4a0;font-size:12px;border:1px solid #e0e0e0;border-radius:6px;">Run an inspection to view annotated output</div>`;
    annotatedSection = `
      <div class="annotated-placeholder">
        ${imgTag}
    <span style="color:rgba(0,180,160,0.4);font-size:12px;position:absolute;bottom:8px;right:12px;">${totalDetections} total detections · Inspection Model v3.2</span>
      </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>NautiCAI Inspection Report — ${reportId}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', sans-serif; background: #fff; color: #1a1a2e; }
  .report { max-width: 800px; margin: 0 auto; padding: 40px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 24px; border-bottom: 2px solid #00b4a0; margin-bottom: 28px; }
  .logo-area { display: flex; align-items: center; gap: 12px; }
  .company-name { font-size: 24px; font-weight: 700; color: #0b1e2d; }
  .company-tagline { font-size: 11px; color: #666; }
  .meta { text-align: right; font-size: 12px; color: #555; line-height: 1.8; }
  .meta strong { color: #0b1e2d; }
  .report-title { font-size: 22px; font-weight: 700; color: #0b1e2d; margin-bottom: 4px; }
  .report-asset { font-size: 13px; color: #666; margin-bottom: 24px; }
  .risk-banner { display: flex; align-items: center; gap: 16px; padding: 16px 20px; border-radius: 8px; background: #fff8e6; border: 1px solid #f39c12; margin-bottom: 28px; }
  .risk-label { font-size: 13px; font-weight: 700; color: #b7770d; }
  .risk-desc { font-size: 12px; color: #666; }
  .risk-score { margin-left: auto; font-size: 14px; font-weight: 700; color: #b7770d; }
  .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 28px; }
  .summary-item { text-align: center; padding: 16px; border: 1px solid #e0e0e0; border-radius: 8px; }
  .sv { font-size: 28px; font-weight: 700; line-height: 1; margin-bottom: 4px; }
  .sl { font-size: 11px; color: #888; }
  .section-title { font-size: 14px; font-weight: 600; color: #0b1e2d; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #eee; padding-bottom: 6px; }
  .annotated-placeholder { height: 200px; background: linear-gradient(135deg, #0a1a26, #0d2a3d); border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #00b4a0; font-size: 13px; margin-bottom: 28px; border: 1px solid #e0e0e0; position: relative; overflow: hidden; }
  .bbox { position: absolute; border: 2px solid; border-radius: 3px; }
  .bbox-label { position: absolute; top: -22px; left: 0; padding: 2px 6px; font-size: 10px; font-weight: 700; color: #fff; border-radius: 3px 3px 0 0; }
  .conf-table { width: 100%; border-collapse: collapse; margin-bottom: 28px; }
  .conf-table th { text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #888; padding: 8px 12px; border-bottom: 2px solid #eee; }
  .conf-table td { padding: 10px 12px; font-size: 13px; border-bottom: 1px solid #f0f0f0; }
  .conf-bar-cell { width: 200px; }
  .cb-wrap { height: 6px; background: #f0f0f0; border-radius: 3px; }
  .cb-fill { height: 100%; border-radius: 3px; }
  .rec-list { list-style: none; margin-bottom: 28px; }
  .rec-list li { display: flex; align-items: flex-start; gap: 10px; padding: 10px 14px; border: 1px solid #eee; border-radius: 6px; margin-bottom: 8px; font-size: 13px; color: #444; }
  .priority { padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; white-space: nowrap; }
  .p-high { background: #fde8e8; color: #c0392b; border: 1px solid #e74c3c; }
  .p-medium { background: #fef3e2; color: #e67e22; border: 1px solid #f39c12; }
  .p-low { background: #e6f9f7; color: #00857a; border: 1px solid #00b4a0; }
  .footer { display: flex; justify-content: space-between; align-items: center; padding-top: 20px; border-top: 1px solid #eee; font-size: 11px; color: #888; flex-wrap: wrap; gap: 8px; }
  .cert-badges { display: flex; gap: 8px; }
  .cert { padding: 3px 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 10px; color: #666; }
  @media print { body { background: #fff; } .report { padding: 20px; } }
</style>
</head>
<body>
<div class="report">
  <div class="header">
    <div class="logo-area">
      <svg width="44" height="44" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="24" cy="24" r="22" stroke="#00b4a0" stroke-width="2"/>
        <path d="M12 30 Q18 18 24 24 Q30 30 36 18" stroke="#00b4a0" stroke-width="2.5" stroke-linecap="round" fill="none"/>
        <circle cx="24" cy="24" r="4" fill="#00b4a0" opacity="0.8"/>
      </svg>
      <div>
        <div class="company-name">NautiCAI</div>
        <div class="company-tagline">Underwater Hull Inspection</div>
      </div>
    </div>
    <div class="meta">
      <div><span>Report ID: </span><strong>${reportId}</strong></div>
      <div><span>Date: </span><strong>${dateStr}</strong></div>
      <div><span>Operator: </span><strong>Maritime Inspection Team</strong></div>
      <div><span>Classification: </span><strong>CONFIDENTIAL</strong></div>
    </div>
  </div>

  <div class="report-title">Subsea Hull Inspection Report</div>
  <div class="report-asset">Asset: MV Northern Star — Aft Starboard Section · Depth: 6.5m · Duration: 47 min</div>

  <div class="risk-banner">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f39c12" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
    <div>
      <div class="risk-label">⚠ ${riskText}</div>
      <div class="risk-desc">Immediate inspection of corroded zones recommended within 30 days</div>
    </div>
    <div class="risk-score">Inference: ${infTime}</div>
  </div>

  <div class="section-title">Detection Summary</div>
  <div class="summary-grid">
    <div class="summary-item"><div class="sv" style="color:#e74c3c;">${corrosionCount}</div><div class="sl">Corrosion Zones</div></div>
    <div class="summary-item"><div class="sv" style="color:#f39c12;">${growthCount}</div><div class="sl">Marine Growth</div></div>
    <div class="summary-item"><div class="sv" style="color:#e67e22;">${debrisCount}</div><div class="sl">Debris Detected</div></div>
    <div class="summary-item"><div class="sv" style="color:#00b4a0;">${healthyCount}</div><div class="sl">Healthy Surfaces</div></div>
  </div>

  <div class="section-title">Annotated Inspection Output</div>
  ${annotatedSection}

  <div class="section-title">Confidence Breakdown</div>
  <table class="conf-table">
    <thead><tr><th>Detection Class</th><th>Count</th><th class="conf-bar-cell">Confidence</th><th>Score</th></tr></thead>
    <tbody>
      ${confidenceRows}
    </tbody>
  </table>

  <div class="section-title">Remediation Recommendations</div>
  <ul class="rec-list">
    <li><span class="priority p-high">HIGH</span> Apply cathodic protection coating to zones A2, A5. Schedule remediation within 30 days.</li>
    <li><span class="priority p-medium">MEDIUM</span> Schedule biofouling removal for marine growth zones B1–B3 within 60 days.</li>
    <li><span class="priority p-low">LOW</span> Continue monitoring healthy surface zones. Re-inspect in 90 days.</li>
  </ul>

  <div class="footer">
    <div><strong>NautiCAI Pte. Ltd.</strong><br/>1 Marina Boulevard, Singapore 018989<br/>contact@nauticai.com · nauticai.com</div>
    <div class="cert-badges">
      <span class="cert">ISO 19901</span>
      <span class="cert">DNV GL Verified</span>
      <span class="cert">BV Marine</span>
    </div>
  </div>
</div>
</body>
</html>`;
}

/* ── Contact Form ─────────────────────────────── */
window.submitForm = async function (e) {
  e.preventDefault();
  const btn = document.getElementById('btn-form-submit');
  const form = document.getElementById('contact-form');
  const successMsg = document.getElementById('form-success');
  const API_BASE = window.API_BASE || 'http://localhost:8001';

  btn.innerHTML = `<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Submitting...`;
  btn.disabled = true;
  btn.style.opacity = '0.7';

  try {
    const payload = {
      first_name: document.getElementById('f-name')?.value?.trim() || '',
      last_name: document.getElementById('f-last')?.value?.trim() || '',
      email: document.getElementById('f-email')?.value?.trim() || '',
      company: document.getElementById('f-company')?.value?.trim() || '',
      use_case: document.getElementById('f-use')?.value || '',
      message: document.getElementById('f-message')?.value?.trim() || '',
    };

    const res = await fetch(`${API_BASE}/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }

    btn.style.display = 'none';
    successMsg.style.display = 'flex';
    form.querySelectorAll('.form-input').forEach(input => {
      input.disabled = true;
      input.style.opacity = '0.5';
    });
  } catch (err) {
    btn.innerHTML = `<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Send Enterprise Inquiry`;
    btn.disabled = false;
    btn.style.opacity = '';
    if (typeof showToast === 'function') {
      showToast(`Contact submit failed: ${err.message}`, 'error');
    } else {
      alert(`Contact submit failed: ${err.message}`);
    }
  }
};
