# Repository workflow

- Start every new feature or maintenance task from the latest `origin/development` on a new branch named `feature/<short-kebab-case-description>`.
- Never implement directly on `development`, `qa`, `staging`, `prod`, or `main`.
- Before pushing a feature, review its diff and run checks appropriate to the change. Report actual results; do not claim unrun application tests passed.
- Push the feature branch, then use a pull request into `development`. Never directly push the feature commit to `development`.
- Promotion order is strictly `development` → `qa` → `staging` → `prod`, using pull requests. Do not skip environments or merge feature branches into later environments.
- After completing a change, do not automatically promote it beyond `development` unless the user requests that rollout.
- Keep `main` as the initial bootstrap branch; it is not an alternative integration path.
- Do not force-push or delete protected environment branches. Do not bypass branch protection or local hooks during normal work.
- Keep `Doc/`, `tasks/`, and `tools/` excluded from Git. Never force-add ignored documents, generated checklists, credentials, dependencies, or build output.
- Enable the local pre-push guard with `git config core.hooksPath .githooks`. Server-side GitHub rules remain the authoritative enforcement.
- The initial repository bootstrap is a one-time exception authorized by the user: initialize all five branches at the same reviewed commit before enabling protection. It does not permit future direct pushes.
