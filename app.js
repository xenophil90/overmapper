'use strict';

/* ---------- GPX parsing ---------- */

function parseGPX(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('Die Datei konnte nicht als GPX gelesen werden.');
  }

  const trkSegs = doc.querySelectorAll('trkseg');
  if (trkSegs.length === 0) {
    throw new Error('Keine Track-Daten (trkseg) in der GPX-Datei gefunden.');
  }

  const segments = [];
  trkSegs.forEach((seg) => {
    const pts = [];
    seg.querySelectorAll('trkpt').forEach((pt) => {
      const lat = parseFloat(pt.getAttribute('lat'));
      const lon = parseFloat(pt.getAttribute('lon'));
      if (Number.isNaN(lat) || Number.isNaN(lon)) return;
      const eleEl = pt.querySelector('ele');
      const timeEl = pt.querySelector('time');
      const ele = eleEl ? parseFloat(eleEl.textContent) : null;
      const time = timeEl ? new Date(timeEl.textContent) : null;
      pts.push({
        lat,
        lon,
        ele: Number.isNaN(ele) ? null : ele,
        time: time && !Number.isNaN(time.getTime()) ? time : null,
      });
    });
    if (pts.length > 1) segments.push(pts);
  });

  if (segments.length === 0) {
    throw new Error('Der Track enthält zu wenige Punkte.');
  }
  return segments;
}

/* ---------- Geo / metrics ---------- */

function haversine(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function computeMetrics(segments) {
  let distance = 0;
  segments.forEach((seg) => {
    for (let i = 1; i < seg.length; i++) {
      distance += haversine(seg[i - 1], seg[i]);
    }
  });
  return { distanceMeters: distance };
}

function minMax(values) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return [min, max];
}

function computeProjection(segments, boxX, boxY, boxW, boxH) {
  const lats = [];
  const lons = [];
  segments.forEach((seg) => seg.forEach((p) => { lats.push(p.lat); lons.push(p.lon); }));

  const [minLat, maxLat] = minMax(lats);
  const [minLon, maxLon] = minMax(lons);
  const midLat = (minLat + maxLat) / 2;
  const lonScale = Math.cos((midLat * Math.PI) / 180) || 1;

  const spanX = Math.max((maxLon - minLon) * lonScale, 1e-9);
  const spanY = Math.max(maxLat - minLat, 1e-9);

  const scale = Math.min(boxW / spanX, boxH / spanY);
  const drawW = spanX * scale;
  const drawH = spanY * scale;
  const offsetX = boxX + (boxW - drawW) / 2;
  const offsetY = boxY + (boxH - drawH) / 2;

  return {
    project(lat, lon) {
      return {
        x: offsetX + (lon - minLon) * lonScale * scale,
        y: offsetY + (maxLat - lat) * scale,
      };
    },
  };
}

function projectSegments(segments, projection) {
  return segments.map((seg) => seg.map((p) => projection.project(p.lat, p.lon)));
}

/* ---------- Layout zones (3x3 position picker) ---------- */

function parseZone(zone) {
  const [vertical, horizontal] = zone.split('-');
  return { vertical, horizontal };
}

function getAnchor(zone, w, h) {
  const { vertical, horizontal } = parseZone(zone);
  const marginX = w * 0.08;
  const x = horizontal === 'left' ? marginX : horizontal === 'right' ? w - marginX : w / 2;
  const y = vertical === 'top' ? h * 0.15 : vertical === 'bottom' ? h * 0.9 : h * 0.5;
  return { x, y, align: horizontal, vertical };
}

function getTrackBox(zone, w, h) {
  const { vertical, horizontal } = parseZone(zone);
  const marginX = w * 0.08;

  let x0;
  let x1;
  if (horizontal === 'left') { x0 = marginX; x1 = w * 0.48; } else if (horizontal === 'right') { x0 = w * 0.52; x1 = w - marginX; } else { x0 = marginX; x1 = w - marginX; }

  let y0;
  let y1;
  if (vertical === 'top') { y0 = h * 0.13; y1 = h * 0.52; } else if (vertical === 'bottom') { y0 = h * 0.5; y1 = h * 0.9; } else { y0 = h * 0.3; y1 = h * 0.7; }

  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/* ---------- Country detection (point-in-polygon) ---------- */

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygonRings(x, y, rings) {
  if (!pointInRing(x, y, rings[0])) return false;
  for (let k = 1; k < rings.length; k++) {
    if (pointInRing(x, y, rings[k])) return false;
  }
  return true;
}

function pointInGeometry(x, y, geometry) {
  if (geometry.type === 'Polygon') return pointInPolygonRings(x, y, geometry.coordinates);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some((rings) => pointInPolygonRings(x, y, rings));
  return false;
}

function computeBBox(geometry) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  (function walk(coords) {
    if (typeof coords[0] === 'number') {
      const [x, y] = coords;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    } else {
      coords.forEach(walk);
    }
  })(geometry.coordinates);
  return [minX, minY, maxX, maxY];
}

