// Preserve pre-revision research implementation without copying environments/data.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
function snapshot(directory) {
  directory = path.resolve(directory);
  if (path.dirname(directory) !== path.join(root, 'docs/engineered') || !path.basename(directory).startsWith('advanced-') || fs.existsSync(directory)) throw new Error('Use a new ignored advanced-* snapshot directory');
  fs.mkdirSync(directory);
  const hashes = {};
  for (const file of fs.readdirSync(__dirname)) {
    if (!/\.(py|js|json|txt)$/.test(file)) continue;
    const bytes = fs.readFileSync(path.join(__dirname, file));
    fs.writeFileSync(path.join(directory, file), bytes, { flag: 'wx' });
    hashes[file] = crypto.createHash('sha256').update(bytes).digest('hex');
  }
  fs.writeFileSync(path.join(directory, 'snapshot-receipt.json'), JSON.stringify({ createdAt: new Date().toISOString(), scope: 'Pre-v2 source snapshot; not another experiment', hashes }, null, 2), { flag: 'wx' });
  console.log(`Preserved ${Object.keys(hashes).length} research source files at ${directory}`);
}
if (require.main === module) snapshot(process.argv[2]);
