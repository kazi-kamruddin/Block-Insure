const clamp = (value) => Math.min(1 - 1e-9, Math.max(1e-9, value));
const logit = (probability) => Math.log(clamp(probability) / (1 - clamp(probability)));
const sigmoid = (value) => 1 / (1 + Math.exp(-value));

const fitPlattScaling = (rows, { iterations = 750, learningRate = 0.03 } = {}) => {
  let slope = 1;
  let intercept = 0;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let slopeGradient = 0;
    let interceptGradient = 0;
    for (const row of rows) {
      const score = logit(row.fraudProbability);
      const predicted = sigmoid(slope * score + intercept);
      const error = predicted - Number(row.actualFraud);
      slopeGradient += error * score;
      interceptGradient += error;
    }
    const divisor = Math.max(rows.length, 1);
    slope -= learningRate * slopeGradient / divisor;
    intercept -= learningRate * interceptGradient / divisor;
  }
  return { method: "platt", version: "platt-v1", slope, intercept };
};

const fitIsotonicCalibration = (rows) => {
  const sorted = rows
    .map((row) => ({ x: row.fraudProbability, y: Number(row.actualFraud), weight: 1 }))
    .sort((left, right) => left.x - right.x);
  const blocks = [];
  for (const point of sorted) {
    blocks.push({ min: point.x, max: point.x, sum: point.y, weight: point.weight });
    while (
      blocks.length >= 2 &&
      blocks.at(-2).sum / blocks.at(-2).weight > blocks.at(-1).sum / blocks.at(-1).weight
    ) {
      const right = blocks.pop();
      const left = blocks.pop();
      blocks.push({
        min: left.min,
        max: right.max,
        sum: left.sum + right.sum,
        weight: left.weight + right.weight,
      });
    }
  }
  return {
    method: "isotonic",
    version: "isotonic-pav-v1",
    blocks: blocks.map((block) => ({
      min: block.min,
      max: block.max,
      value: block.sum / block.weight,
    })),
  };
};

const calibrateProbability = (probability, calibration) => {
  if (!calibration || calibration.method === "none") return probability;
  if (calibration.method === "platt") {
    return sigmoid(calibration.slope * logit(probability) + calibration.intercept);
  }
  if (calibration.method === "isotonic") {
    const block = calibration.blocks.find((item) => probability <= item.max) || calibration.blocks.at(-1);
    return block ? block.value : probability;
  }
  throw new Error(`Unsupported calibration method: ${calibration.method}`);
};

module.exports = {
  calibrateProbability,
  fitIsotonicCalibration,
  fitPlattScaling,
};
