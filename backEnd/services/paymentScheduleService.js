const { ethers } = require("ethers");

const durationLabel = (seconds) => {
  for (const [unit, divisor] of [["day", 86400], ["minute", 60], ["second", 1]]) {
    if (seconds % divisor === 0) return `${seconds / divisor} ${unit}${seconds / divisor === 1 ? "" : "s"}`;
  }
};

function formatPaymentSchedule(raw) {
  const accelerated = raw.profileId === ethers.id("ACCELERATED_TESTNET");
  const expected = accelerated ? [600, 480, 120] : [90 * 86400, 30 * 86400, 7 * 86400];
  const values = [raw.intervalSeconds, raw.advanceWindowSeconds, raw.gracePeriodSeconds].map(Number);
  if ((!accelerated && raw.profileId !== ethers.id("QUARTERLY")) || values.some((v, i) => v !== expected[i])) {
    throw new Error("Unsupported or inconsistent on-chain payment calendar");
  }
  const [intervalSeconds, advanceWindowSeconds, gracePeriodSeconds] = values;
  return { profile: accelerated ? "ACCELERATED_TESTNET" : "QUARTERLY", accelerated,
    label: accelerated ? "Accelerated testnet payment demo" : "Quarterly payment schedule",
    intervalSeconds, advanceWindowSeconds, gracePeriodSeconds,
    intervalLabel: durationLabel(intervalSeconds), advanceWindowLabel: durationLabel(advanceWindowSeconds), gracePeriodLabel: durationLabel(gracePeriodSeconds),
    notice: accelerated
      ? "Demo calendar: premiums repeat every 10 minutes, open 8 minutes before due, and have 2 minutes of collection grace. This is not an insurance pricing or real-world payment frequency. Claim and review deadlines are unchanged."
      : "Premiums follow the retained quarterly calendar. Collection grace does not extend unpaid medical coverage.",
  };
}

const readPaymentSchedule = async (economics) => formatPaymentSchedule(await economics.getPaymentSchedule());
module.exports = { durationLabel, formatPaymentSchedule, readPaymentSchedule };
