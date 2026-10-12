const DEFAULT_SEED = 410034;

const SCENARIOS = Object.freeze({
  baseline: {
    label: "Baseline frequency and severity",
    claimFrequencyPerPolicy: 0.12,
    medianClaimEth: 0.35,
    severitySigma: 0.65,
  },
  high_frequency: {
    label: "High claim frequency",
    claimFrequencyPerPolicy: 0.24,
    medianClaimEth: 0.35,
    severitySigma: 0.65,
  },
  heavy_tail: {
    label: "Heavy-tailed severity",
    claimFrequencyPerPolicy: 0.12,
    medianClaimEth: 0.42,
    severitySigma: 1.15,
  },
  combined_stress: {
    label: "Combined frequency and severity stress",
    claimFrequencyPerPolicy: 0.24,
    medianClaimEth: 0.42,
    severitySigma: 1.15,
  },
});

const CAPITAL_RATIOS = Object.freeze([0.02, 0.05, 0.08, 0.1, 0.15, 0.2, 0.3]);

const createRandom = (seed = DEFAULT_SEED) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const sampleStandardNormal = (random) => {
  const left = Math.max(random(), Number.EPSILON);
  const right = random();
  return Math.sqrt(-2 * Math.log(left)) * Math.cos(2 * Math.PI * right);
};

const samplePoisson = (lambda, random) => {
  if (lambda <= 30) {
    const limit = Math.exp(-lambda);
    let product = 1;
    let count = 0;
    do {
      count += 1;
      product *= random();
    } while (product > limit);
    return count - 1;
  }
  return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * sampleStandardNormal(random)));
};

const quantile = (values, probability) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
};

const calculateInsurerLiability = (claimAmountEth, {
  deductibleRate = 0.1,
  deductibleCapEth = 0.02,
  insurerShare = 0.8,
  coverageLimitEth = 1,
} = {}) => {
  const covered = Math.min(Math.max(claimAmountEth, 0), coverageLimitEth);
  const deductible = Math.min(covered * deductibleRate, deductibleCapEth);
  return Math.max(covered - deductible, 0) * insurerShare;
};

const generateAnnualLosses = ({
  scenario,
  periods = 5000,
  policies = 1000,
  coveragePerPolicyEth = 1,
  seed = DEFAULT_SEED,
}) => {
  const random = createRandom(seed);
  const losses = [];
  const claimCounts = [];
  for (let period = 0; period < periods; period += 1) {
    const claimCount = samplePoisson(
      policies * scenario.claimFrequencyPerPolicy,
      random
    );
    let annualLoss = 0;
    for (let claim = 0; claim < claimCount; claim += 1) {
      const severity = Math.exp(
        Math.log(scenario.medianClaimEth) +
          scenario.severitySigma * sampleStandardNormal(random)
      );
      annualLoss += calculateInsurerLiability(severity, {
        coverageLimitEth: coveragePerPolicyEth,
      });
    }
    losses.push(annualLoss);
    claimCounts.push(claimCount);
  }
  return { losses, claimCounts };
};

const evaluateCapital = (losses, capitalEth) => {
  const shortfalls = losses.map((loss) => Math.max(loss - capitalEth, 0));
  const positiveShortfalls = shortfalls.filter((shortfall) => shortfall > 0);
  const totalLoss = losses.reduce((total, loss) => total + loss, 0);
  const totalShortfall = shortfalls.reduce((total, value) => total + value, 0);
  const meanLoss = totalLoss / losses.length;
  return {
    capitalEth,
    shortfallProbability: positiveShortfalls.length / losses.length,
    expectedShortfallEth: positiveShortfalls.length
      ? positiveShortfalls.reduce((total, value) => total + value, 0) / positiveShortfalls.length
      : 0,
    expectedUnfundedFraction: totalLoss ? totalShortfall / totalLoss : 0,
    meanLossEth: meanLoss,
    meanCapitalUtilization: capitalEth
      ? losses.reduce((total, loss) => total + Math.min(loss / capitalEth, 1), 0) / losses.length
      : 1,
    meanExcessCapitalEth:
      losses.reduce((total, loss) => total + Math.max(capitalEth - loss, 0), 0) /
      losses.length,
  };
};

