// Acme Air: the fictional contractor in the public demo. Every date is relative to today,
// so the demo always looks current. Reset nightly by the scheduled handler.

const TZ = 'America/New_York';
const pad = (n) => String(n).padStart(2, '0');

function etParts(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute };
}
function etToIso(y, m, d, h, mi) {
  let guess = Date.UTC(y, m - 1, d, h, mi);
  for (let i = 0; i < 2; i++) {
    const p = etParts(new Date(guess));
    guess -= Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - Date.UTC(y, m - 1, d, h, mi);
  }
  return new Date(guess).toISOString();
}

export const DEMO_PEOPLE = [
  ['d-admin', 'Dana Reyes', 'Marketing Manager', 'DR', 'admin'],
  ['d-owner', 'Frank Acosta', 'Owner', 'FA', 'full'],
  ['d-owner2', 'Lisa Acosta', 'Owner', 'LA', 'full'],
  ['d-office', 'Priya Shah', 'Office Manager', 'PS', 'team'],
  ['d-lead', 'Marcus Bell', 'Install Lead', 'MB', 'team'],
  ['d-tech', 'Tony Russo', 'Service Tech', 'TR', 'overview']
];
export const DEMO_ROLES = {
  full: 'd-owner', admin: 'd-admin', team: 'd-office', overview: 'd-tech'
};

