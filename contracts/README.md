# Block-Insure Smart Contracts

Hardhat workspace for `InsuranceManager`, the policy-benefit extension,
deployment scripts, gas measurements, and Solidity tests.

## Local workflow

```powershell
npm install
npm run node
```

With the local chain running, use a second terminal:

```powershell
npm run fund:accounts:local
npm run deploy:local
```

`deploy:local` deploys both contract modules, publishes the default benefit
terms, synchronizes addresses and ABIs, and funds the local benefit reserve.

## Verification

```powershell
npm run compile
npm test
npm run coverage
```

Use `npm run deploy:benefits:local` only when attaching a new benefit extension
to an already deployed `InsuranceManager` instance.
