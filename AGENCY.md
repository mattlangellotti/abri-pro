# Sending drafts from Agency (or the Hermes cron) to the hub

The hub accepts drafts from a job running on another machine. Drafts never publish on
their own: blogs land on the **Content** page and social posts land on the **Social**
calendar as Drafts, marked "Agency", for someone with Full access to approve.

## 1. Get a key

In the hub: **People and settings > Agency connection > Create key**. The key starts with
`abri_` and is shown once. Store it on the server as an environment variable, for example
in the cron's `.env` file:

```
HUB_URL=https://yourcompany.abripro.app
HUB_KEY=abri_...
```

Never paste the key into code, chat or Telegram. If it leaks, revoke it on the same screen
and create a new one.

## 2. Send drafts

`POST $HUB_URL/agent/drafts` with `Authorization: Bearer $HUB_KEY` and a JSON body.
Send one draft, or up to 10 at once as `{"drafts": [...]}`.

Each draft can include:

| Field | Required | Notes |
|---|---|---|
| `title` | for blogs | Blog or newsletter title |
| `body` | for blogs | Markdown: `## headings`, `**bold**`, `*italic*`, `- lists`, `[links](https://...)` |
| `excerpt` | no | One or two sentence summary |
| `kind` | no | `blog` (default), `newsletter` or `other` |
| `topic` | no | Short label, e.g. `Industry news`, `Evergreen`, `Weather` |
| `sources` | no | List of source URLs the draft was based on |
| `social` | no | One object or a list of up to 4: `caption` (required), `accounts` (account ids from People and settings, such as `fb` and `ig`; default all accounts), `suggested_at` (ISO date-time; default tomorrow about 10 AM) |
| `image` | no | `{ "data": "<base64>", "type": "image/jpeg", "filename": "x.jpg" }`. PNG, JPEG or WebP, under 20 MB. Shared by the blog and its social versions. |

A draft needs either a `title` and `body`, or at least one social `caption`.

### Example with curl

```
curl -s "$HUB_URL/agent/drafts" \
  -H "Authorization: Bearer $HUB_KEY" -H "Content-Type: application/json" \
  -d '{
    "drafts": [
      {
        "kind": "blog",
        "topic": "Evergreen",
        "title": "Why your furnace short cycles when it gets cold",
        "excerpt": "What causes short cycling and when to call.",
        "body": "## What it looks like\nThe furnace starts, runs a few minutes, and shuts off...",
        "sources": ["https://www.energy.gov/energysaver/furnaces-and-boilers"],
        "social": [{ "caption": "Furnace turning on and off every few minutes? Here is why.", "accounts": ["fb", "ig"] }]
      }
    ]
  }'
```

The reply lists the IDs it created: `{"ok": true, "drafts": [{"content_id": "...", "post_ids": ["..."]}]}`.

### Example in Python (for the cron)

```python
import base64, json, os, urllib.request

def send_to_hub(drafts):
    req = urllib.request.Request(
        os.environ["HUB_URL"] + "/agent/drafts",
        data=json.dumps({"drafts": drafts}).encode(),
        headers={"Authorization": "Bearer " + os.environ["HUB_KEY"], "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())

def image_field(path):
    with open(path, "rb") as f:
        return {"data": base64.b64encode(f.read()).decode(), "type": "image/jpeg", "filename": os.path.basename(path)}
```

## 3. Read back before drafting (avoids repeats)

- `GET $HUB_URL/agent/recent?days=60` returns recent blog titles, topics and statuses,
  social captions, and the reason for anything rejected. Give this to the model as
  "already covered, do not repeat; avoid what was rejected and why".
- `GET $HUB_URL/agent/ideas` returns open ideas from the team's Ideas board, a good source
  of topics.
- `GET $HUB_URL/agent/ping` returns `{"ok": true}` when the key works.

## Housekeeping

- Rejected drafts are deleted automatically after 90 days.
- Drafts older than 14 days drop out of the main Content view but can still be shown.
- The key can only add drafts and read the three endpoints above. It cannot read
  numbers, people, files or anything else.
