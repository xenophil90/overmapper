'use strict';

/* ---------- GPX parsing ---------- */

function gpxError(code) {
  const err = new Error(code);
  err.i18nCode = code;
  return err;
}

// Reads <ele> and <time> from a trkpt's direct children. Walking `children` beats
// querySelector() per point — on a 60k-point track that is 120k fewer selector runs.
function readPointChild(pt, name) {
  for (let i = 0; i < pt.children.length; i++) {
    if (pt.children[i].localName === name) return pt.children[i].textContent;
  }
  return null;
}

function parsePoint(pt) {
  const lat = parseFloat(pt.getAttribute('lat'));
  const lon = parseFloat(pt.getAttribute('lon'));
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;

  const eleText = readPointChild(pt, 'ele');
  const ele = eleText === null ? NaN : parseFloat(eleText);
  const timeText = readPointChild(pt, 'time');
  // Kept as epoch milliseconds rather than a Date, to avoid one object per point.
  const time = timeText === null ? NaN : Date.parse(timeText);

  return {
    lat,
    lon,
    ele: Number.isNaN(ele) ? null : ele,
    time: Number.isNaN(time) ? null : time,
  };
}

function parseGPX(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw gpxError('errorNotGpx');
  }

  const trkSegs = doc.getElementsByTagName('trkseg');
  if (trkSegs.length === 0) {
    throw gpxError('errorNoTrkseg');
  }

  const segments = [];
  for (let s = 0; s < trkSegs.length; s++) {
    const trkPts = trkSegs[s].getElementsByTagName('trkpt');
    const pts = [];
    for (let i = 0; i < trkPts.length; i++) {
      const p = parsePoint(trkPts[i]);
      if (p) pts.push(p);
    }
    if (pts.length > 1) segments.push(pts);
  }

  if (segments.length === 0) {
    throw gpxError('errorTooFewPoints');
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

// Raw GPS elevation jitters by a few metres even while standing still, so summing
// every positive delta invents hundreds of metres of climb. Only count a rise once
// it clears this threshold above the last confirmed reference height.
const ELEVATION_NOISE_M = 5;

function computeElevationGain(segments) {
  let gain = 0;
  let sawElevation = false;
  for (const seg of segments) {
    let ref = null;
    for (const p of seg) {
      if (p.ele === null) continue;
      sawElevation = true;
      if (ref === null) { ref = p.ele; continue; }
      const delta = p.ele - ref;
      if (delta >= ELEVATION_NOISE_M) {
        gain += delta;
        ref = p.ele;
      } else if (delta <= -ELEVATION_NOISE_M) {
        ref = p.ele;
      }
    }
  }
  return sawElevation ? gain : null;
}

// Summed per segment rather than first-to-last timestamp: a gap between two
// segments is a stopped recording, not time spent moving.
function computeDuration(segments) {
  let seconds = 0;
  let sawTime = false;
  for (const seg of segments) {
    const times = [];
    for (const p of seg) if (p.time !== null) times.push(p.time);
    if (times.length < 2) continue;
    sawTime = true;
    seconds += (times[times.length - 1] - times[0]) / 1000;
  }
  return sawTime && seconds > 0 ? seconds : null;
}

function computeMetrics(segments) {
  let distance = 0;
  segments.forEach((seg) => {
    for (let i = 1; i < seg.length; i++) {
      distance += haversine(seg[i - 1], seg[i]);
    }
  });
  return {
    distanceMeters: distance,
    elevationGainMeters: computeElevationGain(segments),
    durationSeconds: computeDuration(segments),
  };
}

/* ---------- Elevation profile ---------- */

// Built once per track: the profile is plotted against travelled distance (not
// point index), so unevenly sampled tracks are not distorted. Downsampled here so
// each render only walks a few hundred points.
const PROFILE_SAMPLES = 500;

function computeElevationProfile(segments) {
  const points = [];
  let travelled = 0;
  let lastWithEle = null;

  for (const seg of segments) {
    for (let i = 0; i < seg.length; i++) {
      if (i > 0) travelled += haversine(seg[i - 1], seg[i]);
      const ele = seg[i].ele;
      if (ele === null) continue;
      points.push({ d: travelled, ele });
      lastWithEle = ele;
    }
  }
  if (points.length < 2 || lastWithEle === null) return null;

  const total = points[points.length - 1].d;
  if (!(total > 0)) return null;

  const sampled = decimate(points, PROFILE_SAMPLES);
  // decimate() picks by index and may drop the final point; the last sample has to
  // be the actual end of the track or the profile stops short of the right edge.
  if (sampled[sampled.length - 1] !== points[points.length - 1]) {
    sampled.push(points[points.length - 1]);
  }

  let minEle = Infinity;
  let maxEle = -Infinity;
  for (const p of sampled) {
    if (p.ele < minEle) minEle = p.ele;
    if (p.ele > maxEle) maxEle = p.ele;
  }

  return {
    points: sampled.map((p) => ({ x: p.d / total, ele: p.ele })),
    minEle,
    maxEle,
  };
}

// Computed once per loaded track — recomputing this per frame would mean walking
// every point again on each drag/zoom step.
function computeBounds(segments) {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const seg of segments) {
    for (const p of seg) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
    }
  }
  return { minLat, maxLat, minLon, maxLon };
}

