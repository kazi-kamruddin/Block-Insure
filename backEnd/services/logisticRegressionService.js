const sigmoid = (value) => {
  if (value >= 0) return 1 / (1 + Math.exp(-value));
  const exponent = Math.exp(value);
  return exponent / (1 + exponent);
};

const vectorize = (featureNames, features) =>
  featureNames.map((name) => Number(Boolean(features?.[name])));

const trainLogisticRegression = ({
  rows,
  featureNames,
  classWeighted = false,
  iterations = 1200,
  learningRate = 0.08,
  l2 = 0.002,
}) => {
  if (!rows.length) throw new Error("Logistic regression requires training rows");
  if (!featureNames.length) throw new Error("Logistic regression requires features");
  const positives = rows.filter((row) => row.actualFraud).length;
  const negatives = rows.length - positives;
  const positiveWeight = classWeighted && positives > 0
    ? rows.length / (2 * positives)
    : 1;
  const negativeWeight = classWeighted && negatives > 0
    ? rows.length / (2 * negatives)
    : 1;
  const weights = Array(featureNames.length).fill(0);
  let intercept = Math.log((positives + 1) / (negatives + 1));

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const gradients = Array(featureNames.length).fill(0);
    let interceptGradient = 0;
    let totalWeight = 0;
    for (const row of rows) {
      const vector = vectorize(featureNames, row.features);
      const probability = sigmoid(
        intercept + vector.reduce((sum, value, index) => sum + value * weights[index], 0)
      );
      const observationWeight = row.actualFraud ? positiveWeight : negativeWeight;
      const error = (probability - Number(row.actualFraud)) * observationWeight;
      interceptGradient += error;
      totalWeight += observationWeight;
      for (let index = 0; index < weights.length; index += 1) {
        gradients[index] += error * vector[index];
      }
    }
    const divisor = Math.max(totalWeight, 1);
    intercept -= learningRate * interceptGradient / divisor;
    for (let index = 0; index < weights.length; index += 1) {
      weights[index] -= learningRate * (gradients[index] / divisor + l2 * weights[index]);
    }
  }

  return {
    algorithm: classWeighted ? "ClassWeightedLogisticRegression" : "LogisticRegression",
    featureNames: [...featureNames],
    weights,
    intercept,
    classWeights: { fraud: positiveWeight, legitimate: negativeWeight },
    iterations,
    learningRate,
    l2,
  };
};

const predictLogisticRegression = (model, features) => {
  const vector = vectorize(model.featureNames, features);
  const logit = model.intercept + vector.reduce(
    (sum, value, index) => sum + value * model.weights[index],
    0
  );
  return { fraudProbability: sigmoid(logit), logit };
};

module.exports = {
  predictLogisticRegression,
  sigmoid,
  trainLogisticRegression,
  vectorize,
};
