const Recrypt = require("@ironcorelabs/recrypt-node-binding");
const { serializeCryptoObject } = require("../services/preTransformService");

const api = new Recrypt.Api256();
const signingKeys = api.generateEd25519KeyPair();

process.stdout.write(`${serializeCryptoObject(signingKeys)}\n`);
