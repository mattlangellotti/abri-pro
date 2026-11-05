import { ensureSchema, resetDemo, DEFAULT_ACCOUNTS } from './schema.js';
import { DEMO_ROLES } from './demo.js';

const RANK = { overview: 1, team: 2, full: 3, admin: 4 };
const LEVELS = ['overview', 'team', 'full', 'admin'];
const DIVISIONS = ['install', 'service', 'commercial'];
const CAMPAIGN_STATUS = ['planned', 'ready', 'live', 'done'];
const IDEA_STATUS = ['new', 'considering', 'planned', 'parked'];
const POST_STATUS = ['draft', 'submitted', 'scheduled', 'published', 'failed', 'rejected'];
const CONTENT_STATUS = ['draft', 'approved', 'published', 'rejected'];
const MAX_AGENT_BODY = 8 * 1024 * 1024;
const VERDICTS = ['worked', 'mixed', 'flopped'];
const SESSION_DAYS = 60;
const MAX_UPLOAD = 20 * 1024 * 1024;
const MAX_BIG_UPLOAD = 95 * 1024 * 1024;
const INLINE_TYPES = /^(image\/(png|jpe?g|gif|webp)|application\/pdf|video\/(mp4|quicktime|webm)|audio\/(mpeg|mp4|x-m4a))$/;
const PUBLIC_PATHS = new Set(['/app.css', '/landing.css', '/landing.js', '/favicon.svg', '/manifest.webmanifest', '/img/icon-180.png', '/img/icon-512.png', '/img/acme-logo.svg', '/img/abri-mark.svg']);
const DEMO_MAX_UPLOAD = 5 * 1024 * 1024;
const isDemo = (env) => env.DEMO === '1';
const HEX = /^#[0-9a-fA-F]{6}$/;

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: 'Something went wrong' }, 500);
    }
  },
  // Nightly: the demo wipes itself and reseeds Acme Air with fresh dates.
  async scheduled(event, env, ctx) {
    if (!isDemo(env)) return;
    await ensureSchema(env);
    ctx.waitUntil(resetDemo(env));
  }
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (PUBLIC_PATHS.has(path)) return env.ASSETS.fetch(request);

  await ensureSchema(env);

  if (path === '/brand/logo') return brandLogo(env, request);
  if (path === '/demo/enter' && request.method === 'POST') return demoEnter(request, env, url);
  if (path === '/auth/setup' && request.method === 'POST') return setupAdmin(request, env, url);
  if (path.startsWith('/signin/')) return signIn(request, env, path.slice(8));
  if (path === '/auth/login' && request.method === 'POST') return passwordLogin(request, env, url);
  if (path.startsWith('/agent/')) return agentApi(request, env, url);

  const me = await currentPerson(request, env);

  if (path.startsWith('/api/')) {
    if (!me) return json({ error: 'Signed out' }, 401);
    if (request.method !== 'GET' && request.method !== 'HEAD') checkOrigin(request, url);
    return api(request, env, me, url);
  }

  if (!me) return signedOutPage(env, null, url.searchParams.get('email'));

  const res = await env.ASSETS.fetch(request);
  if (res.status === 404) return env.ASSETS.fetch(new Request(new URL('/index.html', url), request));
  return res;
}

// ---------- auth ----------

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomToken(bytes = 24) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Passwords: PBKDF2-SHA256, 100k iterations (the Workers maximum), random 16-byte salt.
const PBKDF2_ITER = 100000;
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function pbkdf2(password, salt, iter) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
}
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PBKDF2_ITER}$${b64(salt)}$${b64(await pbkdf2(password, salt, PBKDF2_ITER))}`;
}
async function checkPassword(password, stored) {
  const [kind, iter, salt, hash] = String(stored || '').split('$');
  if (kind !== 'pbkdf2' || !hash) return false;
  const got = new Uint8Array(await pbkdf2(password, unb64(salt), Number(iter)));
  const want = unb64(hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}
const normEmail = (v) => String(v || '').trim().toLowerCase().slice(0, 120);
const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

async function startSession(env, personId, location = '/') {
  const sid = randomToken(32);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 864e5);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO sessions (id_hash, person_id, created_at, expires_at) VALUES (?, ?, ?, ?)`).bind(await sha256(sid), personId, now.toISOString(), expires.toISOString()),
    env.DB.prepare(`UPDATE people SET status = 'active', last_seen = ?, fails = 0, locked_until = NULL WHERE id = ?`).bind(now.toISOString(), personId),
    env.DB.prepare(`DELETE FROM sessions WHERE expires_at < ?`).bind(now.toISOString())
  ]);
  return new Response(null, {
    status: 303,
    headers: {
      Location: location,
      'Set-Cookie': `hub_session=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`,
      'Cache-Control': 'no-store'
    }
  });
}

async function passwordLogin(request, env, url) {
  if (isDemo(env)) return signedOutPage(env, null);
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return signedOutPage(env, 'Please try again.');
  const form = await request.formData().catch(() => null);
  const email = normEmail(form && form.get('email'));
  const password = String((form && form.get('password')) || '');
  const generic = 'That email and password do not match. Try again, or ask your admin for a reset link.';
  if (!email || !password) return signedOutPage(env, 'Enter your email and password.', email);
  const p = await env.DB.prepare(`SELECT id, pw_hash, fails, locked_until FROM people WHERE email = ?`).bind(email).first();
  const now = new Date();
  if (p && p.locked_until && p.locked_until > now.toISOString()) return signedOutPage(env, 'Too many tries. Wait 15 minutes, or ask your admin for a reset link.', email);
  const ok = p && p.pw_hash ? await checkPassword(password, p.pw_hash) : (await hashPassword(password), false);
  if (!ok) {
    if (p) {
      const fails = (p.fails || 0) + 1;
      const lock = fails >= 8 ? new Date(now.getTime() + 15 * 60000).toISOString() : null;
      await env.DB.prepare(`UPDATE people SET fails = ?, locked_until = ? WHERE id = ?`).bind(lock ? 0 : fails, lock, p.id).run();
    }
    return signedOutPage(env, generic, email);
  }
  return startSession(env, p.id);
}

async function signIn(request, env, token) {
  if (!token || token.length < 20) return signedOutPage(env, 'That sign-in link is not valid.');
  const hash = await sha256(token);
  const person = await env.DB.prepare(`SELECT id FROM people WHERE token_hash = ?`).bind(hash).first();
  if (!person) return signedOutPage(env, 'That link has already been used or replaced. Sign in with your email and password below.');
  return startSession(env, person.id);
}

// Demo: one click signs a visitor in as one of the Acme Air people.
async function demoEnter(request, env, url) {
  if (!isDemo(env)) return new Response('Not found', { status: 404 });
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return signedOutPage(env, 'Please try again.');
  const form = await request.formData().catch(() => null);
  const pid = DEMO_ROLES[String((form && form.get('role')) || '')];
  if (!pid) return signedOutPage(env, 'Pick a role to try.');
  const p = await env.DB.prepare(`SELECT id FROM people WHERE id = ?`).bind(pid).first();
  if (!p) return signedOutPage(env, 'The demo is resetting. Try again in a minute.');
  return startSession(env, p.id);
}

