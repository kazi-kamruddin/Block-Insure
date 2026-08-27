const {
  JsonRpcProvider,
  Wallet,
  getBytes,
} = require("../../backEnd/node_modules/ethers");
const { getE2EConfig } = require("./environment");

function normalizeTransaction(transaction) {
  const request = { ...transaction };
  delete request.from;

  if (request.gas && !request.gasLimit) {
    request.gasLimit = request.gas;
  }
  delete request.gas;

  return request;
}

async function dispatchWalletRequest({ provider, wallet, chainId }, payload) {
  const method = payload?.method;
  const params = payload?.params || [];

  switch (method) {
    case "eth_requestAccounts":
    case "eth_accounts":
      return [wallet.address];
    case "eth_chainId":
      return `0x${chainId.toString(16)}`;
    case "net_version":
      return String(chainId);
    case "wallet_switchEthereumChain":
      return null;
    case "wallet_addEthereumChain":
      return null;
    case "personal_sign": {
      const message = params[0];
      return wallet.signMessage(
        typeof message === "string" && message.startsWith("0x")
          ? getBytes(message)
          : String(message)
      );
    }
    case "eth_sign": {
      const message = params[1];
      return wallet.signMessage(
        typeof message === "string" && message.startsWith("0x")
          ? getBytes(message)
          : String(message)
      );
    }
    case "eth_signTypedData_v4": {
      const typedData =
        typeof params[1] === "string" ? JSON.parse(params[1]) : params[1];
      const types = { ...typedData.types };
      delete types.EIP712Domain;
      return wallet.signTypedData(typedData.domain, types, typedData.message);
    }
    case "eth_sendTransaction": {
      const transaction = await wallet.sendTransaction(
        normalizeTransaction(params[0] || {})
      );
      return transaction.hash;
    }
    case "eth_signTransaction":
      return wallet.signTransaction(normalizeTransaction(params[0] || {}));
    default:
      return provider.send(method, params);
  }
}

async function createActorContext(browser, actorName, contextOptions = {}) {
  const environment = getE2EConfig();
  const actor = environment.actors[actorName];

  if (!actor) {
    throw new Error(`Unknown E2E actor: ${actorName}`);
  }

  const provider = new JsonRpcProvider(
    environment.rpcUrl,
    environment.chainId,
    { staticNetwork: true }
  );
  const wallet = new Wallet(actor.privateKey, provider);
  const context = await browser.newContext({
    baseURL: environment.appUrl,
    ...contextOptions,
  });

  await context.exposeBinding(
    "__blockInsureWalletRequest",
    async (_source, payload) =>
      dispatchWalletRequest({ provider, wallet, chainId: environment.chainId }, payload)
  );

  await context.addInitScript(
    ({ address, chainId }) => {
      const listeners = new Map();

      function emit(eventName, value) {
        for (const listener of listeners.get(eventName) || []) {
          listener(value);
        }
      }

      const ethereum = {
        isMetaMask: true,
        selectedAddress: address,
        chainId: `0x${chainId.toString(16)}`,
        networkVersion: String(chainId),
        request: (request) => window.__blockInsureWalletRequest(request),
        on(eventName, listener) {
          const eventListeners = listeners.get(eventName) || new Set();
          eventListeners.add(listener);
          listeners.set(eventName, eventListeners);
          return this;
        },
        removeListener(eventName, listener) {
          listeners.get(eventName)?.delete(listener);
          return this;
        },
        emit,
      };

      Object.defineProperty(window, "ethereum", {
        configurable: false,
        enumerable: true,
        writable: false,
        value: ethereum,
      });

      window.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", {
          detail: {
            info: {
              uuid: `block-insure-e2e-${address}`,
              name: "Block-Insure E2E Wallet",
              icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",
              rdns: "local.block-insure.e2e",
            },
            provider: ethereum,
          },
        })
      );
    },
    { address: wallet.address, chainId: environment.chainId }
  );

  const page = await context.newPage();
  return { actor, context, page, provider, wallet };
}

async function closeActor(actorSession) {
  await actorSession.context.close();
  actorSession.provider.destroy();
}

module.exports = { closeActor, createActorContext };
