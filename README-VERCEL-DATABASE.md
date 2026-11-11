# Vercel + Neon PostgreSQL setup

## 1. Create a Neon PostgreSQL database

Create a Neon project and copy both connection strings:
- Pooled connection string -> `DATABASE_URL` (used by the running app)
- Direct connection string -> `DIRECT_URL` (used for Drizzle schema push)

Keep `sslmode=require` in the connection string if the provider supplies it.

## 2. Create the schema before registering users

On your computer, create `.env.local` in the project root (do not commit it):

```env
DATABASE_URL=PASTE_NEON_POOLED_CONNECTION_STRING
DIRECT_URL=PASTE_NEON_DIRECT_CONNECTION_STRING
```

Then run:

```bash
npm install
npm run db:push
```

This applies the Drizzle schema to the cloud database. The app's seed runs when an API request arrives, so the tables must exist first.

## 3. Set Vercel environment variables

In Vercel -> Project -> Settings -> Environment Variables, set:
- `DATABASE_URL` = Neon pooled connection string
- `APP_BASE_URL` = `https://procure-app-sigma.vercel.app`
- `GROK_API_KEY` = your xAI API key (if using Grok)
- `GROK_MODEL` = a model currently enabled for your xAI account

Do not set `DATABASE_URL` to `127.0.0.1`, `localhost`, or a Docker hostname in Vercel.
Do not upload `.env`, `.env.local`, or secrets to GitHub.

## 4. Redeploy and test

Redeploy on Vercel. Open `/api/health`; it should return `{"ok":true}`.
Then try registration again. If it still returns 500, open Vercel -> Project -> Logs (Functions) and inspect the error for the POST request. Do not share API keys or database passwords in screenshots.
