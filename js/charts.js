/* Hand-drawn SVG charts for PSX Pulse: multi-series line, sector wheel (donut), horizontal fat-line bars.
   No library. Each chart draws at its container's real width so labels stay readable on phones.
   Exposes window.PSX.charts. */
(function () {
  "use strict";
  var PSX = (window.PSX = window.PSX || {});

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function widthOf(el, min, max) {
    return Math.max(min, Math.min(max, Math.round(el.clientWidth || max)));
  }

  // series: [{ label, color, values: [pct...] }] where values are % change from the previous close.
  function line(container, series, opts) {
    opts = opts || {};
    var W = widthOf(container, 240, 640);
    var H = 240;
    var narrow = W < 360;
    var P = { l: narrow ? 44 : 52, r: 10, t: 12, b: 24 };
    var fs = narrow ? 10 : 12;

    var all = [];
    series.forEach(function (s) { s.values.forEach(function (v) { all.push(v); }); });
    if (!all.length) {
      container.innerHTML = '<p class="empty">Waiting for market ticks. Press Start on the Market tab.</p>';
      return;
    }
    var lo = Math.min.apply(null, all.concat([0]));
    var hi = Math.max.apply(null, all.concat([0]));
    var span = hi - lo || 1;
    lo -= span * 0.08;
    hi += span * 0.08;
    var n = Math.max.apply(null, series.map(function (s) { return s.values.length; }));
    var maxT = Math.max(1, n - 1);

    function X(i) { return P.l + (i / maxT) * (W - P.l - P.r); }
    function Y(v) { return P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b); }

    var out = ['<svg viewBox="0 0 ' + W + " " + H + '" class="chart-svg" role="img" aria-label="' + esc(opts.label || "Price trend") + '">'];
    for (var g = 0; g <= 4; g++) {
      var v = lo + (hi - lo) * g / 4;
      var yy = Y(v).toFixed(1);
      out.push('<line class="grid" x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + yy + '" y2="' + yy + '"/>');
      out.push('<text class="axis" style="font-size:' + fs + 'px" x="' + (P.l - 6) + '" y="' + (Number(yy) + 4) +
        '" text-anchor="end">' + v.toFixed(1) + "%</text>");
    }
    // Zero line: the previous close.
    out.push('<line class="zero" x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + Y(0).toFixed(1) + '" y2="' + Y(0).toFixed(1) + '"/>');

    series.forEach(function (s) {
      if (!s.values.length) return;
      var d = s.values.map(function (v, i) { return (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1); }).join(" ");
      out.push('<path class="line" d="' + d + '" stroke="' + esc(s.color) + '" fill="none"/>');
    });
    out.push("</svg>");
    container.innerHTML = out.join("");
  }

  // slices: [{ label, value, color }]
  function donut(container, slices, opts) {
    opts = opts || {};
    var pos = slices.filter(function (s) { return s.value > 0; });
    var total = pos.reduce(function (a, s) { return a + s.value; }, 0);
    if (!total) {
      container.innerHTML = '<p class="empty">No market data yet.</p>';
      return;
    }
    var CX = 110, CY = 110, R = 98, RI = 58;
    function pt(r, a) { return [CX + r * Math.cos(a), CY + r * Math.sin(a)]; }
    var out = ['<svg viewBox="0 0 220 220" class="chart-svg pie-svg" role="img" aria-label="' + esc(opts.label || "Sector share") + '">'];
    var angle = -Math.PI / 2;
    var legend = [];
    pos.forEach(function (s) {
      var frac = s.value / total;
      if (frac >= 0.9999) {
        out.push('<circle cx="' + CX + '" cy="' + CY + '" r="' + ((R + RI) / 2) + '" fill="none" stroke="' + esc(s.color) +
          '" stroke-width="' + (R - RI) + '"/>');
      } else {
        var a1 = angle + frac * 2 * Math.PI;
        var large = frac > 0.5 ? 1 : 0;
        var p0 = pt(R, angle), p1 = pt(R, a1), q1 = pt(RI, a1), q0 = pt(RI, angle);
        out.push('<path fill="' + esc(s.color) + '" d="M' + p0[0].toFixed(2) + " " + p0[1].toFixed(2) +
          " A" + R + " " + R + " 0 " + large + " 1 " + p1[0].toFixed(2) + " " + p1[1].toFixed(2) +
          " L" + q1[0].toFixed(2) + " " + q1[1].toFixed(2) +
          " A" + RI + " " + RI + " 0 " + large + " 0 " + q0[0].toFixed(2) + " " + q0[1].toFixed(2) + ' Z"/>');
        angle = a1;
      }
      legend.push('<li><span class="dot" style="background:' + esc(s.color) + '"></span><span class="lg-name">' +
        esc(s.label) + '</span><span class="lg-val">' + (frac * 100).toFixed(1) + "%</span></li>");
    });
    out.push('<text class="pie-center" x="' + CX + '" y="' + (CY + 5) + '" text-anchor="middle">' + esc(opts.center || "") + "</text>");
    out.push("</svg>");
    container.innerHTML = '<div class="donut-wrap">' + out.join("") + '<ul class="legend">' + legend.join("") + "</ul></div>";
  }

  // items: [{ label, value, color, text }] sorted by the caller. Horizontal fat-line bars.
  function hbars(container, items, opts) {
    opts = opts || {};
    var W = widthOf(container, 240, 640);
    var rowH = 22;
    var P = { l: 64, r: 64, t: 4, b: 4 };
    var H = P.t + P.b + rowH * items.length;
    var max = 0;
    items.forEach(function (i) { if (i.value > max) max = i.value; });
    if (!(max > 0)) {
      container.innerHTML = '<p class="empty">No data yet.</p>';
      return;
    }
    var out = ['<svg viewBox="0 0 ' + W + " " + H + '" class="chart-svg bars-svg" role="img" aria-label="' + esc(opts.label || "Bars") + '">'];
    items.forEach(function (it, idx) {
      var y = P.t + idx * rowH;
      var bw = Math.max(4, (it.value / max) * (W - P.l - P.r));
      out.push('<text class="bar-label" x="' + (P.l - 8) + '" y="' + (y + rowH / 2 + 4) + '" text-anchor="end">' + esc(it.label) + "</text>");
      out.push('<rect x="' + P.l + '" y="' + (y + 5) + '" width="' + bw.toFixed(1) + '" height="10" rx="5" fill="' + esc(it.color) + '"/>');
      out.push('<text class="bar-value" x="' + (P.l + bw + 6).toFixed(1) + '" y="' + (y + rowH / 2 + 4) + '">' + esc(it.text || "") + "</text>");
    });
    out.push("</svg>");
    container.innerHTML = out.join("");
  }

  PSX.charts = { line: line, donut: donut, hbars: hbars };
})();
