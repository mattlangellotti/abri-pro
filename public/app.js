/* Abri Pro marketing hub front end. Plain JS, no build step. */
(() => {
  'use strict';

  const TZ = 'America/New_York';
  const RANK = { overview: 1, team: 2, full: 3, admin: 4 };
  const DIV_NAMES = { install: 'Installation', service: 'Service', commercial: 'Commercial' };
  // Filled from the hub's own account list after each load.
  let ACCT_NAMES = {};
  let ACCT_SHORT = {};
  const ROLE_NAMES = { admin: 'Marketing lead', full: 'Owner', team: 'Office staff', overview: 'Field tech' };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const TABS = [
    ['home', 'Home', 1], ['roadmap', 'Roadmap', 1], ['campaigns', 'Campaigns', 2], ['ideas', 'Ideas', 1],
    ['social', 'Social', 2], ['content', 'Content', 2], ['numbers', 'Monthly numbers', 2], ['files', 'Files', 2], ['people', 'People and settings', 4]
  ];

  const S = {
    data: null, tab: 'home', viewAs: null, division: 'all', campFilter: 'all', weekOffset: 0,
    numbersMonth: null, menu: false, animate: true, draftImage: null, composeAccts: null
  };

  // ---------- helpers ----------
  const $app = document.getElementById('app');
  const $overlay = document.getElementById('overlay');
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const money = (n) => '$' + fmt(Math.round(n || 0));
  const compact = (n) => (n >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? '$' + Math.round(n / 1e3) + 'K' : money(n));
  const pctChange = (c, p) => (p > 0 ? Math.round(((c - p) / p) * 100) : null);
  const signed = (v) => (v == null ? '' : (v >= 0 ? '+' : '−') + Math.abs(v) + '%');
  const level = () => (S.data.me.level === 'admin' && S.viewAs ? S.viewAs : S.data.me.level);
  const can = (lv) => RANK[level()] >= RANK[lv];
  const isAdmin = () => S.data.me.level === 'admin' && level() === 'admin';
  const person = (id) => (S.data.people || []).find((p) => p.id === id);
  const personName = (id) => (person(id) || {}).name || 'Someone';

  function etParts(d = new Date()) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' })
      .formatToParts(d).map((x) => [x.type, x.value]));
    return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, wd: p.weekday };
  }
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const todayStr = () => { const p = etParts(); return ymd(p.y, p.m, p.d); };
  const thisMonth = () => todayStr().slice(0, 7);
  const dnum = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) / 864e5; };
  const fromDnum = (n) => { const d = new Date(n * 864e5); return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); };
  const addMonths = (mk, k) => { let [y, m] = mk.split('-').map(Number); m += k; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return `${y}-${pad(m)}`; };
  const monthLabel = (mk, long) => { const [y, m] = mk.split('-').map(Number); return (long ? MONTHS_LONG : MONTHS)[m - 1] + (long ? ' ' + y : ''); };
  const shortDate = (s) => { if (!s) return ''; const [, m, d] = s.split('-').map(Number); return `${MONTHS[m - 1]} ${d}`; };
  const isoToEtDate = (iso) => { const p = etParts(new Date(iso)); return ymd(p.y, p.m, p.d); };
  const isoToEtTime = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  const isoToEtHM = (iso) => { const p = etParts(new Date(iso)); return `${pad(p.h)}:${pad(p.mi)}`; };
  function etToIso(dateStr, timeStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const [h, mi] = (timeStr || '09:00').split(':').map(Number);
    let guess = Date.UTC(y, m - 1, d, h, mi);
    for (let i = 0; i < 2; i++) {
      const p = etParts(new Date(guess));
      const diff = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - Date.UTC(y, m - 1, d, h, mi);
      guess -= diff;
    }
    return new Date(guess).toISOString();
  }
  function dayRange(start, end) {
    if (!start || !end) return '';
    if (start.slice(0, 4) !== end.slice(0, 4)) return `${shortDate(start)}, ${start.slice(0, 4)} to ${shortDate(end)}, ${end.slice(0, 4)}`;
    return `${shortDate(start)} to ${shortDate(end)}, ${end.slice(0, 4)}`;
  }

  async function call(method, url, body, isForm) {
    const opts = { method, headers: { 'X-Hub': '1' }, credentials: 'same-origin' };
    if (body && !isForm) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    if (isForm) opts.body = body;
    const res = await fetch(url, opts);
    if (res.status === 401) { location.reload(); throw new Error('Signed out'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  }
  async function load() {
    S.data = await call('GET', '/api/bootstrap');
    const list = S.data.accounts || [];
    ACCT_NAMES = Object.fromEntries(list.map((a) => [a.id, a.name]));
    ACCT_SHORT = Object.fromEntries(list.map((a) => [a.id, a.short || a.name]));
    if (!S.composeAccts) S.composeAccts = list.map((a) => a.id);
    else S.composeAccts = S.composeAccts.filter((k) => ACCT_NAMES[k]);
    applyBrand();
  }

  // Brand colors and name. In the demo, the brand form previews in this browser only.
  const demoPreview = () => { try { return JSON.parse(localStorage.getItem('abri-demo-brand') || 'null'); } catch (_) { return null; } };
  function brand() {
    const b = { ...S.data.brand };
    if (S.data.demo) { const p = demoPreview(); if (p) Object.assign(b, p); }
    return b;
  }
  function applyBrand() {
    const b = brand();
    const r = document.documentElement.style;
    r.setProperty('--navy', b.primary);
    r.setProperty('--red', b.accent);
    document.title = `${b.name} · Marketing Hub`;
  }
  async function act(fn, okMsg) {
    try {
      await fn();
      await load();
      S.animate = false;
      render();
      if (okMsg) toast(okMsg);
    } catch (e) { toast(e.message); }
  }

  let toastTimer;
  function toast(msg) {
    clearTimeout(toastTimer);
    let el = document.getElementById('toast');
    if (el) el.remove();
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4CD964" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg><span>${esc(msg)}</span>`;
    document.body.appendChild(el);
    toastTimer = setTimeout(() => el.remove(), 2800);
  }

  // Phone photos are big (and sometimes HEIC). Convert to a JPEG under ~2000px before upload.
  async function prepareImage(file) {
    if (!file || !/^image\//.test(file.type || '') || /gif|svg/.test(file.type)) return file;
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
      const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
      if (bmp.close) bmp.close();
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
      if (!blob) return file;
      if (blob.size >= file.size && /jpe?g|png|webp/.test(file.type)) return file;
      const base = (file.name || 'photo').replace(/\.[^.]+$/, '');
      return new File([blob], base + '.jpg', { type: 'image/jpeg' });
    } catch (_) {
      return file;
    }
  }

  // Large files go up as a raw body so the server can stream them to storage, with a progress toast.
  function uploadBig(file, params) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', '/api/files/upload?' + params.toString());
      xhr.setRequestHeader('X-Hub', '1');
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      let last = -1;
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const pct = Math.floor((e.loaded / e.total) * 100);
        if (pct !== last && pct % 5 === 0) { last = pct; showProgress(pct); }
      };
      xhr.onload = () => {
        hideProgress();
        let data = {};
        try { data = JSON.parse(xhr.responseText || '{}'); } catch (_) { /* ignore */ }
        if (xhr.status === 401) { location.reload(); return reject(new Error('Signed out')); }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.error || 'Upload failed'));
      };
      xhr.onerror = () => { hideProgress(); reject(new Error('Upload failed. Check your connection and try again.')); };
      showProgress(0);
      xhr.send(file);
    });
  }
  function showProgress(pct) {
    let el = document.getElementById('upload-progress');
    if (!el) {
      el = document.createElement('div');
      el.id = 'upload-progress';
      el.className = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.innerHTML = `<span>Uploading ${pct}%</span><span class="progress-track"><span class="progress-fill" style="width:${pct}%"></span></span>`;
  }
  const hideProgress = () => { const el = document.getElementById('upload-progress'); if (el) el.remove(); };

  // ---------- data shaping ----------
  const enabledDivs = () => ['install'].concat(S.data.settings.service ? ['service'] : []).concat(S.data.settings.commercial ? ['commercial'] : []);
  const divKeys = () => { const en = enabledDivs(); return S.division === 'all' || !en.includes(S.division) ? en : [S.division]; };
  function monthTotals(mk, keys = divKeys()) {
    const rows = S.data.monthly.filter((r) => r.month === mk && keys.includes(r.division));
    if (!rows.length) return null;
    return rows.reduce((a, r) => ({ leads: a.leads + r.leads, jobs: a.jobs + r.jobs, revenue: a.revenue + r.revenue }), { leads: 0, jobs: 0, revenue: 0 });
  }
  const latestMonth = () => {
    const cur = thisMonth();
    const ms = [...new Set(S.data.monthly.map((r) => r.month))].filter((m) => m <= cur).sort();
    return ms[ms.length - 1] || null;
  };
  const spendFor = (mk) => { const r = S.data.spend.find((x) => x.month === mk); return r ? r.spend : null; };
  function responses(c) {
    const rows = S.data.campaignMonths.filter((r) => r.campaign_id === c.id);
    const t = rows.reduce((a, r) => ({ scans: a.scans + r.scans, forms: a.forms + r.forms, mentions: a.mentions + r.mentions }), { scans: 0, forms: 0, mentions: 0 });
    t.total = t.scans + t.forms + t.mentions;
    return t;
  }
  function lift(c) {
    if (!c.start_date) return null;
    const startM = c.start_date.slice(0, 7);
    const endM = [c.end_date ? c.end_date.slice(0, 7) : startM, latestMonth() || startM].sort()[0];
    if (endM < startM) return null;
    let cur = 0, prev = 0;
    for (let m = startM; m <= endM; m = addMonths(m, 1)) {
      const a = monthTotals(m, enabledDivs()), b = monthTotals(addMonths(m, -12), enabledDivs());
      if (!a || !b) return null;
      cur += a.leads; prev += b.leads;
    }
    return pctChange(cur, prev);
  }
  function campaignState(c) {
    const t = todayStr();
    const total = c.start_date && c.end_date ? Math.max(1, dnum(c.end_date) - dnum(c.start_date) + 1) : 0;
    const elapsed = total ? Math.min(total, Math.max(0, dnum(t) - dnum(c.start_date) + 1)) : 0;
    const left = c.end_date ? dnum(c.end_date) - dnum(t) : null;
    return { pct: total ? Math.round((elapsed / total) * 100) : 0, left };
  }
  const statusPill = (s) => ({ live: ['Live', 'p-live'], ready: ['Ready', 'p-ready'], planned: ['Planned', 'p-planned'], done: ['Finished', 'p-done'] }[s] || ['Planned', 'p-planned']);
  const verdictPill = (v) => ({ worked: ['Worked', 'p-worked'], mixed: ['Mixed', 'p-mixed'], flopped: ['Flopped', 'p-flopped'] }[v]);
  const postPill = (s) => ({ scheduled: ['Scheduled', 'p-sched'], published: ['Published', 'p-pub'], failed: ['Failed', 'p-fail'], submitted: ['Submitted', 'p-sub'], draft: ['Draft', 'p-draft'], rejected: ['Rejected', 'p-fail'] }[s] || ['Scheduled', 'p-sched']);
  const contentPill = (s) => ({ draft: ['Draft', 'p-draft'], approved: ['Approved', 'p-sched'], published: ['Published', 'p-pub'], rejected: ['Rejected', 'p-fail'] }[s] || ['Draft', 'p-draft']);
  const visiblePosts = () => S.data.posts.filter((p) => p.status !== 'rejected');
  const isAgency = (x) => x.origin && x.origin !== 'person';
  const draftsWaiting = () => (S.data.content || []).filter((c) => c.status === 'draft').length + S.data.posts.filter((p) => p.status === 'draft' && isAgency(p)).length;

  // Small, safe Markdown renderer for draft previews (escapes everything first).
  function md(src) {
    const lines = String(src || '').replace(/\r/g, '').split('\n');
    const inline = (t) => esc(t)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, a, h) => `<a href="${h.replace(/"/g, '%22')}" target="_blank" rel="noopener nofollow">${a}</a>`);
    let html = '', list = null, para = [];
    const flushPara = () => { if (para.length) { html += `<p>${inline(para.join(' '))}</p>`; para = []; } };
    const flushList = () => { if (list) { html += `<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`; list = null; } };
    for (const raw of lines) {
      const line = raw.trimEnd();
      let m;
      if (!line.trim()) { flushPara(); flushList(); continue; }
      if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) { flushPara(); flushList(); const n = Math.min(4, m[1].length + 1); html += `<h${n}>${inline(m[2])}</h${n}>`; continue; }
      if ((m = /^\s*[-*]\s+(.*)$/.exec(line))) { flushPara(); if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; } list.items.push(m[1]); continue; }
      if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) { flushPara(); if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; } list.items.push(m[1]); continue; }
      flushList();
      para.push(line.trim());
    }
    flushPara(); flushList();
    return html;
  }
  const postImg = (p) => (p.image_url ? p.image_url : p.file_id ? `/api/files/${encodeURIComponent(p.file_id)}/raw` : null);
  const acctList = (a) => { const n = Object.keys(ACCT_NAMES).length; return n > 1 && a.length === n ? 'All accounts' : a.map((k) => ACCT_SHORT[k] || k).join(', '); };

  // ---------- icons ----------
  const ICON = {
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
    roadmap: '<path d="M4 6h10"/><path d="M8 12h12"/><path d="M4 18h8"/>',
    campaigns: '<path d="M3 11v2a1 1 0 001 1h2l5 4V6L6 10H4a1 1 0 00-1 1z"/><path d="M16 9a4 4 0 010 6"/><path d="M19 6a8 8 0 010 12"/>',
    ideas: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 00-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0012 3z"/>',
    social: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18"/><path d="M8 3v4"/><path d="M16 3v4"/>',
    numbers: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
    files: '<path d="M4 7a2 2 0 012-2h4l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2z"/>',
    content: '<path d="M4 20h4L19 9a2.8 2.8 0 00-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
    people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0113 0"/><path d="M16 4.5a3.5 3.5 0 010 7"/><path d="M18 14a6.5 6.5 0 013.5 6"/>'
  };
  const icon = (k, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;
  const docIcon = '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" style="stroke:var(--navy)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/></svg>';

  // ---------- shell ----------
  function render() {
    const d = S.data;
    applyBrand();
    const allowedTabs = TABS.filter((t) => RANK[level()] >= t[2]);
    if (!allowedTabs.some((t) => t[0] === S.tab)) S.tab = 'home';
    const views = [['admin', 'You'], ['full', 'Full'], ['team', 'Team'], ['overview', 'Overview']];
    document.body.classList.toggle('still', !S.animate);
    const b = brand();
    $app.innerHTML = `
      ${d.demo ? `<div class="demo-bar"><span>Demo: you're the <b>${esc(ROLE_NAMES[d.me.level] || 'Visitor')}</b><span class="dm-long">, ${esc(d.me.name)}. Changes reset every night.</span></span><button data-act="signout">Switch seat</button></div>` : ''}
      <header class="topbar">
        ${b.logo ? `<img class="logo" src="${esc(b.logo)}" alt="${esc(b.name)}">` : `<div class="brand-name">${esc(b.name)}</div>`}
        <div class="divider"></div>
        <div class="title">Marketing Hub</div>
        ${d.hasSample && !d.demo ? '<span class="pill p-planned">Sample data</span>' : ''}
        <div class="spacer"></div>
        ${d.me.level === 'admin' ? `<div style="display:flex;align-items:center;gap:8px"><span class="muted xs viewas-label" style="font-weight:600">Viewing as</span>
          <div class="seg" role="group" aria-label="Preview the dashboard as">${views.map((v) => `<button class="segbtn${(S.viewAs || 'admin') === v[0] ? ' on' : ''}" data-act="view" data-v="${v[0]}">${v[1]}</button>`).join('')}</div></div>` : ''}
        <button class="avatar" data-act="menu" aria-label="Account menu for ${esc(d.me.name)}">${esc(d.me.initials)}</button>
      </header>
      ${S.menu ? `<div class="menu"><div class="who"><div style="font-weight:700">${esc(d.me.name)}</div>${d.me.email ? `<div class="muted xs">${esc(d.me.email)}</div>` : ''}</div><button data-act="account">Email and password</button><button data-act="signout">Sign out</button></div>` : ''}
      <div class="layout">
        <nav class="side" aria-label="Sections">
          <div class="navcol">${allowedTabs.map((t) => `<button class="navbtn${S.tab === t[0] ? ' on' : ''}" data-act="tab" data-tab="${t[0]}"${S.tab === t[0] ? ' aria-current="page"' : ''}>${icon(t[0])}${t[1]}</button>`).join('')}</div>
          <div class="side-card"><div class="eyebrow">Accounts</div>
            ${Object.keys(ACCT_NAMES).map((k) => `<div class="acct-line"><span class="sdot grey"></span>${ACCT_NAMES[k]}</div>`).join('')}
            <div class="muted xs" style="margin-top:10px">Auto-publishing connects in the next phase.</div>
          </div>
        </nav>
        <main class="main" id="main">${page()}</main>
      </div>`;
    if (S.tab === 'home' && S.animate) countUp();
    const on = $app.querySelector('.navbtn.on');
    if (on && window.innerWidth <= 760) on.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  function page() {
    switch (S.tab) {
      case 'roadmap': return roadmapPage();
      case 'campaigns': return campaignsPage();
      case 'ideas': return ideasPage();
      case 'social': return socialPage();
      case 'numbers': return numbersPage();
      case 'files': return filesPage();
      case 'content': return contentPage();
      case 'people': return peoplePage();
      default: return homePage();
    }
  }

  function countUp() {
    const els = [...$app.querySelectorAll('[data-count]')];
    if (!els.length || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / 1200);
      const e = 1 - Math.pow(1 - p, 3);
      els.forEach((el) => {
        const v = Number(el.dataset.count) * e;
        el.textContent = el.dataset.fmt === 'compact' ? compact(v) : el.dataset.fmt === 'money' ? money(v) : el.dataset.fmt === 'pct' ? Math.round(v) + '%' : fmt(Math.round(v));
      });
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  const counter = (v, f) => {
    const txt = f === 'compact' ? compact(v) : f === 'money' ? money(v) : f === 'pct' ? Math.round(v) + '%' : fmt(v);
    return `<span data-count="${v}" data-fmt="${f || ''}">${txt}</span>`;
  };

  // ---------- home ----------
  function homePage() {
    const d = S.data;
    const now = etParts();
    const greet = now.h < 12 ? 'Good morning.' : now.h < 17 ? 'Good afternoon.' : 'Good evening.';
    const dateLine = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
    const live = d.campaigns.filter((c) => c.status === 'live');
    const t = todayStr();
    const soon = d.campaigns.filter((c) => (c.status === 'planned' || c.status === 'ready') && c.start_date && c.start_date >= t && dnum(c.start_date) - dnum(t) <= 30);
    const lm = latestMonth();
    const cur = lm && monthTotals(lm), prev = lm && monthTotals(addMonths(lm, -12));
    const parts = [];
    parts.push(live.length === 1 ? 'One campaign is live' : `${live.length ? live.length : 'No'} campaigns are live`);
    parts.push(soon.length ? `${soon.length} ${soon.length === 1 ? 'launches' : 'launch'} in the next 30 days` : 'nothing launches in the next 30 days');
    let summary = parts.join(', ');
    if (cur && prev) summary += `, and ${monthLabel(lm, true).split(' ')[0]} is ${cur.leads >= prev.leads ? 'ahead of' : 'behind'} last year`;
    summary += '.';

    const en = enabledDivs();
    const divTabs = [['all', 'All']].concat(en.map((k) => [k, DIV_NAMES[k]]));
    const division = S.division === 'all' || en.includes(S.division) ? S.division : 'all';

    let kpis = '';
    if (cur) {
      const k = (label, v, p, f, cls) => {
        const ch = pctChange(v, p);
        return `<div class="card lift rise ${cls} pad"><div class="eyebrow">${label}</div><div class="kpi-val num">${counter(v, f)}</div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:13px">${ch != null ? `<span class="pill ${ch >= 0 ? 'p-up' : 'p-down'}">${signed(ch)}</span><span class="muted">${f === 'compact' ? compact(p) : fmt(p)} last ${MONTHS_LONG[+lm.slice(5) - 1]}</span>` : '<span class="muted">No figure for last year</span>'}</div></div>`;
      };
      kpis = k(`Leads in ${MONTHS_LONG[+lm.slice(5) - 1]}`, cur.leads, prev ? prev.leads : 0, '', 'd1') + k('Booked jobs', cur.jobs, prev ? prev.jobs : 0, '', 'd2') + k('Revenue', cur.revenue, prev ? prev.revenue : 0, 'compact', 'd3');
    } else {
      kpis = `<div class="card pad rise d1 span2"><div class="h2">No monthly numbers yet</div><p class="muted" style="margin:8px 0 14px">Leads, booked jobs and revenue show here once the first month is entered.</p>${can('full') ? '<button class="btn btn-navy btn-sm" data-act="tab" data-tab="numbers">Enter numbers</button>' : ''}</div>`;
    }
    const year = t.slice(0, 4);
    const ytd = d.spend.filter((r) => r.month.startsWith(year)).reduce((a, r) => a + r.spend, 0);
    const budget = d.settings.budget || 0;
    const pct = budget ? Math.min(100, Math.round((ytd / budget) * 100)) : 0;
    const C = 276.5;
    const donut = `<div class="card lift rise d4 pad" style="display:flex;align-items:center;gap:18px">
      <svg width="104" height="104" viewBox="0 0 104 104" role="img" aria-label="${pct} percent of the ${year} budget spent">
        <circle cx="52" cy="52" r="44" fill="none" stroke="#F0F0F2" stroke-width="12"/>
        <circle class="ring" cx="52" cy="52" r="44" fill="none" style="stroke:var(--navy)" stroke-width="12" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${(C * (1 - pct / 100)).toFixed(1)}" transform="rotate(-90 52 52)"/>
        <text x="52" y="58" text-anchor="middle" font-size="20" font-weight="700" fill="#1D1D1F">${pct}%</text></svg>
      <div><div class="eyebrow">Spend ${year}</div><div class="num" style="font-size:26px;font-weight:700;letter-spacing:-0.02em;margin-top:6px">${counter(ytd, 'money')}</div>
      <div class="muted small" style="margin-top:4px">${budget ? 'of ' + money(budget) + ' budget' : 'No budget set'}</div></div></div>`;

    // leaders
    const ranked = d.campaigns.map((c) => ({ c, r: responses(c) })).filter((x) => x.r.total > 0 && x.c.spend > 0 && x.c.status !== 'planned')
      .map((x) => ({ ...x, cpr: x.c.spend / x.r.total })).sort((a, b) => a.cpr - b.cpr).slice(0, 5);
    const maxCpr = Math.max(1, ...ranked.map((x) => x.cpr));
    const untracked = d.campaigns.filter((c) => c.status === 'done' && !c.trackable);
    const leaders = ranked.length ? ranked.map((x, i) => `<div><div style="display:flex;justify-content:space-between;font-size:14px;font-weight:600;margin-bottom:6px;gap:8px"><span>${i + 1}. ${esc(x.c.name)}</span><span class="num">${x.cpr < 10 ? '$' + x.cpr.toFixed(2) : money(x.cpr)}</span></div>
      <div class="bar-track" style="height:10px;background:#F5F5F7"><div class="bar" style="width:${Math.max(3, Math.round((x.cpr / maxCpr) * 100))}%;background:${i === 0 ? 'var(--navy)' : x.c.status === 'live' ? 'var(--red)' : x.cpr === maxCpr && ranked.length > 2 ? '#A1A1A6' : 'var(--navy)'}"></div></div></div>`).join('')
      : '<div class="empty">Rankings appear once campaigns have spend and responses.</div>';

    // posts this week
    const wk = weekDays(0);
    const weekPosts = visiblePosts().filter((p) => { const ds = isoToEtDate(p.scheduled_at); return ds >= wk[0] && ds <= wk[6]; }).slice(0, 3);

    return `<div class="stack">
      <div class="head rise d1"><div><div class="eyebrow">${esc(dateLine)}</div><h1 class="h1">${greet}</h1><p class="lede">${esc(summary)}</p></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn btn-ghost" data-act="tab" data-tab="ideas">Add an idea</button>${can('team') ? `<button class="btn btn-red" data-act="tab" data-tab="social">${can('full') ? 'Schedule a post' : 'Submit a post'}</button>` : ''}</div></div>
      ${can('full') && draftsWaiting() ? `<button class="banner info rise d2 drafts-banner" data-act="tab" data-tab="${(S.data.content || []).some((c) => c.status === 'draft') ? 'content' : 'social'}"><span class="dot pulse" style="background:var(--navy)"></span>${draftsWaiting()} ${draftsWaiting() === 1 ? 'draft from Agency is' : 'drafts from Agency are'} waiting for review<span style="margin-left:auto">Review \u203A</span></button>` : ''}
      ${en.length > 1 ? `<div class="rise d2" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:-12px">
        <div class="seg" role="group" aria-label="Division">${divTabs.map((x) => `<button class="segbtn${division === x[0] ? ' on' : ''}" data-act="division" data-v="${x[0]}">${x[1]}</button>`).join('')}</div>
        <span class="muted small">${division === 'all' ? en.map((k) => DIV_NAMES[k]).join(' + ') : DIV_NAMES[division] + ' only'}</span></div>` : ''}
      <div class="grid-auto" style="--min:210px">${kpis}${donut}</div>
      <div class="grid-auto">
        <div class="card rise d3 pad span2">${leadsChart()}</div>
        <div class="card rise d4 pad">
          <h2 class="h2">Live now</h2>
          <div style="display:flex;flex-direction:column;gap:18px;margin-top:18px">${live.length ? live.map((c) => { const st = campaignState(c); return `<div>
            <div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><div style="display:flex;align-items:center;gap:8px;font-weight:600;font-size:15px"><span class="dot pulse"></span>${esc(c.name)}</div>
            <span class="muted small" style="font-weight:600;white-space:nowrap">${st.left == null ? 'Ongoing' : st.left > 0 ? st.left + ' days left' : st.left === 0 ? 'Ends today' : 'Ended'}</span></div>
            <div class="muted small" style="margin:4px 0 10px 16px">${esc([c.audience, c.code ? 'Code ' + c.code : ''].filter(Boolean).join('. '))}</div>
            <div class="bar-track" style="margin-left:16px"><div class="bar" style="width:${st.pct}%;background:var(--red)"></div></div></div>`; }).join('') : '<div class="empty">No campaigns are live right now.</div>'}</div>
          <div style="height:1px;background:#F0F0F2;margin:22px 0 16px"></div>
          <div class="eyebrow">Next 30 days</div>
          <div style="display:flex;flex-direction:column;gap:12px;margin-top:12px">${soon.length ? soon.map((c) => { const sp = statusPill(c.status); const [, m, dd] = c.start_date.split('-').map(Number); return `<div style="display:flex;align-items:center;gap:12px">
            <div style="width:46px;flex:none;text-align:center;border-radius:10px;background:#F5F5F7;padding:6px 0"><div style="font-size:10px;font-weight:700;color:var(--red-dark);letter-spacing:0.06em">${MONTHS[m - 1].toUpperCase()}</div><div style="font-size:18px;font-weight:700">${dd}</div></div>
            <div style="min-width:0;flex:1"><div style="font-weight:600;font-size:14px">${esc(c.name)}</div><div class="muted xs">${esc(c.channel || '')}</div></div><span class="pill ${sp[1]}">${sp[0]}</span></div>`; }).join('') : '<div class="muted small">Nothing scheduled to start.</div>'}</div>
        </div>
      </div>
      <div class="grid-auto">
        <div class="card rise d5 pad"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap"><h2 class="h2">What's working</h2><span class="muted small">Cost per response, lower is better</span></div>
          <div style="display:flex;flex-direction:column;gap:16px;margin-top:20px">${leaders}</div>
          ${untracked.length ? `<div class="muted xs" style="margin-top:16px">${esc(untracked.map((c) => c.name).join(', '))} ${untracked.length === 1 ? 'has' : 'have'} no response tracking, so ${untracked.length === 1 ? 'it is' : 'they are'} judged on lift and rating only.</div>` : ''}</div>
        <div class="card rise d6 pad"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h2 class="h2">Posting this week</h2>${can('team') ? '<button class="btn btn-ghost btn-sm" data-act="tab" data-tab="social">Open calendar</button>' : ''}</div>
          ${weekPosts.length ? `<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:18px">${weekPosts.map((p) => postCard(p, 110, false)).join('')}</div>` : '<div class="empty" style="margin-top:18px">No posts this week.</div>'}</div>
      </div>
    </div>`;
  }

  function leadsChart() {
    const t = todayStr();
    const year = +t.slice(0, 4);
    const keys = divKeys();
    const series = (y) => MONTHS.map((_, i) => { const r = monthTotals(`${y}-${pad(i + 1)}`, keys); return r ? r.leads : null; });
    const cur = series(year), prev = series(year - 1);
    const vals = cur.concat(prev).filter((v) => v != null);
    const divName = S.division === 'all' || !enabledDivs().includes(S.division) ? 'all divisions' : DIV_NAMES[S.division].toLowerCase();
    const headHtml = `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><div><h2 class="h2">Leads by month</h2><div class="muted" style="font-size:14px;margin-top:4px">${year} against ${year - 1}, ${divName}</div></div>
      <div style="display:flex;gap:16px;font-size:13px;font-weight:600"><span style="display:inline-flex;align-items:center;gap:6px"><span style="width:14px;height:3px;border-radius:2px;background:var(--red)"></span>${year}</span><span style="display:inline-flex;align-items:center;gap:6px"><span style="width:14px;height:3px;border-radius:2px;background:#A1A1A6"></span>${year - 1}</span></div></div>`;
    if (!vals.length) return headHtml + '<div class="empty" style="margin-top:16px">The chart fills in as monthly numbers are entered.</div>';
    const top = Math.max(...vals);
    const step = top > 150 ? 100 : top > 60 ? 50 : top > 20 ? 10 : 5;
    const yMax = Math.max(step, Math.ceil((top * 1.15) / step) * step);
    const X = (i) => 36 + i * (580 / 11), Y = (v) => 190 - (v / yMax) * 170;
    const line = (arr) => arr.map((v, i) => (v == null ? null : `${X(i).toFixed(1)},${Y(v).toFixed(1)}`)).filter(Boolean).join(' ');
    const g1 = Math.round(yMax / 2 / step) * step || step, g2 = g1 * 2;
    let lastI = -1; cur.forEach((v, i) => { if (v != null) lastI = i; });
    const live = S.data.campaigns.filter((c) => c.status === 'live' && c.start_date && c.end_date && c.start_date.startsWith(String(year)) && dnum(c.end_date) - dnum(c.start_date) <= 120)
      .sort((a, b) => a.end_date.localeCompare(b.end_date))[0];
    let shade = '';
    if (live) {
      const a = (+live.start_date.slice(5, 7) - 1) + (+live.start_date.slice(8) - 1) / 30;
      const b = Math.min(11.95, (+live.end_date.slice(5, 7) - 1) + (+live.end_date.slice(8)) / 31);
      shade = `<rect x="${X(a).toFixed(1)}" y="22" width="${(X(b) - X(a)).toFixed(1)}" height="168" style="fill:var(--red)" opacity="0.06"/><text x="${((X(a) + X(b)) / 2).toFixed(1)}" y="16" text-anchor="middle" font-size="11" font-weight="600" style="fill:var(--red-dark)">${esc(live.name)}</text>`;
    }
    const tip = lastI >= 0 ? (() => { const x = X(lastI), y = Y(cur[lastI]); const label = `${MONTHS[lastI]}: ${cur[lastI]} leads`; const w = label.length * 7 + 20; return `<circle cx="${x}" cy="${y}" r="6" fill="#fff" style="stroke:var(--red)" stroke-width="3"/><rect x="${(x - w / 2).toFixed(1)}" y="${(y - 46).toFixed(1)}" width="${w}" height="30" rx="8" fill="#1D1D1F"/><text x="${x}" y="${(y - 26).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="600" fill="#fff">${label}</text>`; })() : '';
    const aria = lastI >= 0 ? `Line chart of monthly leads, ${year} against ${year - 1}. ${MONTHS_LONG[lastI]} ${year}: ${cur[lastI]}${prev[lastI] != null ? ', against ' + prev[lastI] : ''}.` : 'Line chart of monthly leads.';
    return headHtml + `<div style="overflow-x:auto;margin-top:12px"><svg viewBox="0 0 640 230" style="width:100%;min-width:520px;height:auto;display:block" role="img" aria-label="${esc(aria)}">
      <line x1="36" y1="190" x2="616" y2="190" stroke="#E5E5EA"/><line x1="36" y1="${Y(g1)}" x2="616" y2="${Y(g1)}" stroke="#F2F2F4"/><line x1="36" y1="${Y(g2)}" x2="616" y2="${Y(g2)}" stroke="#F2F2F4"/>
      <text x="28" y="194" text-anchor="end" font-size="11" fill="#86868B">0</text><text x="28" y="${Y(g1) + 4}" text-anchor="end" font-size="11" fill="#86868B">${g1}</text><text x="28" y="${Y(g2) + 4}" text-anchor="end" font-size="11" fill="#86868B">${g2}</text>
      ${MONTHS.map((m, i) => `<text x="${X(i).toFixed(1)}" y="212" text-anchor="middle" font-size="11" fill="#86868B">${m}</text>`).join('')}
      <polyline class="draw" points="${line(prev)}" fill="none" stroke="#A1A1A6" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      <polyline class="draw" points="${line(cur)}" fill="none" style="stroke:var(--red)" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>
      <g class="fadein">${shade}${tip}</g></svg></div>`;
  }

  // ---------- roadmap ----------
  function roadmapPage() {
    const start = addMonths(thisMonth(), -1);
    const months = Array.from({ length: 15 }, (_, i) => addMonths(start, i));
    const w0 = dnum(start + '-01');
    const w1 = dnum(addMonths(start, 15) + '-01');
    const span = w1 - w0;
    const rows = S.data.campaigns.filter((c) => c.start_date && c.end_date && dnum(c.end_date) >= w0 && dnum(c.start_date) < w1)
      .sort((a, b) => a.start_date.localeCompare(b.start_date));
    const todayPct = ((dnum(todayStr()) - w0) / span) * 100;
    const ok = (v, l) => `<span class="chk" style="color:${v ? '#1E6B34' : '#A1A1A6'}">${v ? '✓' : '○'} ${l}</span>`;
    return `<div class="stack">
      <div class="head rise d1"><div><div class="eyebrow">Strategy</div><h1 class="h1">Roadmap</h1><p class="lede">The next 15 months. A campaign is ready to go live once its code, landing page and QR code exist.</p></div>
        <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;font-size:13px;font-weight:600">
          ${[['var(--red)', 'Live'], ['var(--navy)', 'Ready'], ['#E8E8ED', 'Planned'], ['#F2F2F4', 'Finished']].map((x) => `<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:12px;height:12px;border-radius:4px;background:${x[0]};box-shadow:inset 0 0 0 1px rgba(0,0,0,0.12)"></span>${x[1]}</span>`).join('')}
          ${can('full') ? '<button class="btn btn-red btn-sm" data-act="campaign-new">Add campaign</button>' : ''}</div></div>
      <div class="card rise d2 pad only-mobile">${rows.length ? rows.map((c) => { const sp = statusPill(c.status); return `<button class="rm-item" ${can('full') ? `data-act="campaign-edit" data-id="${esc(c.id)}"` : 'disabled'}>
          <span class="rm-swatch tl-${c.status}"></span><span style="flex:1;min-width:0"><span style="display:block;font-weight:600;font-size:15px">${esc(c.name)}</span>
          <span class="muted small" style="display:block;margin-top:2px">${esc(dayRange(c.start_date, c.end_date))}</span>
          <span style="display:flex;gap:10px;margin-top:6px">${ok(c.has_code, 'Code')}${ok(c.has_page, 'Page')}${ok(c.has_qr, 'QR')}</span></span>
          <span class="pill ${sp[1]}">${sp[0]}</span></button>`; }).join('') : '<div class="empty">No campaigns on the roadmap yet.</div>'}</div>
      <div class="card rise d2 tl-wrap only-desktop" style="padding:20px 0 12px">
        ${rows.length ? `<div class="tl"><div class="tl-months">${months.map((m) => `<div>${MONTHS[+m.slice(5) - 1].toUpperCase()}${m.endsWith('-01') ? ' ' + m.slice(2, 4) : ''}</div>`).join('')}</div>
        <div class="tl-body"><div class="tl-today" style="left:calc(300px + (100% - 300px) * ${(todayPct / 100).toFixed(4)})"><span>TODAY</span></div>
        ${rows.map((c, i) => {
          const a = Math.max(0, (dnum(c.start_date) - w0) / span), b = Math.min(1, (dnum(c.end_date) + 1 - w0) / span);
          const delay = (0.05 + i * 0.05).toFixed(2) + 's';
          return `<div class="tl-row rise" style="animation-delay:${delay}">
            <button class="tl-name" ${can('full') ? `data-act="campaign-edit" data-id="${esc(c.id)}"` : 'disabled'}><div style="font-size:14px;font-weight:600">${esc(c.name)}</div>
              <div style="display:flex;gap:10px;margin-top:4px">${ok(c.has_code, 'Code')}${ok(c.has_page, 'Page')}${ok(c.has_qr, 'QR')}</div></button>
            <div class="tl-lane" title="${esc(dayRange(c.start_date, c.end_date))}">${(b - a) >= 0.14
              ? `<div class="tl-bar tl-${c.status}" style="left:${(a * 100).toFixed(2)}%;width:${((b - a) * 100).toFixed(2)}%;animation-delay:${delay}">${esc(dayRange(c.start_date, c.end_date))}</div>`
              : `<div class="tl-bar tl-${c.status}" style="left:${(a * 100).toFixed(2)}%;width:${((b - a) * 100).toFixed(2)}%;animation-delay:${delay}"></div><span class="tl-label" style="${b > 0.8 ? `right:${((1 - a) * 100 + 0.8).toFixed(2)}%` : `left:${(b * 100 + 0.8).toFixed(2)}%`}">${esc(dayRange(c.start_date, c.end_date))}</span>`}</div></div>`;
        }).join('')}</div></div>` : `<div class="empty" style="margin:0 24px">No campaigns on the roadmap yet.${can('full') ? ' Add the first one.' : ''}</div>`}
      </div></div>`;
  }

  // ---------- campaigns ----------
  function campaignsPage() {
    const t = todayStr();
    const filters = [['all', 'All'], ['live', 'Live'], ['upcoming', 'Upcoming'], ['done', 'Finished']];
    const list = S.data.campaigns.filter((c) => S.campFilter === 'all' || (S.campFilter === 'upcoming' ? (c.status === 'planned' || c.status === 'ready') : c.status === S.campFilter))
      .sort((a, b) => { const o = { live: 0, ready: 1, planned: 2, done: 3 }; return o[a.status] - o[b.status] || (b.start_date || '').localeCompare(a.start_date || '') * (a.status === 'done' ? 1 : -1); });
    return `<div class="stack">
      <div class="head rise d1"><div><div class="eyebrow">Results</div><h1 class="h1">Campaigns</h1><p class="lede">Every campaign, what it cost, and how it landed.</p></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center"><div class="seg" role="group" aria-label="Filter campaigns">${filters.map((f) => `<button class="segbtn${S.campFilter === f[0] ? ' on' : ''}" data-act="camp-filter" data-v="${f[0]}">${f[1]}</button>`).join('')}</div>
        ${can('full') ? '<button class="btn btn-red btn-sm" data-act="campaign-new">Add campaign</button>' : ''}</div></div>
      ${list.length ? `<div class="grid-auto" style="--min:320px">${list.map((c, i) => {
        const r = responses(c), l = lift(c);
        const sp = c.status === 'done' && c.verdict ? verdictPill(c.verdict) : statusPill(c.status);
        const cpr = r.total && c.spend ? c.spend / r.total : null;
        const stats = c.trackable ? [
          ['Spend', c.spend ? money(c.spend) : '—'], ['QR / visits', fmt(r.scans)], ['Form fills', fmt(r.forms)],
          ['Code mentions', r.mentions ? fmt(r.mentions) + '+' : '0'], ['Cost / response', cpr ? (cpr < 10 ? '$' + cpr.toFixed(2) : money(cpr)) : '—'], ['Lift vs last year', l == null ? '—' : signed(l)]
        ] : [['Spend', c.spend ? money(c.spend) : '—'], ['Budget', c.budget ? money(c.budget) : '—'], ['Lift vs last year', l == null ? '—' : signed(l)]];
        const notStarted = c.status === 'planned' || c.status === 'ready';
        return `<div class="card lift rise pad" style="display:flex;flex-direction:column;gap:16px;animation-delay:${(0.05 + i * 0.06).toFixed(2)}s">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px"><div style="min-width:0"><div style="font-size:18px;font-weight:700;letter-spacing:-0.02em">${esc(c.name)}</div>
            <div class="muted small" style="margin-top:3px">${esc([dayRange(c.start_date, c.end_date), c.channel].filter(Boolean).join(' · '))}</div></div><span class="pill ${sp[1]}">${sp[0]}</span></div>
          ${notStarted ? `<div class="muted small">${esc(c.audience || '')}${c.code ? ` · Code ${esc(c.code)}` : ''}${c.budget ? ` · Budget ${money(c.budget)}` : ''}</div>` : `<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">${stats.map((s) => `<div class="statbox"><div class="l">${s[0]}</div><div class="v num">${s[1]}</div></div>`).join('')}</div>`}
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;border-top:1px solid #F0F0F2;padding-top:14px;margin-top:auto">
            <div class="small" style="color:#3A3A3C;min-width:0">${esc(c.verdict_note || (c.trackable ? '' : 'No response tracking'))}</div>
            <div style="display:flex;align-items:center;gap:10px">${c.rating ? `<span class="stars" aria-label="${c.rating} out of 5">${'★'.repeat(c.rating)}${'☆'.repeat(5 - c.rating)}</span>` : ''}
            ${can('full') ? `<button class="btn btn-ghost btn-sm" data-act="campaign-edit" data-id="${esc(c.id)}">Edit</button>` : ''}</div></div></div>`;
      }).join('')}</div>` : '<div class="empty">No campaigns here yet.</div>'}
      ${t ? '' : ''}</div>`;
  }

  function campaignModal(c) {
    const isNew = !c;
    c = c || { status: 'planned', trackable: 1 };
    const sel = (v, opts) => opts.map((o) => `<option value="${o[0]}"${v === o[0] ? ' selected' : ''}>${o[1]}</option>`).join('');
    openModal(isNew ? 'Add campaign' : 'Edit campaign', `<form data-form="campaign" data-id="${esc(c.id || '')}" class="stack" style="gap:14px">
      <label class="field">Name<input class="input" name="name" required maxlength="120" value="${esc(c.name || '')}"></label>
      <div class="form-grid" style="--cols:3">
        <label class="field">Status<select class="input" name="status">${sel(c.status, [['planned', 'Planned'], ['ready', 'Ready'], ['live', 'Live'], ['done', 'Finished']])}</select></label>
        <label class="field">Start<input class="input" type="date" name="start_date" value="${esc(c.start_date || '')}"></label>
        <label class="field">End<input class="input" type="date" name="end_date" value="${esc(c.end_date || '')}"></label>
        <label class="field">Code<input class="input" name="code" maxlength="40" value="${esc(c.code || '')}" placeholder="FALL26"></label>
        <label class="field">Channel<input class="input" name="channel" maxlength="80" value="${esc(c.channel || '')}" placeholder="Direct mail"></label>
        <label class="field">Audience<input class="input" name="audience" maxlength="160" value="${esc(c.audience || '')}" placeholder="Towns or list"></label>
        <label class="field">Budget<input class="input" name="budget" inputmode="numeric" value="${c.budget ? esc(c.budget) : ''}" placeholder="$"></label>
        <label class="field">Spent so far<input class="input" name="spend" inputmode="numeric" value="${c.spend ? esc(c.spend) : ''}" placeholder="$"></label>
      </div>
      <div><div class="eyebrow" style="margin-bottom:6px">Launch checklist</div><div style="display:flex;gap:18px;flex-wrap:wrap">
        <label class="check"><input type="checkbox" name="has_code"${c.has_code ? ' checked' : ''}>Code name</label>
        <label class="check"><input type="checkbox" name="has_page"${c.has_page ? ' checked' : ''}>Landing page</label>
        <label class="check"><input type="checkbox" name="has_qr"${c.has_qr ? ' checked' : ''}>QR code</label>
        <label class="check"><input type="checkbox" name="trackable"${c.trackable ? ' checked' : ''}>Tracks responses</label></div></div>
      <div class="form-grid" style="--cols:3">
        <label class="field">Verdict<select class="input" name="verdict">${sel(c.verdict || '', [['', 'None yet'], ['worked', 'Worked'], ['mixed', 'Mixed'], ['flopped', 'Flopped']])}</select></label>
        <label class="field">Rating<select class="input" name="rating">${sel(String(c.rating || ''), [['', 'None'], ['5', '5'], ['4', '4'], ['3', '3'], ['2', '2'], ['1', '1']])}</select></label>
        <label class="field" style="grid-column:span 1">Verdict note<input class="input" name="verdict_note" maxlength="200" value="${esc(c.verdict_note || '')}"></label>
      </div>
      <label class="field">Notes<textarea class="input" name="notes" rows="3" maxlength="1000">${esc(c.notes || '')}</textarea></label>
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">${isNew ? '<span></span>' : `<button type="button" class="btn-link" data-act="campaign-delete" data-id="${esc(c.id)}">Delete campaign</button>`}
        <div style="display:flex;gap:10px"><button type="button" class="btn btn-ghost" data-act="close">Cancel</button><button class="btn btn-navy">${isNew ? 'Add campaign' : 'Save'}</button></div></div>
    </form>`);
  }

  // ---------- ideas ----------
  const voteIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>';
  const voteBtn = (i) => `<button class="vote${i.voted ? ' on' : ''}" data-act="idea-vote" data-id="${esc(i.id)}" aria-pressed="${!!i.voted}" aria-label="${i.voted ? 'Remove your vote' : 'Vote for this idea'}, ${i.votes || 0} vote${i.votes === 1 ? '' : 's'}">${voteIcon}${i.votes || 0}</button>`;
  function ideasPage() {
    const cols = [['new', 'New'], ['considering', 'Considering'], ['planned', 'Planned'], ['parked', 'Parked']];
    const actions = (i) => {
      if (!can('full')) return '';
      const b = (label, act) => `<button class="btn btn-ghost btn-sm" data-act="${act}" data-id="${esc(i.id)}">${label}</button>`;
      const set = { new: [['Consider', 'idea-consider'], ['Plan', 'idea-plan'], ['Park', 'idea-park']], considering: [['Plan', 'idea-plan'], ['Park', 'idea-park']], planned: [], parked: [['Reopen', 'idea-consider']] }[i.status] || [];
      return `<div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;align-items:center">${set.map((x) => b(x[0], x[1])).join('')}<button class="btn-link xs" style="margin-left:auto;color:#6E6E73" data-act="idea-delete" data-id="${esc(i.id)}" aria-label="Delete idea">Remove</button></div>`;
    };
    const when = (iso) => { const s = isoToEtDate(iso); return s === todayStr() ? 'Today' : shortDate(s); };
    return `<div class="stack">
      <div class="rise d1"><div class="eyebrow">Inbox</div><h1 class="h1">Ideas</h1><p class="lede">Drop anything here. Vote for the ones you like. Every idea gets a decision.</p></div>
      <form class="card rise d2" data-form="idea" style="padding:18px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
        <label class="field" style="flex:1 1 360px">New idea<input class="input" name="text" maxlength="400" placeholder="Example: video tour of a heat pump install day" autocomplete="off"></label>
        <button class="btn btn-red">Add idea</button></form>
      <div class="grid-auto" style="--min:240px;align-items:start">${cols.map((c) => {
        const items = S.data.ideas.filter((i) => i.status === c[0]).sort((a, b) => (b.votes || 0) - (a.votes || 0) || b.created_at.localeCompare(a.created_at));
        return `<div class="col"><div style="display:flex;justify-content:space-between;align-items:center;padding:4px 6px 12px"><div style="font-size:15px;font-weight:700">${c[1]}</div><span class="count">${items.length}</span></div>
          <div style="display:flex;flex-direction:column;gap:10px">${items.map((i) => `<div class="ideacard"><div style="font-size:14px;font-weight:600;line-height:1.35">${esc(i.text)}</div>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px"><span class="muted xs">${esc(personName(i.by_person))}, ${when(i.created_at)}</span>${voteBtn(i)}</div>${i.note ? `<div class="note">${esc(i.note)}</div>` : ''}${actions(i)}</div>`).join('') || '<div class="muted xs" style="padding:6px">Nothing here.</div>'}</div></div>`;
      }).join('')}</div></div>`;
  }

  // ---------- social ----------
  function weekDays(offset) {
    const t = todayStr();
    const wdIdx = (new Date(dnum(t) * 864e5).getUTCDay() + 6) % 7;
    const mon = dnum(t) - wdIdx + offset * 7;
    return Array.from({ length: 7 }, (_, i) => fromDnum(mon + i));
  }
  function postCard(p, h, clickable) {
    const img = postImg(p);
    const pill = postPill(p.status);
    return `<${clickable ? 'button' : 'div'} class="post${clickable ? ' clickable' : ''}" ${clickable ? `data-act="post-edit" data-id="${esc(p.id)}"` : ''}>
      ${img ? `<img class="thumb" src="${esc(img)}" alt="Post photo" style="height:${h}px" loading="lazy">` : `<div class="textcard" style="height:${h}px">${esc((p.caption || '').slice(0, 60))}</div>`}
      <div style="padding:8px 10px"><div style="font-size:12px;font-weight:700">${esc(isoToEtTime(p.scheduled_at))}${h > 100 ? ' · ' + shortDate(isoToEtDate(p.scheduled_at)) : ''}</div>
      ${h <= 100 ? `<div class="muted" style="font-size:11px;margin-top:2px;line-height:1.3">${esc((p.caption || '').slice(0, 70))}</div>` : ''}
      <div style="font-size:10px;font-weight:600;color:#515154;margin-top:6px">${esc(acctList(p.accounts))}</div>
      <span class="pill ${pill[1]}" style="margin-top:6px">${pill[0]}</span>${isAgency(p) && p.status === 'draft' ? ' <span class="agency-tag">Agency</span>' : ''}</div></${clickable ? 'button' : 'div'}>`;
  }
  function agendaPost(p, clickable) {
    const img = postImg(p);
    const pill = postPill(p.status);
    return `<${clickable ? 'button' : 'div'} class="agenda-post${clickable ? ' clickable' : ''}" ${clickable ? `data-act="post-edit" data-id="${esc(p.id)}"` : ''}>
      ${img ? `<img src="${esc(img)}" alt="Post photo" loading="lazy">` : `<div class="textcard">${esc((p.caption || '').slice(0, 40))}</div>`}
      <span style="padding:10px 12px 10px 0;min-width:0;display:flex;flex-direction:column;gap:4px"><span style="font-weight:700;font-size:14px">${esc(isoToEtTime(p.scheduled_at))}</span>
      <span class="muted small" style="overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${esc(p.caption || '')}</span>
      <span style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="pill ${pill[1]}">${pill[0]}</span>${isAgency(p) && p.status === 'draft' ? '<span class="agency-tag">Agency</span>' : ''}<span class="xs" style="font-weight:600;color:#515154">${esc(acctList(p.accounts))}</span></span></span></${clickable ? 'button' : 'div'}>`;
  }

  function socialPage() {
    const days = weekDays(S.weekOffset);
    const t = todayStr();
    const accts = S.composeAccts;
    const dflt = fromDnum(dnum(t) + 2);
    const full = can('full');
    return `<div class="stack">
      <div class="head rise d1"><div><div class="eyebrow">Scheduler</div><h1 class="h1">Social</h1><p class="lede">Write once, post to any of your accounts on a set day and time.</p></div>
        ${isAdmin() ? '<div class="banner info">Posts are planned here now. Auto-publishing to Facebook and Instagram switches on once the accounts are connected.</div>' : ''}</div>
      <div class="grid-auto" style="align-items:start">
        <div class="card rise d2 pad span2">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h2 class="h2">${S.weekOffset === 0 ? 'This week' : S.weekOffset === 1 ? 'Next week' : S.weekOffset === -1 ? 'Last week' : 'Week of ' + shortDate(days[0])}</h2>
            <div style="display:flex;align-items:center;gap:8px"><span class="muted small" style="font-weight:600">${shortDate(days[0])} to ${shortDate(days[6])}</span>
            <button class="btn btn-ghost btn-sm" data-act="week" data-v="-1" aria-label="Previous week">‹</button>${S.weekOffset ? '<button class="btn btn-ghost btn-sm" data-act="week" data-v="0">Today</button>' : ''}<button class="btn btn-ghost btn-sm" data-act="week" data-v="1" aria-label="Next week">›</button></div></div>
          <div class="only-mobile" style="margin-top:12px">${days.map((ds) => {
              const posts = visiblePosts().filter((p) => isoToEtDate(p.scheduled_at) === ds).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
              const dt = new Date(dnum(ds) * 864e5);
              return `<div class="agenda-day" style="margin-top:10px"><div class="agenda-head"><span style="${ds === t ? 'color:var(--red-dark)' : ''}">${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dt.getUTCDay()]}</span><span class="muted small" style="font-weight:600">${shortDate(ds)}${ds === t ? ' \u00B7 Today' : ''}</span></div>
                ${posts.length ? posts.map((p) => agendaPost(p, full)).join('') : '<div class="muted small">Nothing scheduled.</div>'}</div>`;
            }).join('')}</div>
          <div class="only-desktop" style="overflow-x:auto;margin-top:16px"><div style="display:grid;grid-template-columns:repeat(7,minmax(104px,1fr));gap:10px;min-width:770px">
            ${days.map((ds) => {
              const posts = visiblePosts().filter((p) => isoToEtDate(p.scheduled_at) === ds).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
              const dt = new Date(dnum(ds) * 864e5);
              return `<div style="display:flex;flex-direction:column;gap:8px"><div class="dayhead${ds === t ? ' today' : ''}"><div style="font-size:11px;font-weight:700;letter-spacing:0.06em">${['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][dt.getUTCDay()]}</div><div style="font-size:20px;font-weight:700">${dt.getUTCDate()}</div></div>
                ${posts.map((p) => postCard(p, 84, full)).join('')}</div>`;
            }).join('')}</div></div></div>
        <form class="card rise d3 pad compose-first" data-form="post" style="display:flex;flex-direction:column;gap:16px">
          <h2 class="h2">${full ? 'New post' : 'Submit a post'}</h2>
          <label class="field">Photo<input class="input" type="file" name="image" accept="image/*" data-change="post-image"><span class="muted xs" style="font-weight:500">On a phone, take a photo or choose one from your library.</span></label>
          ${S.draftImage ? `<div style="border-radius:16px;overflow:hidden"><img class="thumb" src="${esc(S.draftImage.url)}" alt="Selected photo" style="height:200px"></div>` : ''}
          <label class="field">Caption<textarea class="input" name="caption" rows="4" maxlength="2200" placeholder="Write the caption"></textarea></label>
          <div class="field">Post to<div style="display:flex;gap:8px;flex-wrap:wrap">${Object.keys(ACCT_NAMES).map((k) => `<button type="button" class="acct${accts.includes(k) ? ' on' : ''}" aria-pressed="${accts.includes(k)}" data-act="acct" data-v="${k}">${ACCT_NAMES[k]}</button>`).join('')}</div></div>
          <div class="form-grid" style="--cols:2"><label class="field">Date<input class="input" type="date" name="date" value="${dflt}" required></label><label class="field">Time<input class="input" type="time" name="time" value="10:00" required></label></div>
          <button class="btn btn-red" style="width:100%">${full ? 'Schedule post' : 'Submit post'}</button>
        </form>
      </div></div>`;
  }

  function postModal(p) {
    const accts = new Set(p.accounts);
    const sel = (v, opts) => opts.map((o) => `<option value="${o[0]}"${v === o[0] ? ' selected' : ''}>${o[1]}</option>`).join('');
    const img = postImg(p);
    openModal('Edit post', `<form data-form="post-edit" data-id="${esc(p.id)}" class="stack" style="gap:14px">
      ${p.status === 'submitted' ? `<div class="banner info">Submitted by ${esc(personName(p.by_person))}. Approve it to put it on the schedule.</div>` : ''}
      ${p.status === 'draft' && isAgency(p) ? `<div class="banner info">Drafted by Agency${p.content_id ? ' as the social version of a blog draft' : ''}. Edit if needed, then approve to schedule it.</div>` : ''}
      ${img ? `<img class="thumb" src="${esc(img)}" alt="Post photo" style="height:220px;border-radius:14px">` : ''}
      <label class="field">Caption<textarea class="input" name="caption" rows="4" maxlength="2200">${esc(p.caption || '')}</textarea></label>
      <div class="field">Post to<div style="display:flex;gap:14px;flex-wrap:wrap">${Object.keys(ACCT_NAMES).map((k) => `<label class="check"><input type="checkbox" name="acct_${k}"${accts.has(k) ? ' checked' : ''}>${ACCT_NAMES[k]}</label>`).join('')}</div></div>
      <div class="form-grid" style="--cols:3"><label class="field">Date<input class="input" type="date" name="date" value="${isoToEtDate(p.scheduled_at)}"></label>
        <label class="field">Time<input class="input" type="time" name="time" value="${isoToEtHM(p.scheduled_at)}"></label>
        <label class="field">Status<select class="input" name="status">${sel(p.status === 'submitted' || p.status === 'draft' ? 'scheduled' : p.status, [['scheduled', 'Scheduled'], ['draft', 'Draft'], ['published', 'Published'], ['failed', 'Failed']])}</select></label></div>
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">${isAgency(p) && p.status === 'draft' ? `<button type="button" class="btn-link" data-act="post-reject" data-id="${esc(p.id)}">Reject draft</button>` : `<button type="button" class="btn-link" data-act="post-delete" data-id="${esc(p.id)}">Delete post</button>`}
        <div style="display:flex;gap:10px"><button type="button" class="btn btn-ghost" data-act="close">Cancel</button><button class="btn btn-navy">${p.status === 'submitted' || p.status === 'draft' ? 'Approve and schedule' : 'Save'}</button></div></div>
    </form>`);
  }

  // ---------- content ----------
  function contentPage() {
    const all = S.data.content || [];
    const f = S.contentFilter || 'draft';
    const counts = { draft: 0, approved: 0, published: 0, rejected: 0 };
    all.forEach((c) => { counts[c.status] = (counts[c.status] || 0) + 1; });
    const fresh = (c) => c.status !== 'draft' || S.showOldDrafts || dnum(todayStr()) - dnum(isoToEtDate(c.created_at)) <= 14;
    const list = all.filter((c) => c.status === f && fresh(c));
    const hiddenOld = f === 'draft' && !S.showOldDrafts ? all.filter((c) => c.status === 'draft' && !fresh(c)).length : 0;
    const filters = [['draft', 'Drafts'], ['approved', 'Approved'], ['published', 'Published'], ['rejected', 'Rejected']];
    const socialCount = (c) => S.data.posts.filter((p) => p.content_id === c.id && p.status !== 'rejected').length;
    return `<div class="stack">
      <div class="head rise d1"><div><div class="eyebrow">Blogs and newsletters</div><h1 class="h1">Content</h1><p class="lede">Drafts from Agency land here for review. Approved pieces get copied to the website.</p></div>
        <div class="seg" role="group" aria-label="Filter content">${filters.map((x) => `<button class="segbtn${f === x[0] ? ' on' : ''}" data-act="content-filter" data-v="${x[0]}">${x[1]}${counts[x[0]] ? ` <span class="muted">${counts[x[0]]}</span>` : ''}</button>`).join('')}</div></div>
      ${list.length ? `<div class="grid-auto" style="--min:300px;align-items:start">${list.map((c, i) => {
        const pill = contentPill(c.status);
        const img = c.file_id ? `/api/files/${encodeURIComponent(c.file_id)}/raw` : null;
        const sc = socialCount(c);
        return `<button class="card lift rise content-card" data-act="content-open" data-id="${esc(c.id)}" style="animation-delay:${(0.05 + i * 0.05).toFixed(2)}s">
          ${img ? `<img class="thumb" src="${esc(img)}" alt="" style="height:150px" loading="lazy">` : ''}
          <span class="content-card-body"><span style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="pill ${pill[1]}">${pill[0]}</span>${isAgency(c) ? '<span class="agency-tag">Agency</span>' : ''}${c.topic ? `<span class="muted xs" style="font-weight:600">${esc(c.topic)}</span>` : ''}</span>
          <span class="content-title">${esc(c.title)}</span>
          <span class="muted small content-excerpt">${esc(c.excerpt || String(c.body || '').replace(/^\s*([-*]|\d+[.)])\s+/gm, '').replace(/[#*_>\[\]()]/g, '').replace(/\s+/g, ' ').slice(0, 220))}</span>
          <span class="muted xs" style="font-weight:600">${shortDate(isoToEtDate(c.created_at))}${sc ? ` \u00B7 ${sc} social ${sc === 1 ? 'version' : 'versions'}` : ''}${c.status === 'rejected' && c.reject_reason ? ` \u00B7 ${esc(c.reject_reason)}` : ''}</span></span></button>`;
      }).join('')}</div>` : `<div class="empty">${f === 'draft' ? 'No drafts waiting. New ones from Agency appear here automatically.' : 'Nothing here yet.'}</div>`}
      ${hiddenOld ? `<div style="text-align:center"><button class="btn btn-ghost btn-sm" data-act="content-old">Show ${hiddenOld} older ${hiddenOld === 1 ? 'draft' : 'drafts'}</button></div>` : ''}
    </div>`;
  }

  function contentModal(c, editing) {
    const full = can('full');
    const img = c.file_id ? `/api/files/${encodeURIComponent(c.file_id)}/raw` : null;
    const socials = S.data.posts.filter((p) => p.content_id === c.id && p.status !== 'rejected');
    const sources = (c.sources || []).filter((x) => /^https?:\/\//.test(x));
    const pill = contentPill(c.status);
    const actions = !full ? '' : c.status === 'draft' ? `<button type="button" class="btn-link" data-act="content-reject" data-id="${esc(c.id)}">Reject</button>
          <div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" class="btn btn-ghost" data-act="content-copy" data-id="${esc(c.id)}">Copy</button><button type="button" class="btn btn-navy" data-act="content-status" data-id="${esc(c.id)}" data-v="approved">Approve</button></div>`
      : c.status === 'approved' ? `<button type="button" class="btn-link" data-act="content-status" data-id="${esc(c.id)}" data-v="draft">Back to drafts</button>
          <div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" class="btn btn-ghost" data-act="content-copy" data-id="${esc(c.id)}">Copy for website</button><button type="button" class="btn btn-navy" data-act="content-published" data-id="${esc(c.id)}">Mark published</button></div>`
      : c.status === 'rejected' ? `<button type="button" class="btn-link" data-act="content-delete" data-id="${esc(c.id)}">Delete</button><button type="button" class="btn btn-ghost" data-act="content-status" data-id="${esc(c.id)}" data-v="draft">Restore to drafts</button>`
      : `<span></span><button type="button" class="btn btn-ghost" data-act="content-copy" data-id="${esc(c.id)}">Copy</button>`;
    const view = editing ? `<form data-form="content-edit" data-id="${esc(c.id)}" class="stack" style="gap:14px">
        <label class="field">Title<input class="input" name="title" maxlength="200" value="${esc(c.title)}"></label>
        <label class="field">Summary<textarea class="input" name="excerpt" rows="2" maxlength="600">${esc(c.excerpt || '')}</textarea></label>
        <label class="field">Body<textarea class="input mono" name="body" rows="16">${esc(c.body || '')}</textarea></label>
        <div class="muted xs"># Heading, **bold**, *italic*, - list, [link](https://...)</div>
        <div style="display:flex;justify-content:flex-end;gap:10px"><button type="button" class="btn btn-ghost" data-act="content-open" data-id="${esc(c.id)}">Cancel</button><button class="btn btn-navy">Save changes</button></div></form>`
      : `<div class="stack" style="gap:16px">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="pill ${pill[1]}">${pill[0]}</span>${isAgency(c) ? '<span class="agency-tag">Drafted by Agency</span>' : ''}<span class="muted xs" style="font-weight:600">${shortDate(isoToEtDate(c.created_at))}${c.reviewed_by ? ` \u00B7 reviewed by ${esc(personName(c.reviewed_by))}` : ''}</span>
          ${full && c.status !== 'published' ? `<button class="btn btn-ghost btn-sm" style="margin-left:auto" data-act="content-edit" data-id="${esc(c.id)}">Edit</button>` : ''}</div>
        ${c.status === 'rejected' && c.reject_reason ? `<div class="banner warn">Rejected: ${esc(c.reject_reason)}</div>` : ''}
        ${c.published_url ? `<div class="banner info">Live at <a href="${esc(c.published_url)}" target="_blank" rel="noopener">${esc(c.published_url)}</a></div>` : ''}
        ${img ? `<img class="thumb" src="${esc(img)}" alt="Draft image" style="max-height:280px;border-radius:14px">` : ''}
        <article class="prose">${c.excerpt ? `<p class="lead">${esc(c.excerpt)}</p>` : ''}${md(c.body)}</article>
        ${sources.length ? `<div><div class="eyebrow" style="margin-bottom:6px">Sources</div>${sources.map((u) => `<div class="xs" style="word-break:break-all"><a href="${esc(u)}" target="_blank" rel="noopener nofollow">${esc(u)}</a></div>`).join('')}</div>` : ''}
        ${socials.length ? `<div><div class="eyebrow" style="margin-bottom:8px">Social versions</div><div style="display:flex;flex-direction:column;gap:10px">${socials.map((p) => agendaPost(p, full)).join('')}</div></div>` : ''}
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;border-top:1px solid #F0F0F2;padding-top:16px">${actions}</div></div>`;
    openModal(c.title, view);
  }

  async function copyContent(c) {
    const html = `<h1>${esc(c.title)}</h1>${c.excerpt ? `<p>${esc(c.excerpt)}</p>` : ''}${md(c.body)}`;
    const text = `${c.title}\n\n${c.excerpt ? c.excerpt + '\n\n' : ''}${c.body || ''}`;
    try {
      if (window.ClipboardItem && navigator.clipboard.write) {
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
      } else {
        await navigator.clipboard.writeText(text);
      }
      toast('Copied. Paste it into a new WordPress post.');
    } catch (_) { toast('Copy did not work in this browser'); }
  }

  function reasonModal(title, text, onSave) {
    S._reason = onSave;
    openModal(title, `<form data-form="reason" class="stack" style="gap:14px"><p class="muted" style="margin:0">${esc(text)}</p>
      <label class="field">Reason<input class="input" name="reason" maxlength="300" placeholder="Example: too similar to last week's post"></label>
      <div style="display:flex;justify-content:flex-end;gap:10px"><button type="button" class="btn btn-ghost" data-act="close">Cancel</button><button class="btn btn-red">Reject</button></div></form>`);
  }

  function publishedModal(c) {
    openModal('Mark as published', `<form data-form="content-published" data-id="${esc(c.id)}" class="stack" style="gap:14px">
      <label class="field">Page address on the website (optional)<input class="input" name="url" type="url" placeholder="https://yourcompany.com/blog/..."></label>
      <div style="display:flex;justify-content:flex-end;gap:10px"><button type="button" class="btn btn-ghost" data-act="close">Cancel</button><button class="btn btn-navy">Mark published</button></div></form>`);
  }

  function keyModal(key) {
    openModal('Agency connection key', `<div class="stack" style="gap:14px">
      <p class="muted" style="margin:0">Copy this now. It is shown only once. Put it in the cron's environment as <strong>HUB_KEY</strong>, never in code or chat.</p>
      <div class="linkbox"><span style="flex:1;font-family:ui-monospace,Menlo,monospace">${esc(key)}</span></div>
      <div style="display:flex;justify-content:flex-end;gap:10px"><button class="btn btn-ghost" data-act="close">Done</button><button class="btn btn-navy" data-act="copy" data-v="${esc(key)}">Copy key</button></div></div>`);
  }

  // ---------- numbers ----------
  function numbersPage() {
    const cur = thisMonth();
    const options = Array.from({ length: 18 }, (_, i) => addMonths(cur, -i));
    const mk = S.numbersMonth || latestMonth() || cur;
    const en = enabledDivs();
    const row = (d) => S.data.monthly.find((r) => r.month === mk && r.division === d) || {};
    const spend = spendFor(mk);
    const mStart = mk + '-01', mEnd = addMonths(mk, 1) + '-01';
    const camps = S.data.campaigns.filter((c) => c.trackable && c.start_date && c.start_date < mEnd && (!c.end_date || c.end_date >= mStart) && c.status !== 'planned');
    const cm = (id) => S.data.campaignMonths.find((r) => r.campaign_id === id && r.month === mk) || {};
    const v = (x) => (x == null || x === '' ? '' : esc(x));
    const months = [...new Set(S.data.monthly.map((r) => r.month))].filter((m) => m <= cur && monthTotals(m, en)).sort().reverse().slice(0, 12);
    const form = can('full') ? `<form class="card rise d2 pad" data-form="numbers" data-month="${mk}" style="display:flex;flex-direction:column;gap:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><h2 class="h2">${monthLabel(mk, true)}</h2>
        <select class="input" style="width:auto;min-height:36px;padding:6px 10px" data-change="numbers-month" aria-label="Month">${options.map((o) => `<option value="${o}"${o === mk ? ' selected' : ''}>${monthLabel(o, true)}</option>`).join('')}</select></div>
      ${en.map((d) => { const r = row(d); return `<div class="eyebrow">${DIV_NAMES[d]}</div><div class="form-grid" style="--cols:3">
        <label class="field">Leads<input class="input" name="${d}_leads" inputmode="numeric" value="${v(r.leads)}"></label>
        <label class="field">Booked jobs<input class="input" name="${d}_jobs" inputmode="numeric" value="${v(r.jobs)}"></label>
        <label class="field">Revenue<input class="input" name="${d}_revenue" inputmode="numeric" value="${r.revenue != null ? money(r.revenue) : ''}"></label></div>`; }).join('')}
      <div class="eyebrow">Marketing</div><div class="form-grid" style="--cols:2">
        <label class="field">Spend this month<input class="input" name="spend" inputmode="numeric" value="${spend != null ? money(spend) : ''}"></label>
        <label class="field">${mk.slice(0, 4)} budget<input class="input" name="budget" inputmode="numeric" value="${S.data.settings.budget ? money(S.data.settings.budget) : ''}"></label></div>
      ${camps.map((c) => { const r = cm(c.id); return `<div class="eyebrow">${esc(c.name)}</div><div class="form-grid" style="--cols:3">
        <label class="field">QR scans / visits<input class="input" name="c_${esc(c.id)}_scans" inputmode="numeric" value="${v(r.scans)}"></label>
        <label class="field">Form fills<input class="input" name="c_${esc(c.id)}_forms" inputmode="numeric" value="${v(r.forms)}"></label>
        <label class="field">Code mentions<input class="input" name="c_${esc(c.id)}_mentions" inputmode="numeric" value="${v(r.mentions)}"></label></div>`; }).join('')}
      ${camps.length ? '<div class="muted xs">Code mentions come from the lead source count in your CRM and are treated as a minimum.</div>' : ''}
      <button class="btn btn-navy">Save ${monthLabel(mk, true).split(' ')[0]}</button></form>` : '';
    return `<div class="stack">
      <div class="rise d1"><div class="eyebrow">Five minutes a month</div><h1 class="h1">Monthly numbers</h1><p class="lede">Totals by division from your CRM plus each live campaign's responses. Everything else calculates itself.</p></div>
      <div class="grid-auto" style="align-items:start">${form}
        <div class="card rise d3${form ? ' span2' : ''}" style="padding:0;overflow:hidden">
          <div style="padding:22px 22px 8px"><h2 class="h2">History</h2><div class="muted" style="font-size:14px;margin-top:4px">All divisions, change in leads vs the same month last year</div></div>
          <div class="table-row headrow"><div>Month</div><div>Leads</div><div>Jobs</div><div class="hide-sm">Revenue</div><div class="hide-sm">Spend</div></div>
          ${months.length ? months.map((m, i) => { const a = monthTotals(m, en), b = monthTotals(addMonths(m, -12), en); const ch = a && b ? pctChange(a.leads, b.leads) : null; const sp = spendFor(m); return `<div class="table-row rise" style="animation-delay:${(0.1 + i * 0.04).toFixed(2)}s">
            <div style="font-weight:600">${monthLabel(m, true)}</div><div class="num">${fmt(a.leads)} ${ch != null ? `<span style="font-size:12px;font-weight:600;color:${ch >= 0 ? '#1E6B34' : 'var(--red-dark)'}">${signed(ch)}</span>` : ''}</div>
            <div class="num">${fmt(a.jobs)}</div><div class="hide-sm num">${compact(a.revenue)}</div><div class="hide-sm num">${sp != null ? money(sp) : '—'}</div></div>`; }).join('') : '<div class="empty" style="margin:16px 22px 22px">No months entered yet.</div>'}
        </div></div></div>`;
  }

  // ---------- files ----------
  function filesPage() {
    const camp = (id) => (S.data.campaigns.find((c) => c.id === id) || {}).name;
    const files = S.data.files;
    return `<div class="stack">
      <div class="head rise d1"><div><div class="eyebrow">Records</div><h1 class="h1">Files</h1><p class="lede">Invoices, proofs and creative, filed by campaign.</p></div>
        <button class="btn btn-navy" data-act="file-new">Upload</button></div>
      ${files.length ? `<div class="grid-auto" style="--min:220px">${files.map((f, i) => {
        const img = f.image_url || (f.stored && /^image\//.test(f.content_type || '') ? `/api/files/${encodeURIComponent(f.id)}/raw` : null);
        const vid = f.stored && /^video\//.test(f.content_type || '') ? `/api/files/${encodeURIComponent(f.id)}/raw` : null;
        const open = f.stored ? `/api/files/${encodeURIComponent(f.id)}/raw` : null;
        return `<div class="card lift rise" style="overflow:hidden;animation-delay:${(0.05 + i * 0.04).toFixed(2)}s;display:flex;flex-direction:column">
          ${vid ? `<button class="file-open" data-act="video-open" data-id="${esc(f.id)}" aria-label="Play ${esc(f.name)}">` : open ? `<a href="${open}" target="_blank" rel="noopener" aria-label="Open ${esc(f.name)}">` : ''}${img ? `<img class="thumb" src="${esc(img)}" alt="" style="height:130px" loading="lazy">` : vid ? `<span class="video-thumb"><video class="thumb" src="${esc(vid)}#t=0.5" preload="metadata" muted playsinline style="height:130px"></video><span class="play-badge" aria-hidden="true">\u25B6</span></span>` : `<div class="file-icon">${docIcon}</div>`}${vid ? '</button>' : open ? '</a>' : ''}
          <div style="padding:14px 16px;display:flex;flex-direction:column;gap:6px;flex:1"><div style="font-size:14px;font-weight:600">${esc(f.name)}</div>
          <div style="display:flex;justify-content:space-between;gap:8px;font-size:12px"><span class="muted">${esc(camp(f.campaign_id) || (f.kind === 'post' ? 'Social post' : 'General'))}${f.size ? ' \u00B7 ' + (f.size >= 1048576 ? (f.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(f.size / 1024)) + ' KB') : ''}</span><span style="font-weight:600">${f.amount ? money(f.amount) : esc(f.kind === 'invoice' ? '' : f.kind === 'creative' ? 'Creative' : '')}</span></div>
          ${can('full') ? `<div style="margin-top:auto;text-align:right"><button class="btn-link xs" style="color:#6E6E73" data-act="file-delete" data-id="${esc(f.id)}">Remove</button></div>` : ''}</div></div>`;
      }).join('')}</div>` : '<div class="empty">No files yet.</div>'}</div>`;
  }

  function fileModal() {
    const camps = S.data.campaigns.slice().sort((a, b) => (b.start_date || '').localeCompare(a.start_date || ''));
    openModal('Upload a file', `<form data-form="file" class="stack" style="gap:14px">
      <label class="field">File<input class="input" type="file" name="file" accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" required></label>
      <label class="field">Name<input class="input" name="name" maxlength="120" placeholder="Fall26 printing invoice"></label>
      <div class="form-grid" style="--cols:3">
        <label class="field">Campaign<select class="input" name="campaign_id"><option value="">None</option>${camps.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></label>
        <label class="field">Type<select class="input" name="kind"><option value="invoice">Invoice</option><option value="creative">Creative</option><option value="other">Other</option></select></label>
        <label class="field">Amount<input class="input" name="amount" inputmode="numeric" placeholder="$"></label></div>
      <div class="muted xs">${S.data.settings.bigFiles ? 'Photos, videos and documents up to 95 MB.' : 'Up to 20 MB.'}</div>
      <div style="display:flex;justify-content:flex-end;gap:10px"><button type="button" class="btn btn-ghost" data-act="close">Cancel</button><button class="btn btn-navy">Upload</button></div>
    </form>`);
  }

  function videoModal(f) {
    const src = `/api/files/${encodeURIComponent(f.id)}/raw`;
    openModal(f.name, `<div class="stack" style="gap:14px">
      <video id="hub-video" src="${esc(src)}" controls playsinline preload="metadata" style="width:100%;max-height:70vh;border-radius:14px;background:#000"></video>
      <div id="video-error" class="banner warn" hidden>This browser can't play this video format (common with iPhone .MOV files on Windows). Download it to watch, or open the hub in Safari or on a phone.</div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><span class="muted small">${esc(f.content_type || '')}${f.size ? ' \u00B7 ' + (f.size / 1048576).toFixed(1) + ' MB' : ''}</span>
        <a class="btn btn-ghost" href="${esc(src)}?download=1">Download</a></div></div>`);
    const v = document.getElementById('hub-video');
    if (v) v.addEventListener('error', () => { const e = document.getElementById('video-error'); if (e) e.hidden = false; }, { once: true });
  }

  // ---------- people ----------
  function peoplePage() {
    const d = S.data;
    const lvls = [['overview', 'Overview'], ['team', 'Team'], ['full', 'Full']];
    const seen = (iso) => (iso ? 'Last seen ' + shortDate(isoToEtDate(iso)) : '');
    return `<div class="stack">
      <div class="head rise d1"><div><div class="eyebrow">Access</div><h1 class="h1">People and settings</h1><p class="lede">Only people on this list can sign in. Each person uses their invite link once to set an email and password. Only you can change access.</p></div>
        <button class="btn btn-navy" data-act="person-new">Add person</button></div>
      <div class="card rise d2" style="overflow:hidden">${d.people.map((p) => `<div class="person">
        <div class="av ${p.level === 'team' ? 'av-red' : p.level === 'overview' ? 'av-grey' : 'av-navy'}">${esc(p.initials)}</div>
        <div style="flex:1 1 200px;min-width:0"><div style="font-size:15px;font-weight:600">${esc(p.name)} <span class="muted" style="font-weight:500;font-size:13px">${esc(p.label || '')}</span></div>
          <div class="muted small" style="margin-top:2px">${p.has_password ? esc([p.email, seen(p.last_seen)].filter(Boolean).join(' · ')) : p.has_link ? (p.status === 'active' ? 'Signed in, password not set yet' : 'Invite link created, not used yet') : 'No invite link yet'}</div></div>
        <span class="pill ${p.has_password ? 'p-pub' : 'p-planned'}">${p.has_password ? 'Active' : 'Invited'}</span>
        ${d.demo ? '' : `<button class="btn btn-ghost btn-sm" data-act="person-link" data-id="${esc(p.id)}">`}${d.demo ? '' : `${p.has_password ? 'Reset link' : p.has_link ? 'New invite' : 'Invite link'}</button>`}
        <button class="btn btn-ghost btn-sm" data-act="person-edit" data-id="${esc(p.id)}">Edit</button>
        ${p.level === 'admin' ? '<span style="font-size:13px;font-weight:600;color:var(--navy);min-width:230px;text-align:right">Admin</span>'
          : `<div class="seg" role="group" aria-label="Access level for ${esc(p.name)}" style="min-width:230px">${lvls.map((l) => `<button class="segbtn${p.level === l[0] ? ' on' : ''}" data-act="person-level" data-id="${esc(p.id)}" data-v="${l[0]}">${l[1]}</button>`).join('')}</div>`}
      </div>`).join('')}</div>
      <div class="grid-auto" style="--min:220px">
        <div class="card rise d3 pad"><div style="font-weight:700">Overview</div><div class="muted small" style="margin-top:6px;line-height:1.45">Home, Roadmap and Ideas. Can add ideas.</div></div>
        <div class="card rise d4 pad"><div style="font-weight:700">Team</div><div class="muted small" style="margin-top:6px;line-height:1.45">Every page. Adds ideas, submits posts and uploads files.</div></div>
        <div class="card rise d5 pad"><div style="font-weight:700">Full</div><div class="muted small" style="margin-top:6px;line-height:1.45">Everything except this page: scheduling, numbers, ideas and campaigns.</div></div>
        <div class="card rise d6 pad" style="background:#F5F5F7;border:0;box-shadow:none"><div style="font-weight:700">Admin</div><div class="muted small" style="margin-top:6px;line-height:1.45">Full, plus people, sign-in links and settings.</div></div>
      </div>
      ${brandCard()}
      ${accountsCard()}
      <div class="card rise d5 pad" style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">
        <div><div style="font-size:17px;font-weight:700">Divisions</div><div class="muted small" style="margin-top:4px">Turn a division on and it appears on Home and Monthly numbers for everyone.</div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="acct on" aria-pressed="true" data-act="div-locked">Installation ✓</button>
          <button class="acct${d.settings.service ? ' on' : ''}" aria-pressed="${d.settings.service}" data-act="div-toggle" data-v="service">Service${d.settings.service ? ' ✓' : ''}</button>
          <button class="acct${d.settings.commercial ? ' on' : ''}" aria-pressed="${d.settings.commercial}" data-act="div-toggle" data-v="commercial">Commercial${d.settings.commercial ? ' ✓' : ''}</button></div></div>
      <div class="card rise d6 pad">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap"><div><div style="font-size:17px;font-weight:700">Agency connection</div>
          <div class="muted small" style="margin-top:4px">Lets the drafting job on your server send blog and social drafts here. It can only add drafts and read recent content and ideas.</div></div>
          ${d.demo ? '<span class="muted small">Keys are switched off in the demo.</span>' : '<button class="btn btn-ghost" data-act="key-new">Create key</button>'}</div>
        ${(d.keys || []).length ? `<div style="margin-top:14px">${d.keys.map((k) => `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid #F0F0F2;flex-wrap:wrap">
          <span style="font-family:ui-monospace,Menlo,monospace;font-size:13px">${esc(k.prefix)}\u2026</span><span class="small" style="font-weight:600">${esc(k.name)}</span>
          <span class="muted xs">Created ${shortDate(isoToEtDate(k.created_at))}${k.last_used ? ' \u00B7 last used ' + shortDate(isoToEtDate(k.last_used)) : ' \u00B7 not used yet'}</span>
          ${k.revoked_at ? '<span class="pill p-fail" style="margin-left:auto">Revoked</span>' : `<button class="btn-link xs" style="margin-left:auto" data-act="key-revoke" data-id="${esc(k.id)}">Revoke</button>`}</div>`).join('')}</div>` : ''}
      </div>
      ${d.hasSample && !d.demo ? `<div class="card rise d6 pad" style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">
        <div><div style="font-size:17px;font-weight:700">Sample data</div><div class="muted small" style="margin-top:4px">The demo campaigns, numbers, ideas, posts and files. Remove them before entering real numbers.</div></div>
        <button class="btn btn-ghost" data-act="sample-clear">Remove sample data</button></div>` : ''}
    </div>`;
  }

  function brandCard() {
    const b = brand();
    const logo = S.brandLogo !== undefined ? S.brandLogo : b.logo;
    return `<form class="card rise d4 pad" data-form="brand" style="display:flex;flex-direction:column;gap:16px">
      <div><div style="font-size:17px;font-weight:700">Brand</div><div class="muted small" style="margin-top:4px">Your name, logo and colors on every page and the sign-in screen.</div></div>
      ${S.data.demo ? '<div class="banner info">In the demo this previews in your browser only, so other visitors still see Acme Air.</div>' : ''}
      <div class="grid-auto" style="--min:240px;align-items:start">
        <div class="stack" style="gap:14px">
          <label class="field">Company name<input class="input" name="name" maxlength="80" required value="${esc(b.name)}"></label>
          <div class="field">Colors<div class="swatches">
            <label class="swatch"><input type="color" name="primary" value="${esc(b.primary)}" data-change="brand-color">Main</label>
            <label class="swatch"><input type="color" name="accent" value="${esc(b.accent)}" data-change="brand-color">Accent (buttons)</label></div>
            <span class="muted xs" style="font-weight:500">Pick darker shades so white text on buttons stays easy to read.</span></div>
        </div>
        <div class="stack" style="gap:10px">
          <div class="field">Logo<div class="logo-prev">${logo ? `<img src="${esc(logo)}" alt="Logo preview">` : `<span class="brand-name">${esc(b.name)}</span>`}</div></div>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><label class="btn btn-ghost btn-sm" style="cursor:pointer">Upload logo<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" data-change="brand-logo" hidden></label>
            ${logo ? '<button type="button" class="btn-link xs" data-act="brand-logo-clear">Remove logo</button>' : ''}<span class="muted xs">PNG with a clear background works best.</span></div>
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:10px">${S.data.demo && demoPreview() ? '<button type="button" class="btn btn-ghost" data-act="brand-reset">Back to Acme Air</button>' : ''}<button class="btn btn-navy">${S.data.demo ? 'Preview' : 'Save brand'}</button></div>
    </form>`;
  }

  function accountsCard() {
    const rows = S.acctDraft || (S.data.accounts || []).map((a) => ({ ...a }));
    return `<form class="card rise d5 pad" data-form="accounts" style="display:flex;flex-direction:column;gap:14px">
      <div><div style="font-size:17px;font-weight:700">Social accounts</div><div class="muted small" style="margin-top:4px">The pages and profiles you post to. The short name shows on the calendar.</div></div>
      <div class="stack" style="gap:8px">
        <div class="acct-row muted xs" style="font-weight:600"><span>Name</span><span>Short</span><span></span></div>
        ${rows.map((a, i) => `<div class="acct-row"><input class="input" name="an_${i}" maxlength="40" value="${esc(a.name || '')}" placeholder="Facebook"><input class="input" name="as_${i}" maxlength="8" value="${esc(a.short || '')}" placeholder="FB"><input type="hidden" name="ai_${i}" value="${esc(a.id || '')}">
          <button type="button" class="x" data-act="acct-remove" data-v="${i}" aria-label="Remove ${esc(a.name || 'account')}">×</button></div>`).join('')}
      </div>
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><button type="button" class="btn btn-ghost btn-sm" data-act="acct-add"${rows.length >= 8 ? ' disabled' : ''}>Add account</button><button class="btn btn-navy">Save accounts</button></div>
    </form>`;
  }
  function readAcctRows(f) {
    const fd = new FormData(f);
    const rows = [];
    for (let i = 0; fd.has('an_' + i); i++) rows.push({ id: String(fd.get('ai_' + i) || ''), name: String(fd.get('an_' + i) || '').trim(), short: String(fd.get('as_' + i) || '').trim() });
    return rows;
  }

  // Logos are shrunk to a small PNG in the browser before saving.
  async function prepareLogo(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('That image could not be read')); im.src = url; });
      const w0 = img.naturalWidth || 600, h0 = img.naturalHeight || 200;
      const scale = Math.min(1, 600 / w0, 200 / h0);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w0 * scale)); c.height = Math.max(1, Math.round(h0 * scale));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/png');
    } finally { URL.revokeObjectURL(url); }
  }

  function personModal(p) {
    const isNew = !p;
    p = p || { level: 'overview' };
    openModal(isNew ? 'Add person' : 'Edit person', `<form data-form="person" data-id="${esc(p.id || '')}" class="stack" style="gap:14px">
      <label class="field">Name<input class="input" name="name" required maxlength="80" value="${esc(p.name || '')}"></label>
      <div class="form-grid" style="--cols:2"><label class="field">Label<input class="input" name="label" maxlength="80" value="${esc(p.label || '')}" placeholder="Operations"></label>
        <label class="field">Initials<input class="input" name="initials" maxlength="3" value="${esc(p.initials || '')}"></label></div>
      ${isNew ? `<label class="field">Access<select class="input" name="level"><option value="overview">Overview</option><option value="team">Team</option><option value="full">Full</option></select></label>` : ''}
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">${!isNew && p.level !== 'admin' ? `<button type="button" class="btn-link" data-act="person-delete" data-id="${esc(p.id)}">Remove person</button>` : '<span></span>'}
        <div style="display:flex;gap:10px"><button type="button" class="btn btn-ghost" data-act="close">Cancel</button><button class="btn btn-navy">${isNew ? 'Add' : 'Save'}</button></div></div>
    </form>`);
  }

  function linkModal(p, link) {
    openModal(`Sign-in link for ${p.name}`, `<div class="stack" style="gap:14px">
      <p class="muted" style="margin:0">Send this to ${esc(p.name.split(' ')[0])} by email or text. They open it once, choose their email and password, and sign in normally after that. The link stops working once their password is set.</p>
      <div class="linkbox"><span style="flex:1">${esc(link)}</span></div>
      <div style="display:flex;justify-content:flex-end;gap:10px"><button class="btn btn-ghost" data-act="close">Done</button><button class="btn btn-navy" data-act="copy" data-v="${esc(link)}">Copy link</button></div></div>`);
  }

  function confirmModal(title, text, confirmLabel, onYes) {
    S._confirm = onYes;
    openModal(title, `<div class="stack" style="gap:16px"><p class="muted" style="margin:0">${esc(text)}</p>
      <div style="display:flex;justify-content:flex-end;gap:10px"><button class="btn btn-ghost" data-act="close">Cancel</button><button class="btn btn-red" data-act="confirm-yes">${esc(confirmLabel)}</button></div></div>`);
  }

  function ideaNoteModal(idea, status) {
    const isPlan = status === 'planned';
    openModal(isPlan ? 'Plan this idea' : 'Park this idea', `<form data-form="idea-status" data-id="${esc(idea.id)}" data-status="${status}" class="stack" style="gap:14px">
      <div style="font-weight:600">${esc(idea.text)}</div>
      <label class="field">${isPlan ? 'Note (optional)' : 'Reason (optional)'}<input class="input" name="note" maxlength="300" placeholder="${isPlan ? 'Example: run it in spring' : 'Example: revisit next year'}"></label>
      ${isPlan && can('full') ? `<label class="check"><input type="checkbox" name="roadmap" checked>Add it to the roadmap as a planned campaign</label>
        <div class="form-grid" style="--cols:2"><label class="field">Start<input class="input" type="date" name="start_date"></label><label class="field">End<input class="input" type="date" name="end_date"></label></div>` : ''}
      <div style="display:flex;justify-content:flex-end;gap:10px"><button type="button" class="btn btn-ghost" data-act="close">Cancel</button><button class="btn btn-navy">${isPlan ? 'Plan it' : 'Park it'}</button></div></form>`);
  }

  function passwordModal(first) {
    const me = S.data.me;
    openModal(first ? 'Set up your sign-in' : 'Email and password', `<form data-form="password" class="stack" style="gap:14px">
      ${first ? `<p class="muted" style="margin:0">Welcome, ${esc(me.name.split(' ')[0])}. Choose the email and password you'll use to sign in from now on, on any device.</p>` : ''}
      <label class="field">Work email<input class="input" type="email" name="email" autocomplete="username" required value="${esc(me.email || '')}"></label>
      ${!first && me.hasPassword ? '<label class="field">Current password<input class="input" type="password" name="current" autocomplete="current-password" required></label>' : ''}
      <label class="field">${first ? 'Password' : 'New password'}<input class="input" type="password" name="password" autocomplete="new-password" minlength="8" required></label>
      <label class="field">Type it again<input class="input" type="password" name="confirm" autocomplete="new-password" minlength="8" required></label>
      <div class="muted xs">At least 8 characters. Signing in later is just your email and this password.</div>
      <div style="display:flex;justify-content:flex-end;gap:10px">${first ? '' : '<button type="button" class="btn btn-ghost" data-act="close">Cancel</button>'}<button class="btn btn-navy">${first ? 'Save and continue' : 'Save'}</button></div>
    </form>`, first);
  }

  // ---------- modal ----------
  function openModal(title, body, locked) {
    S.modalLocked = !!locked;
    $overlay.innerHTML = `<div class="modal-bg"${locked ? '' : ' data-act="close-bg"'}><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head"><h2 class="h2">${esc(title)}</h2>${locked ? '' : '<button class="x" data-act="close" aria-label="Close">×</button>'}</div>${body}</div></div>`;
    const first = $overlay.querySelector('input:not([type=checkbox]):not([type=file]), textarea, select');
    if (first) first.focus();
  }
  const closeModal = () => { $overlay.innerHTML = ''; };

  // ---------- events ----------
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) { if (S.menu) { S.menu = false; S.animate = false; render(); } return; }
    const a = el.dataset.act, id = el.dataset.id, v = el.dataset.v;
    if (a === 'close-bg') { if (e.target === el) closeModal(); return; }
    if (a !== 'menu' && S.menu) S.menu = false;
    const find = (arr) => arr.find((x) => x.id === id);
    switch (a) {
      case 'tab': S.tab = el.dataset.tab; S.animate = true; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); break;
      case 'menu': S.menu = !S.menu; S.animate = false; render(); break;
      case 'account': S.menu = false; S.animate = false; render(); passwordModal(false); break;
      case 'signout': try { await call('POST', '/api/signout', {}); } catch (_) { /* reload anyway */ } location.reload(); break;
      case 'view': S.viewAs = v === 'admin' ? null : v; S.animate = true; render(); break;
      case 'division': S.division = v; S.animate = true; render(); break;
      case 'camp-filter': S.campFilter = v; S.animate = true; render(); break;
      case 'week': S.weekOffset = v === '0' ? 0 : S.weekOffset + Number(v); S.animate = false; render(); break;
      case 'acct': { const s = new Set(S.composeAccts); s.has(v) ? s.delete(v) : s.add(v); S.composeAccts = Object.keys(ACCT_NAMES).filter((k) => s.has(k)); keepCompose(() => { S.animate = false; render(); }); break; }
      case 'close': closeModal(); break;
      case 'campaign-new': campaignModal(null); break;
      case 'campaign-edit': campaignModal(find(S.data.campaigns)); break;
      case 'campaign-delete': confirmModal('Delete campaign?', 'This removes the campaign and its monthly responses. Files stay but lose the link to it.', 'Delete', () => act(() => call('DELETE', `/api/campaigns/${encodeURIComponent(id)}`), 'Campaign deleted')); break;
      case 'brand-logo-clear': S.brandLogo = ''; keepBrand(); break;
      case 'brand-reset': try { localStorage.removeItem('abri-demo-brand'); } catch (_) { /* ignore */ } S.brandLogo = undefined; applyBrand(); S.animate = false; render(); toast('Back to Acme Air'); break;
      case 'acct-add': { const f = $app.querySelector('form[data-form="accounts"]'); S.acctDraft = readAcctRows(f).concat([{ id: '', name: '', short: '' }]); S.animate = false; render(); const g = $app.querySelector(`form[data-form="accounts"] input[name="an_${S.acctDraft.length - 1}"]`); if (g) g.focus(); break; }
      case 'acct-remove': { const f = $app.querySelector('form[data-form="accounts"]'); const rows = readAcctRows(f); rows.splice(Number(v), 1); S.acctDraft = rows; S.animate = false; render(); break; }
      case 'idea-vote': {
        const i = find(S.data.ideas);
        if (i) { i.voted = !i.voted; i.votes = (i.votes || 0) + (i.voted ? 1 : -1); S.animate = false; render(); }
        try { await call('POST', `/api/ideas/${encodeURIComponent(id)}/vote`, {}); await load(); S.animate = false; render(); } catch (err) { toast(err.message); }
        break;
      }
      case 'idea-consider': act(() => call('PATCH', `/api/ideas/${encodeURIComponent(id)}`, { status: 'considering', note: '' }), 'Moved to Considering'); break;
      case 'idea-plan': ideaNoteModal(find(S.data.ideas), 'planned'); break;
      case 'idea-park': ideaNoteModal(find(S.data.ideas), 'parked'); break;
      case 'idea-delete': confirmModal('Remove idea?', 'It will be deleted for everyone.', 'Remove', () => act(() => call('DELETE', `/api/ideas/${encodeURIComponent(id)}`), 'Idea removed')); break;
      case 'post-edit': postModal(find(S.data.posts)); break;
      case 'post-reject': { const p = find(S.data.posts); reasonModal('Reject this draft?', 'Agency reads the reason so it does better next time.', (reason) => act(() => call('PATCH', `/api/posts/${encodeURIComponent(id)}`, { status: 'rejected', reject_reason: reason, accounts: p.accounts }), 'Draft rejected')); break; }
      case 'content-filter': S.contentFilter = v; S.animate = true; render(); break;
      case 'content-old': S.showOldDrafts = true; S.animate = false; render(); break;
      case 'content-open': contentModal(find(S.data.content)); break;
      case 'content-edit': contentModal(find(S.data.content), true); break;
      case 'content-copy': copyContent(find(S.data.content)); break;
      case 'content-status': { const c = find(S.data.content); closeModal(); act(() => call('PATCH', `/api/content/${encodeURIComponent(id)}`, { status: v }), v === 'approved' ? 'Approved. Copy it to the website when ready.' : 'Moved back to drafts'); if (v === 'approved') S.contentFilter = c.status === 'draft' ? 'draft' : S.contentFilter; break; }
      case 'content-reject': reasonModal('Reject this draft?', 'Agency reads the reason so it does better next time.', (reason) => act(() => call('PATCH', `/api/content/${encodeURIComponent(id)}`, { status: 'rejected', reject_reason: reason }), 'Draft rejected')); break;
      case 'content-published': publishedModal(find(S.data.content)); break;
      case 'content-delete': confirmModal('Delete this draft?', 'It is removed for good.', 'Delete', () => act(() => call('DELETE', `/api/content/${encodeURIComponent(id)}`), 'Deleted')); break;
      case 'key-new': try { const r = await call('POST', '/api/keys', { name: 'Agency' }); await load(); S.animate = false; render(); keyModal(r.key); } catch (err) { toast(err.message); } break;
      case 'key-revoke': confirmModal('Revoke this key?', 'Anything using it stops being able to send drafts right away.', 'Revoke', () => act(() => call('DELETE', `/api/keys/${encodeURIComponent(id)}`), 'Key revoked')); break;
      case 'post-delete': confirmModal('Delete post?', 'It comes off the calendar for everyone.', 'Delete', () => act(() => call('DELETE', `/api/posts/${encodeURIComponent(id)}`), 'Post deleted')); break;
      case 'file-new': fileModal(); break;
      case 'video-open': videoModal(find(S.data.files)); break;
      case 'file-delete': confirmModal('Remove file?', 'The file is deleted for everyone.', 'Remove', () => act(() => call('DELETE', `/api/files/${encodeURIComponent(id)}`), 'File removed')); break;
      case 'person-new': personModal(null); break;
      case 'person-edit': personModal(find(S.data.people)); break;
      case 'person-delete': confirmModal('Remove person?', 'They lose access right away.', 'Remove', () => act(() => call('DELETE', `/api/people/${encodeURIComponent(id)}`), 'Person removed')); break;
      case 'person-level': { const p = find(S.data.people); if (p && p.level !== v) act(() => call('PATCH', `/api/people/${encodeURIComponent(id)}`, { level: v }), `${p.name} set to ${v === 'full' ? 'Full' : v === 'team' ? 'Team' : 'Overview'}`); break; }
      case 'person-link': {
        const p = find(S.data.people);
        const go = async () => { try { const r = await call('POST', `/api/people/${encodeURIComponent(id)}/link`, {}); await load(); S.animate = false; render(); linkModal(p, r.link); } catch (err) { toast(err.message); } };
        if (p.has_password && p.id !== S.data.me.id) confirmModal('Reset sign-in?', `${p.name} will be signed out and their password cleared. They use the new link to set a new one.`, 'Create reset link', go);
        else if (p.has_password || p.has_link) confirmModal('Create a new link?', p.id === S.data.me.id ? 'Your password is cleared and any older link stops working. You stay signed in here and can set a new password.' : `${p.name}'s older link stops working and they are signed out.`, 'Create link', go);
        else go();
        break;
      }
      case 'copy': try { await navigator.clipboard.writeText(v); toast('Link copied'); } catch (_) { toast('Select the link and copy it'); } break;
      case 'confirm-yes': { const fn = S._confirm; S._confirm = null; closeModal(); if (fn) fn(); break; }
      case 'div-locked': toast('Installation is always on'); break;
      case 'div-toggle': { const on = !S.data.settings[v]; act(() => call('PUT', '/api/settings', { [v]: on }), `${v === 'service' ? 'Service' : 'Commercial'} ${on ? 'added to' : 'hidden from'} the dashboard`); break; }
      case 'sample-clear': confirmModal('Remove sample data?', 'All demo campaigns, numbers, ideas, posts and files are deleted. Anything you entered yourself stays.', 'Remove sample data', () => act(() => call('POST', '/api/sample/clear', {}), 'Sample data removed')); break;
      default: break;
    }
  });

  // keep the brand form's typed values across a re-render
  function keepBrand() {
    const f = $app.querySelector('form[data-form="brand"]');
    const saved = f ? { name: f.name.value, primary: f.primary.value, accent: f.accent.value } : null;
    S.animate = false; render();
    const g = $app.querySelector('form[data-form="brand"]');
    if (g && saved) {
      g.name.value = saved.name; g.primary.value = saved.primary; g.accent.value = saved.accent;
      document.documentElement.style.setProperty('--navy', saved.primary);
      document.documentElement.style.setProperty('--red', saved.accent);
    }
  }

  // keep the compose form's typed values across a re-render
  function keepCompose(fn) {
    const f = $app.querySelector('form[data-form="post"]');
    const saved = f ? { caption: f.caption.value, date: f.date.value, time: f.time.value } : null;
    fn();
    const g = $app.querySelector('form[data-form="post"]');
    if (g && saved) { g.caption.value = saved.caption; g.date.value = saved.date; g.time.value = saved.time; }
  }

  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-change]');
    if (!el) return;
    if (el.dataset.change === 'brand-color') {
      const f = el.form;
      document.documentElement.style.setProperty(el.name === 'primary' ? '--navy' : '--red', el.value);
      if (f) f.dataset.dirty = '1';
    }
    if (el.dataset.change === 'brand-logo') {
      const file = el.files && el.files[0];
      if (!file) return;
      prepareLogo(file).then((u) => { if (u.length > 700000) { toast('That logo is too large. Try a smaller image.'); return; } S.brandLogo = u; keepBrand(); }).catch((err) => toast(err.message));
    }
    if (el.dataset.change === 'numbers-month') { S.numbersMonth = el.value; S.animate = false; render(); }
    if (el.dataset.change === 'post-image') {
      const file = el.files && el.files[0];
      if (S.draftImage) URL.revokeObjectURL(S.draftImage.url);
      S.draftImage = file ? { file, url: URL.createObjectURL(file) } : null;
      keepCompose(() => { S.animate = false; render(); });
    }
  });

  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('form[data-form]');
    if (!f) return;
    e.preventDefault();
    const btn = f.querySelector('button:not([type=button])');
    if (btn) btn.disabled = true;
    const fd = new FormData(f);
    const val = (k) => (fd.get(k) || '').toString().trim();
    try {
      switch (f.dataset.form) {
        case 'idea': {
          const text = val('text');
          if (!text) { toast('Type an idea first'); break; }
          await act(() => call('POST', '/api/ideas', { text }), 'Idea added');
          break;
        }
        case 'idea-status': {
          const status = f.dataset.status, id = f.dataset.id;
          const idea = S.data.ideas.find((i) => i.id === id);
          const wantsRoadmap = status === 'planned' && fd.get('roadmap');
          closeModal();
          await act(async () => {
            let note = val('note');
            if (wantsRoadmap) {
              await call('POST', '/api/campaigns', { name: idea.text.slice(0, 120), status: 'planned', start_date: val('start_date') || null, end_date: val('end_date') || null });
              note = note || 'Added to the roadmap';
            }
            await call('PATCH', `/api/ideas/${encodeURIComponent(id)}`, { status, note });
          }, status === 'planned' ? 'Idea planned' : 'Idea parked');
          break;
        }
        case 'campaign': {
          const body = {};
          ['name', 'status', 'start_date', 'end_date', 'code', 'channel', 'audience', 'budget', 'spend', 'verdict', 'rating', 'verdict_note', 'notes'].forEach((k) => { body[k] = val(k); });
          ['has_code', 'has_page', 'has_qr', 'trackable'].forEach((k) => { body[k] = !!fd.get(k); });
          if (body.start_date && body.end_date && body.end_date < body.start_date) { toast('End date is before the start date'); break; }
          if (body.status === 'live' && !(body.has_code && body.has_page && body.has_qr) && body.trackable) toast('Heads up: the launch checklist is not complete');
          const id = f.dataset.id;
          closeModal();
          await act(() => (id ? call('PATCH', `/api/campaigns/${encodeURIComponent(id)}`, body) : call('POST', '/api/campaigns', body)), id ? 'Campaign saved' : 'Campaign added');
          break;
        }
        case 'post': {
          if (!S.composeAccts.length) { toast('Choose at least one account'); break; }
          const caption = val('caption');
          if (!caption && !S.draftImage) { toast('Add a photo or a caption'); break; }
          const at = etToIso(val('date'), val('time'));
          if (S.draftImage) toast('Uploading photo...');
          await act(async () => {
            let file_id = null;
            if (S.draftImage) {
              const up = new FormData();
              up.append('file', await prepareImage(S.draftImage.file));
              up.append('kind', 'post');
              up.append('name', 'Post photo ' + val('date'));
              file_id = (await call('POST', '/api/files', up, true)).id;
            }
            const r = await call('POST', '/api/posts', { caption, accounts: S.composeAccts, scheduled_at: at, file_id });
            S.draftImage = null;
            S._lastPost = r.status;
          }, can('full') ? 'Post scheduled' : 'Post submitted');
          break;
        }
        case 'post-edit': {
          const accounts = Object.keys(ACCT_NAMES).filter((k) => fd.get('acct_' + k));
          if (!accounts.length) { toast('Choose at least one account'); break; }
          const id = f.dataset.id;
          closeModal();
          await act(() => call('PATCH', `/api/posts/${encodeURIComponent(id)}`, { caption: val('caption'), accounts, scheduled_at: etToIso(val('date'), val('time')), status: val('status') }), 'Post saved');
          break;
        }
        case 'numbers': {
          const mk = f.dataset.month;
          const divisions = enabledDivs().map((d) => ({ division: d, leads: val(`${d}_leads`), jobs: val(`${d}_jobs`), revenue: val(`${d}_revenue`) }))
            .filter((d) => d.leads !== '' || d.jobs !== '' || d.revenue !== '');
          const campaigns = [];
          for (const [k] of fd.entries()) {
            const m = /^c_(.+)_scans$/.exec(k);
            if (m) campaigns.push({ campaign_id: m[1], scans: val(`c_${m[1]}_scans`), forms: val(`c_${m[1]}_forms`), mentions: val(`c_${m[1]}_mentions`) });
          }
          await act(() => call('PUT', '/api/monthly', { month: mk, divisions, spend: val('spend'), budget: val('budget'), campaigns: campaigns.filter((c) => c.scans !== '' || c.forms !== '' || c.mentions !== '') }), `${monthLabel(mk, true).split(' ')[0]} numbers saved`);
          S.numbersMonth = mk;
          break;
        }
        case 'file': {
          const file = fd.get('file');
          if (!file || !file.size) { toast('Choose a file'); break; }
          const ready = await prepareImage(file);
          const big = S.data.settings.bigFiles;
          const limit = (big ? 95 : 20) * 1024 * 1024;
          if (ready.size > limit) { toast(`Files must be under ${big ? 95 : 20} MB`); break; }
          closeModal();
          if (big) {
            const q = new URLSearchParams({ name: val('name'), kind: val('kind'), amount: val('amount'), campaign_id: val('campaign_id'), filename: ready.name || 'file' });
            await act(() => uploadBig(ready, q), 'File uploaded');
          } else {
            fd.set('file', ready);
            toast('Uploading...');
            await act(() => call('POST', '/api/files', fd, true), 'File uploaded');
          }
          break;
        }
        case 'reason': {
          const fn = S._reason; S._reason = null;
          const reason = val('reason');
          closeModal();
          if (fn) await fn(reason);
          break;
        }
        case 'content-edit': {
          const id = f.dataset.id;
          await act(() => call('PATCH', `/api/content/${encodeURIComponent(id)}`, { title: val('title'), excerpt: val('excerpt'), body: (fd.get('body') || '').toString() }), 'Saved');
          contentModal(S.data.content.find((c) => c.id === id));
          break;
        }
        case 'content-published': {
          const id = f.dataset.id;
          closeModal();
          await act(() => call('PATCH', `/api/content/${encodeURIComponent(id)}`, { status: 'published', published_url: val('url') }), 'Marked published');
          break;
        }
        case 'password': {
          if (val('password') !== val('confirm')) { toast('The two passwords do not match'); break; }
          const first = !S.data.me.hasPassword;
          try {
            await call('PUT', '/api/account/password', { email: val('email'), password: val('password'), current: val('current') });
            closeModal();
            await load();
            S.animate = false;
            render();
            toast(first ? 'All set. Use your email and password next time.' : 'Saved');
          } catch (err) { toast(err.message); }
          break;
        }
        case 'brand': {
          const body = { brand_name: val('name'), brand_primary: val('primary'), brand_accent: val('accent') };
          if (S.data.demo) {
            const prev = { name: body.brand_name, primary: body.brand_primary, accent: body.brand_accent };
            // Without an uploaded logo, the preview shows the typed name instead of Acme's logo.
            if (S.brandLogo !== undefined) prev.logo = S.brandLogo || null; else { const p = demoPreview(); prev.logo = p && 'logo' in p ? p.logo : null; }
            try { localStorage.setItem('abri-demo-brand', JSON.stringify(prev)); } catch (_) { toast('Your browser blocked the preview'); break; }
            S.brandLogo = undefined; applyBrand(); S.animate = false; render(); toast('Previewing your brand in this browser');
            break;
          }
          if (S.brandLogo !== undefined) body.brand_logo = S.brandLogo;
          await act(() => call('PUT', '/api/settings', body), 'Brand saved');
          S.brandLogo = undefined;
          break;
        }
        case 'accounts': {
          const rows = readAcctRows(f).filter((a) => a.name);
          if (!rows.length) { toast('Keep at least one account'); break; }
          await act(() => call('PUT', '/api/settings', { accounts: rows }), 'Accounts saved');
          S.acctDraft = null;
          break;
        }
        case 'person': {
          const id = f.dataset.id;
          const body = { name: val('name'), label: val('label'), initials: val('initials') };
          if (!id) body.level = val('level');
          closeModal();
          await act(() => (id ? call('PATCH', `/api/people/${encodeURIComponent(id)}`, body) : call('POST', '/api/people', body)), id ? 'Saved' : 'Person added. Create their sign-in link next.');
          break;
        }
        default: break;
      }
    } finally {
      if (btn && btn.isConnected) btn.disabled = false;
    }
  });

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $overlay.innerHTML && !S.modalLocked) closeModal(); });

  // ---------- start ----------
  (async () => {
    try {
      await load();
      render();
      if (!S.data.me.hasPassword && !S.data.demo) passwordModal(true);
    } catch (e) {
      $app.innerHTML = `<div class="loading"><div class="empty">${esc(e.message)}. Refresh to try again.</div></div>`;
    }
  })();
})();
