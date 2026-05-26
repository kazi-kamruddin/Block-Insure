require("dotenv").config();

const dns = require("dns");
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

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
    origin: true,
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
  app.use(morgan("dev"));
}

/* ---------------------------- Base Routes ----------------------------- */

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Block-Insure backend API is running",
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Backend is healthy",
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
app.use("/api/claims", require("./routes/claimRoutes"));
app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api/audit", require("./routes/auditRoutes"));

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
  console.error("Server error:", err);

  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || "Internal server error",
  });
});

/* -------------------------- Database Setup ----------------------------- */

const connectDatabase = async () => {
  await mongoose.connect(MONGODB_URI);
  console.log("MongoDB connected successfully");
};

/* -------------------------- Server Startup ----------------------------- */

const startServer = async () => {
  try {
    await connectDatabase();

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Health check: http://localhost:${PORT}/health`);
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