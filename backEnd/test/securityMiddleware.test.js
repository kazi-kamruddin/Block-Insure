const assert = require("node:assert/strict");
const test = require("node:test");

const { getNonce } = require("../controllers/authController");
const requireOracleApiKey = require("../middleware/oracleApiKeyMiddleware");
const {
  claimSubmissionKey,
  isDevelopmentClaimResetEnabled,
} = require("../middleware/claimSubmissionRateLimit");
const { requireRole } = require("../middleware/roleMiddleware");

function responseRecorder() {
  return {
    statusCode: 0,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

test("malformed SIWE wallet input is a client error and never reaches MongoDB", async () => {
  const response = responseRecorder();
  let receivedError;
  await getNonce(
    { params: { walletAddress: "not-an-ethereum-address" } },
    response,
    (error) => {
      receivedError = error;
    }
  );

  assert.equal(receivedError?.statusCode, 400);
  assert.equal(receivedError?.message, "Invalid wallet address");
  assert.equal(response.statusCode, 0);
});

test("role middleware distinguishes missing authentication from wrong role", () => {
  const requireAdmin = requireRole("ADMIN");
  const missingResponse = responseRecorder();
  requireAdmin({}, missingResponse, () => assert.fail("missing user must not continue"));
  assert.equal(missingResponse.statusCode, 401);

  const wrongRoleResponse = responseRecorder();
  requireAdmin(
    { user: { role: "USER" } },
    wrongRoleResponse,
    () => assert.fail("wrong role must not continue")
  );
  assert.equal(wrongRoleResponse.statusCode, 403);

  let continued = false;
  requireAdmin({ user: { role: "ADMIN" } }, responseRecorder(), () => {
    continued = true;
  });
  assert.equal(continued, true);
});

test("claim submission throttling is isolated per authenticated wallet", () => {
  const sharedNetwork = { ip: "127.0.0.1" };
  const firstWallet = claimSubmissionKey({
    ...sharedNetwork,
    user: { walletAddress: "0xAa00000000000000000000000000000000000001" },
  });
  const sameWalletDifferentCase = claimSubmissionKey({
    ...sharedNetwork,
    user: { walletAddress: "0xaa00000000000000000000000000000000000001" },
  });
  const secondWallet = claimSubmissionKey({
    ...sharedNetwork,
    user: { walletAddress: "0xBb00000000000000000000000000000000000002" },
  });

  assert.equal(firstWallet, sameWalletDifferentCase);
  assert.notEqual(firstWallet, secondWallet);
});

test("claim limiter reset requires an explicitly enabled development environment", () => {
  assert.equal(
    isDevelopmentClaimResetEnabled({
      NODE_ENV: "development",
      DEV_ALLOW_CLAIM_LIMIT_RESET: "true",
    }),
    true
  );
  assert.equal(
    isDevelopmentClaimResetEnabled({
      NODE_ENV: "development",
      DEV_ALLOW_CLAIM_LIMIT_RESET: "false",
    }),
    false
  );
  assert.equal(
    isDevelopmentClaimResetEnabled({
      NODE_ENV: "production",
      DEV_ALLOW_CLAIM_LIMIT_RESET: "true",
    }),
    false
  );
});

test("oracle API middleware rejects missing and invalid credentials", () => {
  const originalKey = process.env.ORACLE_API_KEY;
  process.env.ORACLE_API_KEY = "local-oracle-middleware-test-key";
  try {
    for (const headers of [{}, { "x-oracle-api-key": "wrong-key" }]) {
      const response = responseRecorder();
      requireOracleApiKey({ headers }, response, () =>
        assert.fail("invalid oracle credentials must not continue")
      );
      assert.equal(response.statusCode, 401);
      assert.equal(response.payload.message, "Invalid oracle API key");
    }
  } finally {
    if (originalKey === undefined) delete process.env.ORACLE_API_KEY;
    else process.env.ORACLE_API_KEY = originalKey;
  }
});

test("oracle API middleware accepts header and bearer credentials", () => {
  const originalKey = process.env.ORACLE_API_KEY;
  process.env.ORACLE_API_KEY = "local-oracle-middleware-test-key";
  try {
    for (const headers of [
      { "x-oracle-api-key": process.env.ORACLE_API_KEY },
      { authorization: `Bearer ${process.env.ORACLE_API_KEY}` },
    ]) {
      let continued = false;
      requireOracleApiKey({ headers }, responseRecorder(), () => {
        continued = true;
      });
      assert.equal(continued, true);
    }
  } finally {
    if (originalKey === undefined) delete process.env.ORACLE_API_KEY;
    else process.env.ORACLE_API_KEY = originalKey;
  }
});

test("oracle API middleware fails closed when the server key is absent", () => {
  const originalKey = process.env.ORACLE_API_KEY;
  delete process.env.ORACLE_API_KEY;
  try {
    const response = responseRecorder();
    requireOracleApiKey(
      { headers: { "x-oracle-api-key": "anything" } },
      response,
      () => assert.fail("missing server key must not continue")
    );
    assert.equal(response.statusCode, 500);
    assert.equal(response.payload.message, "ORACLE_API_KEY is not configured");
  } finally {
    if (originalKey !== undefined) process.env.ORACLE_API_KEY = originalKey;
  }
});
