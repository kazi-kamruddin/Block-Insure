const path = require('node:path'), fs = require('node:fs'), { spawnSync } = require('node:child_process');
const { run } = require('../research/exportV2');
const root = path.resolve(__dirname, '../..');
async function main() {
  const python = process.env.RESEARCH_PYTHON || path.join(root, 'backEnd/research/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (!fs.existsSync(python)) throw new Error('Prepare the documented pinned offline Python environment');
  const directory = path.join(root, 'docs/engineered', `advanced-engineering-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await run(directory);
  const child = spawnSync(python, [path.join(root, 'backEnd/research/runV2.py'), directory], { stdio: 'inherit', env: { ...process.env, OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1' } });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(`Engineered study failed (${child.status}); partial evidence preserved at ${directory}`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