// A brand-new hub has nobody on it. The first visitor creates the admin account and names the company.
async function setupAdmin(request, env, url) {
  if (isDemo(env)) return new Response('Not found', { status: 404 });
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return signedOutPage(env, 'Please try again.');
  const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM people`).first();
  if (count.n > 0) return signedOutPage(env, 'This hub is already set up. Sign in below.');
  const form = await request.formData().catch(() => null);
  const get = (k) => String((form && form.get(k)) || '').trim();
  const company = get('company').slice(0, 80);
  const name = get('name').slice(0, 80);
  const email = normEmail(get('email'));
  const password = String((form && form.get('password')) || '');
  if (!company || !name) return signedOutPage(env, 'Enter the company name and your name.');
  if (!validEmail(email)) return signedOutPage(env, 'Enter a valid email address.');
  if (password.length < 8 || password.length > 200) return signedOutPage(env, 'Use a password of at least 8 characters.');
  const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const pid = newId();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO people (id, name, label, initials, level, status, sort, created_at, email, pw_hash) VALUES (?, ?, '', ?, 'admin', 'active', 0, ?, ?, ?)`)
      .bind(pid, name, initials, nowIso(), email, await hashPassword(password)),
    env.DB.prepare(`INSERT INTO settings (key, value) VALUES ('brand_name', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(company)
  ]);
  return startSession(env, pid);
}

async function readSettings(env) {
  const rows = await all(env, `SELECT key, value FROM settings`);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
async function accountList(env, settings) {
  const s = settings || await readSettings(env);
  const list = safeJson(s.accounts, null);
  return Array.isArray(list) && list.length ? list : DEFAULT_ACCOUNTS;
}
const accountIds = async (env) => (await accountList(env)).map((a) => a.id);

// The company logo: a site path or an uploaded image stored as a data URL in settings.
async function brandLogo(env, request) {
  const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'brand_logo'`).first();
  const v = row && row.value;
  if (!v) return new Response('Not found', { status: 404 });
  if (v.startsWith('/')) return env.ASSETS.fetch(new Request(new URL(v, request.url), request));
  const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(v);
  if (!m) return new Response('Not found', { status: 404 });
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  return new Response(bytes, { headers: { 'Content-Type': m[1], 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
}

function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

async function currentPerson(request, env) {
  const sid = readCookie(request, 'hub_session');
  if (!sid) return null;
  const row = await env.DB.prepare(
    `SELECT p.id, p.name, p.label, p.initials, p.level, p.email, CASE WHEN p.pw_hash IS NULL THEN 0 ELSE 1 END AS has_password, s.expires_at FROM sessions s JOIN people p ON p.id = s.person_id WHERE s.id_hash = ?`
  ).bind(await sha256(sid)).first();
  if (!row || row.expires_at < new Date().toISOString()) return null;
  row.sid = sid;
  return row;
}

function checkOrigin(request, url) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) fail(403, 'Blocked');
  if (!request.headers.get('X-Hub')) fail(403, 'Blocked');
}

function notInDemo(env, what) {
  if (isDemo(env)) fail(403, `${what} is switched off in the demo. In your own hub it works normally.`);
}

function need(me, level) {
  if (RANK[me.level] < RANK[level]) fail(403, 'Not available');
}

// ---------- api ----------

async function api(request, env, me, url) {
  const m = request.method;
  const parts = url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
  const [res, id, sub] = parts;
  const body = (m === 'POST' || m === 'PUT' || m === 'PATCH') && res !== 'files'
    ? await request.json().catch(() => ({})) : null;

  switch (res) {
    case 'bootstrap': return json(await bootstrap(env, me));
    case 'signout': {
      await env.DB.prepare(`DELETE FROM sessions WHERE id_hash = ?`).bind(await sha256(me.sid)).run();
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'hub_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax' } });
    }
    case 'account': notInDemo(env, 'Changing the sign-in'); return accountApi(env, me, m, id, body);
    case 'content': return contentApi(env, me, m, id, body);
    case 'keys': if (m !== 'GET') notInDemo(env, 'Creating Agency keys'); return keysApi(env, me, m, id, body);
    case 'ideas': return ideasApi(env, me, m, id, sub, body);
    case 'campaigns': return campaignsApi(env, me, m, id, body);
    case 'monthly': return monthlyApi(env, me, m, body);
    case 'posts': return postsApi(env, me, m, id, body);
    case 'files': return filesApi(request, env, me, m, id, sub);
    case 'people': return peopleApi(request, env, me, m, id, sub, body);
    case 'settings': return settingsApi(env, me, m, body);
    case 'sample': notInDemo(env, 'Removing sample data'); return sampleApi(env, me, m, id);
    default: fail(404, 'Not found');
  }
}

async function all(env, sql, ...args) {
  const r = await env.DB.prepare(sql).bind(...args).all();
  return r.results || [];
}

async function bootstrap(env, me) {
  const rank = RANK[me.level];
  const [settingsRows, people, campaigns, campaignMonths, monthly, spend, ideas, posts, files, sample, content, keys, votes] = await Promise.all([
    all(env, `SELECT key, value FROM settings`),
    all(env, rank >= 4
      ? `SELECT id, name, label, initials, level, status, last_seen, sort, email, CASE WHEN token_hash IS NULL THEN 0 ELSE 1 END AS has_link, CASE WHEN pw_hash IS NULL THEN 0 ELSE 1 END AS has_password FROM people ORDER BY sort, name`
      : `SELECT id, name, initials FROM people ORDER BY sort, name`),
    all(env, `SELECT * FROM campaigns ORDER BY start_date`),
    all(env, `SELECT * FROM campaign_months`),
    all(env, `SELECT * FROM monthly ORDER BY month`),
    all(env, `SELECT * FROM monthly_spend ORDER BY month`),
    all(env, `SELECT * FROM ideas ORDER BY created_at DESC`),
    all(env, `SELECT * FROM posts ORDER BY scheduled_at`),
    rank >= 2 ? all(env, `SELECT id, name, campaign_id, kind, amount, content_type, size, stored, image_url, uploaded_by, is_sample, created_at FROM files ORDER BY created_at DESC`) : [],
    env.DB.prepare(`SELECT (SELECT COUNT(*) FROM campaigns WHERE is_sample = 1) + (SELECT COUNT(*) FROM monthly WHERE is_sample = 1) + (SELECT COUNT(*) FROM ideas WHERE is_sample = 1) + (SELECT COUNT(*) FROM posts WHERE is_sample = 1) + (SELECT COUNT(*) FROM files WHERE is_sample = 1) AS n`).first(),
    rank >= 2 ? all(env, `SELECT * FROM content ORDER BY created_at DESC LIMIT 300`) : [],
    rank >= 4 ? all(env, `SELECT id, name, prefix, created_at, last_used, revoked_at FROM api_keys ORDER BY created_at DESC`) : [],
    all(env, `SELECT idea_id, COUNT(*) AS n, MAX(CASE WHEN person_id = ? THEN 1 ELSE 0 END) AS mine FROM idea_votes GROUP BY idea_id`, me.id)
  ]);
  const voteMap = Object.fromEntries(votes.map((v) => [v.idea_id, v]));
  const settings = Object.fromEntries(settingsRows.map((r) => [r.key, r.value]));
  return {
    me: { id: me.id, name: me.name, initials: me.initials, level: me.level, email: me.email || '', hasPassword: !!me.has_password },
    settings: { service: settings.service !== '0', commercial: settings.commercial === '1', budget: Number(settings.budget || 0), bigFiles: !!env.MEDIA && !isDemo(env) },
    brand: brandOf(settings),
    accounts: await accountList(env, settings),
    demo: isDemo(env),
    people, campaigns, campaignMonths, monthly, spend,
    ideas: ideas.map((i) => ({ ...i, votes: voteMap[i.id] ? voteMap[i.id].n : 0, voted: !!(voteMap[i.id] && voteMap[i.id].mine) })),
    posts: posts.map((p) => ({ ...p, accounts: safeJson(p.accounts, []) })),
    files,
    content: content.map((c) => ({ ...c, sources: safeJson(c.sources, []) })),
    keys,
    hasSample: (sample && sample.n) > 0
  };
}

