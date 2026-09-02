const assert = require("node:assert/strict");
const test = require("node:test");

const User = require("../models/User");
const Bank = require("../models/Bank");
const BankAccount = require("../models/BankAccount");
const EftMandate = require("../models/EftMandate");
const BankOtpChallenge = require("../models/BankOtpChallenge");
const BankTransaction = require("../models/BankTransaction");
const { isReminderWindow, premiumWeiToMinor } = require("../services/bankPaymentService");
const { BANK_NETWORK, DEMO_BANK_ACCOUNTS } = require("../config/bankNetwork");

test("defines one independent simulated bank identity", () => {
  assert.equal(BANK_NETWORK.length, 1);
  assert.match(BANK_NETWORK[0].bankId, /^BANK-001$/);
  assert.match(BANK_NETWORK[0].walletAddress, /^0x[a-f0-9]{40}$/);
});

test("provides visibly different demo account balances", () => {
  assert.deepEqual(DEMO_BANK_ACCOUNTS.map((account) => account.balanceMinor), [500000, 700000, 1000000]);
  assert.equal(new Set(DEMO_BANK_ACCOUNTS.map((account) => account.accountReference)).size, 3);
});

test("accepts BANK and the planned EFT mandate lifecycle", () => {
  assert.ok(User.schema.path("role").enumValues.includes("BANK"));
  assert.deepEqual(EftMandate.schema.path("status").enumValues, [
    "PENDING_BANK_APPROVAL", "ACTIVE", "EXPIRED", "CANCELLED", "REJECTED",
  ]);
  assert.equal(Bank.schema.path("currency").defaultValue, "BDT");
  assert.equal(BankAccount.schema.path("currency").defaultValue, "BDT");
});

test("supports approved quarterly execution and OTP-only manual payments", () => {
  assert.equal(premiumWeiToMinor(10_000_000_000_000_000n), 100000);
  assert.deepEqual(BankTransaction.schema.path("type").enumValues, ["EFT", "MANUAL_OTP"]);
  assert.deepEqual(BankOtpChallenge.schema.path("status").enumValues, ["PENDING", "USED", "EXPIRED", "LOCKED"]);
  assert.ok(EftMandate.schema.path("nextDebitAt"));
  const reference = new Date("2026-09-01T00:00:00.000Z");
  assert.equal(isReminderWindow("2026-09-16T00:00:00.000Z", reference), true);
  assert.equal(isReminderWindow("2026-09-21T00:00:00.000Z", reference), true);
  assert.equal(isReminderWindow("2026-09-15T00:00:00.000Z", reference), false);
  assert.equal(isReminderWindow("2026-09-22T00:00:00.000Z", reference), false);
});
