# Block-Insure Frontend

React and Vite dashboards for policyholders, administrators, auditors,
hospitals, and banks. Tailwind CSS 4 provides the utility layer through the
official Vite plugin, while the project-specific semantic design system in
`src/styles/modern-system.css` keeps shared cards, forms, tables, status
surfaces, and role workspaces visually consistent.

Business-workflow selectors intentionally retain semantic class names so
wallet actions, accessible labels, and Playwright coverage remain stable while
the interface evolves.

## Setup

Copy `.env.example` to `.env`. The local deployment script normally fills the
contract addresses and deployment blocks automatically.

```powershell
npm install
npm run dev
```

The local app runs at `http://localhost:5173`.

## Verification

```powershell
npm run lint
npm run build
```

Run the full repository workflow from the project root with
`npm run verify:all`.

The repository-level `npm run test:e2e:frontend-production` command also
validates the production bundle at mobile, tablet, laptop, and desktop
viewports.
