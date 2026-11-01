// Public-testnet operator guard. Local development identities must stay local.
const { HDNodeWallet } = require("../backEnd/node_modules/ethers");
const { HARDHAT_NETWORK_MNEMONIC } = require("../contracts/node_modules/hardhat/internal/core/config/default-config");
let localAddresses;
function assertDeploymentSigner(chainId, address, { local = false } = {}) {
  const chain = BigInt(chainId);
  if (local) {
    if (chain !== 31337n) throw new Error("Local deployment requires chain 31337");
    return;
  }
  if (![11155111n, 84532n].includes(chain)) throw new Error("Unsupported public test network");
  localAddresses ||= new Set(Array.from({ length: 20 }, (_, index) =>
    HDNodeWallet.fromPhrase(HARDHAT_NETWORK_MNEMONIC, undefined, `m/44'/60'/0'/0/${index}`).address.toLowerCase()));
  if (localAddresses.has(String(address).toLowerCase())) throw new Error("Use a dedicated public-testnet signer, not a known local development account");
}
module.exports = { assertDeploymentSigner };
