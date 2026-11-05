// Database schema, migrations and first-run seed. Runs once per database (tracked in the meta table).
import { seedDemo } from './demo.js';

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`,
  `CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, label TEXT, initials TEXT, level TEXT NOT NULL DEFAULT 'overview',
    token_hash TEXT, status TEXT NOT NULL DEFAULT 'invited', sort INTEGER DEFAULT 0,
    created_at TEXT NOT NULL, last_seen TEXT)`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id_hash TEXT PRIMARY KEY, person_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`,
  `CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT, channel TEXT, audience TEXT,
    status TEXT NOT NULL DEFAULT 'planned', start_date TEXT, end_date TEXT,
    budget INTEGER DEFAULT 0, spend INTEGER DEFAULT 0,
    has_code INTEGER DEFAULT 0, has_page INTEGER DEFAULT 0, has_qr INTEGER DEFAULT 0, trackable INTEGER DEFAULT 1,
    verdict TEXT, verdict_note TEXT, rating INTEGER, notes TEXT,
    is_sample INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS campaign_months (
    campaign_id TEXT NOT NULL, month TEXT NOT NULL, scans INTEGER DEFAULT 0, forms INTEGER DEFAULT 0, mentions INTEGER DEFAULT 0,
    is_sample INTEGER DEFAULT 0, PRIMARY KEY (campaign_id, month))`,
  `CREATE TABLE IF NOT EXISTS monthly (
    month TEXT NOT NULL, division TEXT NOT NULL, leads INTEGER DEFAULT 0, jobs INTEGER DEFAULT 0, revenue INTEGER DEFAULT 0,
    is_sample INTEGER DEFAULT 0, PRIMARY KEY (month, division))`,
  `CREATE TABLE IF NOT EXISTS monthly_spend (month TEXT PRIMARY KEY, spend INTEGER DEFAULT 0, is_sample INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS ideas (
    id TEXT PRIMARY KEY, text TEXT NOT NULL, by_person TEXT, status TEXT NOT NULL DEFAULT 'new', note TEXT,
    is_sample INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY, caption TEXT, accounts TEXT, scheduled_at TEXT, status TEXT NOT NULL DEFAULT 'scheduled',
    file_id TEXT, image_url TEXT, by_person TEXT, is_sample INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, campaign_id TEXT, kind TEXT, amount INTEGER, content_type TEXT, size INTEGER,
    stored INTEGER DEFAULT 1, image_url TEXT, uploaded_by TEXT, is_sample INTEGER DEFAULT 0, created_at TEXT NOT NULL)`
];

// Column and table additions. Each runs once, in order.
const MIGRATIONS = [
  `ALTER TABLE people ADD COLUMN email TEXT`,
  `ALTER TABLE people ADD COLUMN pw_hash TEXT`,
  `ALTER TABLE people ADD COLUMN fails INTEGER DEFAULT 0`,
  `ALTER TABLE people ADD COLUMN locked_until TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS people_email ON people (email)`,
  `CREATE TABLE IF NOT EXISTS api_keys (id TEXT PRIMARY KEY, name TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, prefix TEXT, created_at TEXT NOT NULL, last_used TEXT, revoked_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS content (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'blog', title TEXT NOT NULL, body TEXT, excerpt TEXT, topic TEXT, sources TEXT,
    status TEXT NOT NULL DEFAULT 'draft', reject_reason TEXT, origin TEXT DEFAULT 'agency', file_id TEXT,
    reviewed_by TEXT, reviewed_at TEXT, published_url TEXT, is_sample INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `ALTER TABLE posts ADD COLUMN origin TEXT`,
  `ALTER TABLE posts ADD COLUMN content_id TEXT`,
  `ALTER TABLE posts ADD COLUMN reject_reason TEXT`,
  `ALTER TABLE files ADD COLUMN store TEXT`,
  `CREATE TABLE IF NOT EXISTS idea_votes (idea_id TEXT NOT NULL, person_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (idea_id, person_id))`
];

// Every table that holds a customer's data. Used by the demo reset.
export const DATA_TABLES = ['sessions', 'people', 'settings', 'campaigns', 'campaign_months', 'monthly', 'monthly_spend', 'ideas', 'idea_votes', 'posts', 'files', 'content', 'api_keys'];

export const DEFAULT_ACCOUNTS = [
  { id: 'fb', name: 'Facebook', short: 'FB' },
  { id: 'ig', name: 'Instagram', short: 'IG' }
];

export async function ensureSchema(env) {
  if (globalThis.__hubReady) return;
  await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)));
  const v = await env.DB.prepare(`SELECT value FROM meta WHERE key = 'schema_v'`).first();
  const done = v ? Number(v.value) : 0;
  for (let i = done; i < MIGRATIONS.length; i++) {
    try { await env.DB.prepare(MIGRATIONS[i]).run(); } catch (e) { if (!/duplicate column/i.test(String(e && e.message))) throw e; }
  }
  if (done < MIGRATIONS.length) await env.DB.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_v', ?)`).bind(String(MIGRATIONS.length)).run();
  const seeded = await env.DB.prepare(`SELECT value FROM meta WHERE key = 'seeded'`).first();
  if (!seeded) await (env.DEMO === '1' ? seedDemo(env) : seedProduct(env));
  globalThis.__hubReady = true;
}

// A new customer starts empty. The first visitor creates the admin account (see /auth/setup).
async function seedProduct(env) {
  const q = (sql, ...args) => env.DB.prepare(sql).bind(...args);
  await env.DB.batch([
    q(`INSERT OR IGNORE INTO settings (key, value) VALUES ('service', '1')`),
    q(`INSERT OR IGNORE INTO settings (key, value) VALUES ('commercial', '0')`),
    q(`INSERT OR IGNORE INTO settings (key, value) VALUES ('budget', '0')`),
    q(`INSERT OR IGNORE INTO settings (key, value) VALUES ('accounts', ?)`, JSON.stringify(DEFAULT_ACCOUNTS)),
    q(`INSERT OR REPLACE INTO meta (key, value) VALUES ('seeded', ?)`, new Date().toISOString())
  ]);
}

// Demo only: wipe everything and seed Acme Air again with dates relative to today.
export async function resetDemo(env) {
  const files = await env.DB.prepare(`SELECT id, store FROM files WHERE stored = 1`).all().catch(() => ({ results: [] }));
  for (const f of files.results || []) {
    if (f.store === 'r2' && env.MEDIA) await env.MEDIA.delete(`file:${f.id}`);
    else await env.FILES.delete(`file:${f.id}`);
  }
  await env.DB.batch(DATA_TABLES.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  await env.DB.prepare(`DELETE FROM meta WHERE key = 'seeded'`).run();
  await seedDemo(env);
}
