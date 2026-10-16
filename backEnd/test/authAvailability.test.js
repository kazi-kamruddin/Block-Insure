const assert = require("node:assert/strict");
const test = require("node:test");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const RevokedToken = require("../models/RevokedToken");
const authorization = require("../services/onChainAuthorizationService");

test("authentication distinguishes invalid sessions, revoked roles, and dependency outages", async (t) => {
  const originalSecret = process.env.JWT_SECRET;
  const originalUserLookup = User.findOne;
  const originalRevocationLookup = RevokedToken.findOne;
  const originalAuthorize = authorization.assertCurrentOnChainRole;
  const middlewarePath = require.resolve("../middleware/authMiddleware");
  const originalModule = require.cache[middlewarePath];
  const secret = "synthetic-auth-availability-test-secret";
  process.env.JWT_SECRET = secret;
  const makeToken = (expiresIn = "1h") => jwt.sign({
    walletAddress: "0x1111111111111111111111111111111111111111",
    jti: "synthetic-session", authMethod: "SIWE",
  }, secret, {
    issuer: process.env.JWT_ISSUER || "block-insure-api",
    audience: process.env.JWT_AUDIENCE || "block-insure-client",
    expiresIn,
  });
  let failure;
  let revoked = false;
  authorization.assertCurrentOnChainRole = async () => {
    if (failure) throw failure;
  };
  RevokedToken.findOne = () => ({ select: () => ({ lean: async () => revoked ? { _id: "revoked" } : null }) });
  User.findOne = () => ({ select: async () => ({ walletAddress: "0x1111111111111111111111111111111111111111", role: "ADMIN" }) });
  delete require.cache[middlewarePath];
  const authenticate = require(middlewarePath);
  const request = async (token = makeToken()) => {
    const response = {
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.payload = payload; },
    };
    let continued = false;
    await authenticate({ headers: { authorization: `Bearer ${token}` } }, response, () => { continued = true; });
    return { ...response, continued };
  };
  try {
    await t.test("valid current roles continue", async () => {
      assert.equal((await request()).continued, true);
    });
    await t.test("expired and revoked sessions still return HTTP 401", async () => {
      assert.equal((await request(makeToken(-1))).statusCode, 401);
      revoked = true;
      assert.equal((await request()).statusCode, 401);
      revoked = false;
    });
    await t.test("role revocation returns HTTP 403", async () => {
      failure = Object.assign(new Error("role missing"), { statusCode: 403 });
      assert.equal((await request()).statusCode, 403);
    });
    await t.test("RPC failure returns sanitized HTTP 503 without invalidating the session", async () => {
      failure = new Error("private RPC provider failure");
      const response = await request();
      assert.equal(response.statusCode, 503);
      assert.equal(response.payload.message, "Authentication service is temporarily unavailable");
      assert.equal(response.continued, false);
    });
    await t.test("MongoDB failure returns HTTP 503 and recovers with the same token", async () => {
      failure = undefined;
      const token = makeToken();
      const normalLookup = User.findOne;
      User.findOne = () => { throw new Error("private MongoDB detail"); };
      assert.equal((await request(token)).statusCode, 503);
      User.findOne = normalLookup;
      assert.equal((await request(token)).continued, true);
    });
  } finally {
    User.findOne = originalUserLookup;
    RevokedToken.findOne = originalRevocationLookup;
    authorization.assertCurrentOnChainRole = originalAuthorize;
    if (originalModule) require.cache[middlewarePath] = originalModule;
    else delete require.cache[middlewarePath];
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  }
});
