const fs = require("node:fs");
const path = require("node:path");

const normalize = (value) => String(value || "").trim().toLowerCase();
const isDisabled = (filePath) => normalize(filePath) === "disabled";

const loadCursorState = ({
  filePath,
  chainId,
  contractAddress,
  oracleInstanceId,
  startBlock,
}) => {
  if (isDisabled(filePath) || !fs.existsSync(filePath)) {
    return { nextBlock: startBlock, matched: false, found: false };
  }

  const state = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const matched =
    String(state.chainId) === String(chainId) &&
    normalize(state.contractAddress) === normalize(contractAddress) &&
    String(state.oracleInstanceId) === String(oracleInstanceId);

  if (!matched || !Number.isInteger(Number(state.nextBlock))) {
    return { nextBlock: startBlock, matched: false, found: true };
  }

  return {
    nextBlock: Math.max(Number(startBlock), Number(state.nextBlock)),
    matched: true,
    found: true,
  };
};

const persistCursorState = ({
  filePath,
  chainId,
  contractAddress,
  oracleInstanceId,
  nextBlock,
}) => {
  if (isDisabled(filePath)) return;

  const directory = path.dirname(filePath);
  const temporaryFile = `${filePath}.tmp`;
  const state = {
    chainId: String(chainId),
    contractAddress,
    oracleInstanceId: String(oracleInstanceId),
    nextBlock: Number(nextBlock),
    updatedAt: new Date().toISOString(),
  };

  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(temporaryFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryFile, filePath);
};

module.exports = { loadCursorState, persistCursorState };
