# Block-Insure

Block-Insure is a thesis prototype for blockchain-backed insurance claims,
multi-oracle verification, fraud-risk scoring, auditor voting, and on-chain
settlement.

## Project Layout

- `contracts`: Solidity contract, deployment scripts, and Hardhat tests.
- `backEnd`: Express API, MongoDB models, fraud model, and evaluation scripts.
- `frontEnd`: React dashboards for users, admins, and auditors.
- `oracle`: Two configurable oracle-node processes.
- `docs`: Design decisions, limitations, and thesis methodology notes.

## Local Services

Start each service in its own terminal:

```powershell
cd contracts
npx hardhat node
```

```powershell
cd backEnd
npm run dev
```

```powershell
cd frontEnd
npm run dev
```

```powershell
cd oracle
npm run dev
# In another terminal:
npm run dev:oracle2
```

## Verification

```powershell
cd contracts
npm test
```

```powershell
cd backEnd
npm test
npm run evaluate:risk:synthetic
npm run charts:generate
```

```powershell
cd frontEnd
npm run lint
npm run build
```

```powershell
cd oracle
npm test
```

## Research Studies

With MongoDB, the backend, and the local blockchain running:

```powershell
cd backEnd
npm run seed:mock
npm run train:model
npm run evaluate:risk
npm run loadtest:claims
npm run analyze:auditors
npm run charts:generate
```

The admin **Thesis Results** dashboard reads generated artifacts from
`backEnd/evaluation-results`.

## Documentation

- [Section 1: Smart Contract and System Design](docs/section-1-system-design.md)
- [Section 2: Oracle, Security, and Fraud Model](docs/section-2-oracle-security-fraud-model.md)
- [Section 3: Fraud Model and Report Quality](docs/section-3-fraud-model-report-quality.md)
