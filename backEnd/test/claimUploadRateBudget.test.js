const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const load = require('./helpers/loadIsolatedModule');

test('real upload route permits five-file evidence without consuming claim authorizations; both budgets remain bounded', async () => {
  const limits = load('middleware/claimSubmissionRateLimit.js', {}, { NODE_ENV: 'test' });
  const ok = (_req, res) => res.status(200).json({ success: true });
  const controller = new Proxy({}, { get: () => ok });
  const auth = (req, _res, next) => { req.user = { walletAddress: req.get('x-test-wallet') }; next(); };
  const router = load('routes/documentRoutes.js', {
    '../controllers/documentController': controller,
    '../middleware/authMiddleware': auth,
    '../middleware/uploadMiddleware': { single: () => (_req, _res, next) => next() },
    '../middleware/claimSubmissionRateLimit': limits,
  });
  const app = express();
  app.use('/api/documents', router);
  app.post('/authorize', auth, limits, ok);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const wallet = '0x' + 'a'.repeat(40);
  const send = async (path, actor = wallet) => {
    const response = await fetch(origin + path, { method: 'POST', headers: { 'x-test-wallet': actor } });
    await response.arrayBuffer(); return response;
  };
  try {
    // Five authorizations, each with the supported maximum five documents.
    // Before the correction, the first claim's fifth upload was already 429.
    for (let claim = 0; claim < 5; claim++) {
      assert.equal((await send('/authorize')).status, 200);
      for (let slot = 0; slot < 5; slot++) assert.equal((await send('/api/documents/upload')).status, 200);
    }
    assert.equal((await send('/authorize')).status, 429, 'claim quota must stay five');
    assert.equal((await send('/api/documents/upload')).status, 429, 'upload resource quota must remain enforced');
    assert.equal((await send('/api/documents/upload', wallet.toUpperCase())).status, 429, 'case changes must not reset a wallet budget');
    assert.equal((await send('/api/documents/upload', '0x' + 'b'.repeat(40))).status, 200, 'different wallets have separate budgets');
    assert.equal((await send('/authorize', '0x' + 'b'.repeat(40))).status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
