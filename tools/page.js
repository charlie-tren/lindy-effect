"use strict";
/* Inlined by build.py. No innerHTML anywhere - a security hook blocks it, so every
   chart is built with createElementNS and every label with textContent. */
const D = JSON.parse(document.getElementById("data").textContent);
const NS = "http://www.w3.org/2000/svg";
const el = (n, a = {}) => {
  const e = document.createElementNS(NS, n);
  for (const k in a) e.setAttribute(k, a[k]);
  return e;
};
const txt = (s, a) => { const t = el("text", a); t.textContent = s; return t; };
const clear = n => { while (n.firstChild) n.removeChild(n.firstChild); };
const band = y => y < 1500 ? 0 : y < 1700 ? 1 : y < 1800 ? 2 : y < 1900 ? 3 : 4;
const cLab = c => c < 0 ? Math.abs(c) + " BC" : (c === 0 ? "0-99" : c + "s");
const yrLab = y => y < 0 ? Math.abs(y) + " BC" : String(y);
const fmt = n => n.toLocaleString("en-AU");
const yLab = v => v >= 1000 ? (v / 1000) + "k" : String(v);
const DOT = " · ";

/* ------------------------------------------------------------------- theme */
const tog = document.getElementById("tog");
const togl = document.getElementById("togl");
function setTheme(dark) {
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  togl.textContent = dark ? "Light" : "Dark";
  tog.setAttribute("aria-label", "Switch to the " + (dark ? "light" : "dark") + " theme");
  try { localStorage.setItem("lc-theme", dark ? "dark" : "light"); } catch (e) {}
}
tog.addEventListener("click", () =>
  setTheme(document.documentElement.getAttribute("data-theme") !== "dark"));
setTheme((function () {
  // Dark by default. Only an explicit stored choice can turn it light, so a first
  // visit gets dark and a returning visitor keeps whatever they picked.
  try { const v = localStorage.getItem("lc-theme"); return v ? v === "dark" : true; }
  catch (e) { return true; }
})());

/* ------------------------------------------- one tooltip implementation, four charts */
// Hero labels: nudge a label up only when it actually runs into one already placed.
// build.py puts every label at the same small clearance above its mark; the collisions
// can only be resolved here, where the real rendered text width is known. Fixed
// alternating offsets were the earlier approach - they left half the labels floating
// well clear of a curve they never came near, which read as detached.
// PINCH TO ZOOM. Zoom was wheel-only, and a touch device never fires wheel, so the dot
// plots could be panned on a phone but not zoomed at all. touch-action is already none
// on both, so the browser hands us every touch rather than scrolling the page.
// Registered AFTER each chart's own pointerdown so cancelDrag() runs once the chart has
// set its drag state - otherwise the first finger keeps panning through the pinch.
function pinchZoom(svg, G, zoom, cancelDrag) {
  const pts = new Map();
  let base = null;
  const two = () => {
    const a = [];
    pts.forEach(function (v) { a.push(v); });
    return a;
  };
  const gap = () => {
    const a = two();
    return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
  };
  svg.addEventListener("pointerdown", function (ev) {
    pts.set(ev.pointerId, userPos(svg, ev, G.W, G.H));
    if (pts.size === 2) {
      cancelDrag();
      const a = two();
      base = {d: gap(), m: {x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2}};
    }
  });
  svg.addEventListener("pointermove", function (ev) {
    if (!pts.has(ev.pointerId)) return;
    pts.set(ev.pointerId, userPos(svg, ev, G.W, G.H));
    if (pts.size !== 2 || !base) return;
    const d = gap();
    if (d < 8) return;               // fingers together: the ratio blows up
    zoom(base.m, base.d / d);
    base.d = d;                      // incremental, so the anchor stays put
  });
  const drop = function (ev) {
    pts.delete(ev.pointerId);
    if (pts.size < 2) base = null;
  };
  svg.addEventListener("pointerup", drop);
  svg.addEventListener("pointercancel", drop);
  svg.addEventListener("pointerleave", drop);
}

/* The hero curve is generated server-side at a fixed 960-unit width, so unlike the
   three charts below it cannot be re-laid-out here: its label positions were solved in
   that coordinate space by a separation sweep in build.py. What it CAN stop doing is
   pretending six labels fit on a phone.

   `k` is user units per rendered pixel. Setting a font to `size * k` units renders it
   at exactly `size` pixels whatever the scale, so the labels come back to a real size
   instead of 4px. Below about 600px rendered, the middle callouts come off entirely:
   six labels do not fit on a 342px curve at any legible size, and a label that does
   not fit is deleted rather than shrunk. Both ENDS always stay, because placing the
   oldest and the newest work is the whole claim the picture makes. Every dot stays,
   and every one of them is already on the tooltip.

   Nothing happens above 768px rendered, so the desktop drawing is untouched. */
