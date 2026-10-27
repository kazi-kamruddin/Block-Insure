// Fail before any provider or signer is created. A misspelled rollback flag
// must never silently select the opposite operation alongside --apply.
function parseOperatorArguments(args, { values, switches = [], required = [] }) {
  const parsed = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!values.includes(flag) && !switches.includes(flag)) throw new Error("Unknown operator argument");
    if (Object.hasOwn(parsed, flag)) throw new Error("Duplicate operator argument");
    if (switches.includes(flag)) { parsed[flag] = true; continue; }
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error("Missing operator argument value");
    parsed[flag] = value;
  }
  if (required.some((flag) => !parsed[flag])) throw new Error("Missing required operator argument");
  return parsed;
}
module.exports = { parseOperatorArguments };
