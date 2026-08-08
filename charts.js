/* ============================================================
   charts.js — dependency-free inline SVG renderers:
   7-day sparklines and the portfolio allocation donut.
   Exposes global: Charts
   ============================================================ */
'use strict';

const Charts = {

  PALETTE: ['#4f8ef7', '#f7b84f', '#5fd68a', '#ef6a6a', '#b07ef0',
            '#4fd1c5', '#f77fb0', '#d29922', '#9aa7b8', '#7ea8f7'],

  /**
   * 7-day sparkline as an SVG string.
   * points: number[]; positive: bool|null (null = auto from first/last).
   */
  sparkline(points, width, height, positive) {
    if (!Array.isArray(points) || points.length < 2) {
      return '<span class="muted">—</span>';
    }
    width = width || 110;
    height = height || 34;

    const min = Math.min.apply(null, points);
    const max = Math.max.apply(null, points);
    const range = (max - min) || 1;
    const pad = 2;
    const stepX = (width - pad * 2) / (points.length - 1);

    const coords = points.map((p, i) => {
      const x = pad + i * stepX;
      const y = pad + (1 - (p - min) / range) * (height - pad * 2);
      return x.toFixed(1) + ',' + y.toFixed(1);
    });

    if (positive === null || positive === undefined) {
      positive = points[points.length - 1] >= points[0];
    }
    const color = positive ? '#3fb950' : '#f85149';

    return '<svg width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '"' +
      ' aria-hidden="true">' +
      '<polyline points="' + coords.join(' ') + '" fill="none" stroke="' + color + '"' +
      ' stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>';
  },

  /**
   * Allocation donut as an SVG string.
   * segments: [{ label, value }] — returns { svg, legend } where legend
   * is [{ label, pct, color }] for the caller to render as HTML.
   */
  donut(segments, size) {
    size = size || 150;
    const total = segments.reduce((s, x) => s + x.value, 0);
    if (total <= 0) {
      return { svg: '<span class="muted">No allocation yet</span>', legend: [] };
    }

    // Top 6 slices, remainder grouped as "Other".
    const sorted = segments.slice().sort((a, b) => b.value - a.value);
    const shown = sorted.slice(0, 6);
    const rest = sorted.slice(6);
    if (rest.length > 0) {
      shown.push({ label: 'Other', value: rest.reduce((s, x) => s + x.value, 0) });
    }

    const strokeWidth = 22;
    const r = (size - strokeWidth) / 2;
    const cx = size / 2;
    const cy = size / 2;
    const C = 2 * Math.PI * r;

    let offset = 0;
    let circles = '';
    const legend = [];

    shown.forEach((seg, i) => {
      const frac = seg.value / total;
      const dash = frac * C;
      const color = this.PALETTE[i % this.PALETTE.length];
      // stroke-dashoffset walks each segment around the ring; -90° rotation
      // on the group starts the first slice at 12 o'clock.
      circles += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none"' +
        ' stroke="' + color + '" stroke-width="' + strokeWidth + '"' +
        ' stroke-dasharray="' + dash.toFixed(2) + ' ' + (C - dash).toFixed(2) + '"' +
        ' stroke-dashoffset="' + (-offset).toFixed(2) + '"/>';
      legend.push({ label: seg.label, pct: frac * 100, color });
      offset += dash;
    });

    const svg = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
      '<g transform="rotate(-90 ' + cx + ' ' + cy + ')">' + circles + '</g></svg>';
    return { svg, legend };
  }
};