function heroFit() {
  const svg = document.querySelector("#v-curve figure svg");
  if (!svg) return;
  const vb = (svg.viewBox && svg.viewBox.baseVal.width) || 960;
  const shown = svg.getBoundingClientRect().width || vb;
  const k = vb / shown;
  const labels = [].slice.call(svg.querySelectorAll(".mkl"));
  const drop = k > 1.6 && labels.length > 2;
  const scale = k > 1.25;
  labels.forEach(function (t, i) {
    const keep = !drop || i === 0 || i === labels.length - 1;
    t.style.display = keep ? "" : "none";
    t.style.fontSize = (keep && scale) ? (10.5 * k).toFixed(1) + "px" : "";
  });
  [[".axl", 10], [".ax", 11], [".note", 11], [".fitl", 11]].forEach(function (pair) {
    [].slice.call(svg.querySelectorAll(pair[0])).forEach(function (t) {
      t.style.fontSize = scale ? (pair[1] * k).toFixed(1) + "px" : "";
    });
  });

  /* build.py placed each label clear of the curve at its ORIGINAL size, so growing
     one drops its baseline box onto the curve: at 375 The Odyssey landed on it. Lift
     whatever is now touching. Sampled across the label's own x range rather than at
     its midpoint, because in the steep shoulder the curve falls further under the far
     end of a label than under its centre.

     Every label is reset to the y build.py gave it first, so this is idempotent and a
     resize does not accumulate lifts. */
  const cv = svg.querySelector("path.cv");
  if (!cv || !cv.getTotalLength) return;
  const len = cv.getTotalLength();
  const yAt = function (x) {
    let lo = 0, hi = len;
    for (let i = 0; i < 24; i++) {
      const m = (lo + hi) / 2;
      if (cv.getPointAtLength(m).x < x) { lo = m; } else { hi = m; }
    }
    return cv.getPointAtLength(lo).y;
  };
  labels.forEach(function (t) {
    if (t.dataset.y0 === undefined) t.dataset.y0 = t.getAttribute("y");
    t.setAttribute("y", t.dataset.y0);
    if (t.style.display === "none") return;
    const bb = t.getBBox();
    let top = Infinity;
    for (let i = 0; i <= 20; i++) top = Math.min(top, yAt(bb.x + bb.width * i / 20));
    const clear = top - (bb.y + bb.height);
    if (clear < 4) {
      t.setAttribute("y", (parseFloat(t.dataset.y0) - (4 - clear)).toFixed(1));
    }
  });
}

function heroLabels() {
  var svg = document.querySelector("#v-curve svg");
  if (!svg) return;
  var boxes = [];
  [].slice.call(svg.querySelectorAll(".mkl")).forEach(function (t) {
    var bb = t.getBBox(), lift = 0, hit = true, guard = 0;
    while (hit && guard++ < 8) {
      hit = false;
      for (var i = 0; i < boxes.length; i++) {
        var b = boxes[i];
        if (bb.x < b.x + b.width + 4 && b.x < bb.x + bb.width + 4
            && bb.y - lift < b.y + b.height && b.y < bb.y + bb.height - lift) {
          // exactly clear of that box, not a fixed step - stepping overshot to 33px
          lift = bb.y + bb.height - b.y + 2;
          hit = true;
        }
      }
    }
    if (lift) t.setAttribute("y", (parseFloat(t.getAttribute("y")) - lift).toFixed(1));
    boxes.push({x: bb.x, y: bb.y - lift, width: bb.width, height: bb.height});
  });
}

function tipper(tipId, svg) {
  const tip = document.getElementById(tipId);
  let hits = [];
  return {
    reset: function () { hits = []; },
    /* `sub` may be a function, and on the dot plots it always is. Building the line
       eagerly meant formatting 10,000 of them per redraw so that ONE could be shown:
       measured at 260ms of a 335ms redraw, 254ms of which was toLocaleString. The
       redraw runs on load, on every filter change and at the end of every drag. */
    add: function (x, y, head, sub) { hits.push({x: x, y: y, head: head, sub: sub}); },
    hide: function () { tip.classList.remove("on"); },
    /* xonly snaps to the nearest column regardless of vertical position, which is how
       a line or bar chart should behave - requiring a hit on the 3px marker itself made
       the tooltips feel broken. The scatter stays 2D, where y carries meaning. */
    track: function (u, W, H, radius, xonly) {
      let best = null, bd = radius * radius;
      for (const h of hits) {
        const q = xonly ? (h.x - u.x) * (h.x - u.x)
          : (h.x - u.x) * (h.x - u.x) + (h.y - u.y) * (h.y - u.y);
        if (q < bd) { bd = q; best = h; }
      }
      if (!best) { tip.classList.remove("on"); return; }
      clear(tip);
      const b = document.createElement("b");
      b.textContent = best.head;
      const sp = document.createElement("span");
      sp.textContent = typeof best.sub === "function" ? best.sub() : best.sub;
      tip.appendChild(b);
      tip.appendChild(sp);
      const r = svg.getBoundingClientRect();
      // flip to the left of the point when it would otherwise run off the edge, which
      // was cutting long book titles in half
      const tw = tip.offsetWidth || 240;
      let lx = best.x / W * r.width + 12;
      if (lx + tw > r.width - 4) lx = Math.max(0, best.x / W * r.width - tw - 12);
      tip.style.left = lx + "px";
      tip.style.top = Math.max(0, best.y / H * r.height - 48) + "px";
      tip.classList.add("on");
    }
  };
}
/* Keep a pan/zoom view sitting on top of its data: it may never be dragged so far that
   the data leaves the frame. Zoomed IN, the view has to stay inside the data extent;
   zoomed OUT past that extent it has to contain it instead. That is one rule seen from
   two sides, so both fall out of a single clamp on where the low edge may sit, and there
   is no second copy to drift. Panning was clamped on one edge of one axis before this,
   which is how a drag could carry a plot clean off its own cloud. */
function clampTo(v, home) {
  const w = v.x1 - v.x0, h = v.y1 - v.y0;
  const xa = home.x0, xb = home.x1 - w, ya = home.y0, yb = home.y1 - h;
  const x0 = Math.min(Math.max(v.x0, Math.min(xa, xb)), Math.max(xa, xb));
  const y0 = Math.min(Math.max(v.y0, Math.min(ya, yb)), Math.max(ya, yb));
  v.x0 = x0; v.x1 = x0 + w;
  v.y0 = y0; v.y1 = y0 + h;
}
function userPos(svg, ev, W, H) {
  const r = svg.getBoundingClientRect();
  return {x: (ev.clientX - r.left) / r.width * W, y: (ev.clientY - r.top) / r.height * H};
}


