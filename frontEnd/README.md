# Block-Insure Frontend

React and Vite dashboards for policyholders, administrators, and auditors.

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
