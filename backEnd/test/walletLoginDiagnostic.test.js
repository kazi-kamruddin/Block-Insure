const assert = require("node:assert/strict");
const test = require("node:test");
const { testWalletLogin } = require("../scripts/testWalletLogin");

test("wallet login diagnostic sends the SIWE message, checks the protected profile, and revokes its token without logging it", async () => {
  const walletAddress = "0x1111111111111111111111111111111111111111";
  const token = "synthetic-token-not-for-output";
  const calls = [];
  const output = [];
  await testWalletLogin({
    signer: { address: walletAddress, signMessage: async (message) => {
      assert.equal(message, "synthetic SIWE message");
      return "synthetic signature";
    } },
    log: (...parts) => output.push(parts.join(" ")),
    httpClient: {
      get: async (url, options) => {
        if (url.endsWith(`/nonce/${walletAddress}`)) return { data: { message: "synthetic SIWE message" } };
        assert.equal(options.headers.Authorization, `Bearer ${token}`);
        return { data: { user: { walletAddress } } };
      },
      post: async (url, payload, options) => {
        calls.push(url);
        if (url.endsWith("/wallet-login")) {
          assert.deepEqual(payload, { walletAddress, message: "synthetic SIWE message", signature: "synthetic signature" });
          return { data: { success: true, token } };
        }
        assert.ok(url.endsWith("/logout"));
        assert.equal(options.headers.Authorization, `Bearer ${token}`);
      },
    },
  });
  assert.equal(calls.length, 2);
  assert.ok(output.every((line) => !line.includes(token)));
});

test("wallet login diagnostic rejects a missing challenge before signing", async () => {
  await assert.rejects(testWalletLogin({
    signer: { address: "synthetic", signMessage: () => assert.fail("must not sign a missing message") },
    log: () => {},
    httpClient: { get: async () => ({ data: {} }) },
  }), /did not return a SIWE/);
});