let _countryFeaturesCache = null;
function getCountryFeatures() {
  if (_countryFeaturesCache) return _countryFeaturesCache;
  const features = (window.COUNTRIES_GEOJSON && window.COUNTRIES_GEOJSON.features) || [];
  features.forEach((f) => { f._bbox = computeBBox(f.geometry); });
  _countryFeaturesCache = features;
  return features;
}

let _countryFeatureMapCache = null;
function getCountryFeatureMap() {
  if (_countryFeatureMapCache) return _countryFeatureMapCache;
  const map = new Map();
  getCountryFeatures().forEach((f) => map.set(f.properties.iso2, f));
  _countryFeatureMapCache = map;
  return map;
}

function decimate(points, maxCount) {
  if (points.length <= maxCount) return points;
  const step = points.length / maxCount;
  const out = [];
  for (let i = 0; i < maxCount; i++) out.push(points[Math.floor(i * step)]);
  return out;
}

function detectCountries(segments) {
  const features = getCountryFeatures();
  if (!features.length) return [];
  const allPts = [];
  segments.forEach((seg) => seg.forEach((p) => allPts.push(p)));
  const sampled = decimate(allPts, 400);

  const found = new Map();
  sampled.forEach((p, idx) => {
    const x = p.lon;
    const y = p.lat;
    for (const f of features) {
      const bb = f._bbox;
      if (x < bb[0] || x > bb[2] || y < bb[1] || y > bb[3]) continue;
      if (pointInGeometry(x, y, f.geometry)) {
        const iso2 = f.properties.iso2;
        if (!found.has(iso2)) found.set(iso2, { name: f.properties.name, order: idx });
        break;
      }
    }
  });

  return [...found.entries()]
    .sort((a, b) => a[1].order - b[1].order)
    .map(([iso2, v]) => ({ iso2, name: v.name }));
}

/* ---------- Formatting ---------- */

function formatDistanceParts(meters) {
  if (meters >= 1000) return { value: (meters / 1000).toFixed(1), unit: 'km' };
  return { value: String(Math.round(meters)), unit: 'm' };
}

