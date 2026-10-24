// Source/evidence snapshot only. No secrets, deployment, Git writes or builds.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const git = (...args) => execFileSync("git", ["-c", `safe.directory=${root.replaceAll("\\", "/")}`, ...args], { cwd: root, encoding: "utf8" }).trim();
const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex");
const digest = (object) => crypto.createHash("sha256").update(JSON.stringify(object)).digest("hex");
const args = process.argv.slice(2), check = args[0] === "--check";
if (check) {
  const record = JSON.parse(fs.readFileSync(path.resolve(root, args[1]), "utf8"));
  if (digest(record.files) !== record.sourceIdentity) throw new Error("Release source identity is invalid");
  for (const [file, expected] of Object.entries(record.files)) if (sha(file) !== expected) throw new Error(`Release snapshot changed: ${file}`);
  for (const [file, expected] of Object.entries(record.evidence)) if (sha(file) !== expected) throw new Error(`Release evidence changed: ${file}`);
  console.log(`Release candidate snapshot verified: ${record.sourceIdentity}`);
} else {
  const documents = ["README.md", "docs/shadow-release-assurance.md", "docs/shadow-deployment-handoff.md", "docs/xgboost-advisory-phase3.md", "docs/deployment-guide.md"];
  const entrypoints = ["backEnd/server.js", "frontEnd/eslint.config.js"];
  const packagedSources = Object.keys(require("../backEnd/artifacts/xgboost-advisory-manifest.json").files);
  const files = git("ls-files", "--cached", "--others", "--exclude-standard").split(/\r?\n/).filter((file) =>
    /^(?:backEnd\/(?:controllers|services|models|routes|middleware|config|scripts|research|test|abi|artifacts)\/|oracle\/|frontEnd\/src\/|contracts\/(?:contracts|test|scripts)\/|scripts\/|e2e\/|deploy\/)/.test(file) ||
    /(?:^|\/)(?:package(?:-lock)?\.json|hardhat\.config\.js|vite\.config\.js)$/.test(file) || /^playwright.*\.config\.js$|^frontEnd\/public\//.test(file) ||
    ["render.yaml", "frontEnd/vercel.json", "frontEnd/index.html", ".dockerignore", ...entrypoints, ...packagedSources, ...documents].includes(file));
  const selected = [...new Set(files)].filter((file) => /\.(?:js|jsx|json|py|yaml|yml|sol|css|html)$/.test(file) || /Dockerfile$|\.env\.example$|^frontEnd\/public\//.test(file) || [".dockerignore", ...documents].includes(file))
    .filter((file) => fs.existsSync(path.join(root, file)) && fs.statSync(path.join(root, file)).isFile()).sort();
  const evidenceFiles = ["verification-results/shadow-release-assurance-2026-10-24.json", "verification-results/xgboost-advisory-phase3-2026-10-24.json", "backEnd/evaluation-results/research-manifest-v4.json"];
  for (const file of evidenceFiles) if (!fs.existsSync(path.join(root, file))) throw new Error(`Complete verification evidence first: ${file}`);
  const filesHash = Object.fromEntries(selected.map((file) => [file, sha(file)]));
  const record = { schema: "block-insure-release-candidate-v1", generatedAt: new Date().toISOString(), baseCommit: git("rev-parse", "HEAD"),
    dirtyAtPreparation: Boolean(git("status", "--porcelain")), sourceIdentity: digest(filesHash), files: filesHash,
    evidence: Object.fromEntries(evidenceFiles.map((file) => [file, sha(file)])),
    boundary: "Content-frozen candidate; not a commit, tag, deployment or proof that every file was exercised by every test. Evidence specifies exact executed scopes." };
  const output = path.join(root, "verification-results/release-candidate-2026-10-24.json");
  fs.writeFileSync(output, JSON.stringify(record, null, 2) + "\n");
  console.log(`Prepared source/evidence candidate: ${record.sourceIdentity}; ${selected.length} files`);
}
