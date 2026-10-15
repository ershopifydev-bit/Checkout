# Shopify installation dependency review

Reviewed: 15 October 2026.

The initial Vite 7.3.1 version from Shopify's template triggered security advisories. The app pins Vite 7.3.7 instead; the dependency audit confirms the Vite findings are removed. The full type/build/runtime checks are repeated after the upgrade.

## Open merge blocker

`@shopify/cli@4.9.3 -> global-agent@3.0.0 -> roarr -> sprintf-js@1.1.3` triggers [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) (moderate). The advisory describes denial of service from attacker-controlled format precision. No patched sprintf-js release is listed. Shopify CLI 4.9.4 still declares global-agent 3.0.0 and was also too new for the existing release-age policy at the time of review.

This path is development tooling, not the deployed app server. That limits the exposure but does not establish non-exploitability. A reachability assessment has not established that all format strings are trusted. The advisory remains visible and `pnpm audit --audit-level=moderate` fails. No audit-ignore entry or threshold reduction was added.

The newer global-agent removes roarr, but Shopify CLI also bundles global-agent code. Replacing only the external dependency could make the audit appear clean while leaving bundled code unchanged, so no such override was applied.

Keep the installation feature PR in draft pending an upstream fix or a separately reviewed remediation with evidence. Do not describe the dependency gate as passed or promote this increment. The dev-store organization selection and actual Shopify installation verification are separate outstanding checks.
