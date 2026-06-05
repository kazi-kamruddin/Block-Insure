const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const RESULTS_DIR = path.join(__dirname, "..", "evaluation-results");
const SUMMARY_PATH = path.join(RESULTS_DIR, "risk-model-summary.json");
const RECORDS_PATH = path.join(RESULTS_DIR, "risk-model-records.csv");
const THROUGHPUT_PATH = path.join(RESULTS_DIR, "claim-throughput-results.json");
const AUDITOR_ANALYSIS_PATH = path.join(
  RESULTS_DIR,
  "auditor-reputation-analysis.json"
);
const OUTPUT_DIR = path.join(RESULTS_DIR, "evaluation-charts");

const COLORS = {
  background: "#f8fafc",
  panel: "#ffffff",
  text: "#111827",
  muted: "#64748b",
  line: "#cbd5e1",
  green: "#16a34a",
  greenSoft: "#dcfce7",
  yellow: "#facc15",
  orange: "#f97316",
  orangeSoft: "#ffedd5",
  red: "#dc2626",
  redSoft: "#fee2e2",
  blue: "#2563eb",
  blueSoft: "#dbeafe",
  purple: "#7c3aed",
};

const FONT = {
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01110"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  0: ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  1: ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  2: ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  3: ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  4: ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  5: ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  6: ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  7: ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  8: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  9: ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ",": ["00000", "00000", "00000", "00000", "01100", "00100", "01000"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "_": ["00000", "00000", "00000", "00000", "00000", "00000", "11111"],
  "%": ["11001", "11010", "00010", "00100", "01000", "01011", "10011"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
};

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;

  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }

  return value >>> 0;
});

const parseHex = (hex) => {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
    255,
  ];
};

const crc32 = (buffer) => {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
};

const createChunk = (type, data) => {
  const typeBuffer = Buffer.from(type);
  const lengthBuffer = Buffer.alloc(4);
  const crcBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
};

class Canvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.pixels = Buffer.alloc(width * height * 4, 255);
    this.fillRect(0, 0, width, height, COLORS.background);
  }

  setPixel(x, y, color) {
    const px = Math.round(x);
    const py = Math.round(y);

    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return;

    const [red, green, blue, alpha] = parseHex(color);
    const offset = (py * this.width + px) * 4;
    this.pixels[offset] = red;
    this.pixels[offset + 1] = green;
    this.pixels[offset + 2] = blue;
    this.pixels[offset + 3] = alpha;
  }

  fillRect(x, y, width, height, color) {
    for (let yy = Math.max(0, Math.round(y)); yy < Math.min(this.height, Math.round(y + height)); yy += 1) {
      for (let xx = Math.max(0, Math.round(x)); xx < Math.min(this.width, Math.round(x + width)); xx += 1) {
        this.setPixel(xx, yy, color);
      }
    }
  }

  strokeRect(x, y, width, height, color, thickness = 2) {
    this.fillRect(x, y, width, thickness, color);
    this.fillRect(x, y + height - thickness, width, thickness, color);
    this.fillRect(x, y, thickness, height, color);
    this.fillRect(x + width - thickness, y, thickness, height, color);
  }

  line(x1, y1, x2, y2, color, thickness = 2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);

    for (let step = 0; step <= steps; step += 1) {
      const x = x1 + (dx * step) / steps;
      const y = y1 + (dy * step) / steps;
      this.fillRect(x - thickness / 2, y - thickness / 2, thickness, thickness, color);
    }
  }

  dashedLine(x1, y1, x2, y2, color, thickness = 2, dashLength = 12, gapLength = 8) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const distance = Math.sqrt(dx ** 2 + dy ** 2);

    for (let offset = 0; offset < distance; offset += dashLength + gapLength) {
      const startRatio = offset / distance;
      const endRatio = Math.min((offset + dashLength) / distance, 1);
      this.line(
        x1 + dx * startRatio,
        y1 + dy * startRatio,
        x1 + dx * endRatio,
        y1 + dy * endRatio,
        color,
        thickness
      );
    }
  }

  textWidth(text, scale = 2) {
    return String(text).length * 6 * scale;
  }

  drawText(text, x, y, color = COLORS.text, scale = 2) {
    const chars = String(text).toUpperCase().split("");
    let cursorX = x;

    chars.forEach((char) => {
      const glyph = FONT[char] || FONT[" "];

      glyph.forEach((row, rowIndex) => {
        row.split("").forEach((bit, columnIndex) => {
          if (bit === "1") {
            this.fillRect(
              cursorX + columnIndex * scale,
              y + rowIndex * scale,
              scale,
              scale,
              color
            );
          }
        });
      });

      cursorX += 6 * scale;
    });
  }

  drawTextCentered(text, centerX, y, color = COLORS.text, scale = 2) {
    this.drawText(text, centerX - this.textWidth(text, scale) / 2, y, color, scale);
  }

  save(filePath) {
    const scanlineLength = this.width * 4 + 1;
    const raw = Buffer.alloc(scanlineLength * this.height);

    for (let y = 0; y < this.height; y += 1) {
      raw[y * scanlineLength] = 0;
      this.pixels.copy(
        raw,
        y * scanlineLength + 1,
        y * this.width * 4,
        (y + 1) * this.width * 4
      );
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.width, 0);
    ihdr.writeUInt32BE(this.height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;

    fs.writeFileSync(
      filePath,
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        createChunk("IHDR", ihdr),
        createChunk("IDAT", zlib.deflateSync(raw)),
        createChunk("IEND", Buffer.alloc(0)),
      ])
    );
  }
}

