# Phase 5 Operational Hardening

## Objective

Phase 5 turns the Phase 0–4 implementation into repeatable development and
research workflows. It does not promise that software can never fail; it makes
prerequisites explicit, fails conservatively, preserves the last valid
artifact during interrupted writes, and records machine-readable evidence for
each full verification.

## Fresh checkout

```powershell
npm run install:all
```

This uses `npm ci` in the root, backend, contracts, frontend, and oracle
workspaces. Every workspace must retain its `package-lock.json`.

Copy the environment examples and provide local-only development values. Then
run:

```powershell
npm run doctor
```

The doctor validates environment prerequisites, ABI/address synchronization,
package locks, installed workspaces, frozen model and policy identities,
dataset hashes, research hashes, mutation outcomes, chart hashes, compiled
contract artifacts, bytecode budgets, and temporary-workspace cleanup.

## One-terminal development

```powershell
npm run dev:bootstrap
```

When chain ID 31337 is unavailable, this starts a managed Hardhat node and
waits for RPC readiness. When no valid configured deployment exists, it runs
the existing clean local setup. It then starts the backend, frontend, and both
oracle workers and waits for backend/frontend health checks. An unexpected
child exit stops the managed group and returns failure instead of leaving a
partially running stack.

`setup:local` deliberately clears only the configured Block-Insure local
runtime data. `dev:bootstrap` invokes it only when a valid deployment cannot be
reused. Use `npm run dev:all` to reuse a known running deployment without a
reset.

## Verification levels

```powershell
npm run verify:repository
```

Fast static/artifact integrity verification.

```powershell
npm run verify:all
```

Runs contract tests, repository integrity, backend analytics/unit tests,
frontend lint/build, and oracle tests. Tasks continue after an individual
failure so the report exposes independent faults in one pass.

```powershell
npm run verify:full
```

Adds current local environment/ABI/address synchronization. The generated
report is `verification-results/phase5-verification.json` and contains task
status, duration, source commit/branch/dirty state, Node version, and platform.

Live Playwright tests remain separate because they intentionally require the
prepared stack, browser wallets, MongoDB, and configured local identities:

```powershell
npm run test:e2e
npm run test:e2e:workflow
```

## Research reproduction

```powershell
npm run research:all
```

The command now generates all Phase 0–4 artifacts in dependency order before
stateful and mutation assurance, then refreshes the final research manifest.
Phase-specific commands can still run independently; missing later-phase
artifacts are represented as unavailable rather than causing an unrelated
earlier phase to fail.

Research JSON output uses same-directory temporary files and atomic rename.
Dataset manifests are written last. Generated PNG/SVG files have a separate
SHA-256 chart manifest. The research manifest records package-lock hashes and
the implementation-source hashes that produced the experimental results.

## Remaining environmental limits

- MongoDB, Pinata/public IPFS, MetaMask, browser profiles, and public networks
  remain external dependencies and cannot be made failure-proof by repository
  scripts.
- `dev:bootstrap` is local-development automation, not production process
  supervision or infrastructure-as-code.
- Verification cannot replace independent security audit, formal verification,
  real insurer data, or public-network testing.
- The manager retains only 314 bytes of EIP-170 headroom; Phase 5 adds no
  deployed Solidity.