/* A least-squares fit in log-log space plus R squared. Drawn on both dot plots so the
   "there is no slope" claim is a measured line rather than an eyeball judgement. */
function fitLine(pairs) {
  const n = pairs.length;
  if (n < 8) return null;
  let sx = 0, sy = 0;
  for (const q of pairs) { sx += q[0]; sy += q[1]; }
  const mx = sx / n, my = sy / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const q of pairs) {
    const dx = q[0] - mx, dy = q[1] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  const slope = sxy / sxx;
  return {slope: slope, intercept: my - slope * mx,
          r2: (sxy * sxy) / (sxx * syy), n: n};
}
function drawFit(svg, fit, x0, x1, px, py, labelX, labelY) {
  if (!fit) return;
  const ya = fit.intercept + fit.slope * x0, yb = fit.intercept + fit.slope * x1;
  svg.appendChild(el("line", {class: "fit", x1: px(x0).toFixed(1), y1: py(ya).toFixed(1),
    x2: px(x1).toFixed(1), y2: py(yb).toFixed(1)}));
  svg.appendChild(txt("r² = " + fit.r2.toFixed(3)
    + "  (n = " + fmt(fit.n) + ")", {class: "fitl", x: labelX, y: labelY,
    "text-anchor": "end"}));
}

/* ------------------------------------------------- the hero curve gets hover too */
const svgHero = document.querySelector("#v-curve figure svg");
if (svgHero && document.getElementById("tip6")) {
  const tipHero = tipper("tip6", svgHero);
  const HW = svgHero.viewBox.baseVal.width, HH = svgHero.viewBox.baseVal.height;
  const marks = svgHero.querySelectorAll("circle.mk");
  const labels = svgHero.querySelectorAll("text.mkl");
  for (let i = 0; i < marks.length; i++) {
    const dl = marks[i].getAttribute("data-dl");
    tipHero.add(+marks[i].getAttribute("cx"), +marks[i].getAttribute("cy"),
      marks[i].getAttribute("data-title")
        || (labels[i] ? labels[i].textContent : "?"),
      dl ? dl + " readers a month" : "");
  }
  svgHero.addEventListener("pointermove", function (ev) {
    tipHero.track(userPos(svgHero, ev, HW, HH), HW, HH, 26);
  });
  svgHero.addEventListener("pointerleave", function () { tipHero.hide(); });
}

/* Size a chart's viewBox off its RENDERED width, so one user unit is one CSS pixel.

   A fixed `viewBox="0 0 960 ..."` scaled into a 390px phone shrinks every label with
   it: these four charts declared 9-10px and rendered at 4, measured off the live page
   with getBoundingClientRect. Nothing in the CSS or the computed font-size says so -
   `getComputedStyle(text).fontSize` reports the user-unit size and looks perfectly
   healthy - which is why it sat there unnoticed. Pendulum and Inequality render the
   same declared sizes at 15px because they do this.

   Margins come off the render too. 180px of gutter is a fifth of a 960 canvas and
   more than half of a 342 one, so a set that is right on a desktop leaves a phone
   with no plot at all. Each box carries both, and the narrow set is chosen by
   measurement rather than by a media query, because the container is not the window:
   the same chart is narrower inside a padded card than the viewport suggests. */
/* A log axis puts 1, 2 and 5 in every decade, so at a phone's width the top of one
   decade lands on the bottom of the next: "1,000" printed into "2,000". Keep every
   grid LINE and drop only the label that will not clear its neighbour.

   A separation guard rather than a per-width tick list, because both of these axes
   ZOOM. Any fixed choice of which ticks to label is wrong at some magnification, and
   the guard is right at all of them. */
function spacer(min) {
  let last = -Infinity;
  return function (x) {
    if (x - last < min) return false;
    last = x;
    return true;
  };
}

function fitBox(svg, box) {
  const w = Math.round(svg.getBoundingClientRect().width) || box.W;
  if (w > 0) box.W = w;
  Object.assign(box, w < 560 ? box.narrow : box.wide);
  svg.setAttribute("viewBox", "0 0 " + box.W + " " + box.H);
  return box;
}

/* --------------- shelf: how many books from each century are still read above a bar */
const svgShelf = document.getElementById("shelf");
const tipShelf = tipper("tip3", svgShelf);
const SH = {W: 960, H: 280,
            wide:   {H: 286, L: 58, R: 14, T: 18, B: 62, step: 2},
            narrow: {H: 320, L: 56, R: 10, T: 14, B: 68, step: 4}};
