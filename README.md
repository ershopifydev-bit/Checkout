# Checkout

Shopify checkout platform repository.

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
