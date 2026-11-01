// Local source snapshots. No secrets, builds, deployment, or Git writes.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { parseOperatorArguments } = require("./operatorArguments");
const root = path.resolve(__dirname, "..");
const digest = (object) => crypto.createHash("sha256").update(JSON.stringify(object)).digest("hex");
const publicDocuments = ["README.md", "docs/local-development.md", "docs/deployment-guide.md",
  "docs/free-tier-staging-deployment.md", "docs/repository-artifacts.md", "docs/protocol-v2-migration.json",
  "docs/financial-and-provider-workflows.md", "docs/evidence-review-and-recovery.md", "docs/release-verification.md",
  "docs/release-static-review.md", "docs/current-system-architecture.md",
  "docs/xgboost-protocol-migration.md", "docs/research-source-transition-v4.json"];
const readGit = (directory, args) => execFileSync("git", ["-c", `safe.directory=${directory.replaceAll("\\", "/")}`, ...args],
  { cwd: directory, encoding: "utf8" }).trim();
const resultPath = (value) => {
  if (!/^verification-results\/[\w.-]+\.json$/.test(value)) throw new Error("Use a verification-results JSON path");
  return value;
};

function selectSources(projectRoot, runGit) {
  const packagedSources = Object.keys(JSON.parse(fs.readFileSync(path.join(projectRoot, "backEnd/artifacts/xgboost-advisory-manifest.json"), "utf8")).files);
  const extraFiles = ["render.yaml", "frontEnd/vercel.json", "frontEnd/index.html", ".dockerignore", ".gitignore",
    "deploy/Caddyfile", "deploy/nginx.conf",
    "backEnd/server.js", "frontEnd/eslint.config.js", ...packagedSources, ...publicDocuments];
  const files = runGit(projectRoot, ["ls-files", "--cached", "--others", "--exclude-standard"]).split(/\r?\n/).filter((file) =>
    /^(?:backEnd\/(?:controllers|services|models|routes|middleware|config|scripts|research|test|abi|artifacts)\/|oracle\/|frontEnd\/src\/|contracts\/(?:contracts|test|scripts)\/|scripts\/|e2e\/|deploy\/)/.test(file) ||
    /(?:^|\/)(?:package(?:-lock)?\.json|hardhat\.config\.js|vite\.config\.js)$/.test(file) || /^playwright.*\.config\.js$|^frontEnd\/public\//.test(file) || extraFiles.includes(file));
  const selected = [...new Set(files)].filter((file) => /\.(?:js|jsx|json|py|yaml|yml|sol|css|html)$/.test(file) ||
    /Dockerfile$|\.env(?:\.oracle2)?\.example$|^frontEnd\/public\//.test(file) || extraFiles.includes(file))
    .filter((file) => fs.existsSync(path.join(projectRoot, file)) && fs.statSync(path.join(projectRoot, file)).isFile()).sort();
  return selected;
}

function main(args = process.argv.slice(2), { projectRoot = root, runGit = readGit, log = console.log } = {}) {
  const options = parseOperatorArguments(args, { values: ["--check", "--evidence", "--output"] });
  const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(path.resolve(projectRoot, file))).digest("hex");
  if (options["--check"]) {
    if (options["--output"] || options["--evidence"]) throw new Error("Check cannot be combined with output or evidence");
    const record = JSON.parse(fs.readFileSync(path.resolve(projectRoot, options["--check"]), "utf8"));
    if (digest(record.files) !== record.sourceIdentity) throw new Error("Release source identity is invalid");
    if (JSON.stringify(selectSources(projectRoot, runGit)) !== JSON.stringify(Object.keys(record.files).sort())) throw new Error("Release source set changed");
    for (const [file, expected] of Object.entries(record.files)) if (sha(file) !== expected) throw new Error(`Release snapshot changed: ${file}`);
    for (const [file, expected] of Object.entries(record.evidence || {})) if (sha(file) !== expected) throw new Error(`Release evidence changed: ${file}`);
    log(`Release candidate snapshot verified: ${record.sourceIdentity}`);
    return record;
  }
  const outputName = resultPath(options["--output"] || `verification-results/release-candidate-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const evidenceFiles = options["--evidence"] ? [resultPath(options["--evidence"])] : [];
  for (const file of evidenceFiles) if (!fs.existsSync(path.join(projectRoot, file))) throw new Error(`Selected verification evidence is missing: ${file}`);
  const selected = selectSources(projectRoot, runGit);
  const filesHash = Object.fromEntries(selected.map((file) => [file, sha(file)]));
  const record = { schema: "block-insure-release-candidate-v1", generatedAt: new Date().toISOString(),
    baseCommit: runGit(projectRoot, ["rev-parse", "HEAD"]), dirtyAtPreparation: Boolean(runGit(projectRoot, ["status", "--porcelain"])),
    sourceIdentity: digest(filesHash), files: filesHash, evidence: Object.fromEntries(evidenceFiles.map((file) => [file, sha(file)])),
    boundary: "Source snapshot with explicitly selected local evidence only; not a deployment or proof that all workflows were tested." };
  const output = path.join(projectRoot, outputName);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
  log(`Prepared source/evidence candidate: ${record.sourceIdentity}; ${selected.length} files`);
  return record;
}
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { main };
