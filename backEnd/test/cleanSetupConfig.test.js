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
});

test("clean role bootstrap does not seed extra auditors or reputation", () => {
  const roleScript = fs.readFileSync(
    path.join(projectRoot, "backend", "scripts", "grantProjectRolesLocal.js"),
    "utf8"
  );

  assert.equal(roleScript.includes("updateAuditorReputation"), false);
  assert.equal(roleScript.includes("AUDITOR_2_WALLET_ADDRESS"), false);
  assert.equal(roleScript.includes("AUDITOR_REPUTATION"), false);
});
