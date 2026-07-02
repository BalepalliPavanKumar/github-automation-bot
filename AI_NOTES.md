# AI Notes

I used Codex to scaffold and implement the application: Express routes, GitHub OAuth/webhook handling, Slack notification code, the dashboard UI, README, and a signed webhook test helper. I reviewed the architecture and kept the scope focused on a working core flow instead of adding a half-finished AI triage step.

Key decisions I made: 

- I chose Node and Express because the GitHub and Slack integration surface is mostly HTTP, and a single server can handle OAuth, webhooks, static UI, and dashboard APIs without extra moving parts.
- I used Postgres when `DATABASE_URL` is present, with a JSON-file fallback for local demos. That makes the app deployable to Neon/Supabase while still easy to run locally.
- I made webhook idempotency a first-class database operation keyed by `X-GitHub-Delivery` so GitHub redeliveries do not repeat labels, comments, or Slack alerts.

The hardest AI-related wrong turn was around local persistence. A first version would have required local Postgres immediately, which makes reviewer testing slower and more brittle. I changed that to a dual store: Postgres for deployment and JSON storage for local runs. The app still uses the same store interface, so the rest of the code does not care which backend is active.

With more time, I would add encrypted token storage, a retry queue with backoff for failed Slack/GitHub actions, GitHub App authentication for installation-scoped permissions, and an optional free-tier LLM summarizer using Gemini or Groq.