function brandOf(s) {
  return {
    name: s.brand_name || 'Your company',
    primary: HEX.test(s.brand_primary || '') ? s.brand_primary : '#1E3A5F',
    accent: HEX.test(s.brand_accent || '') ? s.brand_accent : '#E0592A',
    logo: s.brand_logo ? `/brand/logo?v=${hashCode(s.brand_logo)}` : null
  };
}
function hashCode(str) { let h = 0; for (let i = 0; i < str.length; i += 97) h = (h * 31 + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36) + str.length.toString(36); }

const safeJson = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
const nowIso = () => new Date().toISOString();
const newId = () => crypto.randomUUID();
const str = (v, max = 500) => (v == null ? '' : String(v)).trim().slice(0, max);
const int = (v) => { const n = Math.round(Number(String(v ?? '').replace(/[$,\s]/g, ''))); return Number.isFinite(n) ? Math.max(0, n) : 0; };
const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);
const monthKey = (v) => (/^\d{4}-\d{2}$/.test(v || '') ? v : fail(400, 'Bad month'));
const oneOf = (v, list, d) => (list.includes(v) ? v : d);

async function accountApi(env, me, m, id, b) {
  if (m !== 'PUT' || id !== 'password') fail(405, 'Not allowed');
  const email = normEmail(b.email);
  const password = String(b.password || '');
  if (!validEmail(email)) fail(400, 'Enter a valid email address');
  if (password.length < 8) fail(400, 'Use at least 8 characters for your password');
  if (password.length > 200) fail(400, 'That password is too long');
  const cur = await env.DB.prepare(`SELECT pw_hash FROM people WHERE id = ?`).bind(me.id).first();
  if (cur && cur.pw_hash && !(await checkPassword(String(b.current || ''), cur.pw_hash))) fail(400, 'Your current password is not right');
  const taken = await env.DB.prepare(`SELECT id FROM people WHERE email = ? AND id <> ?`).bind(email, me.id).first();
  if (taken) fail(400, 'That email is already used by someone else on the list');
  await env.DB.batch([
    env.DB.prepare(`UPDATE people SET email = ?, pw_hash = ?, token_hash = NULL, fails = 0, locked_until = NULL WHERE id = ?`).bind(email, await hashPassword(password), me.id),
    env.DB.prepare(`DELETE FROM sessions WHERE person_id = ? AND id_hash <> ?`).bind(me.id, await sha256(me.sid))
  ]);
  return json({ ok: true });
}

