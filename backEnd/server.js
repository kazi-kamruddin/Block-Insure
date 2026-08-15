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

/* ----------------------------- DNS Config ----------------------------- */

dns.setDefaultResultOrder("ipv4first");

if (process.env.FORCE_PUBLIC_DNS === "true") {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
}

/* ----------------------------- App Setup ------------------------------ */

const app = express();

/* --------------------------- Basic Config ------------------------------ */

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;
const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins =
  ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : DEFAULT_ALLOWED_ORIGINS;

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

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`CORS origin not allowed: ${origin}`));
    },
    credentials: true,
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

app.get("/health", (req, res) => {
  const databaseState =
    mongoose.connection.readyState === 1 ? "connected" : "disconnected";
  res.status(200).json({
    success: true,
    message: "Backend is healthy",
    services: {
      database: databaseState,
      blockchainRpc: process.env.RPC_URL ? "configured" : "missing",
      contract: process.env.VITE_CONTRACT_ADDRESS ? "configured" : "missing",
      evidenceEncryption: "client-aes256gcm-with-recrypt-pre",
      evidenceTransparency: process.env.EVIDENCE_REGISTRY_ADDRESS
        ? "anchored"
        : "registry-address-missing",
    },
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

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
app.use("/api/indexer", require("./routes/indexerRoutes"));
app.use(
  "/api/evidence-log",
  require("./routes/evidenceTransparencyRoutes")
);

/* ----------------------------- Mock Routes ---------------------------- */

app.use("/mock/hospital", require("./routes/mockHospitalRoutes"));

/* ---------------------------- 404 Handler ----------------------------- */

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

/* ------------------------ Global Error Handler ------------------------- */

app.use((err, req, res, next) => {
  const statusCode = Number(err.statusCode) || 500;
  const isServerError = statusCode >= 500;
  const exposeInternalErrors =
    process.env.NODE_ENV !== "production" ||
    process.env.EXPOSE_INTERNAL_ERRORS === "true";

  console.error("Server error:", {
    method: req.method,
    path: req.originalUrl,
    statusCode,
    message: err.message,
    stack: process.env.NODE_ENV === "production" ? undefined : err.stack,
  });
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

/* -------------------------- Server Startup ----------------------------- */

const startServer = async () => {
  try {
    await connectDatabase();
    await startBlockchainIndexer();
    startEvidenceAnchorScheduler();
    await startBlockchainEventListener();

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`[Backend] Server running on port ${PORT}`);
      console.log(`[Backend] Health check: http://localhost:${PORT}/health`);
    });
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    process.exit(1);
  }
};

startServer();

/* ------------------------ Graceful Shutdown ---------------------------- */

const shutdownServer = async (signal) => {
  try {
    console.log(`${signal} received. Closing MongoDB connection...`);
    await stopBlockchainEventListener();
    stopBlockchainIndexer();
    stopEvidenceAnchorScheduler();
    await mongoose.connection.close();
    console.log("MongoDB connection closed");
    process.exit(0);
  } catch (error) {
    console.error("Error during shutdown:", error.message);
    process.exit(1);
  }
};

process.on("SIGINT", () => shutdownServer("SIGINT"));
process.on("SIGTERM", () => shutdownServer("SIGTERM"));
