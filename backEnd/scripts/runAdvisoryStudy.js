const fs = require("node:fs"), path = require("node:path"), { spawnSync } = require("node:child_process");
const base = path.resolve(__dirname, "../research");
const python = path.join(base, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
if (!fs.existsSync(python)) throw new Error("Use the prepared pinned research Python environment; this command does not create environments");
const child = spawnSync(python, [path.join(base, "runPhase3.py")], {
  windowsHide: true, stdio: "inherit", env: { ...process.env, OMP_NUM_THREADS: "1", OPENBLAS_NUM_THREADS: "1", MKL_NUM_THREADS: "1" },
});
if (child.error) throw child.error;
process.exitCode = child.status || (child.signal ? 1 : 0);