let thresh = "200";
function shelf(st) {
  clear(svgShelf);
  tipShelf.reset();
  fitBox(svgShelf, SH);
  const W = SH.W, H = SH.H, L = SH.L, R = SH.R, T = SH.T, B = SH.B;
  // Twenty-four centuries into 300px is a 12px bar, so every second label still
  // overprints its neighbour. Thinning is the only answer that keeps them legible;
  // every bar is on the tooltip either way.
  const STEP = SH.step;
  // newest on the LEFT, oldest on the RIGHT, matching the curve above
  const bars = st.shelf.bars.slice().reverse();
  if (!bars.length) return;
  const counts = bars.map(function (b) { return b.rate[thresh] || 0; });
  /* LOG scale, because the counts span three orders of magnitude - 3,220 books from the
     1900s against 1 from the 800s. On a linear axis twenty of the twenty-six centuries
     are invisible. The cost is that bar LENGTH is no longer proportional to the count,
     so the axis is labelled and the tooltip gives the number outright. */
  const hi = Math.log10(Math.max(10, Math.max.apply(null, counts) * 1.35));
  const lo = 0;                                    // one book sits on the baseline
  const bw = (W - L - R) / bars.length;
  const yv = v => v <= 0 ? H - B
    : H - B - (Math.log10(v) - lo) / (hi - lo) * (H - T - B);
  [1, 3, 10, 30, 100, 300, 1000, 3000].forEach(function (g) {
    if (Math.log10(g) > hi) return;
    svgShelf.appendChild(el("line", {class: "g", x1: L, y1: yv(g).toFixed(1),
      x2: W - R, y2: yv(g).toFixed(1)}));
    svgShelf.appendChild(txt(fmt(g), {class: "ax", x: L - 8, y: (yv(g) + 4).toFixed(1),
      "text-anchor": "end"}));
  });
  bars.forEach(function (b, i) {
    const x = L + i * bw;
    const c = counts[i];
    const yTop = yv(c);
    svgShelf.appendChild(el("rect", {x: (x + bw * 0.14).toFixed(1), y: yTop.toFixed(1),
      width: (bw * 0.72).toFixed(1), height: Math.max(0.5, H - B - yTop).toFixed(1),
      fill: "var(--c" + band(b.y) + ")", "data-year": b.y}));
    if ((bars.length - 1 - i) % STEP === 0) {
      const g = el("g", {transform: "rotate(-44 " + (x + bw / 2).toFixed(1) + " "
        + (H - B + 15) + ")"});
      g.appendChild(txt(cLab(b.c), {class: "ax", x: (x + bw / 2).toFixed(1),
        y: H - B + 15, "text-anchor": "end"}));
      svgShelf.appendChild(g);
    }
    const t = D.titles[b.i] || ["?", ""];
    tipShelf.add(x + bw / 2, yTop, cLab(b.c),
      fmt(b.cnt[thresh]) + " of " + fmt(b.n) + " books read more than " + fmt(+thresh)
      + " times a month" + DOT + (b.cnt[thresh] / b.n * 100).toFixed(1) + "% of the century"
      + (b.span < 100 ? DOT + "only " + b.span + " years so far, scaled to " + fmt(c)
                        + " per century" : "")
      + DOT + "best known: " + t[0]);
  });
  svgShelf.appendChild(el("line", {class: "g", x1: L, y1: H - B, x2: W - R, y2: H - B}));
  const smid = (T + (H - B)) / 2;
  svgShelf.appendChild(txt("BOOKS  (LOG)", {class: "axl", x: 13, y: smid,
    "text-anchor": "middle", transform: "rotate(-90 13 " + smid + ")"}));
  svgShelf.appendChild(txt("NEWEST", {class: "axl", x: L + 2, y: H - 6}));
  svgShelf.appendChild(txt("OLDEST", {class: "axl", x: W - R - 2, y: H - 6,
    "text-anchor": "end"}));
  const sc = document.getElementById("shcount");
  if (sc) {
    const tot = bars.reduce(function (a, b2) { return a + b2.cnt[thresh]; }, 0);
    sc.textContent = fmt(tot) + " books clear that bar";
  }
}
svgShelf.addEventListener("pointermove", function (ev) {
  tipShelf.track(userPos(svgShelf, ev, SH.W, SH.H), SH.W, SH.H, 12, true);
});
svgShelf.addEventListener("pointerleave", function () { tipShelf.hide(); });



//: Both dot plots pan and zoom, and neither said so. Kept on the status line the
//: charts already write to rather than added as a caption under them.
const GESTURES = "drag to pan, scroll to zoom, double-click to reset";

/* --------------------------------------------- scatter: zoom, pan and hover */
const SC = {W: 960, H: 470, L: 58, R: 122, T: 26, B: 52,
            wide:   {H: 470, L: 58, R: 122, T: 26, B: 52},
            /* R drops from 122 to 12: that gutter exists to keep the fit label off
               the cloud, and on a phone it was costing more than a third of the
               plot. The label is right-aligned inside the plot instead. */
            narrow: {H: 430, L: 54, R: 12, T: 22, B: 46}};
/* The plot holds only the most-read works, so it is truncated at the bottom. Read that
   floor OFF THE DATA rather than rounding it to 1,000, and do not round it back.

   MEASURED 26/08/2026, because the round number is the tempting change and it is wrong.
   The cut moves every refetch - 766, then 732, then 815 over three weeks - so any
   constant drifts, and a hard 1,000 sat ABOVE the cut, hiding 2,691 of the 10,000
   plotted books below the opening view where no pan could reach them. The page's own
   note and the r-squared label both say 10,000, so it was claiming what it would not
   show, and the fit was drawn over points a reader could not audit.

   The one argument for rounding up is that the extra books thicken the truncation shelf.
   They do not, much. Counting the sample in 18px strips walking up from each candidate
   floor: from 774 it goes 2679, 2063, 1293, 866; from 1,000 it goes 2060, 1289, 865,
   678. Cropping does not remove the dense bottom edge, it moves it - 2,691 books spent
   for an edge 77% as dense. That density is the power law, not the cut. */
const READ_MIN = D.scatter.points.reduce((m, p) => Math.min(m, p.d), Infinity);
const HOME = {x0: Math.log10(5), x1: Math.log10(3200),
              y0: Math.log10(READ_MIN * 0.95), y1: Math.log10(200000)};
let view = Object.assign({}, HOME);
const svgScatter = document.getElementById("scatter");
const tipScatter = tipper("tip", svgScatter);

const spx = v => SC.L + (v - view.x0) / (view.x1 - view.x0) * (SC.W - SC.L - SC.R);
const spy = v => SC.H - SC.B - (v - view.y0) / (view.y1 - view.y0) * (SC.H - SC.T - SC.B);

