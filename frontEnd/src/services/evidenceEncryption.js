const ENCRYPTED_FILE_MAGIC = "BINSENC1";
import {
  getEvidenceDecryptionKey,
  getEvidenceEncryptionKey,
} from "./api";

const evidenceKeyStorageName = (cid) => `block-insure:evidence-key:${cid}`;

function readEvidenceKey(cid) {
  if (!cid) return null;
  const key = evidenceKeyStorageName(cid);
  return window.sessionStorage.getItem(key) || window.localStorage.getItem(key);
}

function writeSessionEvidenceKey(cid, value) {
  window.sessionStorage.setItem(evidenceKeyStorageName(cid), value);
}

function bytesToBase64(bytes) {
  let binary = "";

  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });

  return window.btoa(binary);
}

function pemToArrayBuffer(pem) {
  const base64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s/g, "");
  return base64ToBytes(base64).buffer;
}

export async function encryptEvidenceFile(file) {
  if (!file) {
    throw new Error("Evidence file is required");
  }

  if (!window.crypto?.subtle) {
    throw new Error("This browser does not support secure evidence encryption");
  }

  const key = await window.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const plaintext = await file.arrayBuffer();
  const ciphertext = new Uint8Array(
    await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext)
  );
  const rawKey = new Uint8Array(await window.crypto.subtle.exportKey("raw", key));
  const keyResponse = await getEvidenceEncryptionKey();
  const applicationKey = keyResponse?.key || keyResponse?.data?.key;

  if (!applicationKey?.publicKeyPem || !applicationKey?.keyId) {
    throw new Error("Application evidence-encryption key is unavailable");
  }

  const rsaPublicKey = await window.crypto.subtle.importKey(
    "spki",
    pemToArrayBuffer(applicationKey.publicKeyPem),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"]
  );
  const wrappedEvidenceKey = new Uint8Array(
    await window.crypto.subtle.encrypt(
      { name: "RSA-OAEP" },
      rsaPublicKey,
      rawKey
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
    keyBase64: bytesToBase64(rawKey),
    algorithm: "AES-256-GCM",
    originalName: file.name,
    originalMimeType: file.type || "application/octet-stream",
    wrappedEvidenceKey: bytesToBase64(wrappedEvidenceKey),
    keyId: applicationKey.keyId,
  };
}

export function storeEvidenceKey(cid, encryption) {
  if (!cid || !encryption?.keyBase64) return;

  writeSessionEvidenceKey(
    cid,
    JSON.stringify({
      algorithm: encryption.algorithm,
      keyBase64: encryption.keyBase64,
      originalName: encryption.originalName,
      originalMimeType: encryption.originalMimeType,
      storedAt: new Date().toISOString(),
    })
  );
}

function base64ToBytes(value) {
  const binary = window.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function hasLocalEvidenceKey(cid) {
  return Boolean(readEvidenceKey(cid));
}

async function calculateSHA256Hex(bytes) {
  const digest = new Uint8Array(
    await window.crypto.subtle.digest("SHA-256", bytes)
  );
  return Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function downloadDecryptedEvidence(
  cid,
  gatewayBase,
  documentId,
  expectedEncryptedSha256Hash = ""
) {
  let storedValue = readEvidenceKey(cid);

  if (!storedValue && documentId) {
    const keyResponse = await getEvidenceDecryptionKey(documentId);
    const recovered = keyResponse?.decryption || keyResponse?.data?.decryption;

    if (recovered?.keyBase64) {
      storedValue = JSON.stringify(recovered);
      writeSessionEvidenceKey(cid, storedValue);
    }
  }

  if (!storedValue) {
    throw new Error(
      "No recoverable key is available for this legacy evidence document"
    );
  }

  const keyRecord = JSON.parse(storedValue);
  const gateway = gatewayBase.endsWith("/") ? gatewayBase : `${gatewayBase}/`;
  const response = await fetch(`${gateway}${String(cid).replace("ipfs://", "")}`);

  if (!response.ok) {
    throw new Error("Could not download encrypted evidence from IPFS");
  }

  const payload = new Uint8Array(await response.arrayBuffer());
  const expectedHash = String(
    expectedEncryptedSha256Hash || keyRecord.encryptedSha256Hash || ""
  ).toLowerCase();

  if (expectedHash) {
    const downloadedHash = await calculateSHA256Hex(payload);
    if (downloadedHash !== expectedHash) {
      throw new Error("Downloaded evidence does not match its recorded SHA-256 hash");
    }
  }

  const magicLength = new TextEncoder().encode(ENCRYPTED_FILE_MAGIC).length;
  const magic = new TextDecoder().decode(payload.slice(0, magicLength));

  if (magic !== ENCRYPTED_FILE_MAGIC) {
    throw new Error("IPFS payload is not Block-Insure encrypted evidence");
  }

  const iv = payload.slice(magicLength, magicLength + 12);
  const ciphertext = payload.slice(magicLength + 12);
  const key = await window.crypto.subtle.importKey(
    "raw",
    base64ToBytes(keyRecord.keyBase64),
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );
  const plaintext = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );
  const objectUrl = URL.createObjectURL(
    new Blob([plaintext], {
      type: keyRecord.originalMimeType || "application/octet-stream",
    })
  );
  const anchor = document.createElement("a");

  anchor.href = objectUrl;
  anchor.download = keyRecord.originalName || "decrypted-evidence";
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}
