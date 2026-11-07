const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const load = require('./helpers/loadIsolatedModule');

async function fixture(mode) {
  let requests = 0;
  const server = http.createServer(async (req, res) => {
    let data = ''; for await (const chunk of req) data += chunk;
    requests++;
    if (mode() === 'stall') return;
    if (mode() === 'limited') { res.writeHead(429, { 'retry-after': '0' }); res.end(); return; }
    const answer = item => ({ jsonrpc: '2.0', id: item.id, result: item.method === 'eth_chainId' ? '0x7a69' : '0x2a' });
    const body = JSON.parse(data); res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(Array.isArray(body) ? body.map(answer) : answer(body)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const service = load('services/contractService.js', {}, {
    RPC_URL: `http://127.0.0.1:${server.address().port}`, BLOCKCHAIN_RPC_TIMEOUT_MS: '1000',
  });
  const provider = service.getProvider();
  return { provider, requests: () => requests, close: async () => { provider.destroy(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

test('actual ethers transport rejects a stalled RPC within its deadline and later reads recover', async () => {
  let mode = 'healthy'; const f = await fixture(() => mode);
  try {
    assert.equal(await f.provider.getBlockNumber(), 42);
    mode = 'stall'; const start = Date.now();
    await assert.rejects(f.provider.send('eth_blockNumber', []), error => error.code === 'TIMEOUT');
    assert.ok(Date.now() - start < 4000, 'transport must not retain the five-minute default');
    mode = 'healthy'; assert.equal(await f.provider.send('eth_blockNumber', []), '0x2a');
  } finally { await f.close(); }
});

test('persistent HTTP429 uses at most three bounded transport attempts', async () => {
  let mode = 'healthy'; const f = await fixture(() => mode);
  try {
    await f.provider.getBlockNumber(); const before = f.requests(); mode = 'limited';
    await assert.rejects(f.provider.send('eth_blockNumber', []));
    assert.ok(f.requests() - before <= 3, 'retry storm must remain bounded');
  } finally { await f.close(); }
});

test('invalid transport deadlines cannot silently disable the bound', () => {
  for (const value of ['0', '-1', 'garbage', '60001']) {
    const service = load('services/contractService.js', {}, { RPC_URL: 'http://127.0.0.1:1', BLOCKCHAIN_RPC_TIMEOUT_MS: value });
    assert.throws(() => service.getProvider(), /BLOCKCHAIN_RPC_TIMEOUT_MS/);
  }
});
