import { Api256 } from "./recryptBrowser";
import {
  getEvidenceDecryptionKey,
  getEvidenceEncryptionKey,
  getRecipientEncryptionIdentity,
  grantDocumentAccess,
  registerEvidenceEncryptionIdentity,
} from "./api";
import { getEvidenceRegistryWalletContract } from "./contractService";

const ENCRYPTED_FILE_MAGIC = "BINSENC2";
const SCHEME_VERSION = "RECRYPT-RS-0.15+A256GCM";
const DATABASE_NAME = "block-insure-private-keys";
const STORE_NAME = "evidence-identities";
const api = new Api256();

function bytesToBase64(bytes) {
  let binary = "";
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return window.btoa(binary);
}

function base64ToBytes(value) {
  const binary = window.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeCryptoObject(value) {
  if (value instanceof Uint8Array) return `b64:${bytesToBase64(value)}`;
  if (Array.isArray(value)) return value.map(encodeCryptoObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, encodeCryptoObject(child)])
    );
  }
  return value;
}

function decodeCryptoObject(value) {
  if (typeof value === "string" && value.startsWith("b64:")) {
    return base64ToBytes(value.slice(4));
  }
  if (Array.isArray(value)) return value.map(decodeCryptoObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, decodeCryptoObject(child)])
    );
  }
  return value;
}

const serializeCryptoObject = (value) => JSON.stringify(encodeCryptoObject(value));
const deserializeCryptoObject = (value) =>
  decodeCryptoObject(typeof value === "string" ? JSON.parse(value) : value);

function openIdentityDatabase() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "walletAddress" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readIdentity(walletAddress) {
  const database = await openIdentityDatabase();
  return new Promise((resolve, reject) => {
    const request = database
      .transaction(STORE_NAME, "readonly")
      .objectStore(STORE_NAME)
      .get(walletAddress.toLowerCase());
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function writeIdentity(identity) {
  const database = await openIdentityDatabase();
  return new Promise((resolve, reject) => {
    const request = database
      .transaction(STORE_NAME, "readwrite")
      .objectStore(STORE_NAME)
      .put(identity);
    request.onsuccess = () => resolve(identity);
    request.onerror = () => reject(request.error);
  });
}

async function deriveRecoveryKey(walletAddress, signer) {
  const signature = await signer.signMessage(
    `Block-Insure evidence key recovery\nWallet: ${walletAddress.toLowerCase()}\nPurpose: decrypt my client-side identity backup`
  );
  return window.crypto.subtle.importKey(
    "raw",
    await window.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`BLOCK_INSURE_RECOVERY_V1:${signature}`)
    ),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

async function createEncryptedIdentityBackup(identity, signer) {
  const recoveryKey = await deriveRecoveryKey(identity.walletAddress, signer);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(
    JSON.stringify({
      keyPair: identity.keyPair,
      signingKeyPair: identity.signingKeyPair,
      createdAt: identity.createdAt,
    })
  );
  const ciphertext = new Uint8Array(
    await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, recoveryKey, plaintext)
  );
  return JSON.stringify({
    version: 1,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
  });
}

async function recoverIdentityBackup(walletAddress, encryptedBackup, signer) {
  const envelope = JSON.parse(encryptedBackup);
  if (envelope.version !== 1) throw new Error("Unsupported evidence identity backup");
  const recoveryKey = await deriveRecoveryKey(walletAddress, signer);
  const plaintext = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(envelope.iv) },
    recoveryKey,
    base64ToBytes(envelope.ciphertext)
  );
  const recovered = JSON.parse(new TextDecoder().decode(plaintext));
  return {
    walletAddress,
    keyPair: recovered.keyPair,
    signingKeyPair: recovered.signingKeyPair,
    createdAt: recovered.createdAt,
  };
}

