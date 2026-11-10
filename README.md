# GuildZero

GuildZero is an autonomous economic marketplace for real, deterministic data-processing services. Agents will make independent bidding and negotiation decisions; Convex provides centralized coordination. Agents are algorithms, not LLMs. Planned settlement is a **custodial NEAR testnet demonstration**, not trustless escrow.

**Current implementation: Cluster 1 foundation.** Email/password authentication, a private mission workspace, mission CRUD, bounded CSV input, integer budget handling, and initial agent definitions. Auctions, service execution, subcontracting, reputation, visualization, and payments are not active.

## Local setup (no account or paid service required)

Requirements: Node.js 24 LTS or newer supported even-numbered release (tested with Node 26.13.0), npm, and network access for initial dependency/backend downloads. Dependencies are pinned in `package.json` and `package-lock.json`.

```sh
npm ci
npm run dev:backend
```

On the first run, choose **Start without an account (run Convex locally)** and confirm. Convex downloads its official local backend, generates `.env.local`, and deploys the schema/functions. Keep that terminal running. In another terminal:

```sh
npm run auth:keys
npm run dev
```

Open http://localhost:3000. Sign up using an email and a 12–128 character password. Local signup works without email delivery. **Email verification and password recovery are not enabled**; use disposable demo accounts and keep your password.

`auth:keys` generates RS256 keys in memory and sends them directly to the configured Convex backend over stdin. It never prints keys, saves them in source files, or overwrites existing keys. Run it once per new backend. Re-running against an already configured backend fails safely. Restart `npm run dev` after changing frontend environment variables.

For a free Convex cloud development deployment, choose the login option in `npm run dev:backend` instead. You must supply your own Convex login and select a free project. Then run `npm run auth:keys` against that selected deployment. No deployment token is needed by the browser. Cloud deployment is not required for Cluster 1.

## Environment and secrets

`.env.example` documents the public URL placeholders. Convex writes actual local values to ignored `.env.local`; do not copy the empty example over that file. `NEXT_PUBLIC_CONVEX_URL` is required for the UI. `NEXT_PUBLIC_CONVEX_SITE_URL` is generated for HTTP auth routes; the backend supplies its own `CONVEX_SITE_URL` for JWT verification. Backend-only `JWT_PRIVATE_KEY` and `JWKS` are configured by the key helper, not put in a `NEXT_PUBLIC_` variable. Password-only auth does not require `SITE_URL`.

This working checkout also includes an ignored `.env.convex.local` worksheet with blank server-only fields, ready for manual configuration if needed. It is **not automatically loaded or synced**. For a different backend, fill every field and import with `npx convex env set --from-file .env.convex.local`, or use `npm run auth:keys` instead. Current local auth keys are already configured; leave them intact. Never import blank values into a working backend. The worksheet and `.env.local` are private local files and are intentionally absent from Git.

Without `NEXT_PUBLIC_CONVEX_URL`, the frontend shows setup instructions instead of pretending storage/auth work. Both local processes are needed for live use. `.convex/`, `.env*` (except the example), build files, and test artifacts are ignored. There are no NEAR credentials or signing code in Cluster 1.

## Foundation walkthrough

1. Open `/sign-in`, choose **Sign up**, and create account A.
2. On `/dashboard`, select **New mission**. Enter a title, choose `csv_normalize` or `csv_summary`, and select **Use synthetic sample CSV** or paste CSV.
3. Set a positive budget (up to 1,000 testnet NEAR), a deadline within 30 days, and acceptance notes. Select **Create private mission**.
4. The saved `/missions/[id]` page shows the exact input and budget. Reload to confirm persistence; edit and save changes. Missions remain drafts and move no funds.
5. In a private browser window, create account B. Its dashboard does not list A's mission. Paste A's mission URL: access is denied without revealing the mission contents. Backend tests also exercise unauthorized edit/delete attempts.
6. Sign back in as A and delete the draft using the confirmation step.

Input limits: 64 KiB of UTF-8 CSV, 1–500 data rows, at most 32 columns, unique nonempty headers, consistent row widths, 100-character titles, and 1,000-character acceptance notes. No external URL fetching or file execution. Notes are stored as text, not executed or treated as policy. Input validation is not yet the service execution/verification engine.

## Validation

```sh
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
npm audit
```

Vitest uses `convex-test` for isolated backend tests; it does not substitute for a live auth check. Browser tests use real Convex Auth and the running backend:

```sh
# Start npm run dev:backend and configure auth keys first.
npx playwright install chromium
npm run test:e2e
# Or use an existing compatible system Chromium:
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
```

Playwright starts Next.js automatically if port 3000 is free. Run against a disposable development backend: it creates two new demo accounts per run and deletes its mission on success. It does not delete auth accounts. Traces, video, and screenshots are disabled to avoid storing credential-bearing form state. No bypass auth or fake database is used by this test.

For a production-build smoke check, run `npm run build`, then `npm start` while the configured Convex backend is running. Do not run the production build and development server concurrently in the same checkout.

## Architecture and boundaries

- `app/`, `components/`: Next.js App Router UI, Tailwind, shadcn/ui-style Button/Input primitives, Convex client subscriptions, and authenticated navigation.
- `convex/`: Convex Auth managed tables and HTTP routes; mission schema and owner-scoped query/create/update/delete functions. Owner IDs come exclusively from the verified session. Lists use indexed pagination; denied and nonexistent mission IDs return the same error.
- `lib/`: bounded mission validation, BigInt money conversion, static initial agents. No agent execution yet.
- `tests/`: unit, backend integration, and a live two-account browser smoke test.

Auth uses the documented Convex Auth React provider in a client boundary. Private mission data is fetched only after authentication, and every mission function independently checks backend identity and ownership. Protected routes may serve a public HTML shell, but never private mission data in that shell. Authentication library endpoints necessarily allow credential exchange; no marketplace API is public. Convex Auth is beta. The demo currently has neither email verification nor recovery, so it must not be represented as production account management.

The `minimatch` override patches a development-only ESLint dependency advisory while retaining pinned compatible tooling. Convex Auth uses the patched compatible `@auth/core` 0.41.3 rather than the older version shown in its setup example.

Official setup references: [Next.js installation](https://nextjs.org/docs/app/getting-started/installation), [Convex Auth setup](https://labs.convex.dev/auth/setup), [manual auth/key configuration](https://labs.convex.dev/auth/setup/manual), [password provider](https://labs.convex.dev/auth/config/passwords), and [Convex testing](https://docs.convex.dev/testing/convex-test).

See [cluster status](docs/CLUSTER_STATUS.md), [decisions and deviations](docs/DECISIONS_AND_DEVIATIONS.md), and [locked product decisions](docs/decisions.md). Clusters 2–4 require separate explicit authorization.
