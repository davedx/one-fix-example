# One Fix: a reviewable implementation example

A source snapshot of the website and private conversation workflow behind [One Fix](https://remontoire.ai), a service operated by Dave / Red Sky Forge in the Netherlands. AI coding agents built and checked this implementation.

This is our own service implementation, not a completed client project or evidence of customer revenue. It gives a prospective client actual code to review before agreeing a repair.

## What is here

- A responsive HTML/CSS/JavaScript request form, a Cloudflare Worker, and D1 schema.
- Private conversations using a random 256-bit access key. D1 stores only its SHA-256 hash; the browser sends the key as a bearer credential. Anyone with the link can read and reply to that conversation.
- Customer messages persisted in D1; agent responses are written using private operational tooling, which is not included in this snapshot. There is no public agent-write endpoint.
- Outbound Resend notifications, input validation, same-origin write checks, rate limits, inert message rendering, retention cleanup, and retry deduplication.
- Playwright tests covering mobile submission, message persistence, agent response rendering, invalid access keys, cross-origin writes and recoverable errors.

The live service has separate private operations for scope review, quotes, verified Stripe payments and delivery. Those are intentionally absent here. This snapshot is not an unattended agent runtime.

## Run locally

Node.js 24 or later:

```sh
npm ci
npx wrangler d1 execute one-fix-example --local --file=schema.sql
npx wrangler d1 execute one-fix-example --local --file=conversation-schema.sql
npx wrangler d1 execute one-fix-example --local --file=inbox-schema.sql
npx playwright install chromium
npm test
npm run test:inbound
npm run dev -- --var EMAIL_DISABLED:true
```

The tests disable email. Do not supply real email credentials for local browser checks. To deploy your own copy, create a D1 database, replace the sample database ID in `wrangler.jsonc`, apply all three SQL schemas remotely, and configure your own sender and Resend secret. Adapt the seller/legal copy to your business before publishing it.

## The service

One agreed, reproducible frontend repair for EUR 49 total: a patch or PR, verification notes, and one correction. Scope, code access and deadline are confirmed before payment. The customer controls deployment. If we cannot deliver the agreed scope, we refund it.

[Free scope check and private conversation](https://remontoire.ai/?ref=github-example#request)

## Optional email fallback

The Worker can receive future messages addressed to onefix@remontoire.ai when an Email Routing rule points to it. Adapt that address in src/inbound.js for your own deployment; no mail route is created by this sample configuration. Incoming messages are untrusted queue entries, not paid orders or authorization. The private operations used to read and acknowledge them are not in this snapshot.

The handler enforces a 1 MiB input limit, stores at most32k characters plus an omission notice, decodes MIME, omits attachment bytes, redacts quoted website conversation keys and deduplicates retransmissions by retained content. HTML-only messages stay labelled source in the private queue and are never rendered by the website. Daily retention deletes email older than30days. It sends no automatic replies and forwards nothing to an operator. Seven Node/SQLite tests cover ingestion, content conflicts, limits and retention.
