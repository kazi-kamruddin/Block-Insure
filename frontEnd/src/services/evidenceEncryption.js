const ENCRYPTED_FILE_MAGIC = "BINSENC1";

function bytesToBase64(bytes) {
  let binary = "";

  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });

  return window.btoa(binary);
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
  };
}

export function storeEvidenceKey(cid, encryption) {
  if (!cid || !encryption?.keyBase64) return;

  window.localStorage.setItem(
    `block-insure:evidence-key:${cid}`,
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
  return Boolean(
    cid && window.localStorage.getItem(`block-insure:evidence-key:${cid}`)
  );
}

export async function downloadDecryptedEvidence(cid, gatewayBase) {
  const storedValue = window.localStorage.getItem(
    `block-insure:evidence-key:${cid}`
  );

  if (!storedValue) {
    throw new Error("This browser does not hold the evidence decryption key");
  }

  const keyRecord = JSON.parse(storedValue);
  const gateway = gatewayBase.endsWith("/") ? gatewayBase : `${gatewayBase}/`;
  const response = await fetch(`${gateway}${String(cid).replace("ipfs://", "")}`);

  if (!response.ok) {
    throw new Error("Could not download encrypted evidence from IPFS");
  }

  const payload = new Uint8Array(await response.arrayBuffer());
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
