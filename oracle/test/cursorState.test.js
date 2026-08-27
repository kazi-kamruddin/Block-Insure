const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { loadCursorState, persistCursorState } = require("../cursorState");

test("persists and restores a deployment-specific oracle cursor", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "block-insure-cursor-"));
  const filePath = path.join(directory, "cursor.json");

  try {
    persistCursorState({
      filePath,
      chainId: "31337",
      contractAddress: "0x0000000000000000000000000000000000000001",
      oracleInstanceId: "1",
      nextBlock: 42,
    });

    assert.deepEqual(
      loadCursorState({
        filePath,
        chainId: "31337",
        contractAddress: "0x0000000000000000000000000000000000000001",
        oracleInstanceId: "1",
        startBlock: 7,
      }),
      { nextBlock: 42, matched: true, found: true }
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("does not reuse a cursor from another deployment", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "block-insure-cursor-"));
  const filePath = path.join(directory, "cursor.json");

  try {
    persistCursorState({
      filePath,
      chainId: "31337",
      contractAddress: "0x0000000000000000000000000000000000000001",
      oracleInstanceId: "1",
      nextBlock: 42,
    });

    assert.deepEqual(
      loadCursorState({
        filePath,
        chainId: "11155111",
        contractAddress: "0x0000000000000000000000000000000000000001",
        oracleInstanceId: "1",
        startBlock: 7,
      }),
      { nextBlock: 7, matched: false, found: true }
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
