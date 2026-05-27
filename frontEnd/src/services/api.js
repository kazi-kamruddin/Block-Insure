import axios from "axios";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("blockinsure_jwt");

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

export async function getWalletNonce(walletAddress) {
  const response = await api.get(`/api/auth/nonce/${walletAddress}`);
  return response.data;
}

export async function loginWithWallet(walletAddress, signature) {
  const response = await api.post("/api/auth/wallet-login", {
    walletAddress,
    signature,
  });

  return response.data;
}

export async function getCurrentUser() {
  const response = await api.get("/api/users/me");
  return response.data;
}

export function clearStoredSession() {
  localStorage.removeItem("blockinsure_jwt");
  localStorage.removeItem("blockinsure_wallet");
  localStorage.removeItem("blockinsure_user");
}