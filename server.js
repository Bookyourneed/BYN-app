// ✅ Final server.js for BYN Backend (Fully Working & Clean)
require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const socketIo = require("socket.io");
const webpush = require("web-push");
const bcrypt = require("bcrypt");

const app = express();
const server = http.createServer(app);

// ✅ Enable Socket.io
const io = socketIo(server, {
  cors: {
    origin: [
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:3002",
      "https://bookyourneed.com",
      "https://www.bookyourneed.com"
    ],
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// ✅ Middleware
app.use(cors({
  origin: [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "https://bookyourneed.com",
    "https://www.bookyourneed.com"
  ],
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static("uploads")); // Serve uploaded files

// ✅ MongoDB Models
const User = require("./models/User");
const Worker = require("./models/Worker");
const Job = require("./models/Job");

// ✅ Routes
const userRoutes = require("./routes/user");
const jobRoutes = require("./routes/jobs");
const workerRoutes = require("./routes/Worker");
const reviewRoutes = require("./routes/review");
const adminRoutes = require("./routes/admin");

app.use("/api/user", userRoutes);
app.use("/api", jobRoutes);
app.use("/api/worker", workerRoutes);
app.use("/api/review", reviewRoutes);
app.use("/api/admin", adminRoutes);

// ✅ JWT Secret
const SECRET_KEY = process.env.SECRET_KEY || "default_secret_key";

// ✅ Combined Login
app.post("/api/user/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    let worker = await Worker.findOne({ email });
    if (worker) {
      if (!worker.password) return res.status(400).json({ message: "No password set for this worker." });
      const isMatch = await bcrypt.compare(password, worker.password);
      if (!isMatch) return res.status(401).json({ message: "Incorrect password." });

      const token = jwt.sign({ email }, SECRET_KEY, { expiresIn: "2h" });
      return res.status(200).json({ token, _id: worker._id, email, profileCompleted: worker.profileCompleted });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found." });
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ message: "Incorrect password." });

    const token = jwt.sign({ email }, SECRET_KEY, { expiresIn: "2h" });
    return res.status(200).json({ token, _id: user._id, email });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ✅ Worker Notification via Socket.io
let connectedWorkers = {};
io.on("connection", (socket) => {
  console.log("✅ Worker connected:", socket.id);

  socket.on("register-worker", (workerId) => {
    connectedWorkers[workerId] = socket.id;
    console.log(`🛠️ Worker ${workerId} registered`);
  });

  socket.on("disconnect", () => {
    const disconnectedId = Object.keys(connectedWorkers).find(
      (id) => connectedWorkers[id] === socket.id
    );
    if (disconnectedId) {
      delete connectedWorkers[disconnectedId];
      console.log(`❌ Worker ${disconnectedId} disconnected`);
    }
  });
});

// ✅ Job Posting + Real-time Notify
app.post("/api/jobs/post", async (req, res) => {
  try {
    const newJob = new Job(req.body);
    await newJob.save();

    const workers = await Worker.find({
      services: { $elemMatch: { name: newJob.jobTitle } },
      status: "approved",
    });

    workers.forEach((worker) => {
      const socketId = connectedWorkers[worker._id];
      if (socketId) {
        io.to(socketId).emit("new-job", {
          jobId: newJob._id,
          jobTitle: newJob.jobTitle,
          description: newJob.description,
          budget: newJob.budget,
        });
      }
    });

    res.status(200).json({ message: "Job posted & workers notified!", jobId: newJob._id });
  } catch (err) {
    console.error("Job post error:", err);
    res.status(500).json({ error: "Job creation failed" });
  }
});

// ✅ Web Push Setup
webpush.setVapidDetails(
  "mailto:your-email@gmail.com",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// ✅ Health Check Route
app.get("/api/health-check", (req, res) => {
  res.json({ status: "✅ Backend is healthy!" });
});

// ✅ MongoDB Connect
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB error:", err));

// ✅ Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, "0.0.0.0", () =>
  console.log(`🚀 Server running on port ${PORT}`)
);