function ticks(lo, hi) {
  const out = [];
  for (let e = Math.floor(lo); e <= Math.ceil(hi); e++) {
    [1, 2, 5].forEach(function (m) {
      const v = m * Math.pow(10, e), l = Math.log10(v);
      if (l >= lo && l <= hi) out.push(v);
    });
  }
  return out.length > 9 ? out.filter((_, i) => i % 2 === 0) : out;
}

let scQueued = false;
function scatterSoon() {
  if (scQueued) return;
  scQueued = true;
  requestAnimationFrame(function () { scQueued = false; scatter(); });
}
let ptsG = null, dotsG = null, defsG = null;
function buildCloud() {
  /* The cloud is built ONCE and its circles are then repositioned on pan and zoom.
     Recreating 4,800 SVG nodes every frame is what made dragging feel sticky; setting
     two attributes on existing nodes is far cheaper. A group transform would be cheaper
     still, but log-log zoom needs a non-uniform scale, which turns the dots into
     ellipses - so this is the fast option that stays correct.
     THREE LAYERS, and the order matters: the clip has to sit OUTSIDE the pan transform
     or it slides away with the dots and stops being a window on the plot. So ptsG is
     clipped and never moves, dotsG carries the drag translate, circles live in dotsG. */
  defsG = el("defs");
  const cp = el("clipPath", {id: "plotclip"});
  cp.appendChild(el("rect", {x: SC.L, y: SC.T, width: SC.W - SC.L - SC.R,
    height: SC.H - SC.T - SC.B}));
  defsG.appendChild(cp);
  ptsG = el("g", {id: "cloud", "clip-path": "url(#plotclip)"});
  dotsG = el("g");
  ptsG.appendChild(dotsG);
  D.scatter.points.forEach(function () {
    dotsG.appendChild(el("circle", {class: "pt sp", cx: 0, cy: 0, r: 2.9,
      opacity: 0.5}));
  });
}
function placeCloud() {
  const kids = dotsG.childNodes, pts = D.scatter.points;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], c = kids[i];
    /* A dot the filters exclude is HIDDEN, never parked off-canvas. Parking put
       thousands of them on one shared x, and a pan translates the whole group, so the
       parked column marched into frame as a straight vertical line of phantom books.
       display:none cannot be dragged back into view; an off-canvas coordinate can. */
    if (!inEra(p)) {
      if (c.getAttribute("display") !== "none") c.setAttribute("display", "none");
      continue;
    }
    if (c.getAttribute("display") === "none") c.removeAttribute("display");
    /* Placed whether or not it is currently in view, and left to the clip to hide.
       Placing only the visible ones meant a drag - which just translates the group -
       could never bring a new dot in, so the cloud thinned out as you panned and
       snapped back on release. */
    c.setAttribute("cx", spx(Math.log10(p.a)).toFixed(1));
    c.setAttribute("cy", spy(Math.log10(p.d)).toFixed(1));
  }
}
let era = "all", lang = "all", minRead = 0, subj = "all";
function inEra(p) {
  if (p.d < minRead) return false;
  if (subj !== "all" && p.s !== subj) return false;
  if (lang !== "all") {
    if (lang === "other") {
      if (p.l === "en" || p.l === "fr" || p.l === "fi" || p.l === "de") return false;
    } else if (p.l !== lang) return false;
  }
  if (era === "all") return true;
  const y = 2026 - p.a;
  if (era === "anc") return y < 1500;
  if (era === "ear") return y >= 1500 && y < 1800;
  if (era === "c19") return y >= 1800 && y < 1900;
  return y >= 1900;
}
let gridG = null;
let fnQueued = false;
function furnitureSoon() {
  if (fnQueued) return;
  fnQueued = true;
  requestAnimationFrame(function () { fnQueued = false; furniture(); });
}
function furniture() {
  // everything except the cloud, redrawn at the live view so the gridlines follow the
  // data while the axis NUMBERS stay anchored and correct
  const keep = ptsG;
  const drop = [];
  for (let i = 0; i < svgScatter.childNodes.length; i++) {
    const n = svgScatter.childNodes[i];
    if (n !== keep && n !== defsG) drop.push(n);
  }
  drop.forEach(function (n) { svgScatter.removeChild(n); });
  gridG = el("g", {id: "grid"});
  svgScatter.insertBefore(gridG, keep || null);
  const okX1 = spacer(42);
  ticks(view.x0, view.x1).forEach(function (v) {
    const X = spx(Math.log10(v));
    gridG.appendChild(el("line", {class: "g", x1: X, y1: SC.T, x2: X, y2: SC.H - SC.B}));
    if (okX1(X)) gridG.appendChild(txt(fmt(v), {class: "ax", x: X, y: SC.H - SC.B + 18,
      "text-anchor": "middle"}));
  });
  ticks(view.y0, view.y1).forEach(function (v) {
    const Y = spy(Math.log10(v));
    gridG.appendChild(el("line", {class: "g", x1: SC.L, y1: Y, x2: SC.W - SC.R, y2: Y}));
    gridG.appendChild(txt(yLab(v), {class: "ax", x: SC.L - 7, y: Y + 4,
      "text-anchor": "end"}));
  });
  const fp = [];
  D.scatter.points.forEach(function (p) {
    if (inEra(p)) fp.push([Math.log10(p.a), Math.log10(p.d)]);
  });
  drawFit(svgScatter, fitLine(fp), view.x0, view.x1, spx, spy, SC.W - SC.R - 4, SC.T + 4);
  svgScatter.appendChild(txt("AGE AGAINST READERS A MONTH",
    {class: "axl", x: SC.L, y: SC.T - 8}));
  svgScatter.appendChild(txt("AGE IN YEARS", {class: "axl",
    x: (SC.L + (SC.W - SC.R)) / 2, y: SC.H - 8, "text-anchor": "middle"}));
  const m = (SC.T + (SC.H - SC.B)) / 2;
  svgScatter.appendChild(txt("READERS A MONTH", {class: "axl", x: 14, y: m,
    "text-anchor": "middle", transform: "rotate(-90 14 " + m + ")"}));
}
function scatter() {
  clear(svgScatter);
  tipScatter.reset();
  fitBox(svgScatter, SC);
  gridG = el("g", {id: "grid"});
  svgScatter.appendChild(gridG);
  const okX2 = spacer(42);
  ticks(view.x0, view.x1).forEach(function (v) {
    const X = spx(Math.log10(v));
    gridG.appendChild(el("line", {class: "g", x1: X, y1: SC.T, x2: X,
      y2: SC.H - SC.B}));
    if (okX2(X)) gridG.appendChild(txt(fmt(v), {class: "ax", x: X, y: SC.H - SC.B + 18,
      "text-anchor": "middle"}));
  });
  ticks(view.y0, view.y1).forEach(function (v) {
    const Y = spy(Math.log10(v));
    gridG.appendChild(el("line", {class: "g", x1: SC.L, y1: Y, x2: SC.W - SC.R,
      y2: Y}));
    gridG.appendChild(txt(yLab(v), {class: "ax", x: SC.L - 7, y: Y + 4,
      "text-anchor": "end"}));
  });

  if (!ptsG) buildCloud();
  placeCloud();
  svgScatter.appendChild(defsG);
  svgScatter.appendChild(ptsG);

  let shown = 0;
  D.scatter.points.forEach(function (p) {
    const lx = Math.log10(p.a), ly = Math.log10(p.d);
    if (lx < view.x0 || lx > view.x1 || ly < view.y0 || ly > view.y1) return;
    if (!inEra(p)) return;
    shown++;
    const X = spx(lx), Y = spy(ly);
    tipScatter.add(X, Y, p.t || "?", function () {
      return (p.au ? p.au + DOT : "") + fmt(p.a) + " yrs old" + DOT + fmt(p.d)
        + " readers a month";
    });
  });
  const fitPairs = [];
  D.scatter.points.forEach(function (p) {
    if (!inEra(p)) return;
    fitPairs.push([Math.log10(p.a), Math.log10(p.d)]);
  });
  drawFit(svgScatter, fitLine(fitPairs), view.x0, view.x1, spx, spy,
    SC.W - SC.R - 4, SC.T + 4);
  svgScatter.appendChild(txt("AGE IN YEARS", {class: "axl",
    x: (SC.L + (SC.W - SC.R)) / 2, y: SC.H - 8, "text-anchor": "middle"}));
  const mid = (SC.T + (SC.H - SC.B)) / 2;
  svgScatter.appendChild(txt("READERS A MONTH", {class: "axl", x: 14, y: mid,
    "text-anchor": "middle", transform: "rotate(-90 14 " + mid + ")"}));
  const z = (HOME.x1 - HOME.x0) / (view.x1 - view.x0);
  const fc = document.getElementById("fcount");
  if (fc) fc.textContent = fmt(shown) + " of " + fmt(D.scatter.meta.of) + " shown"
    + (z > 1.05 ? DOT + "zoomed " + z.toFixed(1) + "x" : "") + DOT + GESTURES;
  const note = document.getElementById("scatnote");
  if (note) note.textContent =
    "The " + fmt(D.scatter.meta.kept) + " most-read works of " + fmt(D.scatter.meta.of)
    + ", so everything above " + fmt(D.scatter.meta.floor) + " a month - a truncated "
    + "sample, not the corpus's real density."
    + (z > 1.05 ? DOT + "zoomed " + z.toFixed(1) + "x" : "");
}

