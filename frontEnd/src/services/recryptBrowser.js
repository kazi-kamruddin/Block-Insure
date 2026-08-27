import initWasm from "@ironcorelabs/recrypt-wasm-binding/recrypt_wasm_binding_bg.wasm?init";
import * as binding from "@ironcorelabs/recrypt-wasm-binding/recrypt_wasm_binding_bg.js";

const instance = await initWasm({
  imports: { "./recrypt_wasm_binding_bg.js": binding },
});
binding.__wbg_set_wasm(instance.exports);
instance.exports.__wbindgen_start();

const publicKeyToArray = (publicKey) => ({
  x: Array.from(publicKey.x),
  y: Array.from(publicKey.y),
});

const publicKeyToBytes = (publicKey) => ({
  x: new Uint8Array(publicKey.x),
  y: new Uint8Array(publicKey.y),
});

const transformKeyToBytes = (transformKey) => ({
  toPublicKey: publicKeyToBytes(transformKey.toPublicKey),
  ephemeralPublicKey: publicKeyToBytes(transformKey.ephemeralPublicKey),
  encryptedTempKey: new Uint8Array(transformKey.encryptedTempKey),
  hashedTempKey: new Uint8Array(transformKey.hashedTempKey),
  publicSigningKey: new Uint8Array(transformKey.publicSigningKey),
  signature: new Uint8Array(transformKey.signature),
});

export class Api256 {
  constructor() {
    this.api = new binding.Api256();
  }

  transformBlocksToArray(transformBlocks) {
    return transformBlocks.map((block) => ({
      publicKey: publicKeyToArray(block.publicKey),
      encryptedTempKey: Array.from(block.encryptedTempKey),
      randomTransformPublicKey: publicKeyToArray(
        block.randomTransformPublicKey
      ),
      randomTransformEncryptedTempKey: Array.from(
        block.randomTransformEncryptedTempKey
      ),
    }));
  }

  transformBlocksToBytes(transformBlocks) {
    return transformBlocks.map((block) => ({
      publicKey: publicKeyToBytes(block.publicKey),
      encryptedTempKey: new Uint8Array(block.encryptedTempKey),
      randomTransformPublicKey: publicKeyToBytes(
        block.randomTransformPublicKey
      ),
      randomTransformEncryptedTempKey: new Uint8Array(
        block.randomTransformEncryptedTempKey
      ),
    }));
  }

  encryptedValueToArray(encryptedValue) {
    return {
      ephemeralPublicKey: publicKeyToArray(encryptedValue.ephemeralPublicKey),
      encryptedMessage: Array.from(encryptedValue.encryptedMessage),
      authHash: Array.from(encryptedValue.authHash),
      publicSigningKey: Array.from(encryptedValue.publicSigningKey),
      signature: Array.from(encryptedValue.signature),
      transformBlocks: this.transformBlocksToArray(
        encryptedValue.transformBlocks
      ),
    };
  }

  encryptedValueToBytes(encryptedValue) {
    return {
      ephemeralPublicKey: publicKeyToBytes(encryptedValue.ephemeralPublicKey),
      encryptedMessage: new Uint8Array(encryptedValue.encryptedMessage),
      authHash: new Uint8Array(encryptedValue.authHash),
      publicSigningKey: new Uint8Array(encryptedValue.publicSigningKey),
      signature: new Uint8Array(encryptedValue.signature),
      transformBlocks: this.transformBlocksToBytes(
        encryptedValue.transformBlocks
      ),
    };
  }

  generateKeyPair() {
    const keyPair = this.api.generateKeyPair();
    return {
      privateKey: new Uint8Array(keyPair.privateKey),
      publicKey: publicKeyToBytes(keyPair.publicKey),
    };
  }

  generateEd25519KeyPair() {
    const keyPair = this.api.generateEd25519KeyPair();
    return {
      privateKey: new Uint8Array(keyPair.privateKey),
      publicKey: new Uint8Array(keyPair.publicKey),
    };
  }

  generateTransformKey(fromPrivateKey, toPublicKey, privateSigningKey) {
    return transformKeyToBytes(
      this.api.generateTransformKey(
        fromPrivateKey,
        publicKeyToArray(toPublicKey),
        privateSigningKey
      )
    );
  }

  encrypt(plaintext, toPublicKey, privateSigningKey) {
    return this.encryptedValueToBytes(
      this.api.encrypt(
        plaintext,
        publicKeyToArray(toPublicKey),
        privateSigningKey
      )
    );
  }

  decrypt(encryptedValue, privateKey) {
    return this.api.decrypt(
      this.encryptedValueToArray(encryptedValue),
      privateKey
    );
  }
}
