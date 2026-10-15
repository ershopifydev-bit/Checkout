# Local development and verification

1. Select the exact Node and pnpm versions in the root manifests.
2. Run `pnpm install --frozen-lockfile`; a lockfile mismatch is a failure to fix, not a reason to bypass the check.
3. Run `pnpm check`, `pnpm api:spec`, and `pnpm audit --audit-level=moderate`.
4. Run `pnpm start:api`; request `http://127.0.0.1:3000/health/ready`.
5. Stop with Ctrl+C or SIGTERM. Fastify drains connections; a ten-second shutdown deadline prevents a hung process from waiting indefinitely.

If startup exits with an error, check HOST (IP address), PORT (integer 1–65535), LOG_LEVEL, and port availability. Configuration values are not echoed to logs. `.env` is optional and ignored; use Node's explicit `--env-file` option if needed.

Logs contain a correlation ID, method, route pattern, response status, and elapsed time. Avoid adding raw requests, query strings, body content, customer data, or provider exceptions. No external log exporter is configured yet.

The runtime tests bind ephemeral loopback ports and launch the compiled API. In restricted agent environments, they may require local-network permission. They verify HTTP readiness, SIGINT/SIGTERM exit, rejected configuration, and listener conflicts. They do not contact Shopify or other providers.

Future production runbooks must cover dependency readiness, TLS/proxy configuration, secrets, backup/restore, uninstall/privacy handling, incidents, and rollback. This local guide does not satisfy those release gates.
