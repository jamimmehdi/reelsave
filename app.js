(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  const app = $('app');
  const el = {
    url: $('urlInput'), paste: $('pasteBtn'), get: $('getBtn'), err: $('errorMsg'), err2: $('errorMsg2'),
    tiles: $('tiles'), recentLbl: $('recentLbl'), clear: $('clearBtn'),
    thumb: $('thumb'), player: $('player'), playHint: $('playHint'), ok: $('okBadge'),
    ov: $('progressOv'), ring: $('ringFg'), pct: $('pct'), sizeTxt: $('sizeTxt'),
    ttl: $('ttl'), meta: $('meta'), tags: $('tags'), dl: $('dlBtn'), copy: $('copyBtn'), newBtn: $('newBtn'),
    sheet: $('sheet'), scrim: $('scrim'), api: $('apiInput'), test: $('testBtn'), saveCfg: $('saveCfgBtn'), testMsg: $('testMsg'),
    settings: $('settingsBtn'), theme: $('themeBtn'), toast: $('toast'),
  };

  const HOSTS = /(^|\.)(instagram\.com|facebook\.com|fb\.watch|fb\.com|instagr\.am)$/i;
  const RING_LEN = 301.6;

  let current = null;   // { url, info }
  let file = null;      // File ready for sharing
  let blobUrl = null;
  let abortCtl = null;

  // ---------- theme ----------
  function applyTheme(t) {
    const root = document.documentElement;
    if (t) root.setAttribute('data-theme', t); else root.removeAttribute('data-theme');
    const dark = (t || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')) === 'dark';
    el.theme.firstElementChild.className = 'ti ' + (dark ? 'ti-moon' : 'ti-sun');
    $('themeColor').setAttribute('content', dark ? '#09080d' : '#fbf7f2');
  }
  applyTheme(store.get('theme', null));
  el.theme.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') ||
      (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    const next = cur === 'dark' ? 'light' : 'dark';
    store.set('theme', next);
    applyTheme(next);
  });

  // ---------- helpers ----------
  let toastTimer;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2400);
  }
  function showError(msg) {
    [el.err, el.err2].forEach((e) => { e.textContent = msg || ''; e.hidden = !msg; });
  }
  function setState(s) { app.dataset.state = s; }
  function apiBase() { return (store.get('api', '') || window.REEL_API || '').trim().replace(/\/+$/, ''); }
  function fmtSize(b) { return b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }

  function extractUrl(text) {
    const matches = String(text || '').match(/https?:\/\/[^\s"'<>]+/g) || [];
    for (const m of matches) {
      try {
        const u = new URL(m.replace(/[)\].,]+$/, ''));
        if (HOSTS.test(u.hostname)) return u.href;
      } catch {}
    }
    return null;
  }

  function setBusy(btn, busy, label) {
    btn.classList.toggle('busy', busy);
    btn.disabled = busy;
    const i = btn.querySelector('i');
    if (busy) { btn.dataset.icon = i.className; i.className = 'ti ti-loader-2'; }
    else if (btn.dataset.icon) i.className = btn.dataset.icon;
    if (label) btn.querySelector('span').textContent = label;
  }

  // ---------- history ----------
  function history() { return store.get('history', []); }
  function pushHistory(entry) {
    const list = history().filter((h) => h.url !== entry.url);
    list.unshift(entry);
    store.set('history', list.slice(0, 12));
    renderHistory();
  }
  function renderHistory() {
    const list = history();
    el.tiles.textContent = '';
    el.recentLbl.hidden = !list.length;
    const grads = ['linear-gradient(160deg,#ff9a3c,#c2185b)', 'linear-gradient(160deg,#22d3b6,#2563eb)', 'linear-gradient(160deg,#a78bfa,#be185d)'];
    list.forEach((h, i) => {
      const b = document.createElement('button');
      b.className = 'tile';
      b.type = 'button';
      b.style.backgroundImage = h.thumb ? `url("${h.thumb.replace(/"/g, '%22')}"), ${grads[i % 3]}` : grads[i % 3];
      const s = document.createElement('span');
      s.textContent = h.title || 'Reel';
      b.appendChild(s);
      b.addEventListener('click', () => { el.url.value = h.url; fetchInfo(); });
      el.tiles.appendChild(b);
    });
  }
  el.clear.addEventListener('click', () => { store.set('history', []); renderHistory(); });

  // ---------- fetch info ----------
  async function fetchInfo() {
    showError('');
    const url = extractUrl(el.url.value);
    if (!url) { showError('Paste an Instagram or Facebook reel link.'); return; }
    if (!apiBase()) { openSheet(); toast('Add your backend URL first'); return; }

    resetResult();
    setBusy(el.get, true, 'Fetching…');
    try {
      const res = await fetch(`${apiBase()}/api/info?url=${encodeURIComponent(url)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'Couldn’t fetch that reel. Is it public?');
      current = { url, info: data };
      showResult();
      pushHistory({ url, title: data.title, thumb: data.thumbnail, ts: Date.now() });
    } catch (e) {
      showError(e.message === 'Failed to fetch' ? 'Can’t reach your backend. Check the URL in settings.' : e.message);
    } finally {
      setBusy(el.get, false, 'Get video');
    }
  }

  function resetResult() {
    if (abortCtl) abortCtl.abort();
    abortCtl = null;
    file = null;
    if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
    el.player.pause();
    el.player.removeAttribute('src');
    el.player.hidden = true;
    el.thumb.hidden = false;
    el.playHint.hidden = false;
    el.ok.hidden = true;
    el.ov.hidden = true;
  }

  function showResult() {
    const i = current.info;
    el.thumb.removeAttribute('src');
    if (i.thumbnail) el.thumb.src = i.thumbnail;
    el.ttl.textContent = i.title || 'Reel';
    const who = [i.author ? '@' + i.author.replace(/^@/, '') : null, i.source === 'instagram' ? 'Instagram' : 'Facebook'].filter(Boolean);
    el.meta.textContent = who.join(' · ');
    el.tags.textContent = '';
    ['MP4'].forEach((t) => { const s = document.createElement('span'); s.className = 'tag'; s.textContent = t; el.tags.appendChild(s); });
    el.dl.querySelector('i').className = 'ti ti-download';
    el.dl.dataset.icon = '';
    el.dl.querySelector('span').textContent = 'Download';
    el.dl.dataset.mode = 'download';
    showError('');
    setState('result');
  }

  // ---------- download ----------
  function setProgress(p) {
    el.ring.style.strokeDashoffset = String(RING_LEN * (1 - p));
    el.pct.textContent = Math.round(p * 100) + '%';
  }

  async function download() {
    const info = current.info;
    showError('');
    abortCtl = new AbortController();
    setState('saving');
    el.ov.hidden = false;
    el.playHint.hidden = true;
    setProgress(0);
    el.sizeTxt.textContent = 'Starting…';
    setBusy(el.dl, true, 'Downloading…');

    try {
      const name = (info.title || 'reel').replace(/[^\w\- ]+/g, '').trim().slice(0, 40).replace(/\s+/g, '-') || 'reel';
      const res = await fetch(`${apiBase()}/api/dl?u=${encodeURIComponent(info.videoUrl)}&n=${encodeURIComponent(name)}`, { signal: abortCtl.signal });
      if (!res.ok) throw new Error('Download failed. Try again.');
      const total = Number(res.headers.get('content-length')) || 0;
      const chunks = [];
      let got = 0;
      if (res.body && res.body.getReader) {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          got += value.length;
          if (total) setProgress(got / total);
          el.sizeTxt.textContent = total ? `${fmtSize(got)} / ${fmtSize(total)}` : fmtSize(got);
        }
      } else {
        const buf = new Uint8Array(await res.arrayBuffer());
        chunks.push(buf); got = buf.length;
      }
      if (!got) throw new Error('Got an empty file. Try again.');
      setProgress(1);
      const blob = new Blob(chunks, { type: 'video/mp4' });
      file = new File([blob], name + '.mp4', { type: 'video/mp4' });
      blobUrl = URL.createObjectURL(blob);

      el.ov.hidden = true;
      el.ok.hidden = false;
      el.player.src = blobUrl;
      el.player.poster = info.thumbnail || '';
      el.player.hidden = false;
      el.thumb.hidden = true;
      el.tags.textContent = '';
      ['MP4', fmtSize(got)].forEach((t) => { const s = document.createElement('span'); s.className = 'tag'; s.textContent = t; el.tags.appendChild(s); });

      setBusy(el.dl, false);
      el.dl.querySelector('i').className = 'ti ti-photo-down';
      el.dl.dataset.icon = 'ti ti-photo-down';
      el.dl.querySelector('span').textContent = canShareFiles() ? 'Save to Photos' : 'Save video';
      el.dl.dataset.mode = 'save';
      setState('ready');
    } catch (e) {
      el.ov.hidden = true;
      el.playHint.hidden = false;
      setBusy(el.dl, false, 'Download');
      el.dl.querySelector('i').className = 'ti ti-download';
      setState('result');
      if (e.name !== 'AbortError') showError(e.message === 'Failed to fetch' ? 'Download was blocked. Try again.' : e.message);
    }
  }

  function canShareFiles() {
    try { return !!(navigator.canShare && file && navigator.canShare({ files: [file] })); } catch { return false; }
  }

  async function save() {
    if (!file) return;
    if (canShareFiles()) {
      try {
        await navigator.share({ files: [file] });
        toast('Done');
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('Saved to Downloads');
  }

  el.dl.addEventListener('click', () => (el.dl.dataset.mode === 'save' ? save() : download()));

  // ---------- misc actions ----------
  el.get.addEventListener('click', fetchInfo);
  el.url.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.url.blur(); fetchInfo(); } });
  el.paste.addEventListener('click', async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (!t) { toast('Clipboard is empty'); return; }
      el.url.value = t.trim();
      if (extractUrl(t)) fetchInfo(); else showError('That doesn’t look like a reel link.');
    } catch {
      el.url.focus();
      toast('Long-press the field and tap Paste');
    }
  });
  el.copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(current.url); toast('Link copied'); } catch { toast('Couldn’t copy'); }
  });
  el.newBtn.addEventListener('click', () => {
    resetResult();
    current = null;
    el.url.value = '';
    showError('');
    setState('home');
  });
  el.playHint.addEventListener('click', () => {
    if (!current || !current.info.videoUrl) return;
    el.player.src = current.info.videoUrl;
    el.player.hidden = false;
    el.thumb.hidden = true;
    el.playHint.hidden = true;
    el.player.play().catch(() => {});
  });

  // ---------- settings ----------
  function openSheet() { el.api.value = store.get('api', '') || window.REEL_API || ''; el.testMsg.textContent = ''; el.sheet.hidden = false; }
  function closeSheet() { el.sheet.hidden = true; }
  el.settings.addEventListener('click', openSheet);
  el.scrim.addEventListener('click', closeSheet);
  el.saveCfg.addEventListener('click', () => {
    store.set('api', el.api.value.trim().replace(/\/+$/, ''));
    closeSheet();
    toast('Saved');
  });
  el.test.addEventListener('click', async () => {
    const base = el.api.value.trim().replace(/\/+$/, '');
    if (!base) { el.testMsg.textContent = 'Enter a URL first.'; return; }
    el.testMsg.textContent = 'Testing…';
    try {
      const r = await fetch(base + '/api/health');
      const d = await r.json();
      el.testMsg.textContent = d.ok ? 'Connected ✓' : 'Reached the server, but it didn’t look right.';
    } catch { el.testMsg.textContent = 'Couldn’t reach that URL.'; }
  });

  // ---------- boot ----------
  renderHistory();

  const q = new URLSearchParams(location.search);
  const shared = extractUrl([q.get('url'), q.get('text'), q.get('title')].filter(Boolean).join(' '));
  if (q.has('url') || q.has('text') || q.has('u')) {
    const incoming = shared || extractUrl(q.get('u'));
    history.replaceState(null, '', location.pathname);
    if (incoming) { el.url.value = incoming; fetchInfo(); }
  }

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