const bootstrapShortfallProbability = ({ losses, capitalEth, seed, iterations = 250 }) => {
  const random = createRandom(seed);
  const estimates = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let failed = 0;
    for (let index = 0; index < losses.length; index += 1) {
      if (losses[Math.floor(random() * losses.length)] > capitalEth) failed += 1;
    }
    estimates.push(failed / losses.length);
  }
  return { lower: quantile(estimates, 0.025), upper: quantile(estimates, 0.975) };
};

const evaluateReserveAdequacy = ({
  seed = DEFAULT_SEED,
  periods = 5000,
  policies = 1000,
  capitalRatios = CAPITAL_RATIOS,
  targetShortfallProbability = 0.01,
} = {}) => {
  const exposureEth = policies;
  const scenarioResults = Object.entries(SCENARIOS).map(([key, scenario], scenarioIndex) => {
    const generated = generateAnnualLosses({
      scenario,
      periods,
      policies,
      seed: seed + scenarioIndex * 1009,
    });
    const capitalSweep = capitalRatios.map((capitalRatio, ratioIndex) => {
      const metrics = evaluateCapital(generated.losses, exposureEth * capitalRatio);
      return {
        capitalRatio,
        ...metrics,
        shortfallProbability95Ci: bootstrapShortfallProbability({
          losses: generated.losses,
          capitalEth: metrics.capitalEth,
          seed: seed + scenarioIndex * 1009 + ratioIndex * 7919,
        }),
      };
    });
    const recommended = capitalSweep.find(
      (candidate) => candidate.shortfallProbability <= targetShortfallProbability
    ) || capitalSweep[capitalSweep.length - 1];
    return {
      key,
      ...scenario,
      simulatedPeriods: periods,
      policies,
      lossDistribution: {
        meanEth: generated.losses.reduce((total, loss) => total + loss, 0) / periods,
        valueAtRisk95Eth: quantile(generated.losses, 0.95),
        valueAtRisk99Eth: quantile(generated.losses, 0.99),
        meanClaims: generated.claimCounts.reduce((total, count) => total + count, 0) / periods,
      },
      currentFivePercentPolicy: capitalSweep.find((candidate) => candidate.capitalRatio === 0.05),
      recommendedCapitalRatio: recommended.capitalRatio,
      targetMet: recommended.shortfallProbability <= targetShortfallProbability,
      capitalSweep,
    };
  });
  return {
    schemaVersion: 1,
    methodology: {
      type: "aggregate compound Poisson-lognormal Monte Carlo",
      frequencySampler: "Poisson with a normal approximation for aggregate lambda above 30",
      advisoryOnly: true,
      periods,
      policies,
      aggregateExposureEth: exposureEth,
      seed,
      deductibleRate: 0.1,
      deductibleCapEth: 0.02,
      insurerShare: 0.8,
      severityCapEth: 1,
      targetShortfallProbability,
      currentOnChainReserveRatio: 0.05,
    },
    scenarios: scenarioResults,
    chartData: scenarioResults.map((scenario) => ({
      key: scenario.key,
      points: scenario.capitalSweep.map((point) => ({
        capitalRatio: point.capitalRatio,
        shortfallProbability: point.shortfallProbability,
        expectedShortfallEth: point.expectedShortfallEth,
      })),
    })),
    limitations: [
      "Synthetic frequency and severity assumptions are not fitted to insurer loss data.",
      "The result is an advisory reserve-adequacy experiment, not statutory solvency certification.",
      "Dependence, inflation, reinsurance, expenses, premium income, and claim development are not modelled.",
    ],
  };
};

module.exports = {
  CAPITAL_RATIOS,
  DEFAULT_SEED,
  SCENARIOS,
  calculateInsurerLiability,
  createRandom,
  evaluateCapital,
  evaluateReserveAdequacy,
  generateAnnualLosses,
  quantile,
  samplePoisson,
};
