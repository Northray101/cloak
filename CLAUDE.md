# Cloak

A human-centric AI assistant. Static frontend on Cloudflare Pages, Supabase backend, Cohere via a Supabase Edge Function.

## Stack

| Layer | Service |
|---|---|
| Frontend | Static HTML/CSS/JS, served by Cloudflare Pages (`wrangler.jsonc`) |
| AI backend | Supabase Edge Function `chat-message` → Cohere API |
| Auth + DB | Supabase (email auth, chat history, profiles, announcements) |

There is **no build pipeline**. Files are served as-is. Push to `main` and Cloudflare Pages auto-deploys.

## Repo layout

- `index.html` — primary marketing landing. Self-contained (does NOT link `cloak.css`).
- `landing.html` — deeper "What is Cloak?" page, reachable from the chat auth screen.
- `values.html` — values / safety laws / principles page. Uses `cloak.css`.
- `chat.html` — the main app (auth + chat UI). Uses `cloak.css` + `cloak.js`.
- `agents.html` — standalone agent canvas. Has its OWN inlined theme tokens (`:root` block at lines ~22–58) — these are NOT duplicates of `cloak.css`; they are the page's only design source. Removing them breaks the page.
- `admin-management.html` — internal admin dashboard. Separate design system (yellow accent). Ships with a placeholder anon key.
- `cloak.css` — shared design system used by chat / values / landing.
- `cloak.js` — app logic, auth, Supabase client, settings, theming, chat.
- `search.js` + `search-patch.js` — web-search overlay used inside chat.
- `supabase/functions/chat-message/` — Edge Function for chat (Groq + NVIDIA).
- `supabase/functions/telegram-bot/` — Telegram Bot webhook. Calls `chat-message` internally.
- `supabase/functions/sms-bot/` — Twilio SMS webhook (TwiML). Calls `chat-message` internally.
- `supabase/migrations/` — SQL migrations. Apply via Supabase dashboard or CLI.
- `robots.txt`, `sitemap.xml` — SEO.

## Design system

- **Tokens** (in `cloak.css` `:root` and mirrored in `index.html`):
  `--ink #0A0A0A`, `--paper #F2EEE5`, `--surf #FAFAF7`, `--p2 #EAE5DB`, `--p3 #DDD8CC`, `--acc #D44D2A`, `--acc2 #B83B1D`.
- **Borders**: `--bd: 2px solid #0A0A0A`. Hard, not soft rgba.
- **Shadows**: hard offset, no blur — `--sh: 4px 4px 0 #0A0A0A`, `--shsm: 2px 2px 0`, `--shlg: 6px 6px 0`. Neobrutalist aesthetic.
- **Fonts**: `--fd: 'Syne'` (display, 700/800), `--fu: 'Space Grotesk'` (body, 400/500/600/700).
- **Themes**: `default`, `eco`, `aqua` × `light`/`dark`. Toggled via `localStorage.cloak_theme` and `localStorage.cloak_dark`. Each themed page has an early inline `<script>` that reads localStorage before paint to prevent FOUC — don't move or remove these.
- **`index.html` is its own world**: it has a self-contained `<style>` block and uses `prefers-color-scheme` for dark mode (not the `.dark` class). Its tokens are kept in sync with `cloak.css` manually. When changing tokens, change BOTH places.

## Routing conventions

- Internal links use relative paths (`chat.html`, `values.html`, etc.).
- "Launch App" / "Start Using Cloak" / "Open Cloak" CTAs always point to `https://chat.usecloak.org` (the production app subdomain).
- "Back to Cloak" buttons inside app pages (values, agents) point to `chat.html`, NOT `index.html`. The user came from the app, so they go back to the app.
- `chat.html` auth-note links to `landing.html` for "What is Cloak?".

## Accessibility conventions

- Decorative SVGs: `aria-hidden="true"`.
- Icon-only buttons / anchors: `aria-label="..."`.
- Respect `prefers-reduced-motion`: disable custom cursor, scroll-reveal stagger, decorative keyframes.
- Provide `:focus-visible` rings — keyboard users need to see focus.
- Do NOT add `maximum-scale=1.0` or `user-scalable=no` to viewport meta. Block pinch-zoom = a11y violation.
- Prefer `<a href>` over `<button onclick="window.location.href=...">` for navigation.

## Don't-touch list

- `agents.html` lines ~22–58 (`:root` token block). Page is standalone; these are its only theme source.
- `cloak.css` tokens. Shared by chat/values/landing. Token shifts ripple through the whole app — when unifying, sync `index.html` to match `cloak.css`, never the other direction.
- The early `localStorage.cloak_dark` / `cloak_theme` inline scripts in `<head>`. They prevent FOUC.
- Supabase URL + anon key in `cloak.js` (top), `agents.html` (~line 802). Anon keys are publishable (RLS-protected), but extracting them properly needs a build step. Treat as known follow-up.
- `admin-management.html` body. Internal tool, separate design system, currently non-functional (placeholder anon key).
- `chat.html` and `agents.html` body content. Tons of state, IDs read by JS, inline `onclick` handlers. Edit head meta only unless the change is targeted and tested.

## Local dev

```bash
npx wrangler pages dev . --port 8788
# fallback:
python3 -m http.server 8000
```

Then click through:
1. `/` → Launch App goes to `https://chat.usecloak.org`.
2. `/values.html` → both back buttons go to `chat.html`.
3. `/agents.html` → back arrow goes to `chat.html`.
4. `/landing.html` → Launch buttons go to `https://chat.usecloak.org`.
5. `/chat.html` → "What is Cloak?" goes to `landing.html`.

No automated tests.

## Messaging integrations

### Telegram
- Edge Function: `supabase/functions/telegram-bot/index.ts`
- Required secrets: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (optional but recommended)
- Setup:
  1. Create a bot via [@BotFather](https://t.me/BotFather), get the token.
  2. Deploy the function: `supabase functions deploy telegram-bot`
  3. Register the webhook: `curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=<SUPABASE_URL>/functions/v1/telegram-bot&secret_token=<WEBHOOK_SECRET>"`

### Twilio SMS
- Edge Function: `supabase/functions/sms-bot/index.ts`
- Required secrets: `TWILIO_AUTH_TOKEN`
- Setup:
  1. Get a Twilio number, set its "A Message Comes In" webhook URL to `<SUPABASE_URL>/functions/v1/sms-bot`.
  2. Deploy: `supabase functions deploy sms-bot`
  3. Set env secret: `supabase secrets set TWILIO_AUTH_TOKEN=<token>`
- Users can text `reset` to clear their conversation history.

### Session persistence
- Both bots use the `messaging_sessions` table (see `supabase/migrations/20260512000000_messaging_sessions.sql`).
- Apply the migration via Supabase dashboard SQL editor or `supabase db push`.

## Known follow-ups

- Minify `cloak.css`, `cloak.js`, `search.js`, `search-patch.js` (need a build step).
- Extract Supabase URL/anon key into env vars.
- Replace the placeholder anon key in `admin-management.html`.
- Generate a `og-image.png` (1200×630) and switch `twitter:card` to `summary_large_image`.
- Add a custom `404.html` matching the design system.
- Privacy / Terms pages.
- GDPR cookie-consent gate before AdSense lazy-load in `cloak.js`.
- Dedupe `agents.html` theme tokens into `cloak.css` (requires regression-testing the agent canvas).
- JS module split for `cloak.js`.