const parseCsvLine = (line) => {
  const values = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"' && line[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(value);
      value = "";
    } else {
      value += char;
    }
  }

  values.push(value);
  return values;
};

const readCsv = (filePath) => {
  const lines = fs.readFileSync(filePath, "utf8").trim().split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  });
};

const toPercent = (value) => `${Math.round(value * 100)}%`;

const setupChart = (title, width = 1000, height = 700) => {
  const canvas = new Canvas(width, height);
  canvas.fillRect(28, 28, width - 56, height - 56, COLORS.panel);
  canvas.strokeRect(28, 28, width - 56, height - 56, COLORS.line, 2);
  canvas.drawText(title, 56, 56, COLORS.text, 3);
  return canvas;
};

const drawConfusionMatrix = (summary, filePath) => {
  const canvas = setupChart("CONFUSION MATRIX", 920, 680);
  const matrix = summary.confusionMatrix;
  const total = summary.dataset.totalRecords || 1;
  const cells = [
    { label: "TRUE POSITIVE", count: matrix.truePositive, color: COLORS.greenSoft, text: COLORS.green, x: 230, y: 180 },
    { label: "FALSE NEGATIVE", count: matrix.falseNegative, color: COLORS.orangeSoft, text: COLORS.orange, x: 540, y: 180 },
    { label: "FALSE POSITIVE", count: matrix.falsePositive, color: COLORS.redSoft, text: COLORS.red, x: 230, y: 405 },
    { label: "TRUE NEGATIVE", count: matrix.trueNegative, color: COLORS.greenSoft, text: COLORS.green, x: 540, y: 405 },
  ];

  canvas.drawText("PREDICTED FRAUD", 255, 130, COLORS.muted, 2);
  canvas.drawText("PREDICTED LEGIT", 570, 130, COLORS.muted, 2);
  canvas.drawText("ACTUAL FRAUD", 58, 270, COLORS.muted, 2);
  canvas.drawText("ACTUAL LEGIT", 58, 495, COLORS.muted, 2);

  cells.forEach((cell) => {
    canvas.fillRect(cell.x, cell.y, 270, 180, cell.color);
    canvas.strokeRect(cell.x, cell.y, 270, 180, COLORS.line, 2);
    canvas.drawTextCentered(cell.label, cell.x + 135, cell.y + 32, cell.text, 2);
    canvas.drawTextCentered(String(cell.count), cell.x + 135, cell.y + 76, COLORS.text, 5);
    canvas.drawTextCentered(`${Math.round((cell.count / total) * 100)}%`, cell.x + 135, cell.y + 136, COLORS.muted, 2);
  });

  canvas.save(filePath);
};

const getRiskColor = (score) => {
  if (score >= 85) return COLORS.red;
  if (score >= 70) return COLORS.orange;
  if (score >= 35) return COLORS.yellow;
  return COLORS.green;
};