export async function ensureEvidenceIdentity(walletAddress) {
  if (!walletAddress) throw new Error("Wallet is required for evidence encryption");
  const normalizedWallet = walletAddress.toLowerCase();
  let identity = await readIdentity(normalizedWallet);
  const remote = await getEvidenceEncryptionKey();
  const remoteKey = remote?.key || remote?.data?.key || {};
  const registry = await getEvidenceRegistryWalletContract();
  const signer = registry.runner;

  if (!identity) {
    if (remoteKey.registered) {
      if (!remoteKey.encryptedPrivateKeyBackup) {
        throw new Error("This evidence identity has no recoverable encrypted backup");
      }
      identity = await recoverIdentityBackup(
        normalizedWallet,
        remoteKey.encryptedPrivateKeyBackup,
        signer
      );
      identity.version = Number(remoteKey.version);
      await writeIdentity(identity);
      return identity;
    }
    identity = {
      walletAddress: normalizedWallet,
      keyPair: serializeCryptoObject(api.generateKeyPair()),
      signingKeyPair: serializeCryptoObject(api.generateEd25519KeyPair()),
      version: 0,
      createdAt: new Date().toISOString(),
    };
    await writeIdentity(identity);
  }
  const localPublicKey = serializeCryptoObject(
    deserializeCryptoObject(identity.keyPair).publicKey
  );
  if (remoteKey.registered && remoteKey.publicKey !== localPublicKey) {
    throw new Error("The backend identity does not match this browser's protected key");
  }
  if (remoteKey.registered && Number(remoteKey.version) === Number(identity.version)) {
    return identity;
  }
  if (remoteKey.registered) {
    identity.version = Number(remoteKey.version);
    await writeIdentity(identity);
    return identity;
  }
  if (!remoteKey.registered) {
    const keyPair = deserializeCryptoObject(identity.keyPair);
    const signingKeyPair = deserializeCryptoObject(identity.signingKeyPair);
    const publicKeyBytes = new Uint8Array([
      ...keyPair.publicKey.x,
      ...keyPair.publicKey.y,
    ]);
    let identityAlreadyOnChain;
    try {
      const onChainIdentity = await registry.getEncryptionIdentity(normalizedWallet);
      identityAlreadyOnChain =
        onChainIdentity.revokedAt === 0n &&
        onChainIdentity.publicKey.toLowerCase() ===
          `0x${Array.from(publicKeyBytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
    } catch {
      identityAlreadyOnChain = false;
    }
    if (!identityAlreadyOnChain) {
      const transaction = await registry.registerEncryptionIdentity(
        publicKeyBytes,
        signingKeyPair.publicKey,
        `0x${await calculateSHA256Hex(new TextEncoder().encode(SCHEME_VERSION))}`
      );
      await transaction.wait();
    }
    const encryptedPrivateKeyBackup = await createEncryptedIdentityBackup(
      identity,
      signer
    );
    const registration = await registerEvidenceEncryptionIdentity({
      publicKey: localPublicKey,
      signingPublicKey: serializeCryptoObject(signingKeyPair.publicKey),
      schemeVersion: SCHEME_VERSION,
      encryptedPrivateKeyBackup,
    });
    identity.version = Number(
      registration?.identity?.version || registration?.data?.identity?.version
    );
    await writeIdentity(identity);
  }
  return identity;
}

async function calculateSHA256Hex(bytes) {
  const digest = new Uint8Array(await window.crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function encryptEvidenceFile(file, context) {
  if (!file) throw new Error("Evidence file is required");
  if (!window.crypto?.subtle || !window.indexedDB) {
    throw new Error("This browser does not support secure local evidence keys");
  }
  const { claimId, claimVersion, uploader, evidenceType } = context || {};
  if (!claimId || !claimVersion || !uploader || !evidenceType) {
    throw new Error("Claim-bound authenticated evidence metadata is required");
  }
  const identity = await ensureEvidenceIdentity(uploader);
  const keyPair = deserializeCryptoObject(identity.keyPair);
  const signingKeyPair = deserializeCryptoObject(identity.signingKeyPair);
  const rawKey = window.crypto.getRandomValues(new Uint8Array(32));
  const encryptedKeyCapsule = api.encrypt(
    rawKey,
    keyPair.publicKey,
    signingKeyPair.privateKey
  );
  const associatedData = JSON.stringify({
    claimId: String(claimId),
    claimVersion: Number(claimVersion),
    uploader: uploader.toLowerCase(),
    evidenceType,
  });
  const additionalData = new TextEncoder().encode(associatedData);
  const aesKey = await window.crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData },
      aesKey,
      await file.arrayBuffer()
    )
  );
  const magic = new TextEncoder().encode(ENCRYPTED_FILE_MAGIC);
  const payload = new Uint8Array(magic.length + iv.length + ciphertext.length);
  payload.set(magic, 0);
  payload.set(iv, magic.length);
  payload.set(ciphertext, magic.length + iv.length);

  return {
    encryptedFile: new File([payload], `${file.name}.binsenc`, {
      type: "application/octet-stream",
    }),
    algorithm: "AES-256-GCM",
    originalName: file.name,
    originalMimeType: file.type || "application/octet-stream",
    keyCapsule: serializeCryptoObject(encryptedKeyCapsule),
    associatedData,
    encryptionIdentityVersion: identity.version,
    schemeVersion: SCHEME_VERSION,
  };
}

export function storeEvidenceKey() {
  // Private encryption identities live only in IndexedDB; raw AES keys are never persisted.
}

export function hasLocalEvidenceKey() {
  return Boolean(window.indexedDB && localStorage.getItem("blockinsure_wallet"));
}

export async function createEvidenceDelegation(documentId, granteeWallet, claimId) {
  const ownerWallet = localStorage.getItem("blockinsure_wallet");
  const ownerIdentity = await readIdentity(ownerWallet || "");
  if (!ownerIdentity) throw new Error("This browser does not hold the evidence-owner key");
  const recipientResponse = await getRecipientEncryptionIdentity(granteeWallet, claimId);
  const recipient = recipientResponse?.identity || recipientResponse?.data?.identity;
  if (!recipient?.publicKey) throw new Error("Assigned auditor has no encryption identity");
  const ownerKeys = deserializeCryptoObject(ownerIdentity.keyPair);
  const signingKeys = deserializeCryptoObject(ownerIdentity.signingKeyPair);
  const transformKey = api.generateTransformKey(
    ownerKeys.privateKey,
    deserializeCryptoObject(recipient.publicKey),
    signingKeys.privateKey
  );
  return grantDocumentAccess(documentId, {
    granteeWallet,
    transformKey: serializeCryptoObject(transformKey),
  });
}

export async function downloadDecryptedEvidence(
  cid,
  gatewayBase,
  documentId,
  expectedEncryptedSha256Hash = ""
) {
  if (!documentId) throw new Error("Document identity is required for protected evidence");
  const walletAddress = localStorage.getItem("blockinsure_wallet");
  const identity = await readIdentity(walletAddress || "");
  if (!identity) throw new Error("This browser does not hold the assigned encryption key");
  const responseEnvelope = await getEvidenceDecryptionKey(documentId);
  const envelope = responseEnvelope?.decryption || responseEnvelope?.data?.decryption;
  const privateKey = deserializeCryptoObject(identity.keyPair).privateKey;
  const rawKey = api.decrypt(deserializeCryptoObject(envelope.keyCapsule), privateKey);
  const gateway = gatewayBase.endsWith("/") ? gatewayBase : `${gatewayBase}/`;
  const response = await fetch(`${gateway}${String(cid).replace("ipfs://", "")}`);
  if (!response.ok) throw new Error("Could not download encrypted evidence from IPFS");
  const payload = new Uint8Array(await response.arrayBuffer());
  const expectedHash = String(expectedEncryptedSha256Hash || envelope.encryptedSha256Hash || "").toLowerCase();
  if (expectedHash && (await calculateSHA256Hex(payload)) !== expectedHash) {
    throw new Error("Downloaded evidence does not match its transparency receipt");
  }
  if ((await calculateSHA256Hex(new TextEncoder().encode(envelope.associatedData))) !== envelope.associatedDataHash) {
    throw new Error("Evidence associated data was modified");
  }
  const magicLength = new TextEncoder().encode(ENCRYPTED_FILE_MAGIC).length;
  if (new TextDecoder().decode(payload.slice(0, magicLength)) !== ENCRYPTED_FILE_MAGIC) {
    throw new Error("Evidence encryption version is not supported");
  }
  const iv = payload.slice(magicLength, magicLength + 12);
  const ciphertext = payload.slice(magicLength + 12);
  const aesKey = await window.crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );
  const plaintext = await window.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(envelope.associatedData),
    },
    aesKey,
    ciphertext
  );
  const objectUrl = URL.createObjectURL(
    new Blob([plaintext], { type: envelope.originalMimeType || "application/octet-stream" })
  );
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = envelope.originalName || "decrypted-evidence";
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}

export { deserializeCryptoObject, serializeCryptoObject };