function clampView() { clampTo(view, HOME); }
// Zoom about a point, shared by the wheel and by pinch on touch. Extracted rather
// than duplicated: the clamp rules here are the ones that keep the view inside the
// data, and a second copy would drift away from them.
function zoomScatter(u, k) {
  const fx = (u.x - SC.L) / (SC.W - SC.L - SC.R);
  const fy = (SC.H - SC.B - u.y) / (SC.H - SC.T - SC.B);
  const ax = view.x0 + fx * (view.x1 - view.x0);
  const ay = view.y0 + fy * (view.y1 - view.y0);
  const maxW = HOME.x1 - HOME.x0, maxH = HOME.y1 - HOME.y0;
  const w = Math.min(maxW, Math.max(maxW / 40, (view.x1 - view.x0) * k));
  const h = Math.min(maxH, Math.max(maxH / 40, (view.y1 - view.y0) * k));
  view = {x0: ax - fx * w, x1: ax + (1 - fx) * w,
          y0: ay - fy * h, y1: ay + (1 - fy) * h};
  clampView();
  scatterSoon();
}
svgScatter.addEventListener("wheel", function (ev) {
  ev.preventDefault();
  zoomScatter(userPos(svgScatter, ev, SC.W, SC.H), ev.deltaY > 0 ? 1.18 : 1 / 1.18);
}, {passive: false});