async function ideasApi(env, me, m, id, sub, b) {
  // Anyone can vote, once per idea. A second tap takes the vote back.
  if (m === 'POST' && id && sub === 'vote') {
    const idea = await env.DB.prepare(`SELECT id FROM ideas WHERE id = ?`).bind(id).first() || fail(404, 'Not found');
    const had = await env.DB.prepare(`SELECT 1 AS x FROM idea_votes WHERE idea_id = ? AND person_id = ?`).bind(idea.id, me.id).first();
    if (had) await env.DB.prepare(`DELETE FROM idea_votes WHERE idea_id = ? AND person_id = ?`).bind(idea.id, me.id).run();
    else await env.DB.prepare(`INSERT INTO idea_votes (idea_id, person_id, created_at) VALUES (?, ?, ?)`).bind(idea.id, me.id, nowIso()).run();
    return json({ voted: !had });
  }
  if (m === 'POST' && !id) {
    const text = str(b.text, 400);
    if (!text) fail(400, 'Type an idea first');
    const t = nowIso();
    const row = { id: newId(), text, by_person: me.id, status: 'new', note: '', is_sample: 0, created_at: t, updated_at: t };
    await env.DB.prepare(`INSERT INTO ideas (id, text, by_person, status, note, is_sample, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`)
      .bind(row.id, row.text, row.by_person, row.status, row.note, t, t).run();
    return json(row);
  }
  need(me, 'full');
  if (m === 'PATCH' && id) {
    const cur = await env.DB.prepare(`SELECT * FROM ideas WHERE id = ?`).bind(id).first() || fail(404, 'Not found');
    const status = oneOf(b.status, IDEA_STATUS, cur.status);
    const note = b.note !== undefined ? str(b.note, 300) : cur.note;
    await env.DB.prepare(`UPDATE ideas SET status = ?, note = ?, updated_at = ? WHERE id = ?`).bind(status, note, nowIso(), id).run();
    return json({ ok: true });
  }
  if (m === 'DELETE' && id) {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM idea_votes WHERE idea_id = ?`).bind(id),
      env.DB.prepare(`DELETE FROM ideas WHERE id = ?`).bind(id)
    ]);
    return json({ ok: true });
  }
  fail(405, 'Not allowed');
}

function campaignFields(b, cur = {}) {
  const pick = (k, f) => (b[k] !== undefined ? f(b[k]) : (cur[k] ?? null));
  const bool = (v) => (v ? 1 : 0);
  return {
    name: pick('name', (v) => str(v, 120)) || fail(400, 'Name is required'),
    code: pick('code', (v) => str(v, 40).toUpperCase()),
    channel: pick('channel', (v) => str(v, 80)),
    audience: pick('audience', (v) => str(v, 160)),
    status: pick('status', (v) => oneOf(v, CAMPAIGN_STATUS, 'planned')) || 'planned',
    start_date: pick('start_date', date),
    end_date: pick('end_date', date),
    budget: pick('budget', int) || 0,
    spend: pick('spend', int) || 0,
    has_code: pick('has_code', bool) || 0,
    has_page: pick('has_page', bool) || 0,
    has_qr: pick('has_qr', bool) || 0,
    trackable: b.trackable !== undefined ? bool(b.trackable) : (cur.trackable ?? 1),
    verdict: pick('verdict', (v) => oneOf(v, VERDICTS, null)),
    verdict_note: pick('verdict_note', (v) => str(v, 200)),
    rating: pick('rating', (v) => { const n = int(v); return n >= 1 && n <= 5 ? n : null; }),
    notes: pick('notes', (v) => str(v, 1000))
  };
}

async function campaignsApi(env, me, m, id, b) {
  need(me, 'full');
  if (m === 'POST' && !id) {
    const f = campaignFields(b);
    const t = nowIso();
    const cid = newId();
    await env.DB.prepare(`INSERT INTO campaigns (id, name, code, channel, audience, status, start_date, end_date, budget, spend, has_code, has_page, has_qr, trackable, verdict, verdict_note, rating, notes, is_sample, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
      .bind(cid, f.name, f.code, f.channel, f.audience, f.status, f.start_date, f.end_date, f.budget, f.spend, f.has_code, f.has_page, f.has_qr, f.trackable, f.verdict, f.verdict_note, f.rating, f.notes, t, t).run();
    return json({ id: cid });
  }
  if (m === 'PATCH' && id) {
    const cur = await env.DB.prepare(`SELECT * FROM campaigns WHERE id = ?`).bind(id).first() || fail(404, 'Not found');
    const f = campaignFields(b, cur);
    await env.DB.prepare(`UPDATE campaigns SET name = ?, code = ?, channel = ?, audience = ?, status = ?, start_date = ?, end_date = ?, budget = ?, spend = ?, has_code = ?, has_page = ?, has_qr = ?, trackable = ?, verdict = ?, verdict_note = ?, rating = ?, notes = ?, updated_at = ? WHERE id = ?`)
      .bind(f.name, f.code, f.channel, f.audience, f.status, f.start_date, f.end_date, f.budget, f.spend, f.has_code, f.has_page, f.has_qr, f.trackable, f.verdict, f.verdict_note, f.rating, f.notes, nowIso(), id).run();
    return json({ ok: true });
  }
  if (m === 'DELETE' && id) {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM campaign_months WHERE campaign_id = ?`).bind(id),
      env.DB.prepare(`UPDATE files SET campaign_id = NULL WHERE campaign_id = ?`).bind(id),
      env.DB.prepare(`DELETE FROM campaigns WHERE id = ?`).bind(id)
    ]);
    return json({ ok: true });
  }
  fail(405, 'Not allowed');
}

async function monthlyApi(env, me, m, b) {
  need(me, 'full');
  if (m !== 'PUT') fail(405, 'Not allowed');
  const month = monthKey(b.month);
  const st = [];
  for (const d of b.divisions || []) {
    if (!DIVISIONS.includes(d.division)) continue;
    st.push(env.DB.prepare(`INSERT INTO monthly (month, division, leads, jobs, revenue, is_sample) VALUES (?, ?, ?, ?, ?, 0)
      ON CONFLICT(month, division) DO UPDATE SET leads = excluded.leads, jobs = excluded.jobs, revenue = excluded.revenue, is_sample = 0`)
      .bind(month, d.division, int(d.leads), int(d.jobs), int(d.revenue)));
  }
  if (b.spend !== undefined && b.spend !== '') {
    st.push(env.DB.prepare(`INSERT INTO monthly_spend (month, spend, is_sample) VALUES (?, ?, 0) ON CONFLICT(month) DO UPDATE SET spend = excluded.spend, is_sample = 0`).bind(month, int(b.spend)));
  }
  for (const c of b.campaigns || []) {
    if (!c.campaign_id) continue;
    st.push(env.DB.prepare(`INSERT INTO campaign_months (campaign_id, month, scans, forms, mentions, is_sample) VALUES (?, ?, ?, ?, ?, 0)
      ON CONFLICT(campaign_id, month) DO UPDATE SET scans = excluded.scans, forms = excluded.forms, mentions = excluded.mentions, is_sample = 0`)
      .bind(str(c.campaign_id, 80), month, int(c.scans), int(c.forms), int(c.mentions)));
  }
  if (b.budget !== undefined && b.budget !== '') {
    st.push(env.DB.prepare(`INSERT INTO settings (key, value) VALUES ('budget', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(String(int(b.budget))));
  }
  if (st.length) await env.DB.batch(st);
  return json({ ok: true });
}

async function postsApi(env, me, m, id, b) {
  if (m === 'POST' && !id) {
    need(me, 'team');
    const ACCOUNTS = await accountIds(env);
    const accounts = (Array.isArray(b.accounts) ? b.accounts : []).filter((a) => ACCOUNTS.includes(a));
    if (!accounts.length) fail(400, 'Choose at least one account');
    const at = b.scheduled_at && !isNaN(Date.parse(b.scheduled_at)) ? new Date(b.scheduled_at).toISOString() : fail(400, 'Pick a date and time');
    const status = RANK[me.level] >= RANK.full ? 'scheduled' : 'submitted';
    const t = nowIso();
    const pid = newId();
    let fileId = null;
    if (b.file_id) {
      const f = await env.DB.prepare(`SELECT id FROM files WHERE id = ?`).bind(str(b.file_id, 80)).first();
      fileId = f ? f.id : null;
    }
    await env.DB.prepare(`INSERT INTO posts (id, caption, accounts, scheduled_at, status, file_id, by_person, is_sample, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
      .bind(pid, str(b.caption, 2200), JSON.stringify(accounts), at, status, fileId, me.id, t, t).run();
    return json({ id: pid, status });
  }
  need(me, 'full');
  if (m === 'PATCH' && id) {
    const cur = await env.DB.prepare(`SELECT * FROM posts WHERE id = ?`).bind(id).first() || fail(404, 'Not found');
    const ACCOUNTS = await accountIds(env);
    const accounts = Array.isArray(b.accounts) ? b.accounts.filter((a) => ACCOUNTS.includes(a)) : safeJson(cur.accounts, []);
    const at = b.scheduled_at && !isNaN(Date.parse(b.scheduled_at)) ? new Date(b.scheduled_at).toISOString() : cur.scheduled_at;
    await env.DB.prepare(`UPDATE posts SET caption = ?, accounts = ?, scheduled_at = ?, status = ?, reject_reason = ?, updated_at = ? WHERE id = ?`)
      .bind(b.caption !== undefined ? str(b.caption, 2200) : cur.caption, JSON.stringify(accounts), at, oneOf(b.status, POST_STATUS, cur.status),
        b.reject_reason !== undefined ? str(b.reject_reason, 300) : cur.reject_reason ?? null, nowIso(), id).run();
    return json({ ok: true });
  }
  if (m === 'DELETE' && id) {
    await env.DB.prepare(`DELETE FROM posts WHERE id = ?`).bind(id).run();
    return json({ ok: true });
  }
  fail(405, 'Not allowed');
}

async function deleteStoredFile(env, row) {
  if (!row) return;
  if (row.store === 'r2' && env.MEDIA) await env.MEDIA.delete(`file:${row.id}`);
  else await env.FILES.delete(`file:${row.id}`);
}

async function fileMeta(env, src) {
  const kind = oneOf(str(src.get('kind'), 20), ['invoice', 'creative', 'post', 'other'], 'other');
  const amountRaw = str(src.get('amount'), 20);
  let campaign = str(src.get('campaign_id'), 80) || null;
  if (campaign) {
    const c = await env.DB.prepare(`SELECT id FROM campaigns WHERE id = ?`).bind(campaign).first();
    campaign = c ? c.id : null;
  }
  return { kind, amount: amountRaw ? int(amountRaw) : null, campaign };
}

async function filesApi(request, env, me, m, id, sub) {
  need(me, 'team');
  // Large uploads: raw body streamed straight to R2, details in the query string.
  if (m === 'PUT' && id === 'upload') {
    if (!env.MEDIA || isDemo(env)) fail(400, 'Large uploads are not switched on here');
    const url = new URL(request.url);
    const len = Number(request.headers.get('Content-Length') || 0);
    if (!len || !request.body) fail(400, 'Choose a file');
    if (len > MAX_BIG_UPLOAD) fail(400, 'Files must be under 95 MB');
    const q = url.searchParams;
    const meta = await fileMeta(env, q);
    const fileName = str(q.get('filename'), 200) || 'file';
    const name = str(q.get('name'), 120) || str(fileName, 120) || 'File';
    const type = str(request.headers.get('Content-Type'), 100) || 'application/octet-stream';
    const fid = newId();
    // A request body with a Content-Length is a known-length stream, which R2 accepts directly.
    const obj = await env.MEDIA.put(`file:${fid}`, request.body, { httpMetadata: { contentType: type }, customMetadata: { name: fileName } });
    if (!obj || obj.size !== len) { await env.MEDIA.delete(`file:${fid}`); fail(400, 'Upload was incomplete. Try again.'); }
    await env.DB.prepare(`INSERT INTO files (id, name, campaign_id, kind, amount, content_type, size, stored, store, uploaded_by, is_sample, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'r2', ?, 0, ?)`)
      .bind(fid, name, meta.campaign, meta.kind, meta.amount, type, len, me.id, nowIso()).run();
    return json({ id: fid });
  }
  if (m === 'POST' && !id) {
    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') fail(400, 'Choose a file');
    if (file.size > MAX_UPLOAD) fail(400, 'Files must be under 20 MB');
    if (isDemo(env) && file.size > DEMO_MAX_UPLOAD) fail(400, 'The demo takes files up to 5 MB. Your own hub takes videos up to 95 MB.');
    const fid = newId();
    const meta = await fileMeta(env, form);
    const name = str(form.get('name'), 120) || str(file.name, 120) || 'File';
    const type = file.type || 'application/octet-stream';
    const bytes = await file.arrayBuffer();
    let store = 'kv';
    if (env.MEDIA && !isDemo(env)) {
      await env.MEDIA.put(`file:${fid}`, bytes, { httpMetadata: { contentType: type }, customMetadata: { name: str(file.name, 200) } });
      store = 'r2';
    } else {
      await env.FILES.put(`file:${fid}`, bytes, { metadata: { type, name: str(file.name, 200) } });
    }
    await env.DB.prepare(`INSERT INTO files (id, name, campaign_id, kind, amount, content_type, size, stored, store, uploaded_by, is_sample, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0, ?)`)
      .bind(fid, name, meta.campaign, meta.kind, meta.amount, type, file.size, store, me.id, nowIso()).run();
    return json({ id: fid });
  }
  if (m === 'GET' && id && sub === 'raw') {
    const row = await env.DB.prepare(`SELECT * FROM files WHERE id = ?`).bind(id).first() || fail(404, 'Not found');
    const type = row.content_type || 'application/octet-stream';
    const forceDownload = new URL(request.url).searchParams.get('download') === '1';
    const inline = INLINE_TYPES.test(type) && !forceDownload;
    const isMedia = /^(video|audio)\//.test(type);
    const headers = {
      'Content-Type': inline || isMedia ? type : 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      // Media keeps playable headers; everything else is locked down.
      'Content-Security-Policy': isMedia ? "default-src 'none'; media-src 'self'" : "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
      'Cache-Control': 'private, max-age=3600',
      'Accept-Ranges': 'bytes'
    };
    const disp = (n) => `${inline ? 'inline' : 'attachment'}; filename="${String(n || row.name).replace(/[^\w.\- ]/g, '_')}"`;
    if (row.store === 'r2' && env.MEDIA) {
      const size = row.size || 0;
      const rangeHdr = request.headers.get('Range');
      const mm = rangeHdr && /^bytes=(\d*)-(\d*)$/.exec(rangeHdr.trim());
      if (mm && size) {
        let start = mm[1] === '' ? Math.max(0, size - Number(mm[2])) : Number(mm[1]);
        let end = mm[1] !== '' && mm[2] !== '' ? Math.min(Number(mm[2]), size - 1) : size - 1;
        if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
        const obj = await env.MEDIA.get(`file:${id}`, { range: { offset: start, length: end - start + 1 } });
        if (!obj) fail(404, 'Not found');
        return new Response(obj.body, { status: 206, headers: { ...headers, 'Content-Disposition': disp(obj.customMetadata && obj.customMetadata.name), 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) } });
      }
      const obj = await env.MEDIA.get(`file:${id}`);
      if (!obj) fail(404, 'Not found');
      return new Response(obj.body, { headers: { ...headers, 'Content-Disposition': disp(obj.customMetadata && obj.customMetadata.name), 'Content-Length': String(obj.size) } });
    }
    const obj = await env.FILES.getWithMetadata(`file:${id}`, { type: 'stream' });
    if (!obj || !obj.value) fail(404, 'Not found');
    return new Response(obj.value, { headers: { ...headers, 'Content-Disposition': disp(obj.metadata && obj.metadata.name) } });
  }
  if (m === 'DELETE' && id) {
    need(me, 'full');
    const row = await env.DB.prepare(`SELECT id, store FROM files WHERE id = ?`).bind(id).first();
    await deleteStoredFile(env, row);
    await env.DB.batch([
      env.DB.prepare(`UPDATE posts SET file_id = NULL WHERE file_id = ?`).bind(id),
      env.DB.prepare(`DELETE FROM files WHERE id = ?`).bind(id)
    ]);
    return json({ ok: true });
  }
  fail(405, 'Not allowed');
}

async function peopleApi(request, env, me, m, id, sub, b) {
  need(me, 'admin');
  const origin = new URL(request.url).origin;
  if (m === 'POST' && !id) {
    const name = str(b.name, 80) || fail(400, 'Name is required');
    const initials = (str(b.initials, 3) || name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2)).toUpperCase();
    const level = oneOf(b.level, ['overview', 'team', 'full'], 'overview');
    const pid = newId();
    const max = await env.DB.prepare(`SELECT COALESCE(MAX(sort), 0) AS s FROM people`).first();
    await env.DB.prepare(`INSERT INTO people (id, name, label, initials, level, status, sort, created_at) VALUES (?, ?, ?, ?, ?, 'invited', ?, ?)`)
      .bind(pid, name, str(b.label, 80), initials, level, (max.s || 0) + 1, nowIso()).run();
    return json({ id: pid });
  }
  if (m === 'POST' && id && sub === 'link') {
    notInDemo(env, 'Creating sign-in links');
    const p = await env.DB.prepare(`SELECT id FROM people WHERE id = ?`).bind(id).first() || fail(404, 'Not found');
    const token = randomToken(24);
    await env.DB.batch([
      env.DB.prepare(`UPDATE people SET token_hash = ?, pw_hash = NULL, fails = 0, locked_until = NULL WHERE id = ?`).bind(await sha256(token), p.id),
      ...(p.id === me.id ? [] : [env.DB.prepare(`DELETE FROM sessions WHERE person_id = ?`).bind(p.id)])
    ]);
    return json({ link: `${origin}/signin/${token}` });
  }
  if (m === 'PATCH' && id) {
    const cur = await env.DB.prepare(`SELECT * FROM people WHERE id = ?`).bind(id).first() || fail(404, 'Not found');
    if (isDemo(env) && cur.id.startsWith('d-') && b.level && b.level !== cur.level) fail(403, 'The demo roles stay fixed so every visitor gets the same tour. Add a person to try changing access.');
    if (cur.level === 'admin' && b.level && b.level !== 'admin') fail(400, 'The admin account keeps admin access');
    const level = cur.level === 'admin' ? 'admin' : oneOf(b.level, ['overview', 'team', 'full'], cur.level);
    await env.DB.prepare(`UPDATE people SET name = ?, label = ?, initials = ?, level = ? WHERE id = ?`)
      .bind(b.name !== undefined ? (str(b.name, 80) || cur.name) : cur.name, b.label !== undefined ? str(b.label, 80) : cur.label,
        b.initials !== undefined ? (str(b.initials, 3).toUpperCase() || cur.initials) : cur.initials, level, id).run();
    return json({ ok: true });
  }
  if (m === 'DELETE' && id) {
    if (id === me.id) fail(400, 'You cannot remove yourself');
    if (isDemo(env) && id.startsWith('d-')) fail(403, 'The demo team stays put. Add a person, then remove them.');
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM sessions WHERE person_id = ?`).bind(id),
      env.DB.prepare(`DELETE FROM people WHERE id = ?`).bind(id)
    ]);
    return json({ ok: true });
  }
  fail(405, 'Not allowed');
}

