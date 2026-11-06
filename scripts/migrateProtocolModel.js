// Read-only unless --apply is explicitly supplied. Does not reset/redeploy or
// change existing request identities. Both worker versions must be rolled out first.
const fs = require("node:fs"), path = require("node:path");
require("../backEnd/node_modules/dotenv").config({ path: path.resolve(__dirname, "../backEnd/.env"), quiet: true });
const { ethers } = require("../backEnd/node_modules/ethers");
const { loadProtocolArtifact, resolveRequestModel } = require("../oracle/runtimeProtocol");
async function main() {
  const args = require("./operatorArguments").parseOperatorArguments(process.argv.slice(2), {
    values: ["--manifest", "--expect"], switches: ["--apply", "--rollback"], required: ["--manifest"],
  });
  if (args["--apply"] && !/^0x[0-9a-f]{64}$/i.test(args["--expect"] || "")) throw new Error("Apply requires the exact expected model identity");
  const manifest = JSON.parse(fs.readFileSync(path.resolve(args["--manifest"]), "utf8"));
  if (![31337, 11155111, 84532].includes(Number(manifest.chainId))) throw new Error("Unsupported reviewed test network");
  const rpc = process.env.RPC_URL, url = new URL(rpc);
  if (Number(manifest.chainId) !== 31337 && (url.protocol !== "https:" || ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("Public testnet requires HTTPS RPC");
  const transport = new ethers.FetchRequest(rpc); transport.timeout = 10000;
  const provider = new ethers.JsonRpcProvider(transport);
  try {
    if ((await provider.getNetwork()).chainId !== BigInt(manifest.chainId)) throw new Error("RPC chain differs from manifest");
    const address = manifest.components?.InsuranceManager;
    if (!ethers.isAddress(address) || await provider.getCode(address) === "0x") throw new Error("Manifest manager is not deployed");
    const active = loadProtocolArtifact(), target = args["--rollback"] ? active.legacyModelIdentityHash : active.modelIdentityHash;
    const manager = new ethers.Contract(address, require("../backEnd/abi/InsuranceManager.json").abi, provider);
    const current = await manager.oracleModelVersion();
    resolveRequestModel(current); // Known historical v4 is a valid migration source; unknown identities fail closed.
    const summary = { chainId: String(manifest.chainId), manager: address, from: current, to: target,
      existingRequests: "Retain pinned model; deploy version-dispatch workers before changing the default", transactionSent: false };
    if (args["--apply"]) {
      if (args["--expect"].toLowerCase() !== current.toLowerCase()) throw new Error("--apply requires --expect <observed current identity>");
      if (current.toLowerCase() !== target.toLowerCase()) {
        const wallet = new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY, provider);
        require("./deploymentNetworkSafety").assertDeploymentSigner(manifest.chainId, wallet.address, { local: Number(manifest.chainId) === 31337 });
        const writable = manager.connect(wallet);
        if (!await writable.hasRole(await writable.ADMIN_ROLE(), wallet.address)) throw new Error("Configured signer lacks ADMIN_ROLE");
        if ((await manager.oracleModelVersion()).toLowerCase() !== current.toLowerCase()) throw new Error("Default changed during preparation");
        const receipt = await (await writable.updateOracleModelVersion(target)).wait();
        summary.transactionSent = true; summary.transactionHash = receipt.hash;
        if ((await manager.oracleModelVersion()).toLowerCase() !== target.toLowerCase()) throw new Error("Default identity readback failed");
      }
    }
    console.log(JSON.stringify(summary, null, 2));
  } finally { provider.destroy(); }
}
main().catch(() => { console.error("Protocol migration check failed. Inspect manifest, expected identity, RPC and private signer configuration. No reset was performed."); process.exitCode = 1; });
