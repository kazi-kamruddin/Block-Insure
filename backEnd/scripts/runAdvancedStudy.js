// Explicit offline experiment. Never seeds MongoDB or freezes runtime artifacts.
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { run } = require('../research/export');
const root = path.resolve(__dirname, '../..');
async function main() {
  const python = process.env.RESEARCH_PYTHON || path.join(root, 'backEnd/research/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (!fs.existsSync(python)) throw new Error('Install the pinned research environment first; see docs/advanced-ml-phase12.md');
  const directory = path.join(root, 'docs/engineered', `advanced-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await run(directory);
  const result = spawnSync(python, [path.join(root, 'backEnd/research/run.py'), directory], { stdio: 'inherit', env: { ...process.env, OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1' } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Offline study failed (${result.status}); artifacts retained at ${directory}`);
}
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