async function contentApi(env, me, m, id, b) {
  need(me, 'full');
  if (!id) fail(405, 'Not allowed');
  const cur = await env.DB.prepare(`SELECT * FROM content WHERE id = ?`).bind(id).first() || fail(404, 'Not found');
  if (m === 'PATCH') {
    const status = oneOf(b.status, CONTENT_STATUS, cur.status);
    const reviewed = status !== cur.status && status !== 'draft';
    await env.DB.prepare(`UPDATE content SET title = ?, body = ?, excerpt = ?, status = ?, reject_reason = ?, published_url = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?`)
      .bind(b.title !== undefined ? (str(b.title, 200) || cur.title) : cur.title, b.body !== undefined ? str(b.body, 60000) : cur.body,
        b.excerpt !== undefined ? str(b.excerpt, 600) : cur.excerpt, status,
        status === 'rejected' ? (b.reject_reason !== undefined ? str(b.reject_reason, 300) : cur.reject_reason) : null,
        b.published_url !== undefined ? str(b.published_url, 400) : cur.published_url,
        reviewed ? me.id : cur.reviewed_by, reviewed ? nowIso() : cur.reviewed_at, nowIso(), id).run();
    return json({ ok: true });
  }
  if (m === 'DELETE') {
    const st = [env.DB.prepare(`DELETE FROM content WHERE id = ?`).bind(id), env.DB.prepare(`UPDATE posts SET content_id = NULL WHERE content_id = ?`).bind(id)];
    if (cur.file_id) {
      const used = await env.DB.prepare(`SELECT id FROM posts WHERE file_id = ? AND status <> 'rejected' LIMIT 1`).bind(cur.file_id).first();
      if (!used) { const fr = await env.DB.prepare(`SELECT id, store FROM files WHERE id = ?`).bind(cur.file_id).first(); st.push(env.DB.prepare(`DELETE FROM files WHERE id = ?`).bind(cur.file_id)); await deleteStoredFile(env, fr); }
    }
    await env.DB.batch(st);
    return json({ ok: true });
  }
  fail(405, 'Not allowed');
}

