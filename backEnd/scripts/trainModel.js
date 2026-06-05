require("dotenv").config();

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const MockHospitalRecord = require("../models/MockHospitalRecord");
const { trainModelParams } = require("../services/modelTrainingService");

const MODEL_PARAMS_PATH = path.join(__dirname, "..", "model-params.json");

const trainModel = async () => {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing in .env");
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const records = await MockHospitalRecord.find().lean();

  if (records.length === 0) {
    throw new Error("No MockHospitalRecord documents found. Run npm run seed:mock first.");
  }

  const modelParams = trainModelParams(records, {
    source: "MongoDB MockHospitalRecord collection",
  });

  fs.writeFileSync(
    MODEL_PARAMS_PATH,
    `${JSON.stringify(modelParams, null, 2)}\n`,
    "utf8"
  );

  console.log(`Model parameters saved: ${MODEL_PARAMS_PATH}`);
  console.log(`Training records: ${modelParams.trainingSet.totalRecords}`);
  console.log(`Fraud records: ${modelParams.trainingSet.fraudRecords}`);
  console.log(`Legitimate records: ${modelParams.trainingSet.legitimateRecords}`);

  await mongoose.connection.close();
};

trainModel().catch(async (error) => {
  console.error("Model training failed:", error.message);
  await mongoose.connection.close();
  process.exit(1);
});