export async function seedDemo(env) {
  const now = new Date();
  const nowIso = now.toISOString();
  const t = etParts(now);
  const base = Date.UTC(t.y, t.m - 1, t.d) / 864e5;
  const day = (off) => { const x = new Date((base + off) * 864e5); return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`; };
  const at = (off, h, mi = 0) => { const x = new Date((base + off) * 864e5); return etToIso(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate(), h, mi); };
  const monthOf = (off) => day(off).slice(0, 7);
  const addMonths = (k) => { let y = t.y, m = t.m + k; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return [y, m]; };
  const st = [];
  const q = (sql, ...args) => st.push(env.DB.prepare(sql).bind(...args));

  DEMO_PEOPLE.forEach((p, i) => q(
    // pw_hash 'demo-locked' is never a valid password: demo seats are entered from the landing page only.
    `INSERT INTO people (id, name, label, initials, level, status, sort, created_at, email, last_seen, pw_hash) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, 'demo-locked')`,
    p[0], p[1], p[2], p[3], p[4], i, nowIso, p[1].split(' ')[0].toLowerCase() + '@acmeair.example', at(-(i % 3), 9)));

  const settings = {
    service: '1', commercial: '0', budget: '95000',
    brand_name: 'Acme Air', brand_primary: '#12355B', brand_accent: '#C2410C', brand_logo: '/img/acme-logo.svg',
    accounts: JSON.stringify([{ id: 'fb', name: 'Facebook', short: 'FB' }, { id: 'ig', name: 'Instagram', short: 'IG' }, { id: 'gbp', name: 'Google Business', short: 'GBP' }])
  };
  for (const [k, v] of Object.entries(settings)) q(`INSERT INTO settings (key, value) VALUES (?, ?)`, k, v);

  // ---- campaigns ----
  const C = (id, name, code, channel, audience, status, s, e, budget, spend, chk, trackable, verdict, note, rating) => q(
    `INSERT INTO campaigns (id, name, code, channel, audience, status, start_date, end_date, budget, spend, has_code, has_page, has_qr, trackable, verdict, verdict_note, rating, is_sample, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    id, name, code, channel, audience, status, day(s), day(e), budget, spend, chk[0], chk[1], chk[2], trackable, verdict, note, rating, nowIso, nowIso);
  const towns = 'Cedar Falls, Brookfield, Millbrook';
  C('c-tuneup', 'Tune-Up Postcards', 'TUNEUP', 'Direct mail', towns, 'live', -24, 36, 9000, 8600, [1, 1, 1], 1, null, 'Tracking ahead of the spring mailer', 4);
  C('c-gads', 'Google Search Ads', '', 'Search ads', 'Full service area', 'live', -300, 65, 18000, 15100, [0, 1, 0], 1, null, '', null);
  C('c-bill', 'Route 9 Billboard', '', 'Billboard', 'Route 9 commuters', 'ready', 4, 60, 12000, 0, [1, 1, 1], 0, null, '', null);
  C('c-holiday', 'Holiday Social Posts', '', 'Social', 'All accounts', 'ready', 18, 54, 0, 0, [1, 1, 1], 0, null, '', null);
  C('c-winnews', 'Winter Newsletter', '', 'Email', 'Customer list', 'planned', 34, 41, 300, 0, [1, 0, 0], 1, null, '', null);
  C('c-rebate', 'Heat Pump Rebate Push', 'REBATE', 'Direct mail + social', 'Homes with oil or propane', 'planned', 90, 170, 10000, 0, [1, 0, 0], 1, null, '', null);
  C('c-spring', 'Spring AC Check Postcards', '', 'Direct mail', towns, 'planned', 135, 195, 9500, 0, [0, 0, 0], 1, null, '', null);
  C('c-springpast', 'Spring AC Check Postcards', 'COOL', 'Direct mail', towns, 'done', -230, -170, 9000, 8800, [1, 1, 1], 1, 'worked', 'Repeat next spring, same three towns', 4);
  C('c-sumnews', 'Summer Newsletter', '', 'Email', 'Customer list', 'done', -150, -132, 300, 300, [0, 1, 0], 1, 'worked', 'Cheapest response we have. Consider quarterly', 5);
  C('c-fbboost', 'Facebook Boosted Posts', '', 'Social ads', 'Full service area', 'done', -125, -65, 1500, 1500, [0, 1, 0], 1, 'flopped', 'Skip next year. Put the money into postcards', 1);
  C('c-billpast', 'Spring Billboard', '', 'Billboard', 'Route 9 commuters', 'done', -210, -155, 11000, 11000, [0, 0, 0], 0, 'mixed', 'Brand value, hard to measure. Add a short web address next time', 3);

  const CM = (id, off, scans, forms, mentions) => q(
    `INSERT INTO campaign_months (campaign_id, month, scans, forms, mentions, is_sample) VALUES (?, ?, ?, ?, ?, 1)
     ON CONFLICT(campaign_id, month) DO UPDATE SET scans = scans + excluded.scans, forms = forms + excluded.forms, mentions = mentions + excluded.mentions`,
    id, monthOf(off), scans, forms, mentions);
  CM('c-tuneup', -10, 74, 9, 6); CM('c-tuneup', 0, 61, 8, 5);
  CM('c-springpast', -225, 30, 4, 2); CM('c-springpast', -195, 64, 8, 5); CM('c-springpast', -172, 26, 3, 2);
  CM('c-sumnews', -140, 190, 7, 0);
  CM('c-fbboost', -110, 7, 1, 0); CM('c-fbboost', -75, 5, 0, 0);
  for (let k = -9; k <= 0; k++) {
    const [y, m] = addMonths(k);
    const f = [16, 15, 19, 22, 25, 27, 24, 20, 18, 21, 19, 17][m - 1];
    q(`INSERT INTO campaign_months (campaign_id, month, scans, forms, mentions, is_sample) VALUES ('c-gads', ?, ?, ?, 0, 1)`, `${y}-${pad(m)}`, f * 3, f);
  }

  // ---- monthly numbers: the 22 full months before this one (a real hub gets last month's numbers early in the month) ----
  const lastYear = [52, 50, 55, 61, 70, 84, 93, 88, 73, 62, 58, 55];
  const shares = { install: 0.36, service: 0.64, commercial: 0.04 };
  const perJob = { install: 12500, service: 980, commercial: 28000 };
  const jobRate = { install: 0.32, service: 0.8, commercial: 0.5 };
  const spendByMonth = [2400, 2200, 7400, 9300, 6900, 3500, 2500, 2300, 3700, 9800, 5100, 2900];
  for (let k = -22; k <= -1; k++) {
    const [y, m] = addMonths(k);
    const mk = `${y}-${pad(m)}`;
    const growth = k > -13 ? 1.09 : 1;
    const frac = 1;
    const wobble = 1 + (((m * 7 + y) % 5) - 2) * 0.02;
    const total = lastYear[m - 1] * growth * wobble * frac;
    for (const d of Object.keys(shares)) {
      const leads = Math.max(1, Math.round(total * shares[d]));
      const jobs = Math.max(0, Math.round(leads * jobRate[d]));
      q(`INSERT INTO monthly (month, division, leads, jobs, revenue, is_sample) VALUES (?, ?, ?, ?, ?, 1)`, mk, d, leads, jobs, jobs * perJob[d]);
    }
    q(`INSERT INTO monthly_spend (month, spend, is_sample) VALUES (?, ?, 1)`, mk, Math.round(spendByMonth[m - 1] * frac / 100) * 100);
  }

  // ---- ideas and votes ----
  const I = (id, text, by, status, note, off) => q(
    `INSERT INTO ideas (id, text, by_person, status, note, is_sample, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`, id, text, by, status, note, at(off, 10), at(off, 10));
  I('i-video', 'Short video: what an install day looks like, start to finish', 'd-lead', 'new', '', -2);
  I('i-hockey', 'Sponsor the Brookfield youth hockey team', 'd-owner2', 'new', '', -6);
  I('i-refer', 'Refer-a-neighbor credit for past customers', 'd-office', 'considering', '', -14);
  I('i-faq', 'Answer the top 10 phone questions as short posts', 'd-tech', 'new', '', -1);
  I('i-rebate', 'Heat pump rebate explainer campaign', 'd-owner', 'planned', 'On the roadmap for late winter', -35);
  I('i-tv', 'Local cable TV spot', 'd-owner2', 'parked', 'Cost per household reached is too high this year', -58);
  const V = (idea, ...who) => who.forEach((p) => q(`INSERT INTO idea_votes (idea_id, person_id, created_at) VALUES (?, ?, ?)`, idea, p, nowIso));
  V('i-video', 'd-owner', 'd-office', 'd-tech', 'd-admin');
  V('i-refer', 'd-owner', 'd-owner2', 'd-lead');
  V('i-faq', 'd-office', 'd-lead');
  V('i-hockey', 'd-tech');
  V('i-rebate', 'd-admin', 'd-owner');

  // ---- content: Agency blog drafts ----
  const K = (id, title, excerpt, topic, body, status, off, extra = {}) => q(
    `INSERT INTO content (id, kind, title, body, excerpt, topic, sources, status, origin, reviewed_by, reviewed_at, published_url, is_sample, created_at, updated_at)
     VALUES (?, 'blog', ?, ?, ?, ?, '[]', ?, 'agency', ?, ?, ?, 1, ?, ?)`,
    id, title, body, excerpt, topic, status, extra.by || null, extra.by ? at(off + 1, 11) : null, extra.url || null, at(off, 7), at(off, 7));
  K('k-heat', 'Five things to check before you turn the heat on', 'A short checklist homeowners can run in ten minutes before the first cold night.', 'Heating prep', BLOG_HEAT, 'draft', 0);
  K('k-filter', 'How often should you really change your furnace filter?', 'The honest answer depends on the filter, the house and who lives in it.', 'Filters', BLOG_FILTER, 'draft', -1);
  K('k-noise', 'That noise your system is making, and what it usually means', 'A plain-English guide to rattles, hums and clicks.', 'Troubleshooting', BLOG_NOISE, 'published', -12, { by: 'd-owner', url: 'https://acmeair.example/blog/system-noises' });

  // ---- social posts ----
  const accts = (...a) => JSON.stringify(a);
  const P = (id, caption, a, when, status, img, extra = {}) => q(
    `INSERT INTO posts (id, caption, accounts, scheduled_at, status, image_url, by_person, origin, content_id, is_sample, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    id, caption, a, when, status, img, extra.by === undefined ? 'd-admin' : extra.by, extra.origin || null, extra.content || null, nowIso, nowIso);
  P('p-1', 'Another ductless install wrapped up in Millbrook. Quiet, efficient and ready for winter.', accts('fb', 'ig'), at(-2, 9), 'published', '/img/demo-minisplit.jpg');
  P('p-2', 'Same install, posted to Google.', accts('gbp'), at(-2, 9, 30), 'failed', '/img/demo-minisplit.jpg');
  P('p-3', 'Tune-ups are booking now. Mention TUNEUP when you call.', accts('fb', 'ig', 'gbp'), at(1, 10), 'scheduled', '/img/demo-furnace.jpg');
  P('p-4', 'Five things to check before you turn the heat on. Full checklist on our blog.', accts('fb', 'ig'), at(2, 10), 'draft', '/img/demo-thermostat.jpg', { by: null, origin: 'agency', content: 'k-heat' });
  P('p-5', 'Marcus and the crew finished a full system swap in Cedar Falls today.', accts('fb', 'ig'), at(3, 12), 'submitted', '/img/demo-condenser.jpg', { by: 'd-lead' });
  P('p-6', 'Rattle, hum or click? Here is what your system is trying to tell you.', accts('fb'), at(4, 18), 'scheduled', null);

  // ---- files ----
  const F = (id, name, campaign, kind, amount, img, by) => q(
    `INSERT INTO files (id, name, campaign_id, kind, amount, stored, image_url, uploaded_by, is_sample, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, 1, ?)`,
    id, name, campaign, kind, amount, img, by, nowIso);
  F('f-1', 'Tune-up postcard proof', 'c-tuneup', 'creative', null, '/img/demo-furnace.jpg', 'd-admin');
  F('f-2', 'Tune-up printing invoice', 'c-tuneup', 'invoice', 4700, null, 'd-office');
  F('f-3', 'Tune-up postage invoice', 'c-tuneup', 'invoice', 3900, null, 'd-office');
  F('f-4', 'Billboard contract', 'c-bill', 'invoice', 12000, null, 'd-owner');
  F('f-5', 'Install photo set', null, 'creative', null, '/img/demo-condenser.jpg', 'd-lead');
  F('f-6', 'Summer newsletter invoice', 'c-sumnews', 'invoice', 300, null, 'd-office');
  F('f-7', 'Thermostat close-ups', null, 'creative', null, '/img/demo-thermostat.jpg', 'd-tech');

  q(`INSERT OR REPLACE INTO meta (key, value) VALUES ('seeded', ?)`, nowIso);
  await env.DB.batch(st);
}

const BLOG_HEAT = `The first cold night is when most no-heat calls happen. A few minutes now can save you a wait later.

## 1. Swap the filter
A clogged filter makes the system work harder and can trip safety switches. If you can't see light through it, replace it.

## 2. Clear around the vents
Furniture and rugs over supply or return vents choke airflow. Give each one a few inches of space.

## 3. Test the thermostat
Switch to heat and raise the setting a few degrees. You should hear the system start within a few minutes. If the display is blank, try fresh batteries first.

## 4. Check the outdoor unit (heat pumps)
Clear leaves and debris from around it and make sure nothing is stacked against it.

## 5. Notice the smell, briefly
A faint dusty smell on the first run is normal and fades quickly. A smell that sticks around, or anything that smells like gas, is not. Leave the house and call your gas utility.

If anything seems off, call us and we'll take a look. [needs Acme Air: phone number and tune-up price]`;

const BLOG_FILTER = `Every one to three months is the usual answer, but it depends on a few things.

## The filter itself
Thin one-inch filters fill up fast. Thicker media filters (four or five inches) usually last longer.

## Your house
Pets, renovation dust and a busy household all shorten filter life.

## A simple rule
Check it monthly. Hold it up to a light. If you can't see light through it, change it.

Want us to set a reminder for you? [needs Acme Air: reminder program details]`;

const BLOG_NOISE = `Most system noises fall into a few families.

- **Rattling** often means a loose panel or something touching the ductwork.
- **Humming** can be normal, but a loud or new hum is worth a look.
- **Clicking** at startup is usually the system cycling. Constant clicking is not.
- **Squealing** can point to a belt or motor bearing.

When in doubt, turn it off and call us.`;
