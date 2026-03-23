# Cloak

**A human resource, not a companion.**

Cloak is a human-centric AI assistant built on [Cohere](https://cohere.com), with [Supabase](https://supabase.com) for auth and storage.

## Stack

| Layer | Service |
|---|---|
| Frontend | Single `index.html` — deployed via GitHub → Cloudflare Pages |
| AI backend | Supabase Edge Function (`chat-message`) → Cohere API |
| Auth + DB | Supabase (email auth, chat history, profiles, announcements) |

## Deploy

This repo is connected to **Cloudflare Pages**. Every push to `main` auto-deploys.

```
git add .
git commit -m "update"
git push
```

Cloudflare Pages picks it up automatically — no manual upload needed.

## Local dev

Open `index.html` directly in a browser. The Supabase and Cohere backends are live — no local server needed.

## Values

Cloak operates under three inviolable safety laws and a strict set of ethical principles. See the **Cloak's Values** page inside the app or read `index.html` for the full system prompt (enforced server-side).

> Never use for biblical advice · Not a mental health resource · AI can make mistakes