async function keysApi(env, me, m, id, b) {
  need(me, 'admin');
  if (m === 'POST' && !id) {
    const key = 'abri_' + randomToken(32);
    const kid = newId();
    await env.DB.prepare(`INSERT INTO api_keys (id, name, key_hash, prefix, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(kid, str(b.name, 60) || 'Agency', await sha256(key), key.slice(0, 10), nowIso()).run();
    return json({ id: kid, key });
  }
  if (m === 'DELETE' && id) {
    await env.DB.prepare(`UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`).bind(nowIso(), id).run();
    return json({ ok: true });
  }
  fail(405, 'Not allowed');
}

// ---------- Agency connection (server-to-server, bearer key) ----------

function nextMorningIso() {
  // 10:00 AM Eastern tomorrow, approximated as 14:00 UTC (15:00 in winter is close enough for a suggestion)
  const d = new Date(Date.now() + 864e5);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 14, 0)).toISOString();
}

async function agentApi(request, env, url) {
  const auth = request.headers.get('Authorization') || '';
  const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!key.startsWith('abri_') && !key.startsWith('chub_')) return json({ error: 'Missing or invalid key' }, 401);
  const row = await env.DB.prepare(`SELECT id FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL`).bind(await sha256(key)).first();
  if (!row) return json({ error: 'Missing or invalid key' }, 401);
  await env.DB.prepare(`UPDATE api_keys SET last_used = ? WHERE id = ?`).bind(nowIso(), row.id).run();
  const route = url.pathname.replace(/^\/agent\//, '');

  if (route === 'drafts' && request.method === 'POST') {
    const len = Number(request.headers.get('Content-Length') || 0);
    if (len > MAX_AGENT_BODY) fail(413, 'Request too large');
    const b = await request.json().catch(() => null);
    if (!b) fail(400, 'Send JSON');
    const items = Array.isArray(b.drafts) ? b.drafts : [b];
    if (!items.length || items.length > 10) fail(400, 'Send between 1 and 10 drafts');
    await cleanupRejected(env);
    const results = [];
    for (const d of items) results.push(await saveAgentDraft(env, d));
    return json({ ok: true, drafts: results });
  }
  if (route === 'recent' && request.method === 'GET') {
    const days = Math.min(365, Math.max(1, int(url.searchParams.get('days') || 60)));
    const since = new Date(Date.now() - days * 864e5).toISOString();
    const [content, posts] = await Promise.all([
      all(env, `SELECT title, topic, excerpt, status, reject_reason, created_at FROM content WHERE created_at >= ? ORDER BY created_at DESC`, since),
      all(env, `SELECT caption, status, reject_reason, scheduled_at, origin FROM posts WHERE created_at >= ? OR scheduled_at >= ? ORDER BY scheduled_at DESC`, since, since)
    ]);
    return json({ days, content, posts });
  }
  if (route === 'ideas' && request.method === 'GET') {
    return json({ ideas: await all(env, `SELECT text, status, note, created_at FROM ideas WHERE status IN ('new', 'considering', 'planned') ORDER BY created_at DESC LIMIT 50`) });
  }
  if (route === 'ping' && request.method === 'GET') return json({ ok: true });
  fail(404, 'Not found');
}

async function saveAgentDraft(env, d) {
  if (!d || typeof d !== 'object') fail(400, 'Each draft must be an object');
  const t = nowIso();
  let fileId = null;
  if (d.image && d.image.data) {
    const type = /^image\/(png|jpe?g|webp)$/.test(d.image.type || '') ? d.image.type : fail(400, 'Images must be PNG, JPEG or WebP');
    let bytes;
    try { bytes = Uint8Array.from(atob(String(d.image.data).replace(/^data:[^,]+,/, '')), (c) => c.charCodeAt(0)); } catch { fail(400, 'Image data must be base64'); }
    if (bytes.length > MAX_UPLOAD) fail(400, 'Images must be under 20 MB');
    fileId = newId();
    await env.FILES.put(`file:${fileId}`, bytes, { metadata: { type, name: str(d.image.filename, 120) || 'agency-image' } });
    await env.DB.prepare(`INSERT INTO files (id, name, kind, content_type, size, stored, store, uploaded_by, is_sample, created_at) VALUES (?, ?, 'creative', ?, ?, 1, 'kv', NULL, 0, ?)`)
      .bind(fileId, str(d.image.filename, 120) || ('Agency image ' + t.slice(0, 10)), type, bytes.length, t).run();
  }
  const out = {};
  const title = str(d.title, 200);
  if (title && d.body) {
    const cid = newId();
    await env.DB.prepare(`INSERT INTO content (id, kind, title, body, excerpt, topic, sources, status, origin, file_id, is_sample, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, 0, ?, ?)`)
      .bind(cid, oneOf(d.kind, ['blog', 'newsletter', 'other'], 'blog'), title, str(d.body, 60000), str(d.excerpt, 600), str(d.topic, 120),
        JSON.stringify((Array.isArray(d.sources) ? d.sources : []).slice(0, 20).map((x) => str(x, 400))), str(d.origin, 40) || 'agency', fileId, t, t).run();
    out.content_id = cid;
  }
  const socials = Array.isArray(d.social) ? d.social : d.social ? [d.social] : [];
  out.post_ids = [];
  for (const sc of socials.slice(0, 4)) {
    const caption = str(sc.caption, 2200);
    if (!caption) continue;
    const ACCOUNTS = await accountIds(env);
    const accounts = (Array.isArray(sc.accounts) ? sc.accounts : ACCOUNTS).filter((a) => ACCOUNTS.includes(a));
    const at = sc.suggested_at && !isNaN(Date.parse(sc.suggested_at)) ? new Date(sc.suggested_at).toISOString() : nextMorningIso();
    const pid = newId();
    await env.DB.prepare(`INSERT INTO posts (id, caption, accounts, scheduled_at, status, file_id, by_person, origin, content_id, is_sample, created_at, updated_at) VALUES (?, ?, ?, ?, 'draft', ?, NULL, ?, ?, 0, ?, ?)`)
      .bind(pid, caption, JSON.stringify(accounts.length ? accounts : ACCOUNTS), at, fileId, str(d.origin, 40) || 'agency', out.content_id || null, t, t).run();
    out.post_ids.push(pid);
  }
  if (!out.content_id && !out.post_ids.length) fail(400, 'A draft needs a title and body, or a social caption');
  return out;
}

async function cleanupRejected(env) {
  const cutoff = new Date(Date.now() - 90 * 864e5).toISOString();
  const keep = `SELECT file_id FROM posts WHERE status <> 'rejected' AND file_id IS NOT NULL`;
  const old = await all(env, `SELECT file_id FROM content WHERE status = 'rejected' AND updated_at < ? AND file_id IS NOT NULL AND file_id NOT IN (${keep})`, cutoff);
  for (const r of old) await env.FILES.delete(`file:${r.file_id}`);
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM files WHERE id IN (SELECT file_id FROM content WHERE status = 'rejected' AND updated_at < ? AND file_id NOT IN (${keep}))`).bind(cutoff),
    env.DB.prepare(`DELETE FROM content WHERE status = 'rejected' AND updated_at < ?`).bind(cutoff),
    env.DB.prepare(`DELETE FROM posts WHERE status = 'rejected' AND updated_at < ?`).bind(cutoff)
  ]);
}

