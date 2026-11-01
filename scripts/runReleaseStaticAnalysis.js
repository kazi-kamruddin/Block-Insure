// Windows-safe isolated compilation for source-map analysis; working contracts stay untouched.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
function main() {
  const args = require("./operatorArguments").parseOperatorArguments(process.argv.slice(2), { values: ["--output"], required: ["--output"] });
  const output = path.resolve(args["--output"]);
  if (fs.existsSync(output)) throw new Error("Preserve the existing analysis result");
  const directory = fs.mkdtempSync(path.join(root, "tmp", "slither-release-"));
  fs.mkdirSync(path.join(directory, "contracts"));
  const inputHashes = {};
  for (const name of fs.readdirSync(path.join(root, "contracts/contracts"), { recursive: true }).filter((name) => name.endsWith(".sol"))) {
    const input = fs.readFileSync(path.join(root, "contracts/contracts", name));
    inputHashes[name] = crypto.createHash("sha256").update(input).digest("hex");
    const target = path.join(directory, "contracts", name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, input.toString("utf8").replace(/\r\n/g, "\n"));
  }
  for (const file of ["package.json", "hardhat.config.js", "slither.config.json"]) fs.copyFileSync(path.join(root, "contracts", file), path.join(directory, file));
  fs.symlinkSync(path.join(root, "contracts/node_modules"), path.join(directory, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  const env = { ...process.env, APPDATA: path.join(root, ".hardhat-appdata"), LOCALAPPDATA: path.join(root, ".hardhat-localappdata") };
  console.log("Compiling isolated LF source-map inputs for fresh static analysis.");
  execFileSync(process.execPath, [path.join(root, "contracts/node_modules/hardhat/internal/cli/cli.js"), "compile"], { cwd: directory, env, stdio: "inherit", windowsHide: true });
  for (const name of Object.keys(inputHashes)) {
    const file = `artifacts/contracts/${name}/${path.basename(name, ".sol")}.json`;
    if (fs.existsSync(path.join(root, "contracts", file)) && fs.existsSync(path.join(directory, file))) {
      if (JSON.parse(fs.readFileSync(path.join(root, "contracts", file))).deployedBytecode !== JSON.parse(fs.readFileSync(path.join(directory, file))).deployedBytecode) throw new Error(`Analysis bytecode differs: ${name}`);
    }
  }
  const executable = process.env.SLITHER_BIN || path.join(root, "contracts/.venv-slither/Scripts/slither.exe");
  execFileSync(executable, [".", "--config-file", "slither.config.json", "--json", output, "--hardhat-ignore-compile"], { cwd: directory, env, stdio: "inherit", windowsHide: true });
  fs.writeFileSync(output + ".inputs.json", JSON.stringify({ inputHashes, sourceMapNormalization: "CRLF to LF in isolated copy only", bytecodeMatchesWorkingArtifacts: true }, null, 2) + "\n", { flag: "wx" });
}
try { main(); } catch { console.error("Fresh static analysis failed; inspect local compile/analyzer diagnostics. No deployment occurred."); process.exitCode = 1; }
