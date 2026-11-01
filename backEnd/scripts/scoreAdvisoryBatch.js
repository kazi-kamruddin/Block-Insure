// Local research parity bridge; no HTTP, database, wallet or worker access.
const fs = require("node:fs");
const { compile } = require("../../oracle/xgboostAssessment");
const engine = compile(JSON.parse(fs.readFileSync(process.argv[2], "utf8")));
const rows = JSON.parse(fs.readFileSync(0, "utf8"));
process.stdout.write(JSON.stringify(rows.map((row, i) => engine.score(row, { explain: i < 20 }))));
