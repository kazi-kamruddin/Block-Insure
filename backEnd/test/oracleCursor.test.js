const assert = require("node:assert/strict");
const test = require("node:test");
const { Wallet, verifyMessage } = require("ethers");
const { _cursorMessage } = require("../controllers/oracleController");

test("oracle cursor identity is bound to deployment, worker, block, and timestamp", async () => {
  const wallet = Wallet.createRandom();
  const cursor = {
    oracleInstanceId: "2",
    oracleWallet: wallet.address,
    chainId: "11155111",
    contractAddress: "0x1111111111111111111111111111111111111111",
    nextBlock: 12345,
    timestamp: new Date().toISOString(),
  };
  const message = _cursorMessage(cursor);
  const signature = await wallet.signMessage(message);

  assert.equal(verifyMessage(message, signature), wallet.address);
  assert.notEqual(
    verifyMessage(_cursorMessage({ ...cursor, nextBlock: 12346 }), signature),
    wallet.address
  );
});
