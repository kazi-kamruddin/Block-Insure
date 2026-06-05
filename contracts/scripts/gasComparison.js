const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");

const RECORD_COUNTS = [10, 25, 50, 100, 200, 500];

const getHash = (label) => {
  return ethers.keccak256(ethers.toUtf8Bytes(label));
};

const buildHashes = (count) => {
  return Array.from({ length: count }, (_, index) =>
    getHash(`block-insure-document-${count}-${index}`)
  );
};

const formatPercent = (value) => {
  return Number(value.toFixed(2));
};

const measureIndividualHashGas = async (GasTestContract, count) => {
  const gasTestContract = await GasTestContract.deploy();
  await gasTestContract.waitForDeployment();

  const tx = await gasTestContract.storeHashes(buildHashes(count));
  const receipt = await tx.wait();

  return receipt.gasUsed;
};

const measureMerkleRootGas = async (GasTestContract, count) => {
  const gasTestContract = await GasTestContract.deploy();
  await gasTestContract.waitForDeployment();

  const tx = await gasTestContract.storeMerkleRoot(
    getHash(`block-insure-merkle-root-${count}`)
  );
  const receipt = await tx.wait();

  return receipt.gasUsed;
};

const buildGasComparison = async () => {
  const GasTestContract = await ethers.getContractFactory("GasTestContract");
  const rows = [];

  for (const records of RECORD_COUNTS) {
    const individualGas = await measureIndividualHashGas(
      GasTestContract,
      records
    );
    const merkleGas = await measureMerkleRootGas(GasTestContract, records);
    const gasSaved = individualGas - merkleGas;
    const savingsPercent =
      individualGas === 0n
        ? 0
        : (Number(gasSaved) / Number(individualGas)) * 100;

    rows.push({
      records,
      individual_gas: individualGas.toString(),
      merkle_gas: merkleGas.toString(),
      gas_saved: gasSaved.toString(),
      savings_percent: formatPercent(savingsPercent),
    });
  }

  return rows;
};

const writeCsv = (rows) => {
  const outputPath = path.join(__dirname, "..", "gas-comparison-results.csv");
  const header =
    "records,individual_gas,merkle_gas,gas_saved,savings_percent";
  const lines = rows.map((row) =>
    [
      row.records,
      row.individual_gas,
      row.merkle_gas,
      row.gas_saved,
      row.savings_percent,
    ].join(",")
  );

  fs.writeFileSync(outputPath, `${header}\n${lines.join("\n")}\n`);

  return outputPath;
};

const main = async () => {
  const rows = await buildGasComparison();

  console.table(
    rows.map((row) => ({
      N: row.records,
      "Individual Gas": row.individual_gas,
      "Merkle Root Gas": row.merkle_gas,
      "Gas Saved": row.gas_saved,
      "Savings %": row.savings_percent,
    }))
  );

  const outputPath = writeCsv(rows);

  console.log(`Gas comparison CSV written to: ${outputPath}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
