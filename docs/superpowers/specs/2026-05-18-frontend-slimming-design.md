# Frontend Slimming Design

## Goal

Reduce the frontend framework and dependency weight while preserving the current UI. The user-facing pages, routes, layout, colors, spacing, component behavior, and workflows should remain visually and functionally equivalent to the current implementation.

## Current State

The frontend source is small, but the dependency stack is heavy for the product scope. The project currently combines Umi Max, Ant Design, Ant Design Pro Components, React Query, React Router usage in one legacy file, Tailwind-related tooling, Radix packages, and lucide-react. The main weight comes from Umi Max and Ant Design Pro Components rather than from the application code itself.

## Chosen Approach

Migrate the frontend to a lighter stack:

- Keep React, React DOM, Ant Design, Ant Design Icons, Axios, React Query, Vite, TypeScript, and Vitest.
- Add or use React Router as the explicit client router.
- Remove Umi Max and Ant Design Pro Components.
- Remove unused Radix, lucide-react, Tailwind, and class utility dependencies if they are not used after migration.
- Replace Pro Components with local compatibility components that preserve current visual output and existing page usage patterns.

## UI Preservation Boundary

The migration must not intentionally change:

- Routes: `/`, `/buckets`, `/files`, `/build`, `/tasks`, `/tasks/:taskId`.
- Sidebar navigation structure, collapsed behavior, logo area, content background, and footer placement.
- Page titles, subtitles, tables, forms, buttons, tags, alerts, steps, modals, uploads, and task workspace behavior.
- Existing Ant Design theme tokens, including colors, border radii, table styling, button radius, and typography.
- Business API calls, websocket behavior, task polling, and mutation flows.

Text encoding problems that already exist may be fixed only if the fix preserves the intended Chinese copy.

## Component Plan

Create local replacements for the Pro Components currently used:

- `PageContainer`: render a page header with title/subtitle and a content body matching the current spacing.
- `ProCard`: wrap `antd` `Card` while supporting the current props used by pages, including `bordered`, `ghost`, `headerBordered`, `bodyStyle`, `className`, `size`, and title content.
- `StatisticCard`: wrap `antd` `Statistic` and card layout to match the dashboard and storage/file summary cards.
- `AppShell`: replace `ProLayout` with `antd` `Layout`, `Sider`, `Menu`, `Tooltip`, and `ConfigProvider`, preserving route selection, collapsed state, logo, footer, and content container.

The page components should keep their business logic and JSX structure as much as possible, changing imports and wrapper props only where needed.

## Routing And Bootstrapping

Replace the Umi runtime with a normal Vite entrypoint:

- Add `src/main.tsx` to mount the React app.
- Make `src/app.tsx` own `QueryClientProvider`, `BrowserRouter`, and route definitions.
- Update layout usage to use React Router `Outlet`, `useLocation`, and `useNavigate`.
- Keep `index.html` targeting the Vite entrypoint.
- Remove `frontend/config/config.ts` once Umi is no longer used.
- Update package scripts from `max dev/build/preview` to Vite equivalents.

## Validation

Run:

- `npm run test`
- `npm run build`

If dependency installation is available, run the Vite dev server and manually check:

- Navigation between all routes.
- `/tasks/:taskId` task detail route.
- Build wizard step flow.
- Buckets and files pages render tables, forms, modals, and uploads.
- Overview and task workspace render without layout regressions.

## Risks

The highest risk is visual drift from replacing Pro Components. This is controlled by keeping local compatibility components narrow and matching only the props currently used. The second risk is route behavior changing when Umi is removed; this is controlled by explicit route definitions and checking all existing paths.