function computeProjection(bounds, boxX, boxY, boxW, boxH) {
  const { minLat, maxLat, minLon, maxLon } = bounds;
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

/* ---------- Poster layout ---------- */

// The poster is one fixed vertical stack: title on top, then the track, then the
// elevation profile, and a bottom row of stats (left) and flags (right). Every
// block is measured before the one above it is placed, so the layout cannot
// collide no matter how many flags or stats are shown.

// Type and ornament scale with the SHORT edge, not the width. On a landscape
// poster the width says nothing about how big things look — sizing off it made
// text and flags eat the whole height and pushed the track out of its box.
// For portrait and square formats (the common case) this is the width, so
// nothing changes there.
function posterUnit(w, h) {
  return Math.min(w, h);
}

const MARGIN_X = 0.08;        // side margin, as a fraction of poster width
const TITLE_BASELINE = 0.15;  // fraction of poster height
const STATS_BASELINE = 0.9;
const BLOCK_GAP = 0.035;      // breathing room between stacked blocks
// The title is centred, so capping its width also keeps it clear of the
// watermark sitting in the top-right corner.
const TITLE_MAX_WIDTH = 0.78;
// How far the stats row may be shrunk before the flags give way instead.
const MIN_STATS_SCALE = 0.9;
// A row narrower than this share of the content width gets centred rather than
// stretched across it.
const MIN_JUSTIFY_FILL = 0.5;

function computePosterLayout(ctx, w, h, content) {
  const u = posterUnit(w, h);
  const marginX = w * MARGIN_X;
  const contentWidth = w - marginX * 2;
  const gap = h * BLOCK_GAP;

  // --- bottom row, measured first because everything else stacks on top of it ---
  let bottomTop = h - h * 0.06;
  const baseline = h * STATS_BASELINE;

  const natural = content.stats.length > 0
    ? measureStatsRow(ctx, u, content.stats, 0)
    : null;

  // Preference order for the flags: one row next to the stats, else a wrapped
  // block next to the stats, else one row on a line of their own. Stats and
  // flags stop sharing the line once the numbers would have to shrink past
  // MIN_STATS_SCALE — squeezed numbers stop reading as headline figures.
  const roomBeside = (b) => contentWidth - b.gridW - u * 0.05;
  const fitsBeside = (b) => !natural || roomBeside(b) >= natural.totalWidth * MIN_STATS_SCALE;

  let block = null;
  let sideBySide = true;
  if (content.flagCount > 0) {
    const oneRow = getFlagsBlock(u, content.flagCount, true);
    const wrapped = getFlagsBlock(u, content.flagCount, false);
    if (fitsBeside(oneRow)) {
      block = oneRow;
    } else if (fitsBeside(wrapped)) {
      block = wrapped;
    } else {
      block = oneRow;
      sideBySide = false;
    }
  }

  let stats = null;
  if (natural) {
    if (sideBySide && block) {
      // Sharing the line: left edge against the margin, flags against the other.
      stats = { x: marginX, baseline, measured: measureStatsRow(ctx, u, content.stats, roomBeside(block)) };
    } else {
      // Alone on the line. Spread the columns so the row spans the full content
      // width — that gives it the same margin left and right, and lines its right
      // edge up with the flags above. Too short a row is centred instead, since
      // stretching it would leave absurd gaps between the numbers.
      const measured = content.stats.length > 1 && natural.totalWidth >= contentWidth * MIN_JUSTIFY_FILL
        ? justifyStatsRow(natural, contentWidth)
        : natural;
      stats = { x: marginX + (contentWidth - measured.totalWidth) / 2, baseline, measured };
    }
    bottomTop = Math.min(bottomTop, baseline - stats.measured.blockHeight);
  }

  let flags = null;
  if (block) {
    const y = sideBySide || !stats
      ? baseline - block.gridH
      : baseline - stats.measured.blockHeight - h * 0.025 - block.gridH;
    flags = { x: w - marginX - block.gridW, y, block };
    bottomTop = Math.min(bottomTop, flags.y - block.labelH);
  }

  // --- elevation profile, directly above the bottom row ---
  let profile = null;
  if (content.profile) {
    const bandHeight = h * 0.1;
    profile = {
      x: marginX,
      y: bottomTop - gap - bandHeight,
      w: contentWidth,
      h: bandHeight,
    };
  }

  // --- title, which decides where the track may start ---
  let title = null;
  if (content.titleText) {
    const measured = layoutTitleLines(ctx, u, w * TITLE_MAX_WIDTH, content.titleText);
    const lineHeight = measured.fontPx * TITLE_LINE_HEIGHT;
    const baseline = h * TITLE_BASELINE;
    title = {
      ...measured,
      x: w / 2,
      baseline,
      lineHeight,
      bottom: baseline + lineHeight * (measured.lines.length - 1),
    };
  }

  // --- the track fills whatever is left between title and the block below ---
  const trackBottom = (profile ? profile.y : bottomTop) - gap;
  let trackTop = title ? title.bottom + h * 0.09 : h * 0.13;
  // On a crowded poster the track gives way upwards, towards the title — never
  // downwards, which would put it underneath the profile or the stats.
  const minTrackHeight = h * 0.12;
  if (trackBottom - trackTop < minTrackHeight) {
    trackTop = Math.max(h * 0.1, trackBottom - minTrackHeight);
  }
  const track = {
    x: marginX,
    y: trackTop,
    w: contentWidth,
    h: Math.max(1, trackBottom - trackTop),
  };

  return { title, track, profile, stats, flags };
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

const METERS_PER_MILE = 1609.344;
const METERS_PER_FOOT = 0.3048;

function formatDistanceParts(meters, unitSystem) {
  const imperial = unitSystem === 'imperial';
  const large = imperial ? METERS_PER_MILE : 1000;
  const small = imperial ? METERS_PER_FOOT : 1;
  // Only switch to the large unit once its rounded value reaches 1, so 999 m stays "999 m".
  if (meters >= large * 0.9995) {
    return { value: String(Math.round(meters / large)), unit: imperial ? 'mi' : 'km' };
  }
  return { value: String(Math.round(meters / small)), unit: imperial ? 'ft' : 'm' };
}

function formatElevationParts(meters, unitSystem) {
  const imperial = unitSystem === 'imperial';
  const value = imperial ? meters / METERS_PER_FOOT : meters;
  return { value: String(Math.round(value)), unit: imperial ? 'ft' : 'm' };
}

function formatDurationParts(seconds) {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return { value: String(minutes), unit: 'min' };
  return { value: `${hours}:${String(minutes).padStart(2, '0')}`, unit: 'h' };
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

function drawDot(ctx, x, y, color, u) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, u * 0.0065, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = u * 0.0056;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = Math.max(1, u * 0.0019);
  ctx.stroke();
  ctx.restore();
}

// Points closer together than this (in canvas pixels) cannot be told apart in the
// stroke, so they are skipped instead of allocating and stroking a path node each.
const MIN_POINT_SPACING_PX = 0.7;

function traceSegment(ctx, seg, projection) {
  let prevX = 0;
  let prevY = 0;
  let drawn = 0;
  for (let i = 0; i < seg.length; i++) {
    const p = projection.project(seg[i].lat, seg[i].lon);
    const isEdge = i === 0 || i === seg.length - 1;
    if (!isEdge && Math.abs(p.x - prevX) + Math.abs(p.y - prevY) < MIN_POINT_SPACING_PX) continue;
    if (drawn === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
    prevX = p.x;
    prevY = p.y;
    drawn++;
  }
  return drawn;
}

// `u` is the poster's short edge: line weights are relative to it, so the track
// looks the same at every export resolution and in the (smaller) preview.
function drawTrack(ctx, segments, projection, color, u) {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = u * 0.013;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, u * 0.0056);
  segments.forEach((seg) => {
    if (seg.length < 2) return;
    ctx.beginPath();
    if (traceSegment(ctx, seg, projection) > 1) ctx.stroke();
  });
  ctx.restore();

  const firstSeg = segments[0];
  const lastSeg = segments[segments.length - 1];
  const first = firstSeg && firstSeg[0];
  const last = lastSeg && lastSeg[lastSeg.length - 1];
  if (first) {
    const p = projection.project(first.lat, first.lon);
    drawDot(ctx, p.x, p.y, '#3ddc71', u);
  }
  if (last) {
    const p = projection.project(last.lat, last.lon);
    drawDot(ctx, p.x, p.y, '#ff5a5a', u);
  }
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

const TITLE_LINE_HEIGHT = 1.18;

// A long title must not run past the poster edge or under the watermark. Break
// it over two lines first — shrinking the type is the last resort, because a
// title at half size stops looking like a title.
function layoutTitleLines(ctx, u, maxWidth, text) {
  const upper = text.toUpperCase();
  const fontPx = Math.round(u * 0.034);
  ctx.font = `800 ${fontPx}px Inter, sans-serif`;

  const singleWidth = ctx.measureText(upper).width;
  if (singleWidth <= maxWidth) return { lines: [upper], fontPx };

  // Pick the word break that leaves the two lines most even.
  const words = upper.split(/\s+/).filter(Boolean);
  let best = null;
  for (let split = 1; split < words.length; split++) {
    const a = words.slice(0, split).join(' ');
    const b = words.slice(split).join(' ');
    const width = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
    if (!best || width < best.width) best = { lines: [a, b], width };
  }
  if (best && best.width <= maxWidth) return { lines: best.lines, fontPx };

  const lines = best ? best.lines : [upper];
  const width = best ? best.width : singleWidth;

  const widest = (px) => {
    ctx.font = `800 ${px}px Inter, sans-serif`;
    return Math.max(...lines.map((l) => ctx.measureText(l).width));
  };
  // Rounding the scaled size can leave the text a hair over the limit, so step
  // down until it measurably fits rather than trusting the arithmetic.
  let scaled = Math.max(1, Math.floor(fontPx * (maxWidth / width)));
  while (scaled > 1 && widest(scaled) > maxWidth) scaled--;

  return { lines, fontPx: scaled };
}

function drawTitleText(ctx, box, color) {
  ctx.textAlign = 'center';
  ctx.font = `800 ${box.fontPx}px Inter, sans-serif`;
  ctx.fillStyle = withAlpha(color, 0.95);
  box.lines.forEach((line, i) => {
    ctx.fillText(line, box.x, box.baseline + i * box.lineHeight);
  });
}

// One row of headline numbers (distance / elevation gain / duration). The value
// font shrinks as more of them are shown, so the row keeps fitting the poster.
const STAT_VALUE_FONT_BY_COUNT = [0.095, 0.095, 0.072, 0.058];

function measureStat(ctx, stat, valueFont, unitFont, gap) {
  ctx.font = valueFont;
  const valueWidth = ctx.measureText(stat.value).width;
  ctx.font = unitFont;
  const unitWidth = ctx.measureText(stat.unit).width;
  return { valueWidth, unitWidth, width: valueWidth + gap + unitWidth };
}

// Measured separately from drawing, because the layout has to know how tall the
// row ends up before it can place the profile band above it.
function measureStatsRow(ctx, u, stats, maxWidth) {
  let valueFontPx = Math.round(u * STAT_VALUE_FONT_BY_COUNT[stats.length]);
  let unitFontPx = Math.round(valueFontPx * 0.36);
  let labelFontPx = Math.round(u * 0.019);
  let gap = valueFontPx * 0.15;
  let columnGap = u * 0.045;

  let items = stats.map((s) => measureStat(
    ctx,
    s,
    `800 ${valueFontPx}px Inter, sans-serif`,
    `600 ${unitFontPx}px Inter, sans-serif`,
    gap,
  ));
  let totalWidth = items.reduce((sum, m) => sum + m.width, 0) + columnGap * (stats.length - 1);

  // Three numbers plus a row of flags do not fit side by side at poster width, so
  // the row shrinks into whatever the flags leave over. Text width is linear in
  // font size, so the measurements can simply be scaled along.
  if (maxWidth > 0 && totalWidth > maxWidth) {
    const scale = maxWidth / totalWidth;
    valueFontPx = Math.max(1, Math.round(valueFontPx * scale));
    unitFontPx = Math.max(1, Math.round(unitFontPx * scale));
    labelFontPx = Math.max(1, Math.round(labelFontPx * scale));
    gap *= scale;
    columnGap *= scale;
    items = items.map((m) => ({
      valueWidth: m.valueWidth * scale,
      unitWidth: m.unitWidth * scale,
      width: m.width * scale,
    }));
    totalWidth = maxWidth;
  }

  const labelOffset = valueFontPx * 0.92;

  return {
    valueFontPx,
    unitFontPx,
    labelFontPx,
    gap,
    columnGap,
    items,
    totalWidth,
    labelOffset,
    // From the top of the caption down to the baseline.
    blockHeight: labelOffset + labelFontPx,
  };
}

// Widen the gaps between the columns until the row spans exactly `targetWidth`.
function justifyStatsRow(measured, targetWidth) {
  const itemsWidth = measured.items.reduce((sum, m) => sum + m.width, 0);
  const gaps = measured.items.length - 1;
  if (gaps < 1 || measured.totalWidth >= targetWidth) return measured;
  return { ...measured, columnGap: (targetWidth - itemsWidth) / gaps, totalWidth: targetWidth };
}

function drawStatsRow(ctx, box, color, stats) {
  const m = box.measured;
  const valueFont = `800 ${m.valueFontPx}px Inter, sans-serif`;
  const unitFont = `600 ${m.unitFontPx}px Inter, sans-serif`;

  let x = box.x;
  ctx.textAlign = 'left';

  stats.forEach((stat, i) => {
    const item = m.items[i];

    ctx.font = `700 ${m.labelFontPx}px Inter, sans-serif`;
    ctx.fillStyle = withAlpha(color, 0.7);
    ctx.fillText(stat.label.toUpperCase(), x, box.baseline - m.labelOffset);

    ctx.font = valueFont;
    ctx.fillStyle = color;
    ctx.fillText(stat.value, x, box.baseline);

    ctx.font = unitFont;
    ctx.fillStyle = withAlpha(color, 0.85);
    ctx.fillText(stat.unit, x + item.valueWidth + m.gap, box.baseline);

    x += item.width + m.columnGap;
  });
}

function drawElevationProfile(ctx, box, profile, color, u) {
  const { points, minEle, maxEle } = profile;
  const span = maxEle - minEle;
  // A pancake-flat track has no meaningful span; draw it as a centred flat line
  // instead of pinning it to the bottom edge.
  const yFor = span < 1
    ? () => box.y + box.h * 0.5
    : (ele) => box.y + box.h - ((ele - minEle) / span) * box.h;
  const xFor = (t) => box.x + t * box.w;

  ctx.save();

  ctx.beginPath();
  ctx.moveTo(xFor(points[0].x), box.y + box.h);
  points.forEach((p) => ctx.lineTo(xFor(p.x), yFor(p.ele)));
  ctx.lineTo(xFor(points[points.length - 1].x), box.y + box.h);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, box.y, 0, box.y + box.h);
  grad.addColorStop(0, withAlpha(color, 0.4));
  grad.addColorStop(1, withAlpha(color, 0.06));
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  points.forEach((p, i) => {
    const x = xFor(p.x);
    const y = yFor(p.ele);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, u * 0.0035);
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = u * 0.008;
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.moveTo(box.x, box.y + box.h);
  ctx.lineTo(box.x + box.w, box.y + box.h);
  ctx.strokeStyle = withAlpha(color, 0.35);
  ctx.lineWidth = Math.max(1, u * 0.0012);
  ctx.stroke();

  ctx.restore();
}

const MAX_FLAGS_SHOWN = 8;

// The layout needs the full footprint before it can place anything above the
// flags, including the "+N" caption that appears when countries are left over.
// `singleRow` is for when the flags have a line to themselves: there is room for
// all of them side by side, and a wrapped grid just looks like an afterthought.
// Squeezed in next to the stats they stay a compact block of at most four.
function getFlagsBlock(u, countryCount, singleRow) {
  const shown = Math.min(countryCount, MAX_FLAGS_SHOWN);
  const cols = singleRow ? shown : Math.min(4, shown);
  const rows = Math.ceil(shown / cols);
  const cellW = u * 0.085;
  const cellH = cellW * 0.75;
  const gap = u * 0.014;
  const labelFontPx = Math.round(u * 0.024);
  return {
    cols,
    rows,
    cellW,
    cellH,
    gap,
    labelFontPx,
    gridW: cols * cellW + (cols - 1) * gap,
    gridH: rows * cellH + (rows - 1) * gap,
    labelH: countryCount > MAX_FLAGS_SHOWN ? labelFontPx + u * 0.014 : 0,
  };
}

function drawFlagsGrid(ctx, u, box, countries, flagImages) {
  if (!countries || countries.length === 0) return;

  const shown = countries.slice(0, MAX_FLAGS_SHOWN);
  const extra = countries.length - shown.length;
  const { cols, cellW, cellH, gap, gridW, labelFontPx } = box.block;
  const radius = cellW * 0.1;
  const gridX = box.x;
  const gridY = box.y;

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
    ctx.lineWidth = Math.max(1, u * 0.0015);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.stroke();
    ctx.restore();
  });

  if (extra > 0) {
    ctx.textAlign = 'right';
    ctx.font = `700 ${labelFontPx}px Inter, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText(`+${extra}`, gridX + gridW, gridY - u * 0.014);
  }
}

function drawWatermark(ctx, w, u, logoImage) {
  if (!logoImage) return;
  const margin = u * 0.05;
  const size = u * 0.042;
  const centerX = w - margin - size / 2;
  const y = margin;

  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.drawImage(logoImage, centerX - size / 2, y, size, size);

  ctx.textAlign = 'center';
  ctx.font = `700 ${Math.round(u * 0.014)}px Inter, sans-serif`;
  ctx.fillStyle = '#f4f5f7';
  ctx.fillText('OVERMAPPER', centerX, y + size + u * 0.02);
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
  bounds: null,
  metrics: null,
  profile: null,
  countries: null,
  image: null,
  flagImages: new Map(),
  imageTransform: { zoom: 1, panX: 0, panY: 0 },
  lang: window.DEFAULT_LANG,
  unitSystem: 'metric',
  ratio: { w: 4, h: 5 },
  shortEdge: 1080,
  gpxHintState: { type: 'none' },
  imgHintState: { type: 'none' },
  errorCode: null,
};

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
const elevationEnabled = document.getElementById('elevationEnabled');
const durationEnabled = document.getElementById('durationEnabled');
const profileEnabled = document.getElementById('profileEnabled');
const elevationHint = document.getElementById('elevationHint');
const durationHint = document.getElementById('durationHint');
const profileHint = document.getElementById('profileHint');
const flagsEnabled = document.getElementById('flagsEnabled');
const downloadBtn = document.getElementById('downloadBtn');
const errorMsg = document.getElementById('errorMsg');
const gpxHint = document.getElementById('gpxHint');
const imgHint = document.getElementById('imgHint');
const placeholder = document.getElementById('placeholder');
const langButton = document.getElementById('langButton');
const langButtonLabel = document.getElementById('langButtonLabel');
const langMenu = document.getElementById('langMenu');
const langOptions = [...langMenu.querySelectorAll('.lang-option')];
const presetSegmented = document.getElementById('presetSegmented');
const unitSegmented = document.getElementById('unitSegmented');
const customRatioToggle = document.getElementById('customRatioToggle');
const customRatio = document.getElementById('customRatio');
const ratioW = document.getElementById('ratioW');
const ratioH = document.getElementById('ratioH');
const resolutionSegmented = document.getElementById('resolutionSegmented');
const exportSizeHint = document.getElementById('exportSizeHint');
const gpxDrop = document.getElementById('gpxDrop');
const imgDrop = document.getElementById('imgDrop');

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function t(key) {
  const fallback = window.TRANSLATIONS[window.DEFAULT_LANG];
  const dict = window.TRANSLATIONS[state.lang] || fallback;
  // Fall back per key, not just per language: a single missing translation should
  // not blank out a label.
  return key in dict ? dict[key] : fallback[key];
}

// Dragging and the zoom slider fire far faster than the display refreshes;
// collapsing those into one render per frame keeps the preview responsive.
// Declared up here because applyLanguage() below already triggers a render, and a
// `let` further down the file would still be in its temporal dead zone by then.
let renderHandle = 0;
function render() {
  if (renderHandle) return;
  renderHandle = requestAnimationFrame(() => {
    renderHandle = 0;
    renderPreview();
  });
}

/* ---------- Export size (aspect ratio x short edge) ---------- */

const MIN_RATIO_PART = 0.1;
const MAX_RATIO_PART = 100;
const MAX_CANVAS_PX = 8000;

function clampRatioPart(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return clamp(n, MIN_RATIO_PART, MAX_RATIO_PART);
}

function getCanvasSize() {
  const rw = clampRatioPart(state.ratio.w);
  const rh = clampRatioPart(state.ratio.h);
  // The short edge is the one the resolution setting pins down.
  let width;
  let height;
  if (rw <= rh) {
    width = state.shortEdge;
    height = Math.round((state.shortEdge * rh) / rw);
  } else {
    height = state.shortEdge;
    width = Math.round((state.shortEdge * rw) / rh);
  }
  const longest = Math.max(width, height);
  if (longest > MAX_CANVAS_PX) {
    const f = MAX_CANVAS_PX / longest;
    width = Math.round(width * f);
    height = Math.round(height * f);
  }
  return { width, height };
}

function renderExportSizeHint() {
  const { width, height } = getCanvasSize();
  exportSizeHint.textContent = t('hintExportSize')
    .replace('{w}', String(width))
    .replace('{h}', String(height));
}

function setError(code) {
  state.errorCode = code || null;
  errorMsg.textContent = code ? t(code) : '';
}

function renderGpxHint() {
  const s = state.gpxHintState;
  gpxHint.textContent = s.type === 'loaded'
    ? `${s.fileName} · ${s.pointCount} ${t('pointsUnit')}`
    : t('hintNoGpx');
}

function renderImgHint() {
  const s = state.imgHintState;
  imgHint.textContent = s.type === 'loaded' ? s.fileName : t('hintNoImage');
}

// Not every GPX carries <ele> or <time>. Grey the affected switches out and say
// why — but only once a track is actually loaded, otherwise the hint is noise.
function renderMetricAvailability() {
  const loaded = Boolean(state.metrics);

  const apply = (checkbox, hintEl, available, hintKey) => {
    const missing = loaded && !available;
    checkbox.disabled = missing;
    const row = checkbox.closest('.row-label, .panel-title-row');
    if (row) row.classList.toggle('dimmed-label', missing);
    hintEl.textContent = missing ? t(hintKey) : '';
    hintEl.classList.toggle('hidden', !missing);
  };

  apply(elevationEnabled, elevationHint, Boolean(state.metrics && state.metrics.elevationGainMeters !== null), 'hintNoElevation');
  apply(durationEnabled, durationHint, Boolean(state.metrics && state.metrics.durationSeconds !== null), 'hintNoTime');
  apply(profileEnabled, profileHint, Boolean(state.profile), 'hintNoElevation');
}

function detectInitialLang() {
  try {
    const saved = localStorage.getItem('overmapper-lang');
    if (saved && window.SUPPORTED_LANGS.includes(saved)) return saved;
  } catch (err) { /* localStorage unavailable */ }
  const browserLang = (navigator.language || '').slice(0, 2).toLowerCase();
  if (window.SUPPORTED_LANGS.includes(browserLang)) return browserLang;
  return window.DEFAULT_LANG;
}

function detectInitialUnitSystem() {
  try {
    const saved = localStorage.getItem('overmapper-units');
    if (saved === 'metric' || saved === 'imperial') return saved;
  } catch (err) { /* localStorage unavailable */ }
  return 'metric';
}

function applyLanguage(lang) {
  state.lang = window.SUPPORTED_LANGS.includes(lang) ? lang : window.DEFAULT_LANG;
  document.documentElement.lang = state.lang;

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
  });
  syncLangMenu();

  renderGpxHint();
  renderImgHint();
  renderExportSizeHint();
  renderMetricAvailability();
  errorMsg.textContent = state.errorCode ? t(state.errorCode) : '';
  // The stat captions on the poster come from t() as well, so the canvas has to
  // be redrawn — without this it keeps the previous language until the next edit.
  render();

  try {
    localStorage.setItem('overmapper-lang', state.lang);
  } catch (err) { /* localStorage unavailable */ }
}

/* ---------- Language dropdown ---------- */

function setLangMenuOpen(open) {
  langMenu.classList.toggle('hidden', !open);
  langButton.setAttribute('aria-expanded', String(open));
  if (open) {
    const current = langOptions.find((o) => o.dataset.value === state.lang) || langOptions[0];
    current.focus();
  }
}

function syncLangMenu() {
  langOptions.forEach((option) => {
    const selected = option.dataset.value === state.lang;
    option.setAttribute('aria-selected', String(selected));
    if (selected) langButtonLabel.textContent = option.textContent;
  });
}

function chooseLang(value) {
  applyLanguage(value);
  setLangMenuOpen(false);
  langButton.focus();
}

langButton.addEventListener('click', () => {
  setLangMenuOpen(langMenu.classList.contains('hidden'));
});

langButton.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    setLangMenuOpen(true);
  }
});

langOptions.forEach((option, i) => {
  option.addEventListener('click', () => chooseLang(option.dataset.value));
  option.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      chooseLang(option.dataset.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setLangMenuOpen(false);
      langButton.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      langOptions[(i + 1) % langOptions.length].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      langOptions[(i - 1 + langOptions.length) % langOptions.length].focus();
    } else if (e.key === 'Tab') {
      setLangMenuOpen(false);
    }
  });
});

document.addEventListener('pointerdown', (e) => {
  if (!langMenu.classList.contains('hidden') && !e.target.closest('.lang-switch')) {
    setLangMenuOpen(false);
  }
});

applyLanguage(detectInitialLang());

// The preview never needs more pixels than it is shown at (the layout caps it at
// 460 CSS px wide). Exports still render at the full size — see renderExportCanvas().
const PREVIEW_MAX_EDGE = 2400;

function getPreviewSize() {
  const { width, height } = getCanvasSize();
  const longest = Math.max(width, height);
  if (longest <= PREVIEW_MAX_EDGE) return { width, height };
  const f = PREVIEW_MAX_EDGE / longest;
  return {
    width: Math.max(1, Math.round(width * f)),
    height: Math.max(1, Math.round(height * f)),
  };
}

// Stats the user enabled, minus the ones this track has no data for.
function collectStats() {
  const m = state.metrics;
  if (!m) return [];
  const stats = [];
  if (distanceEnabled.checked) {
    stats.push({ label: t('statDistance'), ...formatDistanceParts(m.distanceMeters, state.unitSystem) });
  }
  if (elevationEnabled.checked && m.elevationGainMeters !== null) {
    stats.push({ label: t('statElevation'), ...formatElevationParts(m.elevationGainMeters, state.unitSystem) });
  }
  if (durationEnabled.checked && m.durationSeconds !== null) {
    stats.push({ label: t('statDuration'), ...formatDurationParts(m.durationSeconds) });
  }
  return stats;
}

// Everything the poster is made of, at whatever size the target context has.
// Sizes are all relative to w/h, so preview and export stay identical.
// `u` is the short edge — see posterUnit().
function drawPoster(ctx, w, h) {
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

  const u = posterUnit(w, h);
  drawWatermark(ctx, w, u, logoImage);

  const title = titleEnabled.checked ? titleInput.value.trim() : '';
  const stats = collectStats();
  const showFlags = flagsEnabled.checked && state.countries ? state.countries.length : 0;

  const box = computePosterLayout(ctx, w, h, {
    titleText: title,
    profile: profileEnabled.checked && Boolean(state.profile),
    stats,
    flagCount: showFlags,
  });

  const projection = computeProjection(state.bounds, box.track.x, box.track.y, box.track.w, box.track.h);

  if (showBordersCheckbox.checked) {
    drawCountryOutlines(ctx, projection, state.countries, box.track);
  }

  if (trackEnabled.checked) {
    drawTrack(ctx, state.segments, projection, accentColor.value, u);
  }

  if (box.profile) {
    drawElevationProfile(ctx, box.profile, state.profile, accentColor.value, u);
  }

  if (box.title) {
    drawTitleText(ctx, box.title, textColor.value);
  }

  if (box.stats) {
    drawStatsRow(ctx, box.stats, textColor.value, stats);
  }

  if (box.flags) {
    drawFlagsGrid(ctx, u, box.flags, state.countries, state.flagImages);
  }
}

function isPosterReady() {
  return Boolean(state.image && state.segments);
}

function renderPreview() {
  const { width: w, height: h } = getPreviewSize();
  // Assigning width/height reallocates the backing store and clears it, so only
  // touch it when the size actually changed.
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  renderExportSizeHint();

  if (!isPosterReady()) {
    ctx.fillStyle = '#0f1013';
    ctx.fillRect(0, 0, w, h);
    placeholder.classList.remove('hidden');
    downloadBtn.disabled = true;
    return;
  }

  placeholder.classList.add('hidden');
  drawPoster(ctx, w, h);
  downloadBtn.disabled = false;
}

function renderExportCanvas() {
  const { width, height } = getCanvasSize();
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  drawPoster(out.getContext('2d'), width, height);
  return out;
}

function bindSegmented(container, initialValue, onChange) {
  const buttons = container.querySelectorAll('.segmented-btn');
  const setActive = (value) => {
    buttons.forEach((b) => {
      const active = b.dataset.value === value;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
  };
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      setActive(btn.dataset.value);
      onChange(btn.dataset.value);
    });
  });
  setActive(initialValue);
  return setActive;
}

function parseRatio(value) {
  const [w, h] = value.split(':').map(Number);
  return { w, h };
}

function readCustomRatio() {
  return { w: clampRatioPart(ratioW.value), h: clampRatioPart(ratioH.value) };
}

let lastPreset = '4:5';

const setPresetActive = bindSegmented(presetSegmented, lastPreset, (value) => {
  lastPreset = value;
  state.ratio = parseRatio(value);
  customRatio.classList.add('hidden');
  customRatioToggle.setAttribute('aria-expanded', 'false');
  render();
});

customRatioToggle.addEventListener('click', () => {
  const on = customRatio.classList.contains('hidden');
  customRatio.classList.toggle('hidden', !on);
  customRatioToggle.setAttribute('aria-expanded', String(on));
  // Deselect the presets while a custom ratio is active, so only one is highlighted.
  setPresetActive(on ? null : lastPreset);
  state.ratio = on ? readCustomRatio() : parseRatio(lastPreset);
  render();
});

[ratioW, ratioH].forEach((input) => {
  input.addEventListener('input', () => {
    state.ratio = readCustomRatio();
    render();
  });
  // Only write the clamped value back on blur, so typing isn't fought mid-entry.
  input.addEventListener('change', () => {
    input.value = String(clampRatioPart(input.value));
    state.ratio = readCustomRatio();
    render();
  });
});

bindSegmented(resolutionSegmented, String(state.shortEdge), (value) => {
  state.shortEdge = Number(value);
  render();
});

function bindDropzone(zone, input) {
  zone.addEventListener('click', (e) => {
    if (e.target !== input) input.click();
  });
  ['dragenter', 'dragover'].forEach((type) => {
    zone.addEventListener(type, (e) => {
      e.preventDefault();
      zone.classList.add('dragover');
    });
  });
  ['dragleave', 'dragend'].forEach((type) => {
    zone.addEventListener(type, () => zone.classList.remove('dragover'));
  });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const file = e.dataTransfer && e.dataTransfer.files[0];
    if (!file) return;
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  });
}

bindDropzone(gpxDrop, gpxInput);
bindDropzone(imgDrop, imgInput);

// Keep a file dropped next to a zone from navigating the page away.
['dragover', 'drop'].forEach((type) => {
  window.addEventListener(type, (e) => e.preventDefault());
});

state.unitSystem = detectInitialUnitSystem();
bindSegmented(unitSegmented, state.unitSystem, (value) => {
  state.unitSystem = value;
  try {
    localStorage.setItem('overmapper-units', state.unitSystem);
  } catch (err) { /* localStorage unavailable */ }
  render();
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
bindEnableToggle(distanceEnabled, [unitSegmented]);
bindEnableToggle(elevationEnabled, []);
bindEnableToggle(durationEnabled, []);
bindEnableToggle(profileEnabled, []);

const MAX_GPX_FILE_SIZE = 50 * 1024 * 1024;

gpxInput.addEventListener('change', async () => {
  const file = gpxInput.files[0];
  if (!file) return;
  setError(null);
  if (file.size > MAX_GPX_FILE_SIZE) {
    setError('errorTooLarge');
    state.gpxHintState = { type: 'none' };
    renderGpxHint();
    return;
  }
  try {
    const text = await file.text();
    const segments = parseGPX(text);
    state.segments = segments;
    state.bounds = computeBounds(segments);
    state.metrics = computeMetrics(segments);
    state.profile = computeElevationProfile(segments);
    state.countries = detectCountries(segments);
    const pointCount = segments.reduce((sum, seg) => sum + seg.length, 0);
    state.gpxHintState = { type: 'loaded', fileName: file.name, pointCount };
    renderGpxHint();
    renderMetricAvailability();
    state.flagImages = await preloadFlags(state.countries);
    await fontsReady;
    render();
  } catch (err) {
    setError(err.i18nCode || 'errorReadGeneric');
    state.gpxHintState = { type: 'none' };
    renderGpxHint();
  }
});

let backgroundImageUrl = null;

imgInput.addEventListener('change', async () => {
  const file = imgInput.files[0];
  if (!file) return;
  setError(null);
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    if (backgroundImageUrl) URL.revokeObjectURL(backgroundImageUrl);
    backgroundImageUrl = url;
    state.image = img;
    state.imageTransform = { zoom: 1, panX: 0, panY: 0 };
    zoomRange.value = '1';
    state.imgHintState = { type: 'loaded', fileName: file.name };
    renderImgHint();
    await fontsReady;
    render();
  } catch (err) {
    URL.revokeObjectURL(url);
    setError('errorImageLoad');
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
  if (!isPosterReady()) return;
  renderExportCanvas().toBlob((blob) => {
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
