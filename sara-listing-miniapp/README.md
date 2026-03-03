# Sara Chen — Telegram Mini App + Bot (Listing Desk)

This zip contains:
- **site/** → Cloudflare Pages mini website (Telegram Web App / Mini App) + PDFs + admin dashboard page
- **worker/** → Cloudflare Worker (Telegram webhook + lead capture + D1 database + admin API)

## Fast walkthrough (deploy order)
1) Deploy **Pages** from `site/`
2) Create **D1** + migrate from `worker/`
3) Deploy **Worker**
4) Set **Telegram webhook**
5) Set **Bot menu button** to your Pages URL

## 1) Telegram bot
- Open **@BotFather**
- `/newbot` → create bot
- Copy **BOT TOKEN**

## 2) Deploy Pages site
- Deploy the `site/` folder as a Cloudflare Pages project (must be HTTPS).
- After deploy you get: `https://YOUR-PAGES-DOMAIN.pages.dev`

PDFs are already included in `site/` root in this zip.

## 3) Create D1 database + migrate
```bash
cd worker
npx wrangler d1 create sara_listing_db
# copy database_id into worker/wrangler.toml (database_id)
npx wrangler d1 migrations apply sara_listing_db
```

## 4) Configure Worker vars + secrets
Edit `worker/wrangler.toml`:
- `APP_ORIGIN = "https://YOUR-PAGES-DOMAIN.pages.dev"`
- `ADMIN_TOKEN = "long-random-string"`

Set secrets:
```bash
cd worker
npx wrangler secret put BOT_TOKEN
npx wrangler secret put ADMIN_CHAT_ID
npx wrangler secret put WEBHOOK_SECRET
```

**ADMIN_CHAT_ID** should be your Telegram user chat id (or a private group id).

## 5) Deploy Worker
```bash
cd worker
npx wrangler deploy
```
You’ll get a Worker URL like:
`https://sara-listing-bot.<your>.workers.dev`

## 6) Set Telegram webhook (with secret token)
```bash
curl -s "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -d "url=https://sara-listing-bot.<your>.workers.dev/telegram/webhook" \
  -d "secret_token=<YOUR_WEBHOOK_SECRET>"
```

## 7) Set Menu Button (Mini App)
In **@BotFather**:
- `/setmenubutton`
- Choose your bot
- Type: Web App
- Text: `Open Listing Desk`
- URL: `https://YOUR-PAGES-DOMAIN.pages.dev`

## 8) Admin dashboard
- In `site/admin.html`, set:
  ```js
  const apiBase = "https://sara-listing-bot.<your>.workers.dev";
  ```
  then redeploy Pages.

- Open:
  `https://YOUR-PAGES-DOMAIN.pages.dev/admin.html?token=YOUR_ADMIN_TOKEN`

## Test
- Telegram → your bot → `/start`
- Open the Mini App
- Submit a lead
- Confirm you received it in ADMIN_CHAT_ID and it appears in admin.html

## Notes
- Do not promise “guaranteed listings.” Approvals depend on platform review.