let dragging = null;
svgScatter.addEventListener("pointerdown", function (ev) {
  ev.preventDefault();                // stops a drag becoming a page text selection
  dragging = {u: userPos(svgScatter, ev, SC.W, SC.H), v: Object.assign({}, view)};
  svgScatter.classList.add("drag");
  try { svgScatter.setPointerCapture(ev.pointerId); } catch (e) {}
});
svgScatter.addEventListener("pointerup", function () {
  dragging = null;
  svgScatter.classList.remove("drag");
  if (dotsG) dotsG.setAttribute("transform", "");
  if (gridG) gridG.setAttribute("transform", "");
  scatter();
});
svgScatter.addEventListener("pointermove", function (ev) {
  const u = userPos(svgScatter, ev, SC.W, SC.H);
  if (dragging) {
    const dx = (u.x - dragging.u.x) / (SC.W - SC.L - SC.R)
             * (dragging.v.x1 - dragging.v.x0);
    const dy = (u.y - dragging.u.y) / (SC.H - SC.T - SC.B)
             * (dragging.v.y1 - dragging.v.y0);
    view = {x0: dragging.v.x0 - dx, x1: dragging.v.x1 - dx,
            y0: dragging.v.y0 + dy, y1: dragging.v.y1 + dy};
    clampView();
    /* Derive the shift from the CLAMPED view rather than the raw pointer delta, on both
       axes now that both are clamped. Clamping the view alone still let the cloud slide
       past the edge, because the translate was computed from where the mouse went, not
       where the chart allowed. */
    const appliedX = (dragging.v.x0 - view.x0) / (dragging.v.x1 - dragging.v.x0)
                     * (SC.W - SC.L - SC.R);
    const appliedY = (dragging.v.y0 - view.y0) / (dragging.v.y1 - dragging.v.y0)
                     * (SC.H - SC.T - SC.B);
    // A pan is a pure translation, so shifting the group is exact AND costs one
    // attribute write instead of repositioning every circle. Axes redraw on the frame;
    // the cloud snaps back to real coordinates when the drag ends.
    if (dotsG) dotsG.setAttribute("transform",
      "translate(" + appliedX.toFixed(1) + "," + (-appliedY).toFixed(1) + ")");
    furnitureSoon();
    tipScatter.hide();
    return;
  }
  tipScatter.track(u, SC.W, SC.H, 14);
});
svgScatter.addEventListener("pointerleave", function () { tipScatter.hide(); });
pinchZoom(svgScatter, SC, zoomScatter, function () {
  dragging = null;
  svgScatter.classList.remove("drag");
  if (dotsG) dotsG.setAttribute("transform", "");
  if (gridG) gridG.setAttribute("transform", "");
});
svgScatter.addEventListener("dblclick", function () {
  view = Object.assign({}, HOME);
  scatter();
});

/* ------------------------------------------------------------------- state */
const ST = D.states[0];
function state() { return ST; }


draw();
heroFit();
heroLabels();

/* --------------------------------- the second opinion: Wikipedia pageviews */
const svgWiki = document.getElementById("wiki");
const tipWiki = svgWiki ? tipper("tip5", svgWiki) : null;
const WK = {W: 960, H: 420, L: 66, R: 26, T: 30, B: 52,
            wide:   {H: 420, L: 66, R: 26, T: 30, B: 52},
            narrow: {H: 380, L: 56, R: 12, T: 24, B: 46}};
