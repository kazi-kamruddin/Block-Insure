const test = require("node:test");
const assert = require("node:assert/strict");
const { closeActor } = require("../../e2e/support/walletBridge");
test("wallet fixture cleanup stops polling before closing and always attempts both resources", async () => {
  for (const failure of ["provider", "context", "none"]) {
    const calls = [];
    const closing = closeActor({ provider: { destroy: () => { calls.push("provider"); if (failure === "provider") throw new Error("provider close failed"); } },
      context: { close: async () => { calls.push("context"); if (failure === "context") throw new Error("context close failed"); } } });
    if (failure === "none") await closing; else await assert.rejects(closing, /close failed/);
    assert.deepEqual(calls, ["provider", "context"]);
  }
});
