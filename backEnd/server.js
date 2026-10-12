require("dotenv").config();

const dns = require("dns");
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const {
  startBlockchainEventListener,
  stopBlockchainEventListener,
} = require("./services/notificationService");
const { writeEvent } = require("../scripts/observability");
const {
  startBlockchainIndexer,
  stopBlockchainIndexer,
} = require("./services/blockchainIndexerService");
const {
  startEvidenceAnchorScheduler,
  stopEvidenceAnchorScheduler,
} = require("./services/evidenceAnchorService");
const {
  startBankPaymentScheduler,
  stopBankPaymentScheduler,
} = require("./services/bankPaymentService");
const { assertRuntimeEnvironment } = require("./config/runtimeConfig");
const { buildHealthPayload } = require("./services/readinessService");

/* ----------------------------- DNS Config ----------------------------- */

dns.setDefaultResultOrder("ipv4first");

if (process.env.FORCE_PUBLIC_DNS === "true") {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
}

/* ----------------------------- App Setup ------------------------------ */

const app = express();
let httpServer = null;
let shuttingDown = false;

/* --------------------------- Basic Config ------------------------------ */

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;
let runtimeConfig;

try {
  runtimeConfig = assertRuntimeEnvironment();
  runtimeConfig.warnings.forEach((warning) =>
    console.warn(`[Backend configuration] ${warning}`)
  );
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

if (!MONGODB_URI) {
  console.error("Missing required environment variable: MONGODB_URI");
  process.exit(1);
}

if (!process.env.JWT_SECRET) {
  console.warn("Warning: JWT_SECRET is not set. Auth routes will fail later.");
}

if (!process.env.VITE_CONTRACT_ADDRESS) {
  console.warn(
    "Warning: VITE_CONTRACT_ADDRESS is not set. Contract service will fail later."
  );
}

if (!process.env.RPC_URL) {
  console.warn("Warning: RPC_URL is not set. Blockchain calls will fail later.");
}

/* ----------------------------- Middleware ----------------------------- */

app.disable("x-powered-by");

if (runtimeConfig.trustProxy !== false) {
  app.set("trust proxy", runtimeConfig.trustProxy);
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || runtimeConfig.allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      const error = new Error(`CORS origin not allowed: ${origin}`);
      error.status = 403;
      error.statusCode = 403;
      return callback(error);
    },
    credentials: true,
    exposedHeaders: ["Content-Disposition"],
  })
);

app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

if (process.env.NODE_ENV !== "test") {
  app.use(
    morgan("[Backend] :method :url :status :response-time ms", {
      stream: {
        write(line) {
          writeEvent("Backend", "info", line.trim());
          process.stdout.write(line);
        },
      },
    })
  );
}

/* ---------------------------- Base Routes ----------------------------- */

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Block-Insure backend API is running",
  });
});

const healthPayload = async () => ({
  ...(await buildHealthPayload({
    databaseConnected: mongoose.connection.readyState === 1,
  })),
  uptime: process.uptime(),
  timestamp: new Date().toISOString(),
});

