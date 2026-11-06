// Synthetic local delegated-wallet execution. Real nested EVM CALLs, but not a
// MetaMask/EIP-7702 acceptance test. Never installs code on a public network.
const { ethers } = require("../../backEnd/node_modules/ethers");
const { getE2EConfig } = require("./environment");
async function enableLocalSponsoredWallet(session) {
  const config = getE2EConfig(), url = new URL(config.rpcUrl);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) ||
      BigInt(await session.provider.send("eth_chainId", [])) !== 31337n) throw Error("Sponsored fixture requires an isolated local chain");
  const relayer = new ethers.Wallet(config.actors.beneficiary.privateKey, session.provider);
  if (await session.provider.getCode(session.wallet.address) !== "0x") throw Error("Fixture refuses to overwrite existing wallet code");
  const source = `pragma solidity ^0.8.26;
    contract LocalSponsoredWallet {
      function execute(address target, bytes calldata data) external payable returns (bytes memory) {
        require(msg.sender == address(bytes20(hex"${relayer.address.slice(2)}")), "wrong synthetic relayer");
        (bool ok, bytes memory result) = target.call{value: msg.value}(data);
        if (!ok) assembly { revert(add(result, 32), mload(result)) }
        return result;
      }
      receive() external payable {}
    }`;
  const compiled = JSON.parse(require("../../contracts/node_modules/solc").compile(JSON.stringify({ language: "Solidity",
    sources: { "LocalSponsoredWallet.sol": { content: source } }, settings: { evmVersion: "cancun",
      outputSelection: { "*": { "*": ["abi", "evm.deployedBytecode.object"] } } } })));
  if (compiled.errors?.some(error => error.severity === "error")) throw Error("Synthetic wallet compilation failed");
  const artifact = compiled.contracts["LocalSponsoredWallet.sol"].LocalSponsoredWallet;
  const iface = new ethers.Interface(artifact.abi), transactions = [];
  await session.provider.send("hardhat_setCode", [session.wallet.address, "0x" + artifact.evm.deployedBytecode.object]);
  session.setTransactionRelay(async request => {
    const tx = await relayer.sendTransaction({ to: session.wallet.address, value: request.value || 0,
      data: iface.encodeFunctionData("execute", [request.to, request.data || "0x"]) });
    transactions.push(tx.hash); return tx.hash;
  });
  return { transactions, relayerAddress: relayer.address, async restore() {
    session.setTransactionRelay(null); await session.provider.send("hardhat_setCode", [session.wallet.address, "0x"]);
  } };
}
module.exports = { enableLocalSponsoredWallet };
