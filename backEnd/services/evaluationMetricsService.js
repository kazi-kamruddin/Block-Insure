const round = (value, decimals = 4) => {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(decimals));
};

const buildConfusionMatrix = (rows, predictFraud) => {
  const matrix = {
    truePositive: 0,
    trueNegative: 0,
    falsePositive: 0,
    falseNegative: 0,
  };

  rows.forEach((row) => {
    const predictedFraud = Boolean(predictFraud(row));

    if (row.actualFraud && predictedFraud) matrix.truePositive += 1;
    if (!row.actualFraud && !predictedFraud) matrix.trueNegative += 1;
    if (!row.actualFraud && predictedFraud) matrix.falsePositive += 1;
    if (row.actualFraud && !predictedFraud) matrix.falseNegative += 1;
  });

  return matrix;
};

const calculateClassificationMetrics = (matrix) => {
  const { truePositive, trueNegative, falsePositive, falseNegative } = matrix;
  const total = truePositive + trueNegative + falsePositive + falseNegative;
  const accuracy = total > 0 ? (truePositive + trueNegative) / total : 0;
  const precision =
    truePositive + falsePositive > 0
      ? truePositive / (truePositive + falsePositive)
      : 0;
  const recall =
    truePositive + falseNegative > 0
      ? truePositive / (truePositive + falseNegative)
      : 0;
  const specificity =
    trueNegative + falsePositive > 0
      ? trueNegative / (trueNegative + falsePositive)
      : 0;
  const f1Score =
    precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const falsePositiveRate = 1 - specificity;

  return {
    accuracy: round(accuracy),
    precision: round(precision),
    recall: round(recall),
    specificity: round(specificity),
    falsePositiveRate: round(falsePositiveRate),
    f1Score: round(f1Score),
  };
};

const getThresholdPoint = (rows, threshold) => {
  const confusionMatrix = buildConfusionMatrix(
    rows,
    (row) => Number(row.fraudProbability) >= threshold
  );
  const metrics = calculateClassificationMetrics(confusionMatrix);

  return {
    threshold,
    ...metrics,
    ...confusionMatrix,
  };
};

const calculateTrapezoidalAuc = (points) => {
  const sortedPoints = points
    .slice()
    .sort(
      (left, right) =>
        left.falsePositiveRate - right.falsePositiveRate ||
        left.recall - right.recall
    );
  let area = 0;

  for (let index = 1; index < sortedPoints.length; index += 1) {
    const left = sortedPoints[index - 1];
    const right = sortedPoints[index];
    const width = right.falsePositiveRate - left.falsePositiveRate;
    area += width * ((left.recall + right.recall) / 2);
  }

  return round(area, 6);
};

const calculateAveragePrecision = (points) => {
  const sortedPoints = points
    .slice()
    .sort((left, right) => left.recall - right.recall);
  let previousRecall = 0;
  let area = 0;

  sortedPoints.forEach((point) => {
    if (point.recall > previousRecall) {
      area += (point.recall - previousRecall) * point.precision;
      previousRecall = point.recall;
    }
  });

  return round(area, 6);
};

const buildThresholdRange = (start, end, step) => {
  const values = [];

  for (let threshold = start; threshold >= end - 1e-10; threshold -= step) {
    values.push(Number(threshold.toFixed(6)));
  }

  return values;
};

const calculateCurves = (rows) => {
  const points = [1.01, ...buildThresholdRange(1, 0, 0.01)].map((threshold) =>
    getThresholdPoint(rows, threshold)
  );
  const fraudPrevalence =
    rows.length > 0
      ? rows.filter((row) => row.actualFraud).length / rows.length
      : 0;

  return {
    roc: points.map((point) => ({
      threshold: point.threshold,
      falsePositiveRate: point.falsePositiveRate,
      truePositiveRate: point.recall,
    })),
    precisionRecall: points.map((point) => ({
      threshold: point.threshold,
      precision:
        point.truePositive + point.falsePositive === 0 ? 1 : point.precision,
      recall: point.recall,
      fraudPrevalence: round(fraudPrevalence),
    })),
    auc: calculateTrapezoidalAuc(points),
    averagePrecision: calculateAveragePrecision(points),
    fraudPrevalence: round(fraudPrevalence),
  };
};

const calculateThresholdSensitivity = (rows, step = 0.05) => {
  return buildThresholdRange(1, 0, step).map((threshold) =>
    getThresholdPoint(rows, threshold)
  );
};

const selectBestThreshold = (sensitivityRows) => {
  return sensitivityRows
    .slice()
    .sort(
      (left, right) =>
        right.f1Score - left.f1Score ||
        right.precision - left.precision ||
        right.threshold - left.threshold
    )[0];
};

const calculateBaselines = (rows, meanClaimAmount) => {
  const definitions = [
    {
      key: "always_fraud",
      label: "Always Fraud",
      description: "Predict every held-out claim as fraud.",
      predictFraud: () => true,
    },
    {
      key: "amount_above_training_mean",
      label: "Amount Above Training Mean",
      description: "Predict fraud when claim amount exceeds the training-set mean.",
      predictFraud: (row) => Number(row.claimAmountEth) > meanClaimAmount,
    },
  ];

  return definitions.map(({ key, label, description, predictFraud }) => {
    const confusionMatrix = buildConfusionMatrix(rows, predictFraud);

    return {
      key,
      label,
      description,
      thresholdValue:
        key === "amount_above_training_mean" ? round(meanClaimAmount, 6) : null,
      confusionMatrix,
      metrics: calculateClassificationMetrics(confusionMatrix),
    };
  });
};

module.exports = {
  buildConfusionMatrix,
  calculateAveragePrecision,
  calculateBaselines,
  calculateClassificationMetrics,
  calculateCurves,
  calculateThresholdSensitivity,
  calculateTrapezoidalAuc,
  getThresholdPoint,
  selectBestThreshold,
};
