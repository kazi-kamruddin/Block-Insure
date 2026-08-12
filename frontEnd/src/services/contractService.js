import { ethers } from "ethers";
import InsuranceManagerArtifact from "../abi/InsuranceManager.json";
import policyBenefitsAbi from "../abi/policyBenefitsAbi";

const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS;
const POLICY_BENEFITS_ADDRESS = import.meta.env.VITE_POLICY_BENEFITS_ADDRESS;
const RPC_URL = import.meta.env.VITE_RPC_URL || "http://127.0.0.1:8545";

export const REQUIRED_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID || 31337);

const ABI = InsuranceManagerArtifact.abi || InsuranceManagerArtifact;

export const CLAIM_STATUS = {
  0: "SUBMITTED",
  1: "DUPLICATE_CHECKED",
  2: "FRAUD_FLAGGED",
  3: "ORACLE_PENDING",
  4: "ORACLE_VERIFIED",
  5: "ORACLE_FAILED",
  6: "MANUAL_REVIEW",
  7: "APPROVED",
  8: "REJECTED",
  9: "SETTLED",
  10: "CLOSED",
};

export const POLICY_STATUS = {
  0: "PENDING_PAYMENT",
  1: "ACTIVE",
  2: "GRACE_PERIOD",
  3: "LAPSED",
  4: "CANCELLED",
  5: "EXPIRED",
  6: "RENEWED",
};

function requireContractAddress() {
  if (!CONTRACT_ADDRESS) {
    throw new Error("Missing VITE_CONTRACT_ADDRESS in frontEnd/.env");
  }

  return CONTRACT_ADDRESS;
}

export function getContractAddress() {
  return requireContractAddress();
}

export function getReadProvider() {
  return new ethers.JsonRpcProvider(RPC_URL);
}

export function getReadOnlyContract() {
  return new ethers.Contract(requireContractAddress(), ABI, getReadProvider());
}

export async function getContractBalance() {
  return getReadProvider().getBalance(requireContractAddress());
}

export async function getBrowserProvider() {
  if (!window.ethereum) {
    throw new Error("MetaMask is not installed");
  }

  return new ethers.BrowserProvider(window.ethereum);
}

export async function assertCorrectNetwork() {
  const provider = await getBrowserProvider();
  const network = await provider.getNetwork();
  const activeChainId = Number(network.chainId);

  if (activeChainId !== REQUIRED_CHAIN_ID) {
    throw new Error(
      `Wrong MetaMask network. Expected chain ID ${REQUIRED_CHAIN_ID}, but got ${activeChainId}. Switch MetaMask to Hardhat Localhost.`
    );
  }
}

export async function getSigner() {
  await assertCorrectNetwork();

  const provider = await getBrowserProvider();
  return provider.getSigner();
}

export async function getWalletContract() {
  const signer = await getSigner();
  return new ethers.Contract(requireContractAddress(), ABI, signer);
}

export async function getConnectedWalletAddress() {
  const signer = await getSigner();
  return signer.getAddress();
}

export function formatEth(value) {
  if (value === undefined || value === null) return "0";
  return ethers.formatEther(value);
}

export function parseEth(value) {
  return ethers.parseEther(String(value || "0"));
}

export function toBytes32FromBackendSha256(hash) {
  if (!hash) {
    throw new Error("Missing SHA-256 document hash");
  }

  const normalizedHash = hash.startsWith("0x") ? hash : `0x${hash}`;

  if (!ethers.isHexString(normalizedHash, 32)) {
    throw new Error("Document hash must be a 32-byte SHA-256 value");
  }

  return normalizedHash;
}

export function hashInvoiceNumber(invoiceNumber) {
  if (!invoiceNumber) {
    throw new Error("Invoice number is required");
  }

  return ethers.keccak256(ethers.toUtf8Bytes(invoiceNumber));
}

export function toUnixSecondsFromDateInput(dateValue) {
  if (!dateValue) {
    throw new Error("Date is required");
  }

  const milliseconds = new Date(dateValue).getTime();

  if (Number.isNaN(milliseconds)) {
    throw new Error("Invalid date value");
  }

  return Math.floor(milliseconds / 1000);
}