async function settingsApi(env, me, m, b) {
  need(me, 'admin');
  if (m !== 'PUT') fail(405, 'Not allowed');
  const st = [];
  const put = (k, v) => st.push(env.DB.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(k, v));
  for (const k of ['service', 'commercial']) {
    if (b[k] !== undefined) put(k, b[k] ? '1' : '0');
  }
  const brandEdit = ['brand_name', 'brand_primary', 'brand_accent', 'brand_logo', 'accounts'].some((k) => b[k] !== undefined);
  if (brandEdit) notInDemo(env, 'Saving the brand for everyone');
  if (b.brand_name !== undefined) put('brand_name', str(b.brand_name, 80) || fail(400, 'Enter the company name'));
  for (const k of ['brand_primary', 'brand_accent']) {
    if (b[k] !== undefined) put(k, HEX.test(b[k]) ? b[k] : fail(400, 'Colors must look like #12355B'));
  }
  if (b.brand_logo !== undefined) {
    const v = String(b.brand_logo || '');
    if (v && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v)) fail(400, 'The logo must be a PNG, JPEG or WebP image');
    if (v.length > 700000) fail(400, 'That logo is too large. Try a smaller image.');
    if (v) put('brand_logo', v); else st.push(env.DB.prepare(`DELETE FROM settings WHERE key = 'brand_logo'`));
  }
  if (b.accounts !== undefined) {
    const list = (Array.isArray(b.accounts) ? b.accounts : []).slice(0, 8).map((a, i) => {
      const name = str(a && a.name, 40);
      if (!name) return null;
      const id = str(a.id, 20).replace(/[^a-z0-9]/gi, '').toLowerCase() || name.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 12) || 'acct' + (i + 1);
      return { id, name, short: str(a.short, 8) || name.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 4) };
    }).filter(Boolean);
    if (!list.length) fail(400, 'Keep at least one social account');
    if (new Set(list.map((a) => a.id)).size !== list.length) fail(400, 'Two accounts have the same short id');
    put('accounts', JSON.stringify(list));
  }
  if (st.length) await env.DB.batch(st);
  return json({ ok: true });
}