app.get("/health/live", (req, res) => {
  res.set("Cache-Control", "no-store").status(200).json({
    success: true,
    status: "alive",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

const readinessHandler = async (req, res) => {
  const payload = await healthPayload();
  res
    .set("Cache-Control", "no-store")
    .status(payload.success ? 200 : 503)
    .json(payload);
};

app.get("/health", readinessHandler);
app.get("/health/ready", readinessHandler);

app.get("/api", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Welcome to the Block-Insure API",
  });
});

/* ----------------------------- API Routes ----------------------------- */

app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/users", require("./routes/userRoutes"));
app.use("/api/documents", require("./routes/documentRoutes"));
app.use("/api/policy-packages", require("./routes/policyRoutes"));
app.use("/api/policies", require("./routes/policiesRoutes"));
app.use("/api/policy-benefits", require("./routes/policyBenefitsRoutes"));
app.use("/api/claims", require("./routes/claimRoutes"));
app.use("/api/appeals", require("./routes/appealRoutes"));
app.use("/api/votes", require("./routes/votingRoutes"));
app.use("/api/evaluation", require("./routes/evaluationRoutes"));
app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api/audit", require("./routes/auditRoutes"));
app.use("/api/oracle", require("./routes/oracleRoutes"));
app.use("/api/notifications", require("./routes/notificationRoutes"));
app.use("/api/hospitals", require("./routes/hospitalRoutes"));
app.use("/api/banks", require("./routes/bankRoutes"));
app.use("/api/indexer", require("./routes/indexerRoutes"));
app.use(
  "/api/evidence-log",
  require("./routes/evidenceTransparencyRoutes")
);

/* ----------------------------- Mock Routes ---------------------------- */

if (runtimeConfig.simulatedHospitalApiEnabled) {
  app.use("/mock/hospital", require("./routes/mockHospitalRoutes"));
} else {
  console.log("[Backend] Simulated hospital API disabled");
}

/* ---------------------------- 404 Handler ----------------------------- */

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

/* ------------------------ Global Error Handler ------------------------- */

app.use((err, req, res, next) => {
  const statusCode = Number(err.statusCode || err.status) || 500;
  const isServerError = statusCode >= 500;
  const exposeInternalErrors =
    process.env.NODE_ENV !== "production" ||
    process.env.EXPOSE_INTERNAL_ERRORS === "true";

  const requestFailure = {
    method: req.method,
    path: req.originalUrl,
    statusCode,
    message: err.message,
  };
  if (isServerError) {
    console.error("Server error:", {
      ...requestFailure,
      stack: process.env.NODE_ENV === "production" ? undefined : err.stack,
    });
  } else if (statusCode !== 404) {
    console.warn("Request rejected:", requestFailure);
  }
  writeEvent("Backend", isServerError ? "error" : "warn", err.message);

  res.status(statusCode).json({
    success: false,
    message:
      isServerError && !exposeInternalErrors
        ? "Internal server error"
        : err.message || "Internal server error",
  });
});

/* -------------------------- Database Setup ----------------------------- */

const connectDatabase = async () => {
  await mongoose.connect(MONGODB_URI);
  console.log("[Backend] MongoDB connected successfully");
};

const listenForRequests = () =>
  new Promise((resolve, reject) => {
    const server = app.listen(PORT, "0.0.0.0");
    httpServer = server;
    server.once("error", reject);
    server.once("listening", () => {
      server.off("error", reject);
      console.log(`[Backend] Server running on port ${PORT}`);
      console.log(`[Backend] Health check: http://localhost:${PORT}/health`);
      resolve();
    });
  });

const closeHttpServer = () =>
  new Promise((resolve, reject) => {
    if (!httpServer?.listening) return resolve();
    httpServer.close((error) => (error ? reject(error) : resolve()));
    httpServer.closeIdleConnections?.();
  });

/* -------------------------- Server Startup ----------------------------- */

const startServer = async () => {
  try {
    await connectDatabase();
    if (runtimeConfig.blockchainRuntimeEnabled) {
      await startBlockchainIndexer();
      startEvidenceAnchorScheduler();
      await startBlockchainEventListener();
      startBankPaymentScheduler();
    } else {
      console.warn("[Backend] Blockchain runtime disabled; starting in off-chain preview mode");
    }

    await listenForRequests();
  } catch (error) {
    console.error("Backend startup failed:", error.message);
    if (runtimeConfig.blockchainRuntimeEnabled) {
      stopBlockchainIndexer();
      stopEvidenceAnchorScheduler();
      stopBankPaymentScheduler();
      await stopBlockchainEventListener().catch(() => undefined);
    }
    await mongoose.connection.close().catch(() => undefined);
    process.exit(1);
  }
};

startServer();

/* ------------------------ Graceful Shutdown ---------------------------- */

const shutdownServer = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    console.log(`${signal} received. Stopping backend services...`);
    await closeHttpServer();
    if (runtimeConfig.blockchainRuntimeEnabled) {
      await stopBlockchainEventListener();
      stopBlockchainIndexer();
      stopEvidenceAnchorScheduler();
      stopBankPaymentScheduler();
    }
    await mongoose.connection.close();
    console.log("Backend services stopped cleanly");
    process.exit(0);
  } catch (error) {
    console.error("Error during shutdown:", error.message);
    process.exit(1);
  }
};

process.on("SIGINT", () => shutdownServer("SIGINT"));
process.on("SIGTERM", () => shutdownServer("SIGTERM"));
