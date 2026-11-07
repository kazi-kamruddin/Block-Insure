const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/loadIsolatedModule');

const owner = '0x' + '1'.repeat(40), other = '0x' + '2'.repeat(40);
function fixture() {
  const providers = [], details = [];
  let fail = false;
  const policy = id => ({ policyId: BigInt(id), packageId: 1n, holderWallet: owner, startDate: 1n, endDate: 100n,
    coverageAmount: 1000n, premiumPaid: 10n, status: 1n, premiumAmount: 10n, totalPremiumPaid: 20n });
  const getReadOnlyContract = () => {
    const provider = { destroyed: 0, destroy() { this.destroyed++; } }; providers.push(provider);
    return { runner: { provider }, getPolicy: async id => { if (fail) throw Error('synthetic RPC failure'); return policy(id); },
      getEffectivePolicyStatus: async () => 1n, getPolicyPackage: async () => ({ name: 'Synthetic health', policyType: 'HEALTH' }) };
  };
  const read = field => async (contract, item) => { details.push(contract.runner.provider); return { [field]: String(item.policyId ?? item) }; };
  const service = load('controllers/policyController.js', {
    '../services/contractService': { getReadOnlyContract, getPolicyEconomics: async () => ({}) },
    '../services/contractQueryService': { getPolicyIdsByWallet: async () => [1n, 2n, 3n, 4n],
      parsePagination: () => ({ page: 1, limit: 50 }), paginate: items => ({ items, pagination: { total: items.length } }) },
    '../services/issuedPolicyTermsService': { getIssuedTerms: read('termsFor'), getInstallment: read('quoteFor'), getIssuedDocument: read('documentFor') },
  });
  const invoke = async (action, wallet = owner) => {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await service[action]({ user: { role: 'USER', walletAddress: wallet }, params: { policyId: '1' }, query: {} }, res, e => { res.error = e; });
    return res;
  };
  return { invoke, providers, details, fail: () => { fail = true; } };
}

test('four-policy response reuses one request provider and preserves all amounts, statuses and evidence commitments', async () => {
  const f = fixture(), result = await f.invoke('getMyPolicies');
  assert.equal(result.code, 200); assert.equal(result.body.count, 4);
  assert.deepEqual(result.body.policies.map(p => p.policyId), ['1', '2', '3', '4']);
  for (const p of result.body.policies) {
    assert.equal(p.coverageAmountWei, '1000'); assert.equal(p.totalPremiumPaidWei, '20'); assert.equal(p.status.label, 'ACTIVE');
    assert.deepEqual(p.issuedDocument, { documentFor: p.policyId });
  }
  assert.equal(f.providers.length, 1, 'formatting each policy must not create another RPC provider');
  assert.ok(f.details.every(p => p === f.providers[0]));
  assert.equal(f.providers[0].destroyed, 1, 'request-owned transport must be released');
});

test('policy read failure releases its owned transport and propagates the actual error', async () => {
  const f = fixture(); f.fail(); const result = await f.invoke('getMyPolicies');
  assert.match(result.error.message, /synthetic RPC/); assert.equal(f.providers[0].destroyed, 1);
});

test('another wallet cannot obtain policy economics and denied reads release their provider', async () => {
  const f = fixture(), result = await f.invoke('getPolicyById', other);
  assert.equal(result.code, 403); assert.equal(f.details.length, 0); assert.equal(f.providers[0].destroyed, 1);
});
