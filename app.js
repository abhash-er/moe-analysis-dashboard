(async function() {
  // Theme handling: persisted in localStorage, defaults to system preference.
  const THEME_KEY = 'moe-dashboard-theme';
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const initialTheme = localStorage.getItem(THEME_KEY) || (prefersDark ? 'dark' : 'light');
  document.documentElement.dataset.theme = initialTheme;
  const themeBtn = document.getElementById('theme-toggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      localStorage.setItem(THEME_KEY, next);
    });
  }

  const M = await fetch('manifest.json').then(r => r.json());
  const STAGE = M.stage;

  const $ = id => document.getElementById(id);
  const selBsz = $('sel-bsz'), selNexp = $('sel-nexp'), selLr = $('sel-lr');
  const selRun = $('sel-run');

  const GIF_EXT = M.gif_ext || 'gif';
  const HIDE_RAW_JSON = !!M.no_raw_json;

  // Back-compat: pre-tab manifests had a flat shape.
  const TABS = M.tabs && M.tabs.length ? M.tabs : [{
    id: 'main',
    label: 'Main',
    path_prefix: M.bucket_prefix !== undefined ? M.bucket_prefix : '../',
    stage: M.stage,
    bsz_values: M.bsz_values || [],
    nexp_values: M.nexp_values || [],
    lr_values: M.lr_values || [],
    buckets: M.buckets || {},
  }];

  // Remember user's last selection per tab.
  const tabSelections = Object.fromEntries(TABS.map(t => [t.id, { bsz: null, nexp: null, lr: null, run: null }]));
  let activeTab = TABS[0];

  function bucketPath(bsz, nexp, lr) {
    const stage = activeTab.stage || STAGE;
    return `${activeTab.path_prefix}bsz${bsz}/nexp_${nexp}/lr${lr}/${stage}`;
  }

  function fillSelect(sel, values, prev) {
    sel.innerHTML = '';
    for (const v of values) {
      const opt = document.createElement('option');
      opt.value = v; opt.textContent = v;
      sel.appendChild(opt);
    }
    if (prev && values.includes(prev)) sel.value = prev;
  }

  function currentBucket() {
    const bsz = selBsz.value, nexp = selNexp.value, lr = selLr.value;
    const b = ((activeTab.buckets[bsz] || {})[nexp] || {})[lr];
    return b ? { bsz, nexp, lr, info: b, path: bucketPath(bsz, nexp, lr) } : null;
  }

  function refreshNexp() {
    const bsz = selBsz.value;
    const nexps = Object.keys(activeTab.buckets[bsz] || {}).sort((a,b) => +a - +b);
    fillSelect(selNexp, nexps, selNexp.value);
    refreshLr();
  }
  function refreshLr() {
    const bsz = selBsz.value, nexp = selNexp.value;
    const lrs = Object.keys((activeTab.buckets[bsz] || {})[nexp] || {}).sort((a,b) => +a - +b);
    fillSelect(selLr, lrs, selLr.value);
    // Persist selection for this tab so switching back restores it.
    tabSelections[activeTab.id] = { bsz: selBsz.value, nexp: selNexp.value, lr: selLr.value };
    render();
  }

  function buildLayerTabs(container, layers, onSelect, initial) {
    container.innerHTML = '';
    layers.forEach((L, idx) => {
      const btn = document.createElement('button');
      btn.textContent = `L${L}`;
      btn.dataset.layer = L;
      btn.addEventListener('click', () => {
        container.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        onSelect(L);
      });
      if ((initial !== undefined && L === initial) || (initial === undefined && idx === 0)) {
        btn.classList.add('active');
      }
      container.appendChild(btn);
    });
  }

  function renderSaturation(b) {
    const el = $('saturation-content');
    el.innerHTML = '';
    if (b.info.has_saturation_plot) {
      const img = document.createElement('img');
      img.src = `${b.path}/router_saturation_vs_final.png`;
      img.alt = 'router_saturation_vs_final';
      img.style.maxWidth = '100%';
      el.appendChild(img);
    } else {
      el.innerHTML = '<div class="missing">No saturation plot.</div>';
    }
  }

  function renderActivation(b) {
    const agg = $('activation-agg');
    agg.innerHTML = '';
    if (b.info.has_activation_norms_agg) {
      const img = document.createElement('img');
      img.src = `${b.path}/expert_activation_norms.png`;
      img.alt = 'expert_activation_norms';
      agg.appendChild(img);
    }
    if (b.info.has_activation_max_over_median) {
      const img = document.createElement('img');
      img.src = `${b.path}/expert_activation_max_over_median.png`;
      img.alt = 'expert_activation_max_over_median';
      agg.appendChild(img);
    }
    if (activeTab.kind === 'model' && b.info.has_activation_grid) {
      const img = document.createElement('img');
      img.src = `${b.path}/expert_activation_per_layer.png`;
      img.alt = 'expert_activation_per_layer';
      agg.appendChild(img);
    }
    if (!agg.children.length) agg.innerHTML = '<div class="missing">No aggregate plots.</div>';

    const layers = b.info.activation_layers;
    const tabs = $('activation-tabs');
    const detail = $('activation-detail');
    const scroll = $('activation-scroll');
    scroll.innerHTML = '';
    detail.innerHTML = '';

    if (!layers.length) {
      tabs.innerHTML = '<span class="missing">No per-layer data.</span>';
      return;
    }
    const actPath = (L) => activeTab.kind === 'model'
      ? `${b.path}/per_layer/expert_activation_L${L}.png`
      : `${b.path}/activation_norms_per_layer/activation_norms_layer_${L}.png`;
    const showLayer = (L) => {
      detail.innerHTML = '';
      const img = document.createElement('img');
      img.src = actPath(L);
      img.alt = `activation_layer_${L}`;
      detail.appendChild(img);
    };
    buildLayerTabs(tabs, layers, showLayer);
    showLayer(layers[0]);
    layers.forEach(L => {
      const fig = document.createElement('figure');
      const img = document.createElement('img');
      img.src = actPath(L);
      img.loading = 'lazy';
      const cap = document.createElement('figcaption'); cap.textContent = `L${L}`;
      fig.appendChild(img); fig.appendChild(cap);
      scroll.appendChild(fig);
    });
  }

  function renderCoactivation(b) {
    const stale = document.querySelector('.rev-select-wrap');
    if (stale) stale.remove();
    const layers = b.info.coactivation_layers;
    const tabs = $('coact-tabs');
    const detail = $('coact-detail');
    const scroll = $('coact-scroll');
    scroll.innerHTML = '';
    detail.innerHTML = '';
    if (!layers.length) {
      tabs.innerHTML = '<span class="missing">No coactivation plots.</span>';
      return;
    }
    const showLayer = (L) => {
      detail.innerHTML = '';
      const img = document.createElement('img');
      img.src = `${b.path}/coactivation_layer_${L}.png`;
      img.alt = `coactivation_layer_${L}`;
      detail.appendChild(img);
    };
    buildLayerTabs(tabs, layers, showLayer);
    showLayer(layers[0]);
    layers.forEach(L => {
      const fig = document.createElement('figure');
      const img = document.createElement('img');
      img.src = `${b.path}/coactivation_layer_${L}.png`;
      img.loading = 'lazy';
      const cap = document.createElement('figcaption'); cap.textContent = `L${L}`;
      fig.appendChild(img); fig.appendChild(cap);
      scroll.appendChild(fig);
    });
  }

  // Decoded-frame cache: url -> Promise<{frames: ImageBitmap[], w, h}>.
  const _frameCache = new Map();

  async function loadFrames(url) {
    if (_frameCache.has(url)) return _frameCache.get(url);
    const p = (async () => {
      if (typeof ImageDecoder === 'undefined') {
        throw new Error('ImageDecoder not supported in this browser');
      }
      const buf = await fetch(url).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      });
      const type = url.endsWith('.webp') ? 'image/webp' : 'image/gif';
      const decoder = new ImageDecoder({ data: buf, type });
      await decoder.tracks.ready;
      const track = decoder.tracks.selectedTrack;
      const targetCount = Number.isFinite(track.frameCount) && track.frameCount > 0 ? track.frameCount : 4096;
      const frames = [];
      let w = 0, h = 0;
      for (let i = 0; i < targetCount; i++) {
        try {
          const result = await decoder.decode({ frameIndex: i });
          if (!w) { w = result.image.displayWidth; h = result.image.displayHeight; }
          const bmp = await createImageBitmap(result.image);
          result.image.close();
          frames.push(bmp);
        } catch (e) {
          break;
        }
      }
      decoder.close();
      if (!frames.length) throw new Error('No frames decoded');
      return { frames, w, h };
    })();
    _frameCache.set(url, p);
    p.catch(() => _frameCache.delete(url));
    return p;
  }

  // Master timeline shared across the 3 routing slots.
  const _master = {
    slots: [],          // [{canvas, ctx, status, frames, w, h, layer, url}]
    frame: 0,
    playing: true,
    fps: 8,
    raf: null,
    lastTickAt: 0,
    slider: null,
    counter: null,
    playBtn: null,
  };

  function maxFrames() {
    return _master.slots.reduce((m, s) => Math.max(m, s.frames ? s.frames.length : 0), 0);
  }

  function drawSlot(s) {
    if (!s.frames || !s.frames.length) return;
    const idx = Math.min(_master.frame, s.frames.length - 1);
    const cv = s.canvas, ctx = s.ctx;
    if (cv.width !== s.w || cv.height !== s.h) { cv.width = s.w; cv.height = s.h; }
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(s.frames[idx], 0, 0);
  }

  function renderAllSlots() {
    _master.slots.forEach(drawSlot);
    const total = maxFrames();
    if (_master.slider) _master.slider.max = Math.max(0, total - 1);
    if (_master.slider) _master.slider.value = _master.frame;
    if (_master.counter) _master.counter.textContent = total ? `${_master.frame + 1} / ${total}` : '— / —';
  }

  function tick(now) {
    if (!_master.playing) { _master.raf = null; return; }
    if (!_master.lastTickAt) _master.lastTickAt = now;
    const dt = now - _master.lastTickAt;
    const interval = 1000 / Math.max(1, _master.fps);
    if (dt >= interval) {
      _master.lastTickAt = now;
      const total = maxFrames();
      if (total > 0) {
        _master.frame = (_master.frame + 1) % total;
        renderAllSlots();
      }
    }
    _master.raf = requestAnimationFrame(tick);
  }

  function startPlayback() {
    if (_master.playing && _master.raf) return;
    _master.playing = true;
    _master.lastTickAt = 0;
    if (_master.playBtn) _master.playBtn.textContent = '❚❚ Pause';
    if (_master.raf) cancelAnimationFrame(_master.raf);
    _master.raf = requestAnimationFrame(tick);
  }
  function pausePlayback() {
    _master.playing = false;
    if (_master.playBtn) _master.playBtn.textContent = '▶ Play';
    if (_master.raf) { cancelAnimationFrame(_master.raf); _master.raf = null; }
  }

  async function loadSlot(s) {
    s.frames = null;
    s.status.textContent = 'loading…';
    drawSlot(s);
    try {
      const data = await loadFrames(s.url());
      s.frames = data.frames;
      s.w = data.w;
      s.h = data.h;
      s.status.textContent = `${data.frames.length} frames`;
      renderAllSlots();
    } catch (e) {
      s.status.textContent = `error: ${e.message}`;
      console.error('loadSlot', e);
    }
  }

  function renderRouting(b) {
    const layers = b.info.routing_layers;
    const compare = $('gif-compare');
    compare.innerHTML = '';
    pausePlayback();
    _master.slots = [];
    _master.frame = 0;

    if (!layers.length) {
      compare.innerHTML = '<div class="missing">No per-layer routing animations.</div>';
    } else {
      // Master controls bar (spans full row above the 3 slots).
      const controls = document.createElement('div');
      controls.className = 'gif-controls';
      controls.style.gridColumn = '1 / -1';

      const playBtn = document.createElement('button');
      playBtn.className = 'step-btn play-btn';
      playBtn.textContent = '❚❚ Pause';
      playBtn.title = 'Play / pause';
      playBtn.addEventListener('click', () => { _master.playing ? pausePlayback() : startPlayback(); });

      const prevBtn = document.createElement('button');
      prevBtn.className = 'step-btn';
      prevBtn.textContent = '◀';
      prevBtn.title = 'Step back';
      prevBtn.addEventListener('click', () => {
        pausePlayback();
        const total = maxFrames();
        if (total) { _master.frame = (_master.frame - 1 + total) % total; renderAllSlots(); }
      });

      const nextBtn = document.createElement('button');
      nextBtn.className = 'step-btn';
      nextBtn.textContent = '▶';
      nextBtn.title = 'Step forward';
      nextBtn.addEventListener('click', () => {
        pausePlayback();
        const total = maxFrames();
        if (total) { _master.frame = (_master.frame + 1) % total; renderAllSlots(); }
      });

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = 0; slider.max = 0; slider.value = 0;
      slider.title = 'Scrub frame';
      slider.addEventListener('input', () => {
        pausePlayback();
        _master.frame = +slider.value;
        renderAllSlots();
      });

      const counter = document.createElement('span');
      counter.className = 'frame-count';
      counter.textContent = '— / —';

      const speedSel = document.createElement('select');
      speedSel.className = 'speed-sel';
      speedSel.title = 'Playback speed (fps)';
      [4, 8, 12, 20, 30].forEach(f => {
        const o = document.createElement('option');
        o.value = f; o.textContent = `${f} fps`;
        if (f === _master.fps) o.selected = true;
        speedSel.appendChild(o);
      });
      speedSel.addEventListener('change', () => { _master.fps = +speedSel.value; });

      controls.appendChild(playBtn);
      controls.appendChild(prevBtn);
      controls.appendChild(nextBtn);
      controls.appendChild(slider);
      controls.appendChild(counter);
      controls.appendChild(speedSel);
      compare.appendChild(controls);

      _master.slider = slider;
      _master.counter = counter;
      _master.playBtn = playBtn;

      const defaults = [
        layers[0],
        layers[Math.floor(layers.length / 2)],
        layers[layers.length - 1],
      ];
      defaults.forEach((defL) => {
        const slot = document.createElement('div'); slot.className = 'gif-slot';
        const sel = document.createElement('select');
        layers.forEach(L => {
          const o = document.createElement('option');
          o.value = L; o.textContent = `Layer ${L}`;
          if (L === defL) o.selected = true;
          sel.appendChild(o);
        });
        const canvas = document.createElement('canvas');
        const status = document.createElement('div');
        status.className = 'slot-status';
        const slotState = {
          canvas,
          ctx: canvas.getContext('2d'),
          status,
          frames: null,
          w: 0, h: 0,
          layer: defL,
          url: () => activeTab.kind === 'model'
            ? `${b.path}/routing/expert_routing_layer_${slotState.layer}.gif`
            : `${b.path}/expert_routing_per_layer/expert_routing_layer_${slotState.layer}.${GIF_EXT}`,
        };
        sel.addEventListener('change', () => {
          slotState.layer = sel.value;
          loadSlot(slotState);
        });
        slot.appendChild(sel);
        slot.appendChild(canvas);
        slot.appendChild(status);
        compare.appendChild(slot);
        _master.slots.push(slotState);
      });

      // Kick off all three loads in parallel; start playback once any is ready.
      Promise.all(_master.slots.map(loadSlot)).then(() => {
        if (maxFrames() > 0) startPlayback();
      });
    }

    const agg = $('gif-agg'); agg.innerHTML = '';
    if (b.info.has_routing_gif_agg) {
      const img = document.createElement('img');
      img.src = `${b.path}/expert_routing.${GIF_EXT}`;
      img.alt = 'expert_routing';
      img.style.maxWidth = '100%';
      agg.appendChild(img);
    } else {
      agg.innerHTML = '<div class="missing">No aggregate animation.</div>';
    }
  }

  function renderRaw(b) {
    const ul = $('raw-links');
    ul.innerHTML = '';
    if (HIDE_RAW_JSON) {
      const sec = document.getElementById('sec-raw');
      if (sec) sec.style.display = 'none';
      return;
    }
    const files = [
      ['saturation.json', b.info.has_saturation_json],
      ['coactivation.json', b.info.has_coactivation_json],
      ['token_counts.json', b.info.has_token_counts_json],
      ['expert_activation_norms.json', b.info.has_activation_norms_json],
    ];
    for (const [f, ok] of files) {
      if (!ok) continue;
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = `${b.path}/${f}`; a.textContent = f; a.target = '_blank';
      li.appendChild(a);
      ul.appendChild(li);
    }
  }

  // ---- Model tab (HF single model, cross-revision) ----------------------
  function modelB() {
    const agg = (activeTab.agg_prefix || '').replace(/\/$/, '');
    return {
      path: agg,
      info: {
        has_saturation_plot: !!activeTab.has_saturation,
        has_activation_norms_agg: !!activeTab.has_activation_agg,
        has_activation_max_over_median: !!activeTab.has_activation_maxmed,
        has_activation_grid: !!activeTab.has_activation_grid,
        activation_layers: activeTab.activation_layers || [],
        routing_layers: activeTab.routing_layers || [],
        has_routing_gif_agg: false,
      },
    };
  }

  function renderModelCoactivation(t) {
    const tabs = $('coact-tabs'), detail = $('coact-detail'), scroll = $('coact-scroll');
    tabs.innerHTML = ''; detail.innerHTML = ''; scroll.innerHTML = '';
    const sec = document.getElementById('sec-coactivation');
    const stale = sec.querySelector('.rev-select-wrap');
    if (stale) stale.remove();
    const layers = t.coactivation_layers || [];
    const revs = t.revisions || [];
    if (!layers.length || !revs.length) {
      tabs.innerHTML = '<span class="missing">No coactivation plots.</span>';
      return;
    }
    let curRev = revs[revs.length - 1];   // default: final revision
    let curLayer = layers[0];

    const wrap = document.createElement('div');
    wrap.className = 'rev-select-wrap';
    const lbl = document.createElement('label');
    lbl.className = 'rev-select-label';
    lbl.textContent = 'Revision ';
    const sel = document.createElement('select');
    sel.className = 'rev-select';
    revs.forEach(r => {
      const o = document.createElement('option');
      o.value = r; o.textContent = r;
      if (r === curRev) o.selected = true;
      sel.appendChild(o);
    });
    lbl.appendChild(sel); wrap.appendChild(lbl);
    sec.insertBefore(wrap, sec.querySelector('.sub'));

    const imgSrc = (L) => `${t.root_prefix}${curRev}/coactivation_layer_${L}.png`;
    const show = (L) => {
      curLayer = L;
      detail.innerHTML = '';
      const img = document.createElement('img');
      img.src = imgSrc(L); img.alt = `coactivation_layer_${L}`;
      detail.appendChild(img);
    };
    const rebuild = () => {
      buildLayerTabs(tabs, layers, show, curLayer);
      show(curLayer);
      scroll.innerHTML = '';
      layers.forEach(L => {
        const fig = document.createElement('figure');
        const img = document.createElement('img');
        img.src = imgSrc(L); img.loading = 'lazy';
        const cap = document.createElement('figcaption'); cap.textContent = `L${L}`;
        fig.appendChild(img); fig.appendChild(cap);
        scroll.appendChild(fig);
      });
    };
    sel.addEventListener('change', () => { curRev = sel.value; rebuild(); });
    rebuild();
  }

  function renderModelRaw(t) {
    const ul = $('raw-links');
    ul.innerHTML = '';
    const sec = document.getElementById('sec-raw');
    if (HIDE_RAW_JSON) { if (sec) sec.style.display = 'none'; return; }
    if (sec) sec.style.display = '';
    if (!t.has_saturation_json) {
      ul.innerHTML = '<li><span class="missing">No JSON.</span></li>';
      return;
    }
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `${t.agg_prefix}router_saturation.json`;
    a.textContent = 'router_saturation.json'; a.target = '_blank';
    li.appendChild(a); ul.appendChild(li);
  }

  function renderModelView() {
    const b = modelB();
    $('bucket-status').textContent =
      `${activeTab.label} · ${(activeTab.revisions || []).length} revisions`;
    renderSaturation(b);
    renderActivation(b);
    renderModelCoactivation(activeTab);
    renderRouting(b);
    renderModelRaw(activeTab);
  }

  // ---- Runs tab (our own live checkpoints, date-clustered selector) ---------
  function fillRunSelect(tab, prev) {
    selRun.innerHTML = '';
    const groups = new Map();  // date -> [run]; tab.runs is already newest-first
    for (const r of (tab.runs || [])) {
      if (!groups.has(r.date)) groups.set(r.date, []);
      groups.get(r.date).push(r);
    }
    for (const [date, rs] of groups) {
      const og = document.createElement('optgroup');
      og.label = date;
      for (const r of rs) {
        const opt = document.createElement('option');
        opt.value = r.id; opt.textContent = r.label;
        og.appendChild(opt);
      }
      selRun.appendChild(og);
    }
    if (prev && (tab.runs || []).some(r => r.id === prev)) selRun.value = prev;
    else if ((tab.runs || []).length) selRun.value = tab.runs[0].id;  // newest = default
  }

  function runB() {
    const runs = activeTab.runs || [];
    const r = runs.find(x => x.id === selRun.value) || runs[0];
    if (!r) return null;
    return { path: (r.path_prefix || '').replace(/\/$/, ''), info: r.info, run: r };
  }

  function renderRunsView() {
    const b = runB();
    const status = $('bucket-status');
    if (!b) { status.textContent = 'No runs'; return; }
    status.textContent = `${b.run.label} · ${b.run.date}`;
    renderSaturation(b);
    renderActivation(b);
    renderCoactivation(b);
    renderRouting(b);
    renderRaw(b);
  }

  function render() {
    if (activeTab.kind === 'runs') { renderRunsView(); return; }
    if (activeTab.kind === 'model') { renderModelView(); return; }
    const b = currentBucket();
    const status = $('bucket-status');
    if (!b) { status.textContent = 'No bucket'; return; }
    status.textContent = `bsz${b.bsz} / nexp_${b.nexp} / lr${b.lr} / ${activeTab.stage || STAGE}`;
    renderSaturation(b);
    renderActivation(b);
    renderCoactivation(b);
    renderRouting(b);
    renderRaw(b);
  }

  function countBuckets(tab) {
    if (tab.kind === 'model') return (tab.revisions || []).length;
    if (tab.kind === 'runs') return (tab.runs || []).length;
    return Object.values(tab.buckets).reduce(
      (n, ne) => n + Object.values(ne).reduce((m, lr) => m + Object.keys(lr).length, 0), 0);
  }

  function updateFooter() {
    const fs = document.getElementById('footer-stats');
    if (!fs) return;
    if (activeTab.kind === 'model') {
      fs.textContent = `${activeTab.label} · ${(activeTab.revisions || []).length} revisions · ${(activeTab.routing_layers || []).length} layers`;
      return;
    }
    if (activeTab.kind === 'runs') {
      const runs = activeTab.runs || [];
      const dates = new Set(runs.map(r => r.date));
      fs.textContent = `${activeTab.label} · ${runs.length} runs · ${dates.size} date(s)`;
      return;
    }
    const n = countBuckets(activeTab);
    fs.textContent = `${activeTab.label} · ${n} buckets · ${activeTab.bsz_values.length} bsz × ${activeTab.nexp_values.length} nexp × ${activeTab.lr_values.length} lr`;
  }

  const mainEl = document.querySelector('main');
  let _tabSwitchTimer = null;
  function applyTab(tab) {
    activeTab = tab;
    document.querySelectorAll('#tab-bar button').forEach(b => {
      b.classList.toggle('active', b.dataset.tabId === tab.id);
    });
    const badge = document.getElementById('brand-stage');
    if (badge) badge.textContent = tab.kind === 'model'
      ? (tab.stage_badge || 'model') : (tab.stage || STAGE);
    const sweepSel = document.getElementById('sweep-selectors');
    const runsSel = document.getElementById('runs-selector');
    if (tab.kind === 'model') {
      if (sweepSel) sweepSel.style.display = 'none';
      if (runsSel) runsSel.style.display = 'none';
      updateFooter();
      render();
      return;
    }
    if (tab.kind === 'runs') {
      if (sweepSel) sweepSel.style.display = 'none';
      if (runsSel) runsSel.style.display = '';
      fillRunSelect(tab, (tabSelections[tab.id] || {}).run);
      updateFooter();
      render();
      return;
    }
    if (sweepSel) sweepSel.style.display = '';
    if (runsSel) runsSel.style.display = 'none';
    const sel = tabSelections[tab.id];
    fillSelect(selBsz, tab.bsz_values, sel.bsz);
    if (sel.nexp) selNexp.value = sel.nexp;
    if (sel.lr) selLr.value = sel.lr;
    refreshNexp();
    updateFooter();
  }

  function activateTab(tab, opts) {
    if (tab === activeTab && !(opts && opts.force)) return;
    const animate = !!mainEl && !(opts && opts.immediate);
    if (!animate) { applyTab(tab); return; }
    if (_tabSwitchTimer) clearTimeout(_tabSwitchTimer);
    mainEl.classList.add('tab-switching');
    // Wait for the fade-out, swap content, then fade back in on next frame.
    _tabSwitchTimer = setTimeout(() => {
      applyTab(tab);
      requestAnimationFrame(() => {
        mainEl.classList.remove('tab-switching');
      });
    }, 180);
  }

  function buildTabBar() {
    const bar = $('tab-bar');
    if (!bar) return;
    bar.innerHTML = '';
    if (TABS.length <= 1) { bar.style.display = 'none'; return; }
    TABS.forEach(t => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.tabId = t.id;
      btn.setAttribute('role', 'tab');
      const count = countBuckets(t);
      btn.innerHTML = `${t.label}<span class="tab-count">${count}</span>`;
      btn.addEventListener('click', () => activateTab(t));
      bar.appendChild(btn);
    });
  }

  // ---- Lightbox (click any plot to zoom) ---------------------------------
  const lb = document.getElementById('lightbox');
  const lbImg = document.getElementById('lightbox-img');
  const lbCap = document.getElementById('lightbox-cap');
  function openLightbox(src, cap) {
    if (!lb) return;
    lbImg.src = src;
    lbCap.textContent = cap || '';
    lb.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeLightbox() {
    if (!lb || lb.hidden) return;
    lb.hidden = true;
    lbImg.src = '';
    document.body.style.overflow = '';
  }
  if (lb) {
    lb.addEventListener('click', closeLightbox);
    document.querySelector('main').addEventListener('click', (e) => {
      const img = e.target.closest('img');
      if (!img) return;
      openLightbox(img.currentSrc || img.src, img.alt);
    });
  }

  // ---- Section nav scroll-spy --------------------------------------------
  const navLinks = Array.from(document.querySelectorAll('#section-nav a'));
  if (HIDE_RAW_JSON) {
    const rawLink = navLinks.find(a => a.getAttribute('href') === '#sec-raw');
    if (rawLink) rawLink.style.display = 'none';
  }
  const spySections = navLinks
    .map(a => document.querySelector(a.getAttribute('href')))
    .filter(Boolean);
  if ('IntersectionObserver' in window && spySections.length) {
    const spy = new IntersectionObserver((entries) => {
      const vis = entries
        .filter(en => en.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!vis) return;
      navLinks.forEach(a =>
        a.classList.toggle('active', a.getAttribute('href') === '#' + vis.target.id));
    }, { rootMargin: '-15% 0px -55% 0px', threshold: [0, .25, .5] });
    spySections.forEach(s => spy.observe(s));
  }

  // ---- Keyboard shortcuts --------------------------------------------------
  // 1-5 jump to section, arrows step routing frames, space play/pause, t theme.
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    if (e.key === 'Escape') { closeLightbox(); return; }
    if (e.key === 't' || e.key === 'T') { if (themeBtn) themeBtn.click(); return; }
    if (e.key >= '1' && e.key <= '9') {
      const a = navLinks[+e.key - 1];
      if (a && a.style.display !== 'none') {
        const sec = document.querySelector(a.getAttribute('href'));
        if (sec && sec.style.display !== 'none') sec.scrollIntoView({ behavior: 'smooth' });
      }
      return;
    }
    const total = maxFrames();
    if (!total) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      pausePlayback();
      const d = e.key === 'ArrowLeft' ? -1 : 1;
      _master.frame = (_master.frame + d + total) % total;
      renderAllSlots();
    } else if (e.key === ' ') {
      e.preventDefault();
      if (_master.playing) pausePlayback(); else startPlayback();
    }
  });

  buildTabBar();
  selBsz.addEventListener('change', refreshNexp);
  selNexp.addEventListener('change', refreshLr);
  selLr.addEventListener('change', () => {
    tabSelections[activeTab.id] = { bsz: selBsz.value, nexp: selNexp.value, lr: selLr.value };
    render();
  });
  if (selRun) selRun.addEventListener('change', () => {
    tabSelections[activeTab.id] = Object.assign(
      {}, tabSelections[activeTab.id], { run: selRun.value });
    render();
  });
  activateTab(TABS[0], { immediate: true, force: true });
})();
