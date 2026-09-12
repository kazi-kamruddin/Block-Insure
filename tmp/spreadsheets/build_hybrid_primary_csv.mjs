import fs from "node:fs/promises";
import path from "node:path";
import { Workbook } from "@oai/artifact-tool";

const root = String.raw`E:\4-1\4100 thesis\project\Block-Insure`;
const inputPath = path.join(root, "backEnd", "datasets", "hybrid-v1", "runtime", "hybrid-primary.jsonl");
const outputPath = path.join(root, "reference", "hybrid-primary.csv");
const previewPath = path.join(root, "tmp", "spreadsheets", "hybrid-primary-preview.png");

const source = await fs.readFile(inputPath, "utf8");
const lines = source.split(/\r?\n/).filter((line) => line.trim().length > 0);
const rows = lines.map((line, index) => {
  try {
    return JSON.parse(line);
  } catch (error) {
    throw new Error(`Invalid JSON on source line ${index + 1}: ${error.message}`);
  }
});

const columns = [];
const seenColumns = new Set();

function flatten(value, prefix, output) {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      const childPrefix = prefix ? `${prefix}.${key}` : key;
      flatten(child, childPrefix, output);
    }
    return;
  }
  if (!prefix) return;
  if (!seenColumns.has(prefix)) {
    seenColumns.add(prefix);
    columns.push(prefix);
  }
  output[prefix] = Array.isArray(value) ? JSON.stringify(value) : value;
}

const flatRows = rows.map((record) => {
  const flat = {};
  flatten(record, "", flat);
  return flat;
});

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "boolean" ? (value ? "true" : "false") : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

const csvLines = [
  columns.map(csvCell).join(","),
  ...flatRows.map((record) => columns.map((column) => csvCell(record[column])).join(",")),
];
const csvText = `${csvLines.join("\r\n")}\r\n`;
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, csvText, "utf8");

// Verify the produced CSV through the spreadsheet artifact engine.
const workbook = await Workbook.fromCSV(csvText, { sheetName: "Hybrid runtime" });
workbook.recalculate();
const inspection = await workbook.inspect({
  kind: "table",
  range: `Hybrid runtime!A1:J6`,
  include: "values,formulas",
  tableMaxRows: 6,
  tableMaxCols: 10,
  maxChars: 7000,
});
const preview = await workbook.render({
  sheetName: "Hybrid runtime",
  range: "A1:J12",
  scale: 1,
  format: "png",
});
await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));

const outputStats = await fs.stat(outputPath);
const sourceIds = new Set(rows.map((record) => record.recordId));
const outputLineCount = csvText.split(/\r?\n/).filter(Boolean).length;
if (rows.length !== 4995) throw new Error(`Expected 4,995 records, found ${rows.length}`);
if (sourceIds.size !== rows.length) throw new Error("Source recordId values are not unique");
if (outputLineCount !== rows.length + 1) throw new Error("CSV row count does not match source plus header");

console.log(JSON.stringify({
  inputRecords: rows.length,
  uniqueRecordIds: sourceIds.size,
  outputDataRows: outputLineCount - 1,
  columns: columns.length,
  outputBytes: outputStats.size,
  outputPath,
  inspection: inspection.ndjson,
}, null, 2));