const drawRiskScoreDistribution = (records, filePath) => {
  const canvas = setupChart("RISK SCORE DISTRIBUTION", 1000, 700);
  const buckets = Array.from({ length: 10 }, (_, index) => ({
    start: index * 10,
    end: index === 9 ? 100 : index * 10 + 9,
    count: 0,
  }));

  records.forEach((record) => {
    const score = Number(record.riskScore);
    const index = Math.min(Math.floor(score / 10), 9);
    buckets[index].count += 1;
  });

  const chart = { x: 90, y: 170, width: 840, height: 410 };
  const maxCount = Math.max(...buckets.map((bucket) => bucket.count), 1);

  canvas.line(chart.x, chart.y + chart.height, chart.x + chart.width, chart.y + chart.height, COLORS.line, 3);
  canvas.line(chart.x, chart.y, chart.x, chart.y + chart.height, COLORS.line, 3);
  canvas.drawText("COUNT", 40, 165, COLORS.muted, 2);
  canvas.drawText("RISK SCORE", 400, 625, COLORS.muted, 2);

  const barWidth = chart.width / buckets.length - 10;

  buckets.forEach((bucket, index) => {
    const barHeight = (bucket.count / maxCount) * (chart.height - 20);
    const x = chart.x + index * (chart.width / buckets.length) + 6;
    const y = chart.y + chart.height - barHeight;
    const mid = (bucket.start + bucket.end) / 2;

    canvas.fillRect(x, y, barWidth, barHeight, getRiskColor(mid));
    canvas.drawTextCentered(String(bucket.count), x + barWidth / 2, y - 24, COLORS.text, 2);
    canvas.drawTextCentered(`${bucket.start}-${bucket.end}`, x + barWidth / 2, chart.y + chart.height + 20, COLORS.muted, 1);
  });

  canvas.save(filePath);
};

const drawFraudLabelBreakdown = (summary, filePath) => {
  const canvas = setupChart("FRAUD LABEL BREAKDOWN", 1150, 720);
  const preferredOrder = [
    "LEGITIMATE",
    "USED_INVOICE",
    "CANCELLED_RECORD",
    "INFLATED_AMOUNT",
    "BLACKLISTED_HOSPITAL",
    "DATE_MISMATCH",
    "SUSPICIOUS_PATTERN",
  ];
  const breakdown = summary.fraudLabelBreakdown || {};
  const rows = preferredOrder
    .filter((label) => breakdown[label])
    .map((label) => ({ label, count: breakdown[label].total }));
  const chart = { x: 360, y: 145, width: 700, height: 470 };
  const rowHeight = chart.height / rows.length;
  const maxCount = Math.max(...rows.map((row) => row.count), 1);

  rows.forEach((row, index) => {
    const y = chart.y + index * rowHeight + 12;
    const width = (row.count / maxCount) * chart.width;

    canvas.drawText(row.label.replace(/_/g, "-"), 70, y + 6, COLORS.text, 2);
    canvas.fillRect(chart.x, y, width, rowHeight - 22, row.label === "LEGITIMATE" ? COLORS.green : COLORS.orange);
    canvas.drawText(String(row.count), chart.x + width + 14, y + 8, COLORS.text, 2);
  });

  canvas.save(filePath);
};