function requirePolicyBenefitsAddress() {
  if (!POLICY_BENEFITS_ADDRESS) {
    throw new Error(
      "Policy benefits module is not configured. Run the local deployment workflow."
    );
  }
  return POLICY_BENEFITS_ADDRESS;
}

export async function getPolicyBenefitsWalletContract() {
  const signer = await getSigner();
  return new ethers.Contract(
    requirePolicyBenefitsAddress(),
    policyBenefitsAbi,
    signer
  );
}

export async function setPolicyBeneficiaries(policyId, beneficiaries) {
  const contract = await getPolicyBenefitsWalletContract();
  return contract.setBeneficiaries(
    policyId,
    beneficiaries.map((beneficiary) => beneficiary.account),
    beneficiaries.map((beneficiary) => Math.round(beneficiary.sharePercent * 100))
  );
}

export async function requestPolicyBenefit(policyId, benefitType, evidenceHash) {
  const contract = await getPolicyBenefitsWalletContract();
  return contract.requestBenefit(policyId, benefitType, evidenceHash);
}

export async function cancelPolicy(policyId) {
  const contract = await getWalletContract();
  return contract.cancelPolicy(policyId);
}

export function getStatusLabel(statusValue) {
  const numericStatus = Number(statusValue);
  return CLAIM_STATUS[numericStatus] || `UNKNOWN_${statusValue}`;
}

export function getPolicyStatusLabel(statusValue) {
  const numericStatus = Number(statusValue);
  return POLICY_STATUS[numericStatus] || `UNKNOWN_${statusValue}`;
}

export function parseTransactionError(error) {
  const rawMessage = String(
    error?.shortMessage ||
      error?.reason ||
      error?.response?.data?.message ||
      error?.message ||
      "Transaction failed"
  );
  const lowerMessage = rawMessage.toLowerCase();
  const code = error?.code || error?.info?.error?.code;

  if (code === 4001 || lowerMessage.includes("user rejected")) {
    return "MetaMask rejected the transaction.";
  }

  if (lowerMessage.includes("wrong metamask network") || lowerMessage.includes("chain id")) {
    return rawMessage;
  }

  if (lowerMessage.includes("metamask is not installed") || lowerMessage.includes("missing provider")) {
    return "Wallet is missing. Install or unlock MetaMask.";
  }

  if (lowerMessage.includes("access denied") || lowerMessage.includes("role")) {
    return "Your backend or on-chain role is missing for this action.";
  }

  if (lowerMessage.includes("policy is not active")) {
    return "This policy is inactive, expired, lapsed, or premium-overdue.";
  }

  if (lowerMessage.includes("premium") || lowerMessage.includes("lapsed")) {
    return rawMessage.includes("Incorrect") ? "Incorrect premium amount." : rawMessage;
  }

  if (lowerMessage.includes("duplicate")) {
    return "Duplicate claim evidence was detected.";
  }

  if (lowerMessage.includes("insufficient contract balance")) {
    return "Insufficient reserve for settlement.";
  }

  if (lowerMessage.includes("already settled")) {
    return "This claim is already settled.";
  }

  if (lowerMessage.includes("already closed")) {
    return "This claim is already closed.";
  }

  if (lowerMessage.includes("oracle") && lowerMessage.includes("not")) {
    return "Oracle result is not ready for this action.";
  }

  return rawMessage;
}

export async function payPolicyPremium(policyId, premiumWei) {
  const contract = await getWalletContract();
  return contract.payPremium(policyId, { value: premiumWei });
}

export async function reinstatePolicy(policyId, premiumWei) {
  const contract = await getWalletContract();
  return contract.reinstatePolicy(policyId, { value: premiumWei });
}

export function getEtherscanTxUrl(txHash) {
  if (!txHash) return "#";

  const isLocal =
    RPC_URL.includes("127.0.0.1") || RPC_URL.includes("localhost");

  if (isLocal) {
    return "#";
  }

  return `https://sepolia.etherscan.io/tx/${txHash}`;
}
