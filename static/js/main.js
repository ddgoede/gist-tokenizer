/* GIST project page: teaser scrubber, two-target playground, results chart.
   Plain JS, no dependencies. Data comes from tools/build_assets.py. */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const N = 19; // bins per target error
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const HERO_IDS = ["in100_black_swan", "goldfish_reef", "blue_morpho", "hummingbird", "pink_peony"];
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const fmtEps = (v) => (v === 0 ? "0" : String(+v.toFixed(3)));
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // Version tag from the script URL (main.js?v=...), reused for the data files so
  // a browser never mixes a cached old script or JSON with a new page.
  const ASSET_V = (() => {
    try { return new URL(document.currentScript.src).searchParams.get("v") || ""; } catch (e) { return ""; }
  })();
  const versioned = (url) => (ASSET_V ? `${url}?v=${ASSET_V}` : url);

  let DATA = null;
  let byId = {};

  /* ---------- theme changes (system setting or data-theme toggle) ---------- */
  const themeListeners = [];
  const onTheme = (fn) => themeListeners.push(fn);
  const fireTheme = () => themeListeners.forEach((fn) => fn());
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", fireTheme);
  new MutationObserver(fireTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  /* ---------- colour helpers (OKLab interpolation for the heatmap) ---------- */
  function hexToRgb(h) {
    h = h.replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const toLin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const fromLin = (c) => Math.round(clamp(c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055, 0, 1) * 255);
  function rgbToOklab([r, g, b]) {
    r = toLin(r); g = toLin(g); b = toLin(b);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    ];
  }
  function oklabToLinear([L, a, b]) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ];
  }
  const oklabToRgb = (lab) => oklabToLinear(lab).map(fromLin);
  // OKLCH -> sRGB; lowers chroma until the colour fits the sRGB gamut.
  function oklchToRgb(L, C, H) {
    for (let k = 0; k < 80; k++) {
      const lin = oklabToLinear([L, C * Math.cos(H), C * Math.sin(H)]);
      if (lin.every((v) => v >= -1e-4 && v <= 1 + 1e-4)) return lin.map(fromLin);
      C *= 0.97;
    }
    return oklabToRgb([L, 0, 0]);
  }
  // Colormap of the playground's token-count grid.
  //   "paper": the rainbow of the paper's token bars (TOKENS_CMAP in
  //            demo/make_comparison_video.py).
  //   "green": single-hue ramp from the theme tokens.
  // HEAT_SCALE "log" spreads 16..256 tokens evenly over the colormap, so the
  // 16-80 token region where semantic protection acts stays readable; "linear"
  // maps T / 256 exactly like the paper's token bars.
  const HEATMAP = "paper";
  const HEAT_SCALE = "log";
  // The paper's hues (#2563eb #06b6d4 #22c55e #f59e0b #dc2626), toned down in OKLCH
  // so the grid is easier on the eyes: every stop's lightness is pulled halfway
  // toward L = 0.60 (darkening the glaring cyan, green and amber) and chroma is
  // kept at 92%. Equally spaced stops, interpolated in OKLCH along the hue circle
  // so in-between shades keep their saturation instead of greying out.
  const PAPER_TOKENS_CMAP = ["#346eeb", "#04a3be", "#1baf52", "#d2870d", "#da3933"].map((h) => {
    const [L, a, b] = rgbToOklab(hexToRgb(h));
    return [L, Math.hypot(a, b), Math.atan2(b, a)];
  });
  function paperCmap(t) {
    const x = clamp(t, 0, 1) * (PAPER_TOKENS_CMAP.length - 1);
    const i = Math.min(Math.floor(x), PAPER_TOKENS_CMAP.length - 2);
    const f = x - i;
    const [L0, C0, H0] = PAPER_TOKENS_CMAP[i];
    const [L1, C1, H1] = PAPER_TOKENS_CMAP[i + 1];
    const dH = ((H1 - H0 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI; // shortest way round
    return oklchToRgb(L0 + (L1 - L0) * f, C0 + (C1 - C0) * f, H0 + dH * f);
  }
  function greenRamp(t) {
    const lo = rgbToOklab(hexToRgb(css("--heat-lo")));
    const hi = rgbToOklab(hexToRgb(css("--heat-hi")));
    return oklabToRgb(lo.map((v, i) => v + (hi[i] - v) * t));
  }
  const heatColor = (t) => (HEATMAP === "paper" ? paperCmap(t) : greenRamp(t));
  const tokenShade = (T) => (HEAT_SCALE === "linear"
    ? clamp(T / 256, 0, 1)
    : clamp(Math.log(T / 16) / Math.log(16), 0, 1));

  /* ---------- reconstruction strips ---------- */
  const imgCache = new Map();
  function loadImg(url) {
    if (!imgCache.has(url)) {
      imgCache.set(url, new Promise((resolve, reject) => {
        const im = new Image();
        im.decoding = "async";
        im.onload = () => resolve(im);
        im.onerror = () => { imgCache.delete(url); reject(new Error(`failed to load ${url}`)); };
        im.src = url;
      }));
    }
    return imgCache.get(url);
  }
  const recon = (id, file) => `static/recon/${id}/${file}.webp`;
  const semFile = (s) => `gist_s${String(s).padStart(2, "0")}`;

  const tileObserver = new ResizeObserver((entries) => entries.forEach((e) => e.target._tile && e.target._tile.draw()));

  // A canvas that shows tile i of a horizontal strip of n 256x256 tiles.
  // Until the requested strip has loaded it keeps showing the previous frame.
  class Tile {
    constructor(canvas) {
      this.c = canvas;
      this.ctx = canvas.getContext("2d");
      this.img = null; this.i = 0; this.n = 1; this.want = "";
      canvas._tile = this;
      tileObserver.observe(canvas);
    }
    show(url, i = 0, n = 1) {
      const key = `${url}#${i}`;
      this.want = key;
      return loadImg(url).then((img) => {
        if (this.want !== key) return;
        this.img = img; this.i = i; this.n = n;
        this.draw();
      }).catch(() => {});
    }
    draw() {
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const w = Math.max(1, Math.round(this.c.clientWidth * dpr));
      if (this.c.width !== w || this.c.height !== w) { this.c.width = w; this.c.height = w; }
      if (!this.img) return;
      const tw = this.img.naturalWidth / this.n;
      const th = this.img.naturalHeight;
      // 1px inset so bilinear filtering never samples the neighbouring tile.
      const inset = this.n > 1 ? 1 : 0;
      this.ctx.imageSmoothingEnabled = true;
      this.ctx.imageSmoothingQuality = "high";
      this.ctx.drawImage(this.img, this.i * tw + inset, inset, tw - 2 * inset, th - 2 * inset, 0, 0, w, w);
    }
  }

  function syncRange(input) {
    const p = ((input.value - input.min) / (input.max - input.min)) * 100;
    input.style.setProperty("--p", `${p}%`);
  }

  // Thumbnail radio group. Returns a function that marks the selected id.
  function buildPicker(el, ids, onPick) {
    el.textContent = "";
    for (const id of ids) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "thumb";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-label", byId[id].label);
      b.title = byId[id].label;
      b.dataset.id = id;
      b.style.backgroundImage = `url("${recon(id, "orig")}")`;
      b.addEventListener("click", () => onPick(id));
      el.appendChild(b);
    }
    el.addEventListener("keydown", (e) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      const btns = [...el.querySelectorAll(".thumb")];
      const cur = btns.findIndex((b) => b.getAttribute("aria-checked") === "true");
      const next = btns[(cur + step + btns.length) % btns.length];
      next.focus();
      onPick(next.dataset.id);
    });
    return (id) => el.querySelectorAll(".thumb").forEach((b) => {
      const on = b.dataset.id === id;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
    });
  }

  /* ---------- teaser: KARL-dagger vs GIST at the same pixel target ---------- */
  function initHero() {
    const st = { id: HERO_IDS[0], r: REDUCED ? 13 : 0, dir: 1, playing: !REDUCED, inView: false, timer: 0 };
    const tOrig = new Tile($("hero-orig"));
    const tKarl = new Tile($("hero-karl"));
    const tGist = new Tile($("hero-gist"));
    const range = $("hero-rec");
    const btn = $("hero-play");

    const mark = buildPicker($("hero-picker"), HERO_IDS, (id) => { st.id = id; mark(id); render(); });
    mark(st.id);

    function render() {
      const ex = byId[st.id];
      const r = st.r;
      tOrig.show(recon(st.id, "orig"));
      tKarl.show(recon(st.id, "karl"), r, N);
      tGist.show(recon(st.id, semFile(0)), r, N);
      const kT = ex.karl.T[r];
      const gT = ex.gist.T[0][r];
      $("hero-karl-T").textContent = kT;
      $("hero-gist-T").textContent = gT;
      $("hero-karl-lp").textContent = ex.karl.lpips[r].toFixed(2);
      $("hero-gist-lp").textContent = ex.gist.lpips[0][r].toFixed(2);
      $("hero-karl-bar").style.width = `${(kT / DATA.budget) * 100}%`;
      $("hero-gist-bar").style.width = `${(gT / DATA.budget) * 100}%`;
      range.value = r;
      syncRange(range);
      $("hero-rec-out").textContent = fmtEps(DATA.rec[r]);
      range.setAttribute("aria-valuetext",
        `ε_rec ${fmtEps(DATA.rec[r])}: KARL† keeps ${kT} tokens, GIST keeps ${gT} tokens`);
    }

    function setPlaying(on) {
      st.playing = on;
      btn.setAttribute("aria-pressed", String(on));
      btn.setAttribute("aria-label", on ? "Pause" : "Play");
      schedule();
    }
    function schedule() {
      clearTimeout(st.timer);
      if (!st.playing || !st.inView || document.hidden) return;
      const atEnd = st.r === 0 || st.r === N - 1;
      st.timer = setTimeout(tick, atEnd ? 1600 : 620);
    }
    function tick() {
      if (st.r + st.dir < 0 || st.r + st.dir > N - 1) st.dir *= -1;
      st.r += st.dir;
      render();
      schedule();
    }

    range.addEventListener("input", () => { st.r = +range.value; setPlaying(false); render(); });
    btn.addEventListener("click", () => {
      if (!st.playing && st.r === N - 1) st.dir = -1;
      if (!st.playing && st.r === 0) st.dir = 1;
      setPlaying(!st.playing);
    });
    document.addEventListener("visibilitychange", schedule);
    new IntersectionObserver((entries) => {
      st.inView = entries[0].isIntersecting;
      schedule();
    }, { threshold: 0.35 }).observe($("protection"));

    setPlaying(st.playing);
    render();
    // Warm the other teaser examples once the first one is on screen.
    Promise.all([loadImg(recon(st.id, "karl")), loadImg(recon(st.id, semFile(0)))]).then(() => {
      for (const id of HERO_IDS) { loadImg(recon(id, "karl")); loadImg(recon(id, semFile(0))); }
    }).catch(() => {});
  }

  /* ---------- playground: both targets on one image ---------- */
  function initPlayground() {
    const ids = DATA.examples.map((e) => e.id);
    const st = { id: "hummingbird", r: 15, s: 0, drag: false };
    const tRecon = new Tile($("pg-recon"));
    const tOrig = new Tile($("pg-orig"));
    const pad = $("pg-pad");
    const heat = $("pg-heat");
    const puck = $("pg-puck");
    const tip = $("pg-tip");
    const recR = $("pg-rec");
    const semR = $("pg-sem");
    const presets = [...document.querySelectorAll("#playground .preset")];

    const mark = buildPicker($("pg-picker"), ids, (id) => {
      st.id = id; mark(id); preload(); drawHeat(); render();
    });
    mark(st.id);

    let near = false; // only prefetch once the playground approaches the viewport
    new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !near) { near = true; preload(); }
    }, { rootMargin: "600px 0px" }).observe($("playground"));

    function preload() {
      if (!near) return;
      // Current semantic row first, then outward.
      const order = [...Array(N).keys()].sort((a, b) => Math.abs(a - st.s) - Math.abs(b - st.s));
      for (const s of order) loadImg(recon(st.id, semFile(s))).catch(() => {});
    }

    function drawHeat() {
      const ex = byId[st.id];
      const ctx = heat.getContext("2d");
      const img = ctx.createImageData(N, N);
      for (let s = 0; s < N; s++) {
        for (let r = 0; r < N; r++) {
          const [R, G, B] = heatColor(tokenShade(ex.gist.T[s][r]));
          img.data.set([R, G, B, 255], ((N - 1 - s) * N + r) * 4);
        }
      }
      ctx.putImageData(img, 0, 0);
      const stops = Array.from({ length: 17 }, (_, i) => i / 16)
        .map((t) => `rgb(${heatColor(t).join(",")}) ${t * 100}%`);
      $("pg-ramp").style.background = `linear-gradient(to right, ${stops.join(",")})`;
      const ticks = HEAT_SCALE === "linear" ? [0, 64, 128, 192, 256] : [16, 32, 64, 128, 256];
      const tickRow = $("pg-ramp-ticks");
      tickRow.textContent = "";
      ticks.forEach((T, i) => {
        const tick = document.createElement("span");
        tick.textContent = T;
        tick.style.left = `${(i / (ticks.length - 1)) * 100}%`;
        tickRow.appendChild(tick);
      });
    }

    function render() {
      const ex = byId[st.id];
      const { r, s } = st;
      const T = ex.gist.T[s][r];
      tRecon.show(recon(st.id, semFile(s)), r, N);
      tOrig.show(recon(st.id, "orig"));
      $("pg-T").textContent = T;
      $("pg-lp").textContent = ex.gist.lpips[s][r].toFixed(2);
      $("pg-ds").textContent = ex.gist.dreamsim[s][r].toFixed(2);
      recR.value = r; semR.value = s;
      syncRange(recR); syncRange(semR);
      $("pg-rec-out").textContent = fmtEps(DATA.rec[r]);
      $("pg-sem-out").textContent = fmtEps(DATA.sem[s]);
      puck.style.left = `${(r / N) * 100}%`;
      puck.style.top = `${((N - 1 - s) / N) * 100}%`;
      presets.forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.r === r && +b.dataset.s === s)));
      pad.setAttribute("aria-valuetext",
        `ε_rec ${fmtEps(DATA.rec[r])}, ε_sem ${fmtEps(DATA.sem[s])}: ${T} of 256 tokens, LPIPS ${ex.gist.lpips[s][r].toFixed(2)}`);
    }

    function set(r, s) {
      r = clamp(r, 0, N - 1); s = clamp(s, 0, N - 1);
      if (r === st.r && s === st.s) return;
      const rowChanged = s !== st.s;
      st.r = r; st.s = s;
      if (rowChanged) preload();
      render();
    }

    const cellAt = (e) => {
      const b = pad.getBoundingClientRect();
      return [
        clamp(Math.floor(((e.clientX - b.left) / b.width) * N), 0, N - 1),
        clamp(N - 1 - Math.floor(((e.clientY - b.top) / b.height) * N), 0, N - 1),
      ];
    };
    function showTip(e, r, s) {
      const ex = byId[st.id];
      const b = pad.getBoundingClientRect();
      tip.textContent = "";
      const l1 = document.createElement("div");
      l1.textContent = `ε_rec ${fmtEps(DATA.rec[r])} · ε_sem ${fmtEps(DATA.sem[s])}`;
      const l2 = document.createElement("div");
      l2.textContent = `${ex.gist.T[s][r]} tokens · LPIPS ${ex.gist.lpips[s][r].toFixed(2)}`;
      tip.append(l1, l2);
      tip.hidden = false;
      const x = e.clientX - b.left;
      const y = e.clientY - b.top;
      const tw = tip.offsetWidth;
      const th = tip.offsetHeight;
      tip.style.left = `${clamp(x + 14 + tw > b.width ? x - tw - 14 : x + 14, 4, b.width - tw - 4)}px`;
      tip.style.top = `${clamp(y - th - 12 < 0 ? y + 16 : y - th - 12, 4, b.height - th - 4)}px`;
    }

    pad.addEventListener("pointerdown", (e) => {
      st.drag = true;
      pad.setPointerCapture(e.pointerId);
      const [r, s] = cellAt(e);
      set(r, s);
      showTip(e, r, s);
    });
    pad.addEventListener("pointermove", (e) => {
      const [r, s] = cellAt(e);
      if (st.drag) set(r, s);
      if (e.pointerType === "mouse" || st.drag) showTip(e, r, s);
    });
    const end = () => { st.drag = false; };
    pad.addEventListener("pointerup", (e) => { end(); if (e.pointerType !== "mouse") tip.hidden = true; });
    pad.addEventListener("pointercancel", () => { end(); tip.hidden = true; });
    pad.addEventListener("pointerleave", () => { if (!st.drag) tip.hidden = true; });
    pad.addEventListener("keydown", (e) => {
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
      if (!d) return;
      e.preventDefault();
      set(st.r + d[0], st.s + d[1]);
    });
    recR.addEventListener("input", () => set(+recR.value, st.s));
    semR.addEventListener("input", () => set(st.r, +semR.value));
    presets.forEach((b) => {
      b.addEventListener("click", () => set(+b.dataset.r, +b.dataset.s));
    });

    onTheme(drawHeat);
    preload();
    drawHeat();
    render();
  }

  /* ---------- results chart ---------- */
  const SVG_NS = "http://www.w3.org/2000/svg";
  function el(tag, attrs, parent) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(node);
    return node;
  }
  function interp(pts, x) {
    if (x < pts[0][0] || x > pts[pts.length - 1][0]) return null;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      if (x >= x0 && x <= x1) return x1 === x0 ? y0 : y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
    return pts[pts.length - 1][1];
  }

  function initChart(PARETO) {
    const box = $("chart");
    const svg = $("chart-svg");
    const tip = $("chart-tip");
    const st = { ds: "in100", metric: "lpips", hoverX: null };
    const SERIES = [
      { key: "karl", label: "KARL†", color: "--pix" },
      { key: "gist1", label: "GIST-1", color: "--gist1" },
      { key: "gist", label: "GIST", color: "--sem" },
    ];
    // How each metric is drawn and how GIST's difference to KARL-dagger is stated:
    // relative change for the losses (as in the paper), dB for PSNR, absolute for SSIM.
    const METRICS = {
      lpips: { label: "LPIPS", higher: false, digits: 3, delta: "rel" },
      dreamsim: { label: "DreamSim", higher: false, digits: 3, delta: "rel" },
      l1: { label: "L1 ×10", higher: false, digits: 3, delta: "rel" },
      psnr: { label: "PSNR (dB)", higher: true, digits: 2, delta: "db" },
      ssim: { label: "SSIM", higher: true, digits: 3, delta: "abs" },
    };
    const deltaOf = (spec, k, g) => (spec.delta === "rel" ? (g - k) / k : g - k);
    const gain = (spec, d) => (spec.higher ? d : -d); // > 0 means GIST is better
    function fmtDelta(spec, d) {
      const sign = d < 0 ? "−" : "+";
      const a = Math.abs(d);
      if (spec.delta === "rel") return `${sign}${Math.round(a * 100)}%`;
      if (spec.delta === "db") return `${sign}${a.toFixed(1)} dB`;
      return `${sign}${a.toFixed(2)}`;
    }
    function niceStep(range) {
      const raw = range / 5;
      const p = 10 ** Math.floor(Math.log10(raw));
      return [1, 2, 2.5, 5, 10].map((f) => f * p).find((v) => v >= raw);
    }
    let geom = null;

    document.querySelectorAll(".chart-filters .seg").forEach((group) => {
      group.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        group.querySelectorAll("button").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
        if (b.dataset.ds) st.ds = b.dataset.ds;
        if (b.dataset.metric) st.metric = b.dataset.metric;
        render();
      });
    });

    function render() {
      const W = Math.max(280, box.clientWidth);
      const H = W < 560 ? 300 : 390;
      const m = { l: 52, r: 18, t: 16, b: 46 };
      svg.textContent = "";
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      svg.setAttribute("width", W);
      svg.setAttribute("height", H);

      const spec = METRICS[st.metric];
      const data = PARETO[st.ds][st.metric];
      const all = SERIES.flatMap((s) => data[s.key].map((p) => p[1]));
      const step = niceStep(Math.max(...all) - Math.min(...all));
      const decimals = (String(+step.toPrecision(6)).split(".")[1] || "").length;
      const iLo = Math.floor(Math.min(...all) / step), iHi = Math.ceil(Math.max(...all) / step);
      const yLo = iLo * step, yHi = iHi * step;
      const X = (t) => m.l + (t / 260) * (W - m.l - m.r);
      const Y = (v) => m.t + (1 - (v - yLo) / (yHi - yLo)) * (H - m.t - m.b);
      geom = { W, H, m, X, Y, data, spec };

      const ink = css("--ink"), muted = css("--muted"), line = css("--line"), bg = css("--bg");

      // grid + axes
      const grid = el("g", {}, svg);
      for (let i = iLo; i <= iHi; i++) {
        const v = i * step;
        el("line", { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), stroke: line, "stroke-width": 1 }, grid);
        el("text", { x: m.l - 10, y: Y(v) + 4, "text-anchor": "end", "font-size": 12, fill: muted }, grid)
          .textContent = v.toFixed(decimals);
      }
      for (let t = 0; t <= 250; t += 50) {
        el("text", { x: X(t), y: H - m.b + 20, "text-anchor": "middle", "font-size": 12, fill: muted }, grid).textContent = t;
      }
      el("text", { x: (m.l + W - m.r) / 2, y: H - 6, "text-anchor": "middle", "font-size": 13, fill: muted }, grid)
        .textContent = "Tokens used";
      el("text", {
        x: 0, y: 0, transform: `translate(14 ${(m.t + H - m.b) / 2}) rotate(-90)`,
        "text-anchor": "middle", "font-size": 13, fill: muted,
      }, grid).textContent = `${spec.label} (${spec.higher ? "higher" : "lower"} is better)`;

      // band: GIST's difference to KARL-dagger at matched tokens
      const k = data.karl, g = data.gist;
      const lo = Math.max(k[0][0], g[0][0]), hi = Math.min(k[k.length - 1][0], g[g.length - 1][0]);
      const xs = Array.from({ length: 241 }, (_, i) => lo + ((hi - lo) * i) / 240);
      const top = xs.map((x) => `${X(x)},${Y(interp(k, x))}`);
      const bot = xs.slice().reverse().map((x) => `${X(x)},${Y(interp(g, x))}`);
      el("polygon", { points: top.concat(bot).join(" "), fill: css("--sem"), "fill-opacity": 0.13 }, svg);

      // series
      for (const s of SERIES) {
        const pts = data[s.key];
        const color = css(s.color);
        el("path", {
          d: pts.map((p, i) => `${i ? "L" : "M"}${X(p[0])},${Y(p[1])}`).join(""),
          fill: "none", stroke: color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round",
        }, svg);
        const dots = el("g", {}, svg);
        for (const p of pts) el("circle", { cx: X(p[0]), cy: Y(p[1]), r: 4, fill: color, stroke: bg, "stroke-width": 2 }, dots);
      }

      // direct label on the series the story is about
      const g0 = g[0];
      el("text", { x: X(g0[0]) - 10, y: Y(g0[1]) + 4, "text-anchor": "end", "font-size": 13, "font-weight": 600, fill: ink }, svg)
        .textContent = "GIST";

      // largest gain of GIST over KARL-dagger, read off the same interpolation as the band
      let best = { x: lo, gain: -Infinity, d: 0 };
      for (const x of xs) {
        const d = deltaOf(spec, interp(k, x), interp(g, x));
        if (gain(spec, d) > best.gain) best = { x, gain: gain(spec, d), d };
      }
      const yk = Y(interp(k, best.x)), yg = Y(interp(g, best.x));
      const dir = yg > yk ? 1 : -1; // +1: GIST drawn below KARL-dagger
      el("line", { x1: X(best.x), x2: X(best.x), y1: yk + 6 * dir, y2: yg - 6 * dir, stroke: ink, "stroke-width": 1 }, svg);
      // Between the curves when there is room; on narrow charts beside GIST's
      // start, on the side away from KARL-dagger.
      const narrow = W < 560;
      const lx = narrow ? X(best.x) + 18 : X(best.x) + 8;
      const ly = narrow ? (dir > 0 ? yg + 26 : yg - 30) : (yk + yg) / 2;
      const anchor = narrow ? "end" : "start";
      const lab = el("text", { x: lx, y: ly, "font-size": 13, fill: ink, "text-anchor": anchor }, svg);
      el("tspan", { "font-weight": 700 }, lab).textContent = fmtDelta(spec, best.d);
      el("tspan", { x: lx, dy: 16, "font-size": 11.5, fill: muted }, lab).textContent = `at ${Math.round(best.x)} tokens`;

      // hover layer
      const hover = el("g", { "pointer-events": "none" }, svg);
      geom.hover = hover;
      const hit = el("rect", { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: "transparent" }, svg);
      hit.style.cursor = "crosshair";
      hit.addEventListener("pointermove", (e) => {
        const b = svg.getBoundingClientRect();
        const px = ((e.clientX - b.left) / b.width) * W;
        st.hoverX = clamp(Math.round(((px - m.l) / (W - m.l - m.r)) * 260), 16, 256);
        drawHover();
      });
      hit.addEventListener("pointerleave", () => { st.hoverX = null; drawHover(); });
      if (st.hoverX != null) drawHover();
    }

    function drawHover() {
      const { hover, X, Y, m, H, W, data, spec } = geom;
      hover.textContent = "";
      if (st.hoverX == null) { tip.hidden = true; return; }
      const x = st.hoverX;
      el("line", { x1: X(x), x2: X(x), y1: m.t, y2: H - m.b, stroke: css("--muted"), "stroke-width": 1 }, hover);

      tip.textContent = "";
      const head = document.createElement("div");
      head.className = "t-head";
      head.textContent = `${x} tokens`;
      tip.appendChild(head);
      const vals = {};
      for (const s of SERIES.slice().reverse()) {
        const v = interp(data[s.key], x);
        if (v == null) continue;
        vals[s.key] = v;
        el("circle", { cx: X(x), cy: Y(v), r: 4.5, fill: css(s.color), stroke: css("--bg"), "stroke-width": 2 }, hover);
        const row = document.createElement("div");
        row.className = "t-row";
        const key = document.createElement("i");
        key.style.background = css(s.color);
        const val = document.createElement("b");
        val.textContent = v.toFixed(spec.digits);
        const name = document.createElement("span");
        name.textContent = s.label;
        row.append(key, val, name);
        tip.appendChild(row);
      }
      if (vals.karl != null && vals.gist != null) {
        const gap = document.createElement("div");
        gap.className = "t-gap";
        const b = document.createElement("b");
        b.textContent = fmtDelta(spec, deltaOf(spec, vals.karl, vals.gist));
        gap.append("GIST vs KARL†: ", b);
        tip.appendChild(gap);
      }
      tip.hidden = Object.keys(vals).length === 0;
      const scale = box.clientWidth / W;
      const px = X(x) * scale;
      const tw = tip.offsetWidth;
      tip.style.left = `${px + 14 + tw > box.clientWidth ? px - tw - 14 : px + 14}px`;
      tip.style.top = `${m.t * scale + 6}px`;
    }

    // keyboard: the chart is focusable and arrow keys move the crosshair
    svg.setAttribute("tabindex", "0");
    svg.addEventListener("keydown", (e) => {
      const d = { ArrowLeft: -4, ArrowRight: 4 }[e.key];
      if (!d) return;
      e.preventDefault();
      st.hoverX = clamp((st.hoverX ?? 64) + d, 16, 256);
      drawHover();
    });
    svg.addEventListener("blur", () => { st.hoverX = null; drawHover(); });

    new ResizeObserver(() => render()).observe(box);
    onTheme(render);
    render();
  }

  /* ---------- small things ---------- */
  document.querySelectorAll('a[aria-disabled="true"]').forEach((a) => a.addEventListener("click", (e) => e.preventDefault()));

  const copyBtn = $("bib-copy");
  copyBtn.addEventListener("click", () => {
    const text = $("bib-text").innerText;
    const done = (msg) => { copyBtn.textContent = msg; setTimeout(() => { copyBtn.textContent = "Copy"; }, 1600); };
    const fallback = () => {
      const sel = window.getSelection();
      const r = document.createRange();
      r.selectNodeContents($("bib-text"));
      sel.removeAllRanges();
      sel.addRange(r);
      done("Selected");
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => done("Copied"), fallback);
    } else {
      fallback();
    }
  });

  /* ---------- boot ---------- */
  fetch(versioned("static/data/examples.json")).then((r) => r.json()).then((d) => {
    DATA = d;
    byId = Object.fromEntries(d.examples.map((e) => [e.id, e]));
    initHero();
    initPlayground();
  }).catch((err) => console.error(err));

  fetch(versioned("static/data/pareto.json")).then((r) => r.json()).then(initChart).catch((err) => console.error(err));
})();
