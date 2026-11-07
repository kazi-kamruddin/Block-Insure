const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/loadIsolatedModule');

test('indexed wallet IDs reuse the caller transport while retaining catch-up, deployment and wallet filters', async () => {
  const provider = {}, calls = []; let filter;
  const service = load('services/contractQueryService.js', {
    './blockchainIndexerService': { indexConfirmedEvents: async () => { calls.push('catch-up'); },
      getIndexerContext: async p => { assert.equal(p, provider); calls.push('identity'); return { indexerId: 'deployment-A' }; } },
    './contractService': { getProvider: () => { throw Error('Unexpected independent provider'); } },
    '../models/IndexedBlockchainEvent': { distinct: async (field, query) => { calls.push('query'); filter = query; assert.equal(field, 'args.policyId'); return ['9', '2']; } },
  });
  const ids = await service.getPolicyIdsByWallet({ runner: { provider } }, '0xABC');
  assert.deepEqual(ids, [2n, 9n]); assert.deepEqual(calls, ['catch-up', 'identity', 'query']);
  assert.deepEqual(filter, { indexerId: 'deployment-A', eventName: 'PolicyPurchased', $or: [
    { 'args.holderWallet': '0xabc' }, { 'args.claimantWallet': '0xabc' },
  ] });
});

test('failed standalone indexed identity lookup releases its transport and never queries another deployment', async () => {
  let destroyed = 0, queries = 0;
  const service = load('services/contractQueryService.js', {
    './blockchainIndexerService': { indexConfirmedEvents: async () => {}, getIndexerContext: async () => { throw Error('RPC unavailable'); } },
    './contractService': { getProvider: () => ({ destroy: () => { destroyed++; } }) },
    '../models/IndexedBlockchainEvent': { distinct: async () => { queries++; return []; } },
  });
  await assert.rejects(service.getClaimIdsByWallet(null, '0xabc'), /RPC unavailable/);
  assert.equal(destroyed, 1); assert.equal(queries, 0);
});
