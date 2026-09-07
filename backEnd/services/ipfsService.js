const axios = require("axios");
const FormData = require("form-data");

const PINATA_TIMEOUT_MS = Math.max(
  1_000,
  Number(process.env.PINATA_TIMEOUT_MS) || 30_000
);

const uploadToPinata = async (fileBuffer, fileName, mimeType) => {
  if (
    !process.env.PINATA_JWT &&
    (!process.env.PINATA_API_KEY || !process.env.PINATA_SECRET)
  ) {
    const error = new Error("Pinata credentials are missing");
    error.statusCode = 500;
    throw error;
  }

  const formData = new FormData();

  formData.append("file", fileBuffer, {
    filename: fileName,
    contentType: mimeType,
  });

  const headers = {
    ...formData.getHeaders(),
  };

  if (process.env.PINATA_JWT) {
    headers.Authorization = `Bearer ${process.env.PINATA_JWT}`;
  } else {
    headers.pinata_api_key = process.env.PINATA_API_KEY;
    headers.pinata_secret_api_key = process.env.PINATA_SECRET;
  }

  const response = await axios.post(
    "https://api.pinata.cloud/pinning/pinFileToIPFS",
    formData,
    {
      headers,
      maxBodyLength: Infinity,
      timeout: PINATA_TIMEOUT_MS,
    }
  );

  return response.data.IpfsHash;
};

const unpinFromPinata = async (ipfsCID) => {
  if (!ipfsCID) return false;

  const headers = {};

  if (process.env.PINATA_JWT) {
    headers.Authorization = `Bearer ${process.env.PINATA_JWT}`;
  } else if (process.env.PINATA_API_KEY && process.env.PINATA_SECRET) {
    headers.pinata_api_key = process.env.PINATA_API_KEY;
    headers.pinata_secret_api_key = process.env.PINATA_SECRET;
  } else {
    return false;
  }

  await axios.delete(`https://api.pinata.cloud/pinning/unpin/${ipfsCID}`, {
    headers,
    timeout: PINATA_TIMEOUT_MS,
  });

  return true;
};

module.exports = {
  unpinFromPinata,
  uploadToPinata,
};
