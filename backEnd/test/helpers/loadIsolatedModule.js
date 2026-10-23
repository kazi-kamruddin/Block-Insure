const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

// Execute the actual service with explicit dependency doubles, not a duplicate
// implementation. Each load has independent module state and environment.
module.exports = (relativePath, doubles = {}, environment = {}) => {
  const filename = path.resolve(__dirname, "../..", relativePath);
  const localRequire = createRequire(filename);
  const isolated = { exports: {} };
  const resolve = (name) => Object.hasOwn(doubles, name) ? doubles[name] : localRequire(name);
  const execute = new Function("require", "module", "exports", "process", "__filename", "__dirname", fs.readFileSync(filename, "utf8"));
  execute(resolve, isolated, isolated.exports, { env: environment }, filename, path.dirname(filename));
  return isolated.exports;
};
