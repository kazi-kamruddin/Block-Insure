const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizeUrl, validateResponses } = require("../../scripts/hostedPreflight");

const preview = () => ({
  frontend: { body: "<title>Block-Insure</title>" },
  backend: { body: { success: true, status: "limited" } },
  oracleOne: { body: { success: true, status: "alive", oracleInstanceId: "1", workerEnabled: false } },
  oracleTwo: { body: { success: true, status: "alive", oracleInstanceId: "2", workerEnabled: false } },
});

test("hosted preflight accepts dormant preview workers and rejects duplicated Oracle identities", () => {
  const responses = preview();
  assert.doesNotThrow(() => validateResponses(responses));
  responses.oracleTwo = responses.oracleOne;
  assert.throws(() => validateResponses(responses), /Oracle 2 liveness/);
});

test("hosted preflight distinguishes enabled Oracle readiness from liveness", () => {
  const responses = preview();
  responses.oracleOne.body.workerEnabled = true;
  assert.throws(() => validateResponses(responses), /enabled but is not ready/);
  responses.oracleOne.body.status = "ready";
  assert.doesNotThrow(() => validateResponses(responses));
});

test("hosted preflight rejects loopback IPv6 and URL credentials", () => {
  assert.throws(() => normalizeUrl("backend", "https://[::1]"), /loopback/);
  assert.throws(() => normalizeUrl("backend", "https://user:synthetic@example.test"), /credentials/);
  assert.equal(normalizeUrl("backend", "https://example.test/"), "https://example.test");
  assert.equal(normalizeUrl("worker", "https://example.test/oracle-one/"), "https://example.test/oracle-one");
});

test("full hosted gate rejects preview, wrong chains, model drift and one wallet masquerading as both workers", () => {
  const responses = preview();
  const model = `0x${"a".repeat(64)}`;
  const wallets = [`0x${"1".repeat(40)}`, `0x${"2".repeat(40)}`];
  const components = Object.fromEntries(["InsuranceManager", "PolicyEconomics", "OracleCoordinator", "EvidenceRegistry", "PolicyBenefitsManager"].map((name, i) => [name, `0x${String(i + 3).repeat(40)}`]));
  const options = { full: true, chainId: "11155111", modelIdentity: model, oracleWallets: wallets, components, backendOrigin: "https://api.example.test", frontendOrigin: "https://app.example.test" };
  assert.throws(() => validateResponses(responses, options), /connected backend/);
  responses.backend.body = { success: true, status: "ready", services: { database: "connected", blockchainRpc: "connected", contract: "deployed", chainId: 11155111 } };
  responses.backend.body.deployment = { managerAddress: components.InsuranceManager };
  responses.frontendConfiguration = { body: { schema: "block-insure-public-release-v1", chainId: 11155111, apiOrigin: options.backendOrigin,
    managerAddress: components.InsuranceManager, economicsAddress: components.PolicyEconomics, evidenceRegistryAddress: components.EvidenceRegistry, benefitsAddress: components.PolicyBenefitsManager } };
  for (const [index, worker] of [responses.oracleOne, responses.oracleTwo].entries()) Object.assign(worker.body, { workerEnabled: true, status: "ready", protocolModel: { identity: model }, oracleWallet: wallets[index], registrySnapshot: index ? "oracle2" : "primary" });
  for (const worker of [responses.oracleOne, responses.oracleTwo]) worker.body.deployment = { chainId: 11155111, managerAddress: components.InsuranceManager, coordinatorAddress: components.OracleCoordinator };
  assert.doesNotThrow(() => validateResponses(responses, options));
  responses.backend.body.deployment.managerAddress = wallets[0];
  assert.throws(() => validateResponses(responses, options), /Backend deployment/);
  responses.backend.body.deployment.managerAddress = components.InsuranceManager;
  responses.frontendConfiguration.body.managerAddress = wallets[0];
  assert.throws(() => validateResponses(responses, options), /Frontend build/);
  responses.frontendConfiguration.body.managerAddress = components.InsuranceManager;
  responses.oracleTwo.body.deployment.coordinatorAddress = wallets[0];
  assert.throws(() => validateResponses(responses, options), /Oracle 2/);
  responses.oracleTwo.body.deployment.coordinatorAddress = components.OracleCoordinator;
  responses.backend.body.services.chainId = 84532;
  assert.throws(() => validateResponses(responses, options), /selected deployment/);
  responses.backend.body.services.chainId = 11155111;
  responses.oracleTwo.body.protocolModel.identity = "wrong";
  assert.throws(() => validateResponses(responses, options), /Oracle 2/);
  responses.oracleTwo.body.protocolModel.identity = model;
  responses.oracleTwo.body.oracleWallet = wallets[0];
  assert.throws(() => validateResponses(responses, options), /distinct Oracle/);
});
