const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const v8 = require("node:v8");

function privateCheckpoint(directory, keyMaterial, scope) {
  const key = crypto.hkdfSync("sha256", Buffer.from(keyMaterial.slice(2), "hex"), Buffer.from(scope), "block-insure-paired-checkpoint/v1", 32);
  fs.mkdirSync(directory, { recursive: true });
  const fileFor = (name) => {
    if (!/^[a-z0-9.-]+$/.test(name)) throw new Error("Invalid paired checkpoint name");
    return path.join(directory, name + ".sealed");
  };
  return {
    read(name) {
      const file = fileFor(name);
      if (!fs.existsSync(file)) return null;
      const envelope = fs.readFileSync(file);
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, envelope.subarray(0, 12));
      decipher.setAAD(Buffer.from(name));
      decipher.setAuthTag(envelope.subarray(12, 28));
      return v8.deserialize(Buffer.concat([decipher.update(envelope.subarray(28)), decipher.final()]));
    },
    create(name, value) {
      const file = fileFor(name);
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(name));
      const ciphertext = Buffer.concat([cipher.update(v8.serialize(value)), cipher.final()]);
      const temporary = file + "." + crypto.randomUUID() + ".tmp";
      const stream = fs.openSync(temporary, "wx", 0o600);
      try {
        fs.writeFileSync(stream, Buffer.concat([iv, cipher.getAuthTag(), ciphertext]));
        fs.fsyncSync(stream);
      } finally { fs.closeSync(stream); }
      try { fs.linkSync(temporary, file); } finally { fs.unlinkSync(temporary); }
    },
  };
}

module.exports = { privateCheckpoint };
