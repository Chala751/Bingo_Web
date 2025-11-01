// server.js or soundRoutes.js
import express from "express";
import path from "path";

const router = express.Router();

router.get("/", (req, res) => {
  const { path: audioPath } = req.query;
  if (!audioPath) return res.status(400).send("Missing path");

  // Small alias map to preserve compatibility with older client keys
  const aliases = {
    "amharic/finishamh.opus": "amharic/winamh.opus", // finish -> win voice
  };

  const normalized = decodeURIComponent(String(audioPath)).replace(/\\/g, "/");
  const resolvedPath = aliases[normalized] || normalized;

  const filePath = path.join(process.cwd(), "public/sounds", resolvedPath); // adjust folder
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error("Failed to send file:", filePath, err);
      res.status(404).send("Not found");
    }
  });
});

export default router;