function withAlpha(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* ---------- Canvas drawing helpers ---------- */

function roundedRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function getCoverMetrics(img, w, h, zoom) {
  const coverScale = Math.max(w / img.width, h / img.height);
  const scale = coverScale * zoom;
  const drawW = img.width * scale;
  const drawH = img.height * scale;
  const maxOffsetX = Math.max(0, (drawW - w) / 2);
  const maxOffsetY = Math.max(0, (drawH - h) / 2);
  return { drawW, drawH, maxOffsetX, maxOffsetY };
}

function drawBackgroundImage(ctx, img, w, h, transform) {
  const { drawW, drawH, maxOffsetX, maxOffsetY } = getCoverMetrics(img, w, h, transform.zoom);
  const dx = (w - drawW) / 2 + transform.panX * maxOffsetX;
  const dy = (h - drawH) / 2 + transform.panY * maxOffsetY;
  ctx.drawImage(img, dx, dy, drawW, drawH);
}

function drawDot(ctx, x, y, color) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 6;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawTrack(ctx, projectedSegments, color) {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 14;
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  projectedSegments.forEach((seg) => {
    if (seg.length < 2) return;
    ctx.beginPath();
    seg.forEach((pt, i) => {
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.stroke();
  });
  ctx.restore();

  const first = projectedSegments[0] && projectedSegments[0][0];
  const lastSeg = projectedSegments[projectedSegments.length - 1];
  const last = lastSeg && lastSeg[lastSeg.length - 1];
  if (first) drawDot(ctx, first.x, first.y, '#3ddc71');
  if (last) drawDot(ctx, last.x, last.y, '#ff5a5a');
}

function drawRingOutline(ctx, projection, ring) {
  ctx.beginPath();
  ring.forEach(([lon, lat], i) => {
    const p = projection.project(lat, lon);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
  ctx.stroke();
}

function drawGeometryOutline(ctx, projection, geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  polygons.forEach((rings) => rings.forEach((ring) => drawRingOutline(ctx, projection, ring)));
}

function drawCountryOutlines(ctx, projection, countries, clipBox) {
  if (!countries || countries.length === 0) return;
  const featureMap = getCountryFeatureMap();

  ctx.save();
  ctx.beginPath();
  ctx.rect(clipBox.x, clipBox.y, clipBox.w, clipBox.h);
  ctx.clip();

  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = Math.max(1, clipBox.w * 0.0018);
  ctx.lineJoin = 'round';

  countries.forEach((c) => {
    const feature = featureMap.get(c.iso2);
    if (feature) drawGeometryOutline(ctx, projection, feature.geometry);
  });

  ctx.restore();
}

function singleLineBaseline(anchor, fontPx) {
  if (anchor.vertical === 'top') return anchor.y + fontPx * 0.85;
  if (anchor.vertical === 'bottom') return anchor.y;
  return anchor.y + fontPx * 0.32;
}

function drawTitleText(ctx, w, h, anchor, color, title) {
  if (!title) return;
  const fontPx = Math.round(w * 0.034);
  ctx.textAlign = anchor.align;
  ctx.font = `800 ${fontPx}px Inter, sans-serif`;
  ctx.fillStyle = withAlpha(color, 0.95);
  ctx.fillText(title.toUpperCase(), anchor.x, singleLineBaseline(anchor, fontPx));
}

function drawDistanceText(ctx, w, h, anchor, color, distanceMeters) {
  const distFontPx = Math.round(w * 0.095);
  const unitFontPx = Math.round(w * 0.034);
  const distBaseline = singleLineBaseline(anchor, distFontPx);

  const { value, unit } = formatDistanceParts(distanceMeters);
  const valueFont = `800 ${distFontPx}px Inter, sans-serif`;
  const unitFont = `600 ${unitFontPx}px Inter, sans-serif`;
  const gap = w * 0.014;

  ctx.font = valueFont;
  const valueWidth = ctx.measureText(value).width;
  ctx.font = unitFont;
  const unitWidth = ctx.measureText(unit).width;
  const totalWidth = valueWidth + gap + unitWidth;

  let valueX;
  if (anchor.align === 'left') valueX = anchor.x;
  else if (anchor.align === 'right') valueX = anchor.x - totalWidth;
  else valueX = anchor.x - totalWidth / 2;

  ctx.textAlign = 'left';
  ctx.font = valueFont;
  ctx.fillStyle = color;
  ctx.fillText(value, valueX, distBaseline);

  ctx.font = unitFont;
  ctx.fillStyle = withAlpha(color, 0.85);
  ctx.fillText(unit, valueX + valueWidth + gap, distBaseline);
}

function drawFlagsGrid(ctx, w, h, countries, flagImages, anchor) {
  if (!countries || countries.length === 0) return;

  const maxShown = 8;
  const shown = countries.slice(0, maxShown);
  const extra = countries.length - shown.length;

  const cols = Math.min(4, shown.length);
  const rows = Math.ceil(shown.length / cols);

  const cellW = w * 0.085;
  const cellH = cellW * 0.75;
  const gap = w * 0.014;
  const radius = cellW * 0.1;

  const gridW = cols * cellW + (cols - 1) * gap;
  const gridH = rows * cellH + (rows - 1) * gap;

  const gridX = anchor.align === 'left' ? anchor.x : anchor.align === 'right' ? anchor.x - gridW : anchor.x - gridW / 2;
  const gridY = anchor.vertical === 'top' ? anchor.y : anchor.vertical === 'bottom' ? anchor.y - gridH : anchor.y - gridH / 2;

  shown.forEach((c, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = gridX + col * (cellW + gap);
    const y = gridY + row * (cellH + gap);
    const img = flagImages && flagImages.get(c.iso2);

    ctx.save();
    roundedRectPath(ctx, x, y, cellW, cellH, radius);
    ctx.clip();
    if (img) {
      ctx.drawImage(img, x, y, cellW, cellH);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(x, y, cellW, cellH);
    }
    ctx.restore();

    ctx.save();
    roundedRectPath(ctx, x, y, cellW, cellH, radius);
    ctx.lineWidth = Math.max(1, w * 0.0015);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.stroke();
    ctx.restore();
  });

  if (extra > 0) {
    const label = `+${extra}`;
    let labelX;
    let labelAlign;
    if (anchor.align === 'left') { labelX = gridX; labelAlign = 'left'; } else if (anchor.align === 'right') { labelX = gridX + gridW; labelAlign = 'right'; } else { labelX = gridX + gridW / 2; labelAlign = 'center'; }
    const labelY = anchor.vertical === 'top' ? gridY + gridH + w * 0.03 : gridY - w * 0.014;

    ctx.textAlign = labelAlign;
    ctx.font = `700 ${Math.round(w * 0.024)}px Inter, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText(label, labelX, labelY);
  }
}

function drawWatermark(ctx, w, h, logoImage) {
  if (!logoImage) return;
  const margin = w * 0.05;
  const size = w * 0.042;
  const centerX = w - margin - size / 2;
  const y = margin;

  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.drawImage(logoImage, centerX - size / 2, y, size, size);

  ctx.textAlign = 'center';
  ctx.font = `700 ${Math.round(w * 0.014)}px Inter, sans-serif`;
  ctx.fillStyle = '#f4f5f7';
  ctx.fillText('OVERMAPPER', centerX, y + size + w * 0.02);
  ctx.restore();
}

/* ---------- Fonts & flag images ---------- */

const fontsReady = Promise.all([
  document.fonts.load('600 16px Inter'),
  document.fonts.load('700 16px Inter'),
  document.fonts.load('800 16px Inter'),
]).catch(() => {});

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function preloadFlags(countries) {
  const entries = await Promise.all(countries.map(async (c) => {
    try {
      const img = await loadImage(`data/flags/${c.iso2.toLowerCase()}.svg`);
      return [c.iso2, img];
    } catch (err) {
      return [c.iso2, null];
    }
  }));
  return new Map(entries.filter(([, img]) => img));
}

let logoImage = null;
loadImage('assets/logo.svg').then((img) => {
  logoImage = img;
  render();
}).catch(() => {});

/* ---------- App state & rendering ---------- */

const state = {
  segments: null,
  metrics: null,
  countries: null,
  image: null,
  flagImages: new Map(),
  imageTransform: { zoom: 1, panX: 0, panY: 0 },
};

const layout = {
  track: 'middle-center',
  title: 'top-center',
  distance: 'bottom-left',
  flags: 'bottom-right',
};

let currentPreset = '1080x1350';

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const gpxInput = document.getElementById('gpxInput');
const imgInput = document.getElementById('imgInput');
const accentColor = document.getElementById('accentColor');
const textColor = document.getElementById('textColor');
const titleInput = document.getElementById('titleInput');
const zoomRange = document.getElementById('zoomRange');
const resetImageBtn = document.getElementById('resetImageBtn');
const showBordersCheckbox = document.getElementById('showBordersCheckbox');
const trackEnabled = document.getElementById('trackEnabled');
const titleEnabled = document.getElementById('titleEnabled');
const distanceEnabled = document.getElementById('distanceEnabled');
const flagsEnabled = document.getElementById('flagsEnabled');
const downloadBtn = document.getElementById('downloadBtn');
const errorMsg = document.getElementById('errorMsg');
const gpxHint = document.getElementById('gpxHint');
const imgHint = document.getElementById('imgHint');
const placeholder = document.getElementById('placeholder');

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function setError(msg) {
  errorMsg.textContent = msg || '';
}

function render() {
  const [w, h] = currentPreset.split('x').map(Number);
  canvas.width = w;
  canvas.height = h;

  if (!state.image || !state.segments) {
    ctx.fillStyle = '#0f1013';
    ctx.fillRect(0, 0, w, h);
    placeholder.classList.remove('hidden');
    downloadBtn.disabled = true;
    return;
  }
  placeholder.classList.add('hidden');

  drawBackgroundImage(ctx, state.image, w, h, state.imageTransform);

  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(0, 0, w, h);

  const bottomGrad = ctx.createLinearGradient(0, h * 0.45, 0, h);
  bottomGrad.addColorStop(0, 'rgba(0,0,0,0)');
  bottomGrad.addColorStop(1, 'rgba(0,0,0,0.65)');
  ctx.fillStyle = bottomGrad;
  ctx.fillRect(0, h * 0.45, w, h * 0.55);

  const topGrad = ctx.createLinearGradient(0, 0, 0, h * 0.18);
  topGrad.addColorStop(0, 'rgba(0,0,0,0.35)');
  topGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, 0, w, h * 0.18);

  drawWatermark(ctx, w, h, logoImage);

  const trackBox = getTrackBox(layout.track, w, h);
  const projection = computeProjection(state.segments, trackBox.x, trackBox.y, trackBox.w, trackBox.h);

  if (showBordersCheckbox.checked) {
    drawCountryOutlines(ctx, projection, state.countries, trackBox);
  }

  if (trackEnabled.checked) {
    const projected = projectSegments(state.segments, projection);
    drawTrack(ctx, projected, accentColor.value);
  }

  if (titleEnabled.checked) {
    const titleAnchor = getAnchor(layout.title, w, h);
    drawTitleText(ctx, w, h, titleAnchor, textColor.value, titleInput.value.trim());
  }

  if (distanceEnabled.checked) {
    const distanceAnchor = getAnchor(layout.distance, w, h);
    drawDistanceText(ctx, w, h, distanceAnchor, textColor.value, state.metrics.distanceMeters);
  }

  if (flagsEnabled.checked) {
    const flagsAnchor = getAnchor(layout.flags, w, h);
    drawFlagsGrid(ctx, w, h, state.countries, state.flagImages, flagsAnchor);
  }

  downloadBtn.disabled = false;
}

const presetButtons = document.querySelectorAll('#presetSegmented .segmented-btn');
presetButtons.forEach((btn) => {
  if (btn.dataset.value === currentPreset) btn.classList.add('active');
  btn.addEventListener('click', () => {
    presetButtons.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentPreset = btn.dataset.value;
    render();
  });
});

function bindEnableToggle(checkbox, dimTargets) {
  const sync = () => {
    dimTargets.forEach((el) => el && el.classList.toggle('dimmed', !checkbox.checked));
    render();
  };
  checkbox.addEventListener('change', sync);
  sync();
}

bindEnableToggle(trackEnabled, [document.getElementById('trackControls')]);
bindEnableToggle(flagsEnabled, []);
bindEnableToggle(titleEnabled, [titleInput]);
bindEnableToggle(distanceEnabled, []);

gpxInput.addEventListener('change', async () => {
  const file = gpxInput.files[0];
  if (!file) return;
  setError('');
  try {
    const text = await file.text();
    const segments = parseGPX(text);
    state.segments = segments;
    state.metrics = computeMetrics(segments);
    state.countries = detectCountries(segments);
    const pointCount = segments.reduce((sum, seg) => sum + seg.length, 0);
    gpxHint.textContent = `${file.name} · ${pointCount} Punkte`;
    state.flagImages = await preloadFlags(state.countries);
    await fontsReady;
    render();
  } catch (err) {
    setError(err.message || 'Fehler beim Lesen der GPX-Datei.');
    gpxHint.textContent = 'Noch keine Datei geladen';
  }
});

imgInput.addEventListener('change', async () => {
  const file = imgInput.files[0];
  if (!file) return;
  setError('');
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    state.image = img;
    state.imageTransform = { zoom: 1, panX: 0, panY: 0 };
    zoomRange.value = '1';
    imgHint.textContent = file.name;
    await fontsReady;
    render();
  } catch (err) {
    setError('Das Bild konnte nicht geladen werden.');
  }
});

accentColor.addEventListener('input', render);
textColor.addEventListener('input', render);
titleInput.addEventListener('input', render);
showBordersCheckbox.addEventListener('change', render);

zoomRange.addEventListener('input', () => {
  state.imageTransform.zoom = parseFloat(zoomRange.value);
  render();
});

resetImageBtn.addEventListener('click', () => {
  state.imageTransform = { zoom: 1, panX: 0, panY: 0 };
  zoomRange.value = '1';
  render();
});

let dragState = null;

canvas.addEventListener('pointerdown', (e) => {
  if (!state.image) return;
  dragState = {
    startClientX: e.clientX,
    startClientY: e.clientY,
    startPanX: state.imageTransform.panX,
    startPanY: state.imageTransform.panY,
  };
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add('dragging');
});

canvas.addEventListener('pointermove', (e) => {
  if (!dragState || !state.image) return;
  const rect = canvas.getBoundingClientRect();
  const dxCanvas = (e.clientX - dragState.startClientX) * (canvas.width / rect.width);
  const dyCanvas = (e.clientY - dragState.startClientY) * (canvas.height / rect.height);

  const { maxOffsetX, maxOffsetY } = getCoverMetrics(state.image, canvas.width, canvas.height, state.imageTransform.zoom);
  const deltaPanX = maxOffsetX > 0 ? dxCanvas / maxOffsetX : 0;
  const deltaPanY = maxOffsetY > 0 ? dyCanvas / maxOffsetY : 0;

  state.imageTransform.panX = clamp(dragState.startPanX + deltaPanX, -1, 1);
  state.imageTransform.panY = clamp(dragState.startPanY + deltaPanY, -1, 1);
  render();
});

function endDrag() {
  dragState = null;
  canvas.classList.remove('dragging');
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('pointerleave', () => { if (dragState) endDrag(); });

downloadBtn.addEventListener('click', () => {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gpx-poster.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, 'image/png');
});

render();
