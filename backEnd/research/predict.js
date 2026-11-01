// Independent offline reference only; intentionally not imported by API/workers.
const fs = require('node:fs');
function predict(model, rows) {
  if (model.schema !== 'advanced-trees-v1' || model.baseMargin !== 0 || !Array.isArray(model.trees) || !Array.isArray(model.features)) throw new Error('Unsupported tree artifact');
  return rows.map((row) => {
    if (row.length !== model.features.length || row.some((n) => !Number.isFinite(n))) throw new Error('Invalid candidate feature vector');
    let margin = Math.fround(model.baseMargin);
    for (const tree of model.trees) {
      let node = tree;
      while (node.leaf === undefined) {
        const index = model.features.indexOf(node.split);
        if (index < 0 || !Array.isArray(node.children)) throw new Error('Invalid tree split');
        const childId = Math.fround(row[index]) < Math.fround(node.split_condition) ? node.yes : node.no;
        node = node.children.find((child) => child.nodeid === childId);
        if (!node) throw new Error('Missing child');
      }
      margin = Math.fround(margin + Math.fround(node.leaf));
    }
    return { margin, probability: 1 / (1 + Math.exp(-margin)) };
  });
}
if (require.main === module) {
  const [modelPath, rowsPath] = process.argv.slice(2);
  process.stdout.write(JSON.stringify(predict(JSON.parse(fs.readFileSync(modelPath)), JSON.parse(fs.readFileSync(rowsPath)))));
}
module.exports = { predict };
