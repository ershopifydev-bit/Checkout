# Dashboard templates

`Classic` is the existing dashboard. `Workspace` supplies a sidebar, a compact toolbar,
neutral panels, denser tables and light/dark colours. The default is Classic.

## Structure

- `classic/`: original stylesheet (preserved), template metadata.
- `workspace/`: opt-in stylesheet, template metadata.
- `registry.ts`: ordered template catalogue and stable IDs.
- `TemplateSwitcher.tsx`, `switcher.css`: shared top-of-page picker.
- `preferences.ts`, `useDashboardTemplate.ts`: browser-local selection; no merchant settings writes.
- `NavigationIcon.tsx`: optional sidebar icons, hidden by the Classic stylesheet.

The shared shell remains in `App.tsx` and `components/`. All views, auth, API hooks and
save handlers remain shared. A switch changes the root `data-dashboard-template` attribute;
it does not swap components, introduce a React `key`, or remount a view. This preserves
unsaved forms and filters and avoids new API calls. See React's
[state preservation documentation](https://react.dev/learn/preserving-and-resetting-state).

The preference uses `tezvix.dashboard.template.v1` in localStorage. Unknown IDs and
unavailable storage fall back to Classic. Storage failures still allow a session-only switch.
The choice is per browser, not a server-side account setting.

## Adding a template

1. Create `templates/<stable-id>/template.ts` and `styles.css`.
2. Add its metadata to `dashboardTemplates` in `registry.ts`.
3. Import its CSS after Classic in `styles/index.css`. Scope **every** rule to
   `:root[data-dashboard-template='<stable-id>']`; never change Classic's base for a new style.
4. Use the existing shell slots and views. Keep API hooks and write logic outside templates.
5. Check both portals, unsaved state, narrow screens, dark mode and API error states.

Run `pnpm exec vitest run tests/unit/dashboard-templates.test.ts` for persistence tests.
Run `pnpm build:dashboard` then
`node --test tests/integration/dashboard-templates.browser.test.mjs` for Chrome verification.
The browser test serves local API fixtures and performs no live merchant writes. It needs
Chrome (`CHROME_BIN` overrides the binary) and permission to open local sockets. Screenshots
are written to `/tmp/tezvix-dashboard-templates` (`DASHBOARD_SCREENSHOT_DIR` overrides it).