let wHome = null, wView = null;
function wiki() {
  const w = D.wiki;
  if (!w || !svgWiki) return;
  clear(svgWiki);
  tipWiki.reset();
  fitBox(svgWiki, WK);
  const pts = w.points;
  if (!wHome) {
    wHome = {x0: Math.log10(60), x1: Math.log10(3200),
             y0: Math.log10(Math.max(200, Math.min.apply(null, pts.map(p => p.w)) * 0.7)),
             y1: Math.log10(Math.max.apply(null, pts.map(p => p.w)) * 1.4)};
    wView = Object.assign({}, wHome);
  }
  const x0 = wView.x0, x1 = wView.x1, y0 = wView.y0, y1 = wView.y1;
  const px = v => WK.L + (v - x0) / (x1 - x0) * (WK.W - WK.L - WK.R);
  const py = v => WK.H - WK.B - (v - y0) / (y1 - y0) * (WK.H - WK.T - WK.B);
  const okWX = spacer(42);
  ticks(x0, x1).forEach(function (v) {
    const l = Math.log10(v);
    if (l < x0 || l > x1) return;
    svgWiki.appendChild(el("line", {class: "g", x1: px(l), y1: WK.T, x2: px(l),
      y2: WK.H - WK.B}));
    if (okWX(px(l))) svgWiki.appendChild(txt(fmt(v), {class: "ax", x: px(l),
      y: WK.H - WK.B + 18, "text-anchor": "middle"}));
  });
  ticks(y0, y1).forEach(function (v) {
    const l = Math.log10(v);
    if (l < y0 || l > y1) return;
    svgWiki.appendChild(el("line", {class: "g", x1: WK.L, y1: py(l), x2: WK.W - WK.R,
      y2: py(l)}));
    svgWiki.appendChild(txt(v >= 1000000 ? (v / 1000000) + "M" : yLab(v),
      {class: "ax", x: WK.L - 8, y: py(l) + 4, "text-anchor": "end"}));
  });
  pts.forEach(function (p) {
    const lx = Math.log10(p.a), ly = Math.log10(p.w);
    if (lx < x0 || lx > x1 || ly < y0 || ly > y1) return;
    const X = px(lx), Y = py(ly);
    svgWiki.appendChild(el("circle", {class: "pt", cx: X.toFixed(1), cy: Y.toFixed(1),
      r: 3.4, opacity: 0.6}));
    tipWiki.add(X, Y, p.t, function () {
      return fmt(p.a) + " yrs old" + DOT + fmt(p.w) + " Wikipedia views a year"
        + DOT + fmt(p.d) + " Gutenberg readers a month";
    });
  });
  drawFit(svgWiki, fitLine(pts.map(function (q) {
    return [Math.log10(q.a), Math.log10(q.w)];
  })), x0, x1, px, py, WK.W - WK.R - 4, WK.T + 4);
  svgWiki.appendChild(txt("AGE IN YEARS", {class: "axl",
    x: (WK.L + (WK.W - WK.R)) / 2, y: WK.H - 8, "text-anchor": "middle"}));
  const wmid = (WK.T + (WK.H - WK.B)) / 2;
  svgWiki.appendChild(txt("PAGE VIEWS A YEAR", {class: "axl", x: 14,
    y: wmid, "text-anchor": "middle", transform: "rotate(-90 14 " + wmid + ")"}));
  const wn = document.getElementById("wnote");
  if (wn) wn.textContent = fmt(w.n) + " books that have their own Wikipedia article."
    + DOT + GESTURES;
  const set = function (id, v) {
    const n = document.getElementById(id);
    if (n) n.textContent = v;
  };
  set("wn", fmt(w.n));
  set("wt", fmt(w.tried));
  set("wrho", (w.rho_wiki >= 0 ? "+" : "−") + Math.abs(w.rho_wiki).toFixed(3));
  set("wgut", (w.rho_gut >= 0 ? "+" : "−") + Math.abs(w.rho_gut).toFixed(3));
  set("wold", fmt(w.med_old));
  set("wnew", fmt(w.med_new));
  set("wagree", (w.rho_agree >= 0 ? "+" : "−") + Math.abs(w.rho_agree).toFixed(3));
}
if (svgWiki) {
  let wDrag = null;
  /* This plot may zoom out to three times the home span for air round the cloud, so a
     clamp to the home extent alone would fight the zoom. clampTo covers both: past the
     home extent the rule flips to keeping the data inside the view. */
  const clampWiki = function () { clampTo(wView, wHome); };
  const zoomWiki = function (u, k) {
    const fx = (u.x - WK.L) / (WK.W - WK.L - WK.R);
    const fy = (WK.H - WK.B - u.y) / (WK.H - WK.T - WK.B);
    const ax = wView.x0 + fx * (wView.x1 - wView.x0);
    const ay = wView.y0 + fy * (wView.y1 - wView.y0);
    // zooming OUT past the opening extent was capped, so the chart felt stuck.
    // Three times the home span is enough to see the whole cloud with air round it.
    const mw = (wHome.x1 - wHome.x0) * 3, mh = (wHome.y1 - wHome.y0) * 3;
    const ww = Math.min(mw, Math.max(mw / 90, (wView.x1 - wView.x0) * k));
    const hh = Math.min(mh, Math.max(mh / 90, (wView.y1 - wView.y0) * k));
    wView = {x0: ax - fx * ww, x1: ax + (1 - fx) * ww,
             y0: ay - fy * hh, y1: ay + (1 - fy) * hh};
    clampWiki();
    wiki();
  };
  svgWiki.addEventListener("wheel", function (ev) {
    ev.preventDefault();
    zoomWiki(userPos(svgWiki, ev, WK.W, WK.H), ev.deltaY > 0 ? 1.18 : 1 / 1.18);
  }, {passive: false});
  svgWiki.addEventListener("pointerdown", function (ev) {
    ev.preventDefault();
    wDrag = {u: userPos(svgWiki, ev, WK.W, WK.H), v: Object.assign({}, wView)};
    svgWiki.classList.add("drag");
    try { svgWiki.setPointerCapture(ev.pointerId); } catch (e) {}
  });
  svgWiki.addEventListener("pointerup", function () {
    wDrag = null;
    svgWiki.classList.remove("drag");
  });
  svgWiki.addEventListener("pointermove", function (ev) {
    const u = userPos(svgWiki, ev, WK.W, WK.H);
    if (wDrag) {
      const dx = (u.x - wDrag.u.x) / (WK.W - WK.L - WK.R) * (wDrag.v.x1 - wDrag.v.x0);
      const dy = (u.y - wDrag.u.y) / (WK.H - WK.T - WK.B) * (wDrag.v.y1 - wDrag.v.y0);
      wView = {x0: wDrag.v.x0 - dx, x1: wDrag.v.x1 - dx,
               y0: wDrag.v.y0 + dy, y1: wDrag.v.y1 + dy};
      clampWiki();
      tipWiki.hide();
      wiki();
      return;
    }
    tipWiki.track(u, WK.W, WK.H, 14);
  });
  svgWiki.addEventListener("pointerleave", function () { tipWiki.hide(); });
  pinchZoom(svgWiki, WK, zoomWiki, function () {
    wDrag = null;
    svgWiki.classList.remove("drag");
  });
  svgWiki.addEventListener("dblclick", function () {
    wView = Object.assign({}, wHome);
    wiki();
  });
}
wiki();

function draw() {
  const st = state();
  shelf(st);
  scatter();
}
draw();

/* Now that the geometry comes from the container, a resize has to redraw it or a
   rotated phone keeps the portrait margins. Debounced: a rotation fires a burst and
   each scatter redraw places ten thousand points. Width only - a mobile browser
   changes the reported HEIGHT every time its address bar hides, and redrawing on
   that would rebuild the cloud on every scroll. */
let lastW = window.innerWidth;
let resizeT = null;
window.addEventListener("resize", function () {
  if (window.innerWidth === lastW) return;
  lastW = window.innerWidth;
  clearTimeout(resizeT);
  resizeT = setTimeout(function () { draw(); wiki(); heroFit(); }, 150);
});

/* the dropdown filters above the dot plot */
(function () {
  const sel = document.getElementById("f-thresh");
  if (!sel) return;
  thresh = sel.value;
  sel.addEventListener("change", function () { thresh = sel.value; shelf(state()); });
})();
[["f-era", function (v) { era = v; }],
 ["f-subj", function (v) { subj = v; }],
 ["f-lang", function (v) { lang = v; }],
 ["f-min", function (v) { minRead = +v; }]].forEach(function (pair) {
  const sel = document.getElementById(pair[0]);
  if (!sel) return;
  sel.addEventListener("change", function () {
    pair[1](sel.value);
    scatter();
  });
});