async function sampleApi(env, me, m, id) {
  need(me, 'admin');
  if (m !== 'POST' || id !== 'clear') fail(405, 'Not allowed');
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM campaign_months WHERE is_sample = 1 OR campaign_id IN (SELECT id FROM campaigns WHERE is_sample = 1)`),
    env.DB.prepare(`UPDATE files SET campaign_id = NULL WHERE campaign_id IN (SELECT id FROM campaigns WHERE is_sample = 1)`),
    env.DB.prepare(`DELETE FROM campaigns WHERE is_sample = 1`),
    env.DB.prepare(`DELETE FROM monthly WHERE is_sample = 1`),
    env.DB.prepare(`DELETE FROM monthly_spend WHERE is_sample = 1`),
    env.DB.prepare(`DELETE FROM ideas WHERE is_sample = 1`),
    env.DB.prepare(`DELETE FROM posts WHERE is_sample = 1`),
    env.DB.prepare(`DELETE FROM files WHERE is_sample = 1`)
  ]);
  return json({ ok: true });
}

// ---------- responses ----------

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

async function signedOutPage(env, message, email) {
  const clean = (v) => String(v || '').replace(/[<>&"']/g, '');
  const settings = await readSettings(env).catch(() => ({}));
  const brand = brandOf(settings);
  const demo = isDemo(env);
  const setup = !demo && !(await env.DB.prepare(`SELECT COUNT(*) AS n FROM people`).first().catch(() => ({ n: 1 }))).n;
  const mark = brand.logo ? `<img src="${brand.logo}" alt="${clean(brand.name)}" class="so-logo">` : `<div class="so-name">${clean(brand.name)}</div>`;
  const msg = message ? `<p class="so-msg" role="alert">${clean(message)}</p>` : '';
  let body;
  if (demo) {
    const role = (r, title, who, text) => `<button class="so-role" name="role" value="${r}"><span class="so-role-t">${title}</span><span class="so-role-who">${who}</span><span class="so-role-d">${text}</span></button>`;
    body = `${mark}<h1>Try Abri Pro</h1>${msg}
<p>${clean(brand.name)} is a made-up contractor. Pick a seat and look around. Nothing here is real, and everything resets every night.</p>
<form method="post" action="/demo/enter" class="so-roles">
${role('full', 'Owner', 'Frank Acosta', 'Sees everything, approves posts and drafts, enters the monthly numbers.')}
${role('admin', 'Marketing lead', 'Dana Reyes', 'Runs the hub. Adds people, sets access, connects Agency.')}
${role('team', 'Office staff', 'Priya Shah', 'Adds ideas, submits posts for approval, uploads invoices.')}
${role('overview', 'Field tech', 'Tony Russo', 'Sees the plan and adds ideas from the truck.')}
</form>`;
  } else if (setup) {
    body = `${mark}<h1>Set up your hub</h1>${msg}<p>You'll be the admin. You can add your team and your logo next.</p>
<form method="post" action="/auth/setup" class="so-form">
<label class="field">Company name<input class="input" name="company" required maxlength="80" value="${settings.brand_name ? clean(settings.brand_name) : ''}"></label>
<label class="field">Your name<input class="input" name="name" required maxlength="80" autocomplete="name"></label>
<label class="field">Email<input class="input" type="email" name="email" autocomplete="username" required></label>
<label class="field">Password<input class="input" type="password" name="password" autocomplete="new-password" minlength="8" required></label>
<button class="btn btn-navy" style="width:100%">Create my hub</button>
</form>`;
  } else {
    body = `${mark}<h1>Marketing Hub</h1>${msg || '<p>Sign in with your work email and password.</p>'}
<form method="post" action="/auth/login" class="so-form">
<label class="field">Email<input class="input" type="email" name="email" autocomplete="username" required value="${clean(email)}"></label>
<label class="field">Password<input class="input" type="password" name="password" autocomplete="current-password" required></label>
<button class="btn btn-navy" style="width:100%">Sign in</button>
</form>
<p class="so-help">First time here? Use the invite link your admin sent you. Forgot your password? Ask your admin for a reset link.</p>`;
  }
  if (demo) return demoLanding(env, brand, message);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${demo ? 'Abri Pro demo' : 'Sign in · ' + clean(brand.name)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/img/icon-180.png"><link rel="manifest" href="/manifest.webmanifest">
<link rel="stylesheet" href="/app.css"><style>:root{--navy:${brand.primary};--red:${brand.accent}}</style></head>
<body class="signed-out"><main class="so-card${demo ? ' so-wide' : ''}">${body}
<div class="so-foot"><img src="/img/abri-mark.svg" alt="" width="18" height="18">Abri Pro</div>
</main></body></html>`;
  return new Response(html, { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' } });
}

// ---------- demo landing ----------
// Pick a seat on the left; the window on the right shows what that person sees, with the demo's real numbers.
async function demoLanding(env, brand, message) {
  const clean = (v) => String(v || '').replace(/[<>&"']/g, '');
  const latest = await env.DB.prepare(`SELECT month FROM monthly WHERE is_sample IN (0, 1) GROUP BY month ORDER BY month DESC LIMIT 1`).first().catch(() => null);
  let stats = { month: '', leads: 0, jobs: 0, revenue: 0, change: null };
  if (latest) {
    const [y, mo] = latest.month.split('-').map(Number);
    const prevKey = `${y - 1}-${String(mo).padStart(2, '0')}`;
    const sum = async (m) => env.DB.prepare(`SELECT COALESCE(SUM(leads),0) AS leads, COALESCE(SUM(jobs),0) AS jobs, COALESCE(SUM(revenue),0) AS revenue FROM monthly WHERE month = ? AND division IN ('install','service')`).bind(m).first();
    const cur = await sum(latest.month), prev = await sum(prevKey);
    stats = { month: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][mo - 1], leads: cur.leads, jobs: cur.jobs, revenue: cur.revenue, change: prev.leads ? Math.round(((cur.leads - prev.leads) / prev.leads) * 100) : null };
  }
  const drafts = (await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM content WHERE status = 'draft') + (SELECT COUNT(*) FROM posts WHERE status = 'draft' AND origin IS NOT NULL AND origin <> 'person') AS n`).first().catch(() => ({ n: 0 }))).n;
  const ideas = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ideas WHERE status IN ('new','considering')`).first().catch(() => ({ n: 0 }))).n;
  const money = (n) => n >= 1e4 ? '$' + Math.round(n / 1e3) + 'K' : '$' + Number(n).toLocaleString('en-US');

  const seats = [
    { role: 'full', initials: 'FA', title: 'Owner', who: 'Frank Acosta', text: 'Sees every number and approves what goes out.', pages: 8, action: drafts ? `Review ${drafts} Agency draft${drafts === 1 ? '' : 's'}` : 'Review Agency drafts' },
    { role: 'admin', initials: 'DR', title: 'Marketing lead', who: 'Dana Reyes', text: 'Runs the hub, invites the team, sets who sees what.', pages: 9, action: 'Invite your team' },
    { role: 'team', initials: 'PS', title: 'Office staff', who: 'Priya Shah', text: 'Submits posts for approval and keeps the invoices.', pages: 8, action: 'Submit a post' },
    { role: 'overview', initials: 'TR', title: 'Field tech', who: 'Tony Russo', text: 'Checks the plan and drops ideas from the truck.', pages: 3, action: `Add an idea (${ideas} open)` }
  ];
  const tabs = [['Home', 1], ['Roadmap', 1], ['Campaigns', 2], ['Ideas', 1], ['Social', 2], ['Content', 2], ['Monthly numbers', 2], ['Files', 2], ['People', 4]];
  const rank = { overview: 1, team: 2, full: 3, admin: 4 };
  const seatData = Object.fromEntries(seats.map((x) => [x.role, { who: x.who.split(' ')[0], pages: tabs.filter((t) => rank[x.role] >= t[1]).map((t) => t[0]), action: x.action }]));
  const chevron = '<svg class="seat-go" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Try Abri Pro with ${clean(brand.name)}</title>
<meta name="description" content="Try the Abri Pro marketing hub as a made-up contractor. No sign-up.">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/img/icon-180.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&display=swap">
<link rel="stylesheet" href="/landing.css"></head>
<body class="ld">
<header class="ld-top"><img src="${brand.logo || '/img/acme-logo.svg'}" alt="${clean(brand.name)}" class="ld-logo"><span class="ld-note">A made-up company. Everything resets at night.</span></header>
<main class="ld-main">
  <section class="ld-pick" aria-labelledby="ld-h">
    <h1 id="ld-h">See your marketing on one screen.</h1>
    <p class="ld-lede">This is Abri Pro running for ${clean(brand.name)}, a pretend heating and cooling company. Pick a seat. No sign-up, no password.</p>
    ${message ? `<p class="ld-msg" role="alert">${clean(message)}</p>` : ''}
    <form method="post" action="/demo/enter" class="seats">
      ${seats.map((x, i) => `<button class="seat${i === 0 ? ' is-on' : ''}" name="role" value="${x.role}" data-seat="${x.role}">
        <span class="seat-av seat-av-${x.role}" aria-hidden="true">${x.initials}</span>
        <span class="seat-txt"><span class="seat-t">${x.title}<span class="seat-who">${x.who}</span></span><span class="seat-d">${x.text}</span></span>${chevron}</button>`).join('')}
    </form>
  </section>
  <section class="ld-peek" aria-label="What this seat sees">
    <div class="win" id="win">
      <div class="win-bar"><span></span><span></span><span></span></div>
      <div class="win-body">
        <nav class="win-nav" aria-hidden="true">${tabs.map((t) => `<span class="wt" data-tab="${t[0]}">${t[0]}</span>`).join('')}</nav>
        <div class="win-main">
          <div class="win-hi">Good morning, <span id="win-who">Frank</span>.</div>
          <div class="win-kpis" id="win-kpis">
            <div class="kpi"><span class="kpi-l">Leads in ${stats.month}</span><span class="kpi-n">${stats.leads}</span>${stats.change != null ? `<span class="kpi-c${stats.change < 0 ? ' down' : ''}">${stats.change >= 0 ? '+' : '−'}${Math.abs(stats.change)}% on last year</span>` : ''}</div>
            <div class="kpi"><span class="kpi-l">Booked jobs</span><span class="kpi-n">${stats.jobs}</span></div>
            <div class="kpi kpi-money"><span class="kpi-l">Revenue</span><span class="kpi-n">${money(stats.revenue)}</span></div>
          </div>
          <svg class="win-chart" viewBox="0 0 300 90" preserveAspectRatio="none" aria-hidden="true">
            <polyline class="ln-prev" points="0,62 27,64 54,60 81,54 108,44 135,30 162,22 189,26 216,40 243,50 270,54 300,58"/>
            <polyline class="ln-cur" points="0,56 27,58 54,52 81,46 108,36 135,22 162,12 189,16 216,30 243,40 270,44"/>
          </svg>
          <div class="win-act" id="win-act">${clean(seats[0].action)}</div>
        </div>
      </div>
    </div>
    <p class="peek-cap" id="peek-cap" aria-live="polite">Frank sees 8 of 9 pages. Only the marketing lead manages people.</p>
  </section>
</main>
<footer class="ld-foot"><img src="/img/abri-mark.svg" alt="" width="20" height="20">Abri Pro, the marketing hub for home service contractors</footer>
<script id="seat-data" type="application/json">${JSON.stringify(seatData).replace(/</g, '\\u003c')}</script>
<script src="/landing.js" defer></script>
</body></html>`;
  return new Response(html, { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' } });
}
