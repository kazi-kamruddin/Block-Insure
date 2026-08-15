const EPSILON = 1e-12;

const clampProbability = (value) =>
  Math.min(1 - EPSILON, Math.max(EPSILON, Number(value)));

const logSumExp = (values) => {
  const maximum = Math.max(...values);
  return maximum + Math.log(values.reduce(
    (total, value) => total + Math.exp(value - maximum),
    0
  ));
};

const trainBernoulliNaiveBayes = ({ rows, featureNames, alpha = 1 }) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Bernoulli Naive Bayes requires at least one training row");
  }
  if (!Array.isArray(featureNames) || featureNames.length === 0) {
    throw new Error("At least one feature is required");
  }
  if (!(alpha > 0)) throw new Error("Laplace alpha must be positive");

  const classCounts = { fraud: 0, legitimate: 0 };
  const presentCounts = Object.fromEntries(
    featureNames.map((name) => [name, { fraud: 0, legitimate: 0 }])
  );

  for (const row of rows) {
    const className = row.actualFraud ? "fraud" : "legitimate";
    classCounts[className] += 1;
    for (const name of featureNames) {
      if (Boolean(row.features?.[name])) presentCounts[name][className] += 1;
    }
  }

  const classPrior = {
    fraud: (classCounts.fraud + alpha) / (rows.length + 2 * alpha),
    legitimate: (classCounts.legitimate + alpha) / (rows.length + 2 * alpha),
  };
  const featureProbabilities = {};
  for (const name of featureNames) {
    featureProbabilities[name] = {};
    for (const className of ["fraud", "legitimate"]) {
      const present =
        (presentCounts[name][className] + alpha) /
        (classCounts[className] + 2 * alpha);
      featureProbabilities[name][className] = {
        present,
        absent: 1 - present,
        presentCount: presentCounts[name][className],
        classCount: classCounts[className],
      };
    }
  }

  return {
    algorithm: "BernoulliNB",
    alpha,
    featureNames: [...featureNames],
    classCounts,
    classPrior,
    featureProbabilities,
  };
};

const predictBernoulliNaiveBayes = (model, features) => {
  const logLikelihood = {
    fraud: Math.log(clampProbability(model.classPrior.fraud)),
    legitimate: Math.log(clampProbability(model.classPrior.legitimate)),
  };
  const contributions = [];

  for (const name of model.featureNames) {
    const present = Boolean(features?.[name]);
    const probabilityKey = present ? "present" : "absent";
    const fraudProbability = clampProbability(
      model.featureProbabilities[name].fraud[probabilityKey]
    );
    const legitimateProbability = clampProbability(
      model.featureProbabilities[name].legitimate[probabilityKey]
    );
    logLikelihood.fraud += Math.log(fraudProbability);
    logLikelihood.legitimate += Math.log(legitimateProbability);
    contributions.push({
      feature: name,
      present,
      probabilityGivenFraud: fraudProbability,
      probabilityGivenLegitimate: legitimateProbability,
      logLikelihoodRatio: Math.log(fraudProbability / legitimateProbability),
    });
  }

  const normalizer = logSumExp([logLikelihood.fraud, logLikelihood.legitimate]);
  const fraudProbability = Math.exp(logLikelihood.fraud - normalizer);
  return {
    fraudProbability,
    legitimateProbability: 1 - fraudProbability,
    predictedFraud: fraudProbability >= 0.5,
    logLikelihood,
    contributions,
  };
};

module.exports = {
  logSumExp,
  predictBernoulliNaiveBayes,
  trainBernoulliNaiveBayes,
};
