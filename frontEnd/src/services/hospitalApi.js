import axios from "axios";

const storageKey = "blockinsure_hospital_session";
export const hospitalApi = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? window.location.origin : "http://localhost:5000"),
  timeout: 30000,
});
export const readHospitalSession = () => sessionStorage.getItem(storageKey);
export const clearHospitalSession = () => sessionStorage.removeItem(storageKey);
hospitalApi.interceptors.request.use((config) => {
  const token = readHospitalSession();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
hospitalApi.interceptors.response.use((response) => response, (error) => {
  if ([401, 403].includes(error.response?.status) && readHospitalSession()) {
    clearHospitalSession();
    window.dispatchEvent(new Event("blockinsure:hospital-session-expired"));
  }
  return Promise.reject(error);
});
export const loginHospital = async (credentials) => {
  const { data } = await hospitalApi.post("/api/hospital-staff/login", credentials);
  sessionStorage.setItem(storageKey, data.token);
  return data;
};
export const getHospitalSession = async () => (await hospitalApi.get("/api/hospital-staff/session")).data;
export const logoutHospital = async () => {
  await hospitalApi.post("/api/hospital-staff/logout");
  clearHospitalSession();
};
