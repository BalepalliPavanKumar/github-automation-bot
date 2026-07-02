# GitHub Automation Bot

A small full-stack product that signs users in with GitHub, connects a repository, receives GitHub webhooks, applies configurable rules, writes back to GitHub, sends Slack alerts, and shows a live authenticated activity log.

## Features

- GitHub OAuth login with CSRF state validation.
- Repository connection that creates a GitHub webhook for `issues`, `pull_request`, and `push`.
- Webhook HMAC verification with `X-Hub-Signature-256`.
- Idempotent event storage by `X-GitHub-Delivery`.
- Rule UI for event type, keyword, GitHub label, GitHub comment, and Slack alert.
- Dashboard behind login with repository, rules, event history, action results, and live updates.
- Postgres storage when `DATABASE_URL` is set, JSON-file storage for local demos.

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:3000`.

For a real GitHub OAuth flow, create a GitHub OAuth app:

- Homepage URL: `http://localhost:3000`
- Authorization callback URL: `http://localhost:3000/auth/github/callback`

Then put the GitHub client ID and secret in `.env`.

## Environment variables

See `.env.example`.

Required for a deployed end-to-end run:

- `APP_BASE_URL`: public URL of the deployed app.
- `SESSION_SECRET`: long random string for signed sessions.
- `GITHUB_CLIENT_ID`: GitHub OAuth app client ID.
- `GITHUB_CLIENT_SECRET`: GitHub OAuth app client secret.
- `GITHUB_WEBHOOK_SECRET`: shared secret used for webhook signatures.
- `SLACK_WEBHOOK_URL`: Slack Incoming Webhook URL.
- `DATABASE_URL`: optional Postgres URL. Use Neon or Supabase on a free tier for deployment.

## Local webhook test

After connecting a repo in the dashboard, GitHub will send real webhooks. For a local signed request, run:

```bash
GITHUB_WEBHOOK_SECRET=dev-webhook-secret GITHUB_REPOSITORY=owner/repo node scripts/send-test-webhook.js
```

The helper signs the request exactly like GitHub. If `owner/repo` is not connected in the app, the event will still be recorded but ignored because no enabled rule belongs to that repo.

## Deployment

One free deployment path:

1. Create a free Postgres database on Neon or Supabase and copy the connection string.
2. Create a GitHub OAuth app whose callback URL is `https://your-app.example.com/auth/github/callback`.
3. Create a Slack app with an Incoming Webhook URL.
4. Deploy this repository to Render as a Web Service.
5. Set the environment variables from `.env.example`.
6. Set the start command to `npm start`.
7. Set `APP_BASE_URL` to the Render URL.

The app creates its database tables on startup. After signing in, choose a repository and click Connect. The app creates the webhook automatically with the configured `GITHUB_WEBHOOK_SECRET`.

## Reviewer test flow

1. Visit the deployed URL and sign in with GitHub.
2. Connect a throwaway repository you own.
3. Add a rule: event `Issue`, keyword `bug`, label `bug`, Slack alert enabled.
4. Open an issue in the connected repo with `bug` in the title.
5. Confirm the dashboard records the event and actions.
6. Confirm the issue receives the label and Slack receives the notification.
7. Re-deliver the webhook from GitHub settings and confirm it is marked as a duplicate and does not run actions twice.

## Reliability and security notes

- Forged webhook requests are rejected with `401` unless the HMAC signature matches the raw body.
- Replay/duplicate deliveries are deduplicated by GitHub delivery ID before side effects run.
- Downstream failures are recorded as failed actions and visible in the dashboard.
- Secrets are read only from environment variables and are not shipped to the browser.
- GitHub access tokens are stored server-side. For a production system, encrypt them at rest with a managed key.

## Stretch goals included

- Configurable rules in the UI.
- Multi-repository support for a single signed-in user.
- Visible action failures and event statuses.

## AI context files

This repo includes `AGENTS.md` and `AI_NOTES.md` as the AI collaboration/context artifacts used for the assignment.
