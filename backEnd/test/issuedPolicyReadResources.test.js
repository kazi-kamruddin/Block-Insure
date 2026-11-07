const test = require('node:test');
const assert = require('node:assert/strict');
const { ethers } = require('ethers');
const load = require('./helpers/loadIsolatedModule');

test('independent issued-term reads run together and preserve deployment, coverage and payment-calendar facts', async () => {
  const provider = {}, contract = { runner: { provider } }, started = [];
  let release; const gate = new Promise(resolve => { release = resolve; });
  const wait = async name => { started.push(name); await gate; };
  const raw = { packageId: 7n, packageRuleVersion: 2n, waitingPeriod: 86400n, reinstatementWaitingPeriod: 86400n,
    claimDeadline: 2592000n, insurerShareBps: 8000n, deductibleRateBps: 1000n, deductibleCapWei: 10n,
    maximumClaimWei: 100n, minimumDocumentCommitments: 1n, coverageLimitWei: 100n, policyRuleVersion: ethers.id('rules') };
  const economics = { getPolicyTerms: async () => raw, getPackageRules: async () => [null, [ethers.id('HOSPITALIZATION')], []],
    getCoverageIntervals: async () => { await wait('intervals'); return [{ startsAt: 1n, endsAt: 2n, waitingEndsAt: 1n }]; },
    remainingCoverage: async () => { await wait('coverage'); return 80n; },
    getPaymentSchedule: async () => { await wait('calendar'); return { profileId: ethers.id('QUARTERLY'), intervalSeconds: 7776000n, advanceWindowSeconds: 2592000n, gracePeriodSeconds: 604800n }; } };
  let scopeProvider;
  const service = load('services/issuedPolicyTermsService.js', {
    './contractService': { getPolicyEconomics: async c => { assert.equal(c, contract); return economics; } },
    './deploymentScopeService': { getDeploymentScope: async p => { scopeProvider = p; await wait('scope'); return 'deployment-A'; } },
    '../models/PolicyRulePublication': { findOne: filter => { assert.equal(filter.deploymentScope, 'deployment-A'); return { lean: async () => null }; } },
  });
  const pending = service.getIssuedTerms(contract, 3n);
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(started.sort(), ['calendar', 'coverage', 'intervals', 'scope']);
    assert.equal(scopeProvider, provider);
  } finally { release(); }
  const result = await pending;
  assert.equal(result.remainingCoverageWei, '80'); assert.equal(result.coverageLimitWei, '100');
  assert.equal(result.coinsuranceBps, 8000); assert.equal(result.paymentSchedule.profile, 'QUARTERLY');
  assert.deepEqual(result.coveredClaimTypes, ['HOSPITALIZATION']);
  assert.deepEqual(result.coverageIntervals, [{ startsAt: '1', endsAt: '2', waitingEndsAt: '1' }]);
});

test('deployment identity borrows its caller transport without closing it and never suppresses chain/code validation', async () => {
  let destroys = 0, creations = 0, chain = 31337n, code = '0x6000';
  const provider = { getNetwork: async () => ({ chainId: chain }), getBlock: async () => ({ hash: ethers.id('block') }),
    getCode: async () => code, destroy: () => { destroys++; } };
  const service = load('services/deploymentScopeService.js', {
    './contractService': { getProvider: () => { creations++; return provider; }, getContractAddress: () => '0x' + '1'.repeat(40) },
  }, { CONTRACT_DEPLOYMENT_BLOCK: '1', CHAIN_ID: '31337' });
  assert.match(await service.getDeploymentScope(provider), /^31337:/); assert.equal(creations, 0); assert.equal(destroys, 0);
  chain = 84532n; await assert.rejects(service.getDeploymentScope(provider), /chain differs/); assert.equal(destroys, 0);
  chain = 31337n; code = '0x'; await assert.rejects(service.getDeploymentScope(provider), /no manager/);
  code = '0x6000'; await service.getDeploymentScope(); assert.equal(creations, 1); assert.equal(destroys, 1);
});

test('a standalone failed deployment check releases only its owned provider', async () => {
  let destroys = 0;
  const service = load('services/deploymentScopeService.js', { './contractService': {
    getProvider: () => ({ destroy: () => { destroys++; } }), getContractAddress: () => '0x' + '1'.repeat(40),
  } }, { CONTRACT_DEPLOYMENT_BLOCK: 'invalid' });
  await assert.rejects(service.getDeploymentScope(), /CONTRACT_DEPLOYMENT_BLOCK/); assert.equal(destroys, 1);
});
