const assert = require("node:assert/strict");
const test = require("node:test");

const User = require("../models/User");
const { HOSPITAL_NETWORK } = require("../config/hospitalNetwork");
const { buildSyntheticRecords } = require("../scripts/seedMockData");

test("defines five distinct contracted hospital identities", () => {
  assert.equal(HOSPITAL_NETWORK.length, 5);
  assert.equal(new Set(HOSPITAL_NETWORK.map((item) => item.hospitalId)).size, 5);
  assert.equal(new Set(HOSPITAL_NETWORK.map((item) => item.walletAddress)).size, 5);
  assert.ok(HOSPITAL_NETWORK.every((item) => /^HOSP-00[1-5]$/.test(item.hospitalId)));
  assert.ok(HOSPITAL_NETWORK.every((item) => /^0x[a-f0-9]{40}$/.test(item.walletAddress)));
});

test("binds the five demo records to the named hospital directory", () => {
  const records = buildSyntheticRecords().slice(0, 5);
  assert.deepEqual(
    records.map(({ hospitalId, hospitalName }) => ({ hospitalId, hospitalName })),
    HOSPITAL_NETWORK.map(({ hospitalId, name }) => ({
      hospitalId,
      hospitalName: name,
    }))
  );
});

test("accepts HOSPITAL as a separate authenticated role", () => {
  assert.ok(User.schema.path("role").enumValues.includes("HOSPITAL"));
});
