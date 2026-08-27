const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..", "..");

test("clean setup contains only infrastructure initialization in safe order", () => {
  const rootPackage = require(path.join(projectRoot, "package.json"));
  const setup = rootPackage.scripts["setup:local"];
  const expectedSteps = [
    "reset:local",
    "fund:accounts:local",
    "deploy:local",
    "grant:roles",
    "fund:local",
    "push:merkle",
    "verify:clean",
  ];

  let previousIndex = -1;
  for (const step of expectedSteps) {
    const index = setup.indexOf(step);
    assert.ok(index > previousIndex, `${step} must appear in safe order`);
    previousIndex = index;
  }

  for (const forbidden of ["demo:populate", "seed:mock", "loadtest:claims"]) {
    assert.equal(setup.includes(forbidden), false);
  }

  assert.equal(setup.includes("--prefix backend"), false);
  assert.equal(setup.includes("--prefix frontend"), false);
  assert.equal(setup.includes("--prefix backEnd"), true);
});

test("clean role bootstrap creates quorum auditors without seeding reputation", () => {
  const roleScript = fs.readFileSync(
    path.join(projectRoot, "backEnd", "scripts", "grantProjectRolesLocal.js"),
    "utf8"
  );

  assert.equal(roleScript.includes("updateAuditorReputation"), false);
  assert.equal(roleScript.includes("AUDITOR_WALLET_ADDRESS_2"), true);
  assert.equal(roleScript.includes("auditorWalletAddresses.length !== 4"), true);
  assert.equal(roleScript.includes("AUDITOR_REPUTATION"), false);
});

test("clean reset removes and verifies sensitive evidence-access history", () => {
  const resetScript = fs.readFileSync(
    path.join(projectRoot, "backEnd", "scripts", "resetLocalData.js"),
    "utf8"
  );
  const verificationScript = fs.readFileSync(
    path.join(projectRoot, "backEnd", "scripts", "verifyCleanStart.js"),
    "utf8"
  );

  assert.equal(resetScript.includes('require("../models/EvidenceAccessLog")'), true);
  assert.equal(resetScript.includes('"evidence access logs"'), true);
  for (const collection of [
    "evidence events",
    "evidence grants",
    "evidence tree heads",
    "indexed blockchain events",
    "indexer checkpoints",
  ]) {
    assert.equal(resetScript.includes(`"${collection}"`), true);
    assert.equal(verificationScript.includes(`"${collection}"`), true);
  }
  assert.equal(
    verificationScript.includes('require("../models/EvidenceAccessLog")'),
    true
  );
  assert.equal(verificationScript.includes('"evidence access logs"'), true);
});

test("gas comparison uses an isolated in-memory Hardhat network", () => {
  const contractsPackage = require(path.join(projectRoot, "contracts", "package.json"));
  assert.equal(contractsPackage.scripts["gas:compare"].includes("--network localhost"), false);
});
