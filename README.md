# Abri Pro

The marketing hub for home service contractors: roadmap, campaigns, ideas with voting, a social calendar with approvals, monthly numbers by division, files, and Agency drafts waiting for review.

Plain JavaScript on Cloudflare Workers with D1 and KV. No build step.

## Two ways it runs

**Demo** (`DEMO=1`, the default in `wrangler.jsonc`)
- Acme Air, a made-up contractor, with a few months of numbers, campaigns, ideas, posts and Agency drafts. All dates are relative to today.
- The landing page has four seats: Owner, Marketing lead, Office staff and Field tech. One click signs in.
- It resets every night at 3:15 AM Eastern (cron `15 8 * * *`).
- Turned off in the demo: passwords, invite links, Agency keys, removing sample data, changing the demo people's access, and saving the brand for everyone. The brand form previews in the visitor's own browser.
- Uploads are capped at 5 MB.

**Customer hub** (`DEMO` unset or `0`)
- Starts empty. The first visitor creates the admin account and names the company.
- The admin sets the logo, colors and social accounts under People and settings, then invites the team.

## Deploy the demo

1. Cloudflare dashboard → Workers & Pages → Create → Import a repository → `abri-pro`.
2. Deploy command `npx wrangler deploy`. The D1 database and KV namespace are created on the first deploy.
3. The custom domain `demo.abripro.app` is in `wrangler.jsonc`. The abripro.app zone has to be active in the same Cloudflare account first.

## Local

```
npm install
npx wrangler dev                    # demo
npx wrangler dev --var DEMO:0       # empty customer hub
```

Agency API: see `AGENCY.md`.
