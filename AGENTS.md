# AI Working Instructions

This project was built with Codex assistance. The working instruction was to prioritize a small, shippable, end-to-end product over a large partial implementation.

Important constraints:

- Do not commit secrets. Use `.env` locally and environment variables in deployment.
- Keep GitHub webhook verification on the raw request body.
- Preserve idempotency by checking the GitHub delivery ID before side effects.
- Keep the dashboard behind GitHub login.
- Prefer clear, boring deployment steps that work on free tiers.
