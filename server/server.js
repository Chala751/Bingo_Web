import express from "express";
import "dotenv/config";
import http from "http";
import connectDB from "./configs/db.js";
import cors from "cors";
import authRoutes from "./routes/authRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import gameRoutes from "./routes/gameRoutes.js";
import soundRoutes from "./routes/soundRoutes.js";
import { initSocket } from "./socket.js";
import os from "os";
import { exec } from "child_process";
import util from "util";

const execAsync = util.promisify(exec);

// Initialize express
const app = express();

// Connect to database
await connectDB();

// Middleware
app.use(
  cors({
    origin: [
      "https://jokerbingo.xyz",
      "http://localhost:5173",
      "http://localhost:3000",
    ],
    credentials: true,
  })
);
app.use(express.json());

// === Resource monitoring helpers ===

// Container disk usage (root folder)
const getContainerDiskUsage = async () => {
  const { stdout } = await execAsync("du -sh .");
  return stdout.trim();
};

// CPU usage per core
const getCpuUsage = () => {
  const cpus = os.cpus();
  return cpus.map((cpu, index) => {
    const times = cpu.times;
    const total = Object.values(times).reduce((a, b) => a + b, 0);
    const usage = ((total - times.idle) / total) * 100;
    return `CPU ${index}: ${usage.toFixed(2)}% used`;
  });
};

// Memory usage
const getMemoryUsage = () => {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  return {
    usedMB: (used / 1024 / 1024).toFixed(2),
    freeMB: (free / 1024 / 1024).toFixed(2),
    totalMB: (total / 1024 / 1024).toFixed(2),
    usagePercent: ((used / total) * 100).toFixed(2) + "%",
  };
};

// Bandwidth usage
const getBandwidthUsage = async () => {
  const { stdout } = await execAsync("cat /proc/net/dev");
  const lines = stdout.split("\n").slice(2);
  return lines
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      const iface = parts[0].replace(":", "");
      if (!iface) return null;
      const rxMB = (parseInt(parts[1], 10) / 1024 / 1024).toFixed(2);
      const txMB = (parseInt(parts[9], 10) / 1024 / 1024).toFixed(2);
      return { interface: iface, receivedMB: rxMB, sentMB: txMB };
    })
    .filter(Boolean);
};

// Uptime and OS info
const getSystemInfo = () => ({
  uptime: `${(os.uptime() / 3600).toFixed(2)} hours`,
  platform: os.platform(),
  release: os.release(),
  arch: os.arch(),
  hostname: os.hostname(),
});

// === Routes ===
app.get("/", (req, res) => res.send("Server is running"));

// Full resource monitoring endpoint
app.get("/resources", async (req, res) => {
  try {
    const [disk, cpu, memory, bandwidth, system] = await Promise.all([
      getContainerDiskUsage(),
      getCpuUsage(),
      getMemoryUsage(),
      getBandwidthUsage(),
      getSystemInfo(),
    ]);

    res.json({
      system,
      containerDiskUsage: disk,
      cpuUsage: cpu,
      memoryUsage: memory,
      bandwidthUsage: bandwidth,
    });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Failed to get resources", details: err.message });
  }
});

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/games", gameRoutes);
app.use("/api/sounds", soundRoutes);

// === HTTP server + Socket.io ===
const PORT = process.env.PORT || 5000;
const server = http.createServer(app);
initSocket(server);

// Start server
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
