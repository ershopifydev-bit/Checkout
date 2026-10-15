# Checkout

Shopify checkout platform repository.

## Current implementation

The first increment provides a TypeScript/pnpm workspace, shared Zod contracts, a conservative merchant capability resolver, and a runnable Fastify process. The API exposes `GET /health/live`, `GET /health/ready`, and `GET /openapi.json`.

The Shopify admin installation shell now lives in `apps/shopify-admin`, with official Shopify authentication, encrypted MongoDB sessions, and signed lifecycle webhooks. Live development-store installation still requires app linking and verification. This is not a working shopper checkout: commerce persistence/outbox, storefront handoff, and the customer UI remain upcoming. Health readiness describes this process only. Live merchant eligibility and Gate 0 require test-store evidence. Custom payments remain disabled.

## Shopify app development

After configuring MongoDB and linking the intended development app, run one command:

```sh
npm run dev
# Or: pnpm dev
```

Both launch Shopify CLI for `codemadi.myshopify.com`. Use the CLI preview URL to install/open the app. Follow the [first-time Shopify setup](docs/runbooks/shopify-development.md) for the database, encrypted session key, and app linking. The API URL on port 3000 is a separate backend and has no storefront page.

The local todo dashboard at `tasks/index.html` is generated from ignored task files; refresh it to see recorded progress.

## API foundation setup

Use Node **24.22.0** (`.nvmrc` / `.node-version`) and pnpm **12.11.2**:

```sh
nvm install
nvm use
npm install --global pnpm@12.11.2 --ignore-scripts
pnpm install --frozen-lockfile
pnpm check
pnpm start:api
```

The API listens on `127.0.0.1:3000`. It needs no merchant credentials or external services for this increment. `.env.example` lists the optional environment variables; environment files are not loaded automatically. For example, run `PORT=3001 pnpm start:api`. To load a local file explicitly after building, use `node --env-file=.env apps/api/dist/server.js`.

For development, run `pnpm exec tsc -b tsconfig.build.json --watch` in one terminal and `pnpm dev:api` in another. The API watcher restarts when compiled files change.

| Command                             | Verification                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| `pnpm check`                        | Formatting, lint, strict types, unit/API coverage, build, and compiled-process tests |
| `pnpm test`                         | Unit and Fastify injection tests                                                     |
| `pnpm test:runtime`                 | Build and real loopback HTTP/startup/shutdown checks                                 |
| `pnpm build`                        | Compile package references and application                                           |
| `pnpm api:spec`                     | Build and regenerate `docs/api/openapi.json`                                         |
| `pnpm audit --audit-level=moderate` | Check locked dependencies for known advisories                                       |

See [foundation decisions](docs/architecture/0001-platform-foundation.md), [API contracts](docs/api/README.md), and [local operations](docs/runbooks/local-development.md). See also [Shopify development](docs/runbooks/shopify-development.md). The local implementation tracker remains in ignored `tasks/` and must not be committed.

## Branch workflow

```text
feature/<short-kebab-case-description> → development → qa → staging → prod
```

- Start every new feature or maintenance change from an updated `development` branch.
- Name branches descriptively, for example `feature/customer-address-validation`.
- Review the diff and run the applicable checks before pushing a feature branch.
- Open a pull request into `development`; promote through `qa`, `staging`, and `prod` in order.
- Do not push directly to environment branches, force-push them, or skip promotion stages.
- `main` is retained for the requested initial GitHub bootstrap, not ongoing feature work.
- All environment branches start at the same commit. Feature work proceeds independently; changes reach later environments through promotion PRs.

```sh
git switch development
git pull --ff-only origin development
git switch -c feature/short-description
# Implement, review, and run applicable checks.
git add <specific-files>
git commit -m "feat: describe the change"
git push -u origin feature/short-description
# Open a pull request: feature/short-description → development.
```

## Enforcement

After cloning, enable the local direct-push guard:

```sh
git config core.hooksPath .githooks
```

The `Branch policy` GitHub Actions check validates PR source/target names and rejects cross-repository sources. It runs trusted base-branch code and never checks out or executes PR code.

GitHub branch protection must require pull requests and the `Branch policy` status check for `development`, `qa`, `staging`, and `prod`, including administrators, with force pushes and deletion disabled. Lock `main` after bootstrap. Local hooks are bypassable and are not a substitute for GitHub protection. Current setup status must be verified in GitHub before treating protection as active.

## Local-only files

`Doc/`, `tasks/`, and `tools/` are ignored, along with dependencies, build output, local databases, environment secrets, Shopify CLI state, and local editor/agent state. Do not force-add ignored files. Lockfiles, example environment templates, and Shopify app configuration remain eligible for tracking.