const drawPrecisionRecallF1 = (summary, filePath) => {
  const canvas = setupChart("PRECISION RECALL F1", 1000, 700);
  const { truePositive, trueNegative, falsePositive, falseNegative } = summary.confusionMatrix;
  const fraud = {
    precision: summary.metrics.precision,
    recall: summary.metrics.recall,
    f1: summary.metrics.f1Score,
  };
  const legitPrecision = trueNegative + falseNegative > 0 ? trueNegative / (trueNegative + falseNegative) : 0;
  const legitRecall = trueNegative + falsePositive > 0 ? trueNegative / (trueNegative + falsePositive) : 0;
  const legitF1 = legitPrecision + legitRecall > 0 ? (2 * legitPrecision * legitRecall) / (legitPrecision + legitRecall) : 0;
  const groups = [
    { label: "FRAUDULENT", values: [fraud.precision, fraud.recall, fraud.f1] },
    { label: "LEGITIMATE", values: [legitPrecision, legitRecall, legitF1] },
  ];
  const metrics = [
    { label: "PRECISION", color: COLORS.blue },
    { label: "RECALL", color: COLORS.green },
    { label: "F1", color: COLORS.purple },
  ];
  const chart = { x: 120, y: 160, width: 780, height: 390 };

  canvas.line(chart.x, chart.y + chart.height, chart.x + chart.width, chart.y + chart.height, COLORS.line, 3);
  canvas.line(chart.x, chart.y, chart.x, chart.y + chart.height, COLORS.line, 3);

  groups.forEach((group, groupIndex) => {
    const groupX = chart.x + 120 + groupIndex * 360;

    group.values.forEach((value, metricIndex) => {
      const barHeight = value * chart.height;
      const x = groupX + metricIndex * 70;
      const y = chart.y + chart.height - barHeight;

      canvas.fillRect(x, y, 48, barHeight, metrics[metricIndex].color);
      canvas.drawTextCentered(toPercent(value), x + 24, y - 24, COLORS.text, 2);
    });

    canvas.drawTextCentered(group.label, groupX + 84, chart.y + chart.height + 32, COLORS.muted, 2);
  });

  metrics.forEach((metric, index) => {
    const x = 250 + index * 180;
    canvas.fillRect(x, 600, 18, 18, metric.color);
    canvas.drawText(metric.label, x + 28, 598, COLORS.text, 2);
  });

  canvas.save(filePath);
};

const drawFraudProbabilityDistribution = (records, filePath) => {
  const canvas = setupChart("FRAUD PROBABILITY DISTRIBUTION", 1080, 720);
  const bins = Array.from({ length: 11 }, (_, index) => index * 10);
  const series = {
    fraud: Array(11).fill(0),
    legitimate: Array(11).fill(0),
  };

  records.forEach((record) => {
    const value = Number(record.posteriorFraudPercent);
    const index = Math.min(Math.round(value / 10), 10);
    series[record.actualFraud === "true" ? "fraud" : "legitimate"][index] += 1;
  });

  const chart = { x: 110, y: 160, width: 850, height: 410 };
  const maxCount = Math.max(...series.fraud, ...series.legitimate, 1);
  const toPoint = (count, index) => ({
    x: chart.x + (index / 10) * chart.width,
    y: chart.y + chart.height - (count / maxCount) * chart.height,
  });

  canvas.line(chart.x, chart.y + chart.height, chart.x + chart.width, chart.y + chart.height, COLORS.line, 3);
  canvas.line(chart.x, chart.y, chart.x, chart.y + chart.height, COLORS.line, 3);
  canvas.drawText("COUNT", 52, 160, COLORS.muted, 2);
  canvas.drawText("POSTERIOR FRAUD PROBABILITY", 300, 625, COLORS.muted, 2);

  [0, 2, 4, 6, 8, 10].forEach((index) => {
    const point = toPoint(0, index);
    canvas.drawTextCentered(`${bins[index]}%`, point.x, chart.y + chart.height + 20, COLORS.muted, 1);
  });

  const drawSeries = (counts, color) => {
    for (let index = 0; index < counts.length - 1; index += 1) {
      const left = toPoint(counts[index], index);
      const right = toPoint(counts[index + 1], index + 1);
      canvas.line(left.x, left.y, right.x, right.y, color, 5);
      canvas.fillRect(left.x - 4, left.y - 4, 8, 8, color);
    }

    const last = toPoint(counts[counts.length - 1], counts.length - 1);
    canvas.fillRect(last.x - 4, last.y - 4, 8, 8, color);
  };

  drawSeries(series.fraud, COLORS.red);
  drawSeries(series.legitimate, COLORS.green);
  canvas.fillRect(330, 600, 18, 18, COLORS.red);
  canvas.drawText("FRAUD-LABELED", 360, 598, COLORS.text, 2);
  canvas.fillRect(590, 600, 18, 18, COLORS.green);
  canvas.drawText("LEGITIMATE", 620, 598, COLORS.text, 2);

  canvas.save(filePath);
};

