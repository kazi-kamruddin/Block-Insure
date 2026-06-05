const axios = require("axios");
const FormData = require("form-data");

const uploadToPinata = async (fileBuffer, fileName, mimeType) => {
  if (!process.env.PINATA_JWT && (!process.env.PINATA_API_KEY || !process.env.PINATA_SECRET)) {
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
    }
  );

  return response.data.IpfsHash;
};

module.exports = {
  uploadToPinata,
};