const drawCurveAxes = (canvas, chart, xLabel, yLabel) => {
  canvas.line(
    chart.x,
    chart.y + chart.height,
    chart.x + chart.width,
    chart.y + chart.height,
    COLORS.line,
    3
  );
  canvas.line(chart.x, chart.y, chart.x, chart.y + chart.height, COLORS.line, 3);

  [0, 0.25, 0.5, 0.75, 1].forEach((value) => {
    const x = chart.x + value * chart.width;
    const y = chart.y + chart.height - value * chart.height;
    canvas.drawTextCentered(toPercent(value), x, chart.y + chart.height + 18, COLORS.muted, 1);
    canvas.drawText(toPercent(value), chart.x - 54, y - 4, COLORS.muted, 1);
  });

  canvas.drawTextCentered(xLabel, chart.x + chart.width / 2, chart.y + chart.height + 48, COLORS.muted, 2);
  canvas.drawText(yLabel, 40, chart.y - 38, COLORS.muted, 2);
};

const drawNormalizedSeries = (canvas, chart, points, xKey, yKey, color, thickness = 4) => {
  const normalized = points
    .map((point) => ({ x: Number(point[xKey]), y: Number(point[yKey]) }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .sort((left, right) => left.x - right.x);

  for (let index = 1; index < normalized.length; index += 1) {
    const left = normalized[index - 1];
    const right = normalized[index];
    canvas.line(
      chart.x + left.x * chart.width,
      chart.y + chart.height - left.y * chart.height,
      chart.x + right.x * chart.width,
      chart.y + chart.height - right.y * chart.height,
      color,
      thickness
    );
  }
};

const drawRocCurve = (summary, filePath) => {
  const canvas = setupChart("ROC CURVE", 1000, 720);
  const chart = { x: 130, y: 150, width: 760, height: 420 };

  drawCurveAxes(canvas, chart, "FALSE POSITIVE RATE", "TRUE POSITIVE RATE");
  canvas.line(chart.x, chart.y + chart.height, chart.x + chart.width, chart.y, COLORS.line, 2);
  drawNormalizedSeries(
    canvas,
    chart,
    summary.curves?.roc || [],
    "falsePositiveRate",
    "truePositiveRate",
    COLORS.blue,
    5
  );
  canvas.drawText(`AUC ${Number(summary.metrics?.auc || 0).toFixed(4)}`, 690, 95, COLORS.blue, 2);
  canvas.save(filePath);
};

const drawPrecisionRecallCurve = (summary, filePath) => {
  const canvas = setupChart("PRECISION RECALL CURVE", 1000, 720);
  const chart = { x: 130, y: 150, width: 760, height: 420 };
  const prevalence = Number(summary.curves?.fraudPrevalence || 0);

  drawCurveAxes(canvas, chart, "RECALL", "PRECISION");
  canvas.dashedLine(
    chart.x,
    chart.y + chart.height - prevalence * chart.height,
    chart.x + chart.width,
    chart.y + chart.height - prevalence * chart.height,
    COLORS.red,
    2
  );
  drawNormalizedSeries(
    canvas,
    chart,
    summary.curves?.precisionRecall || [],
    "recall",
    "precision",
    COLORS.purple,
    5
  );
  canvas.drawText(
    `AP ${Number(summary.metrics?.averagePrecision || 0).toFixed(4)}`,
    700,
    95,
    COLORS.purple,
    2
  );
  canvas.drawText(`BASELINE ${toPercent(prevalence)}`, 600, 610, COLORS.red, 2);
  canvas.save(filePath);
};

const drawThresholdSensitivity = (summary, filePath) => {
  const canvas = setupChart("THRESHOLD SENSITIVITY", 1080, 740);
  const chart = { x: 130, y: 150, width: 820, height: 430 };
  const points = summary.thresholdAnalysis?.heldOutSensitivity || [];
  const series = [
    { key: "precision", color: COLORS.blue, label: "PRECISION" },
    { key: "recall", color: COLORS.green, label: "RECALL" },
  ];
  const f1Points = points.map((point) => ({
    threshold: point.threshold,
    f1: point.f1Score,
  }));

  drawCurveAxes(canvas, chart, "THRESHOLD", "METRIC");

  const drawThresholdSeries = (values, key, color) => {
    const normalized = values
      .filter((point) => point.threshold >= 0 && point.threshold <= 100)
      .sort((left, right) => left.threshold - right.threshold);

    for (let index = 1; index < normalized.length; index += 1) {
      const left = normalized[index - 1];
      const right = normalized[index];
      canvas.line(
        chart.x + (left.threshold / 100) * chart.width,
        chart.y + chart.height - Number(left[key]) * chart.height,
        chart.x + (right.threshold / 100) * chart.width,
        chart.y + chart.height - Number(right[key]) * chart.height,
        color,
        4
      );
    }
  };

  series.forEach((item) => drawThresholdSeries(points, item.key, item.color));
  drawThresholdSeries(f1Points, "f1", COLORS.purple);
  [
    ...series,
    { color: COLORS.purple, label: "F1" },
  ].forEach((item, index) => {
    const x = 180 + index * 300;
    canvas.fillRect(x, 675, 18, 18, item.color);
    canvas.drawText(item.label, x + 28, 673, COLORS.text, 2);
  });
  canvas.save(filePath);
};

const drawBaselineComparison = (summary, filePath) => {
  const canvas = setupChart("MODEL VS BASELINES F1", 1000, 700);
  const rows = [
    { label: "BAYESIAN MODEL", value: summary.metrics?.f1Score || 0, color: COLORS.blue },
    ...(summary.baselines || []).map((baseline, index) => ({
      label: baseline.label,
      value: baseline.metrics.f1Score,
      color: index === 0 ? COLORS.orange : COLORS.red,
    })),
  ];
  const chart = { x: 330, y: 165, width: 560, height: 400 };
  const rowHeight = chart.height / rows.length;

  rows.forEach((row, index) => {
    const y = chart.y + index * rowHeight + 20;
    const width = Number(row.value) * chart.width;
    canvas.drawText(row.label, 70, y + 10, COLORS.text, 2);
    canvas.fillRect(chart.x, y, width, rowHeight - 36, row.color);
    canvas.drawText(toPercent(row.value), chart.x + width + 12, y + 10, COLORS.text, 2);
  });

  canvas.save(filePath);
};

const drawThroughputLatency = (results, filePath) => {
  const canvas = setupChart("THROUGHPUT VS LATENCY", 1080, 740);
  const rows = results.rows || [];
  const chart = { x: 130, y: 150, width: 820, height: 430 };
  const maxConcurrency = Math.max(...rows.map((row) => row.concurrency), 1);
  const maxLatency = Math.max(
    ...rows.map((row) => Number(row.endToEnd?.averageMs || 0)),
    1
  );
  const maxThroughput = Math.max(
    ...rows.map((row) => Number(row.throughputClaimsPerSecond || 0)),
    1
  );

  canvas.line(chart.x, chart.y + chart.height, chart.x + chart.width, chart.y + chart.height, COLORS.line, 3);
  canvas.line(chart.x, chart.y, chart.x, chart.y + chart.height, COLORS.line, 3);
  canvas.line(chart.x + chart.width, chart.y, chart.x + chart.width, chart.y + chart.height, COLORS.line, 3);
  canvas.drawText("LATENCY MS", 40, 105, COLORS.muted, 2);
  canvas.drawText("CLAIMS/S", 875, 105, COLORS.muted, 2);
  canvas.drawTextCentered("PARALLEL CLAIMS", chart.x + chart.width / 2, 630, COLORS.muted, 2);

  const drawSeries = (getValue, maximum, color) => {
    const points = rows.map((row) => ({
      x: chart.x + (row.concurrency / maxConcurrency) * chart.width,
      y:
        chart.y +
        chart.height -
        (Number(getValue(row) || 0) / maximum) * chart.height,
    }));

    for (let index = 1; index < points.length; index += 1) {
      canvas.line(points[index - 1].x, points[index - 1].y, points[index].x, points[index].y, color, 5);
    }

    points.forEach((point) => {
      canvas.fillRect(point.x - 4, point.y - 4, 8, 8, color);
    });
  };

  drawSeries((row) => row.endToEnd?.averageMs, maxLatency, COLORS.orange);
  drawSeries((row) => row.throughputClaimsPerSecond, maxThroughput, COLORS.blue);
  [
    { label: "END-TO-END LATENCY", color: COLORS.orange, x: 220 },
    { label: "THROUGHPUT", color: COLORS.blue, x: 610 },
  ].forEach((item) => {
    canvas.fillRect(item.x, 675, 18, 18, item.color);
    canvas.drawText(item.label, item.x + 28, 673, COLORS.text, 2);
  });
  canvas.save(filePath);
};

const drawAuditorReputationScatter = (analysis, filePath) => {
  const canvas = setupChart("REPUTATION VS ACCURACY", 1000, 720);
  const chart = { x: 130, y: 150, width: 760, height: 420 };

  drawCurveAxes(canvas, chart, "REPUTATION SCORE", "HISTORICAL ACCURACY");

  (analysis.auditors || []).forEach((auditor) => {
    const x = chart.x + (Number(auditor.reputationScore) / 100) * chart.width;
    const y =
      chart.y + chart.height - Number(auditor.historicalAccuracy) * chart.height;
    canvas.fillRect(x - 6, y - 6, 12, 12, COLORS.purple);
  });

  const correlation = analysis.pearsonCorrelation;
  canvas.drawText(
    `PEARSON ${correlation === null ? "N/A" : Number(correlation).toFixed(4)}`,
    650,
    100,
    COLORS.purple,
    2
  );
  canvas.save(filePath);
};

const assertInputsExist = () => {
  if (!fs.existsSync(SUMMARY_PATH)) {
    throw new Error(`Missing ${SUMMARY_PATH}. Run npm run evaluate:risk first.`);
  }

  if (!fs.existsSync(RECORDS_PATH)) {
    throw new Error(`Missing ${RECORDS_PATH}. Run npm run evaluate:risk first.`);
  }
};

const main = () => {
  assertInputsExist();
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const summary = JSON.parse(fs.readFileSync(SUMMARY_PATH, "utf8"));
  const records = readCsv(RECORDS_PATH);
  const outputs = [
    ["confusion_matrix.png", (filePath) => drawConfusionMatrix(summary, filePath)],
    ["risk_score_distribution.png", (filePath) => drawRiskScoreDistribution(records, filePath)],
    ["fraud_label_breakdown.png", (filePath) => drawFraudLabelBreakdown(summary, filePath)],
    ["precision_recall_f1.png", (filePath) => drawPrecisionRecallF1(summary, filePath)],
    ["fraud_probability_distribution.png", (filePath) => drawFraudProbabilityDistribution(records, filePath)],
    ["roc_curve.png", (filePath) => drawRocCurve(summary, filePath)],
    ["precision_recall_curve.png", (filePath) => drawPrecisionRecallCurve(summary, filePath)],
    ["threshold_sensitivity.png", (filePath) => drawThresholdSensitivity(summary, filePath)],
    ["baseline_f1_comparison.png", (filePath) => drawBaselineComparison(summary, filePath)],
  ];

  if (fs.existsSync(THROUGHPUT_PATH)) {
    const throughput = JSON.parse(fs.readFileSync(THROUGHPUT_PATH, "utf8"));
    outputs.push([
      "throughput_vs_latency.png",
      (filePath) => drawThroughputLatency(throughput, filePath),
    ]);
  }

  if (fs.existsSync(AUDITOR_ANALYSIS_PATH)) {
    const auditorAnalysis = JSON.parse(
      fs.readFileSync(AUDITOR_ANALYSIS_PATH, "utf8")
    );
    outputs.push([
      "auditor_reputation_accuracy_scatter.png",
      (filePath) => drawAuditorReputationScatter(auditorAnalysis, filePath),
    ]);
  }

  outputs.forEach(([fileName, draw]) => {
    const filePath = path.join(OUTPUT_DIR, fileName);
    draw(filePath);
    console.log(`Saved chart: ${filePath}`);
  });
};

if (require.main === module) {
  main();
}

module.exports = {
  Canvas,
  drawAuditorReputationScatter,
  drawBaselineComparison,
  drawPrecisionRecallCurve,
  drawRocCurve,
  drawThresholdSensitivity,
  drawThroughputLatency,
  main,
};
