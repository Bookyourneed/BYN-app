require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const webpush = require("web-push");
const bcrypt = require("bcrypt");
const multer = require("multer");
const path = require("path");
const socketio = require("socket.io");
const cron = require("node-cron");
const axios = require("axios");

// ✅ Initialize email transporter
require("./emailService");

// =====================================================
// ⚙️ Base Setup
// =====================================================
const app = express();
const server = http.createServer(app);
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// =====================================================
// ⚡ Socket.io Setup
// =====================================================
const { initSocket } = require("./socket");
const io = initSocket(server);
app.set("socketio", io);

// 🔥 REQUIRED FOR RIDE PRIVATE CHAT TO WORK
app.use((req, res, next) => {
  req.io = io;
  next();
});
// =====================================================
// 🗂️ Multer Setup (for uploads)
// =====================================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) =>
    cb(null, Date.now() + path.extname(file.originalname)),
});
const upload = multer({ storage });

// =====================================================
// 🌐 CORS — allow only live domains
// =====================================================
app.use(
  cors({
    origin: [
      "https://bookyourneed.com",
      "https://worker.bookyourneed.com",
      "https://admin.bookyourneed.com",
      "https://api.bookyourneed.com",
      "https://app.bookyourneed.com",
      "http://localhost:3000", // for local testing
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

// =====================================================
// 📦 Middleware
// =====================================================
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// =====================================================
// 📘 Models
// =====================================================
const User = require("./models/User");
const Worker = require("./models/Worker");
const Job = require("./models/Job");
const Chat = require("./models/Chat");
const BookingRequest = require("./models/BookingRequest");

// =====================================================
// 🛣️ Routes
// =====================================================
app.use("/api/customers", require("./routes/user"));
app.use("/api/customers/jobs", require("./routes/jobs"));
app.use("/api/worker", require("./routes/Worker"));
app.use("/api/review", require("./routes/review"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/chat", require("./routes/chat"));
app.use("/api/ride", require("./routes/ride"));
app.use("/api/booking", require("./routes/booking"));
app.use("/api/ride-chat", require("./routes/rideChat"));
app.use("/api/ridepayment", require("./routes/ridepayment"));
app.use("/api/ride-booking", require("./routes/customerridebooking"));
app.use("/api/notification", require("./routes/notification"));
app.use("/api/worker/job", require("./routes/workerJobs"));

// ✅ Payment & Wallet Routes
app.use("/api/payment", require("./routes/payment"));
app.use("/api/worker", require("./routes/workerWallet"));
app.use("/api/stripe", require("./routes/stripeConnect"));

// =====================================================
// 🖼️ Profile Picture Upload
// =====================================================
app.post(
  "/api/user/upload-profile-picture",
  upload.single("profilePicture"),
  async (req, res) => {
    const { email } = req.body;
    if (!req.file)
      return res.status(400).json({ message: "No file uploaded" });

    try {
      const profilePicturePath = `/uploads/${req.file.filename}`;
      const user = await User.findOneAndUpdate(
        { email },
        { profilePicture: profilePicturePath },
        { new: true }
      );
      if (!user) return res.status(404).json({ message: "User not found" });

      res.status(200).json({
        message: "Profile picture uploaded",
        profilePicture: user.profilePicture,
      });
    } catch (error) {
      console.error("Upload profile picture error:", error);
      res
        .status(500)
        .json({ message: "Failed to upload profile picture" });
    }
  }
);

// =====================================================
// 📬 Web Push Setup
// =====================================================
webpush.setVapidDetails(
  "mailto:admin@bookyourneed.com",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// =====================================================
// 🩺 Health Check
// =====================================================
app.get("/api/health-check", (req, res) => {
  res.json({ status: "✅ Backend is healthy!" });
});

// =====================================================
// 🧠 MongoDB Connection
// =====================================================
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB error:", err));

// =====================================================
// ⏰ CRON Jobs
// =====================================================
const { sendEmailSafe } = require("./emailService");

// 🕒 Auto-refund expired jobs every hour
cron.schedule("0 * * * *", async () => {
  console.log("⏳ Running auto-refund for expired unassigned jobs...");
  try {
    const { refundExpiredJobs } = require("./routes/payment");
    const results = await refundExpiredJobs();
    if (results.length > 0)
      console.log(`✅ Auto-refunded ${results.length} jobs`, results);
    else console.log("ℹ️ No expired jobs to refund this run");
  } catch (err) {
    console.error("❌ Cron auto-refund failed:", err);
  }
});

// 🕒 Auto-release ride payments every 3 hours
cron.schedule("0 */3 * * *", async () => {
  console.log("🚗 Running auto-release for completed rides...");
  try {
    await axios.post(
      `https://api.bookyourneed.com/api/ridepayment/auto-complete`
    );
    console.log("✅ Ride auto-release check completed successfully");
  } catch (err) {
    console.error("❌ Ride auto-release cron failed:", err.message);
  }
});

// 🕒 Cleanup completed rides daily at 2 AM
cron.schedule("0 2 * * *", async () => {
  console.log("🧹 Running cleanup for completed rides...");
  try {
    await axios.post(
      `https://api.bookyourneed.com/api/ridepayment/cleanup-completed`
    );
    console.log("✅ Completed rides cleaned up successfully");
  } catch (err) {
    console.error("❌ Cleanup cron failed:", err.message);
  }
});

// 🕓 Daily cleanup of refunded bookings older than 72h
setInterval(async () => {
  const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000);
  try {
    const result = await BookingRequest.deleteMany({
      status: "refunded",
      updatedAt: { $lt: cutoff },
    });
    if (result.deletedCount > 0)
      console.log(`🧹 Cleaned ${result.deletedCount} old refunded bookings`);
  } catch (err) {
    console.error("Refund cleanup error:", err.message);
  }
}, 24 * 60 * 60 * 1000);

// =====================================================
// 📧 Test Email Route
// =====================================================
app.get("/api/test-email", async (req, res) => {
  try {
    await sendEmailSafe({
      to: "youremail@gmail.com", // replace before testing
      subject: "BYN Brevo Test 🚀",
      html: `<p>Hello from <b>Book Your Need</b> Brevo API integration!</p>`,
      context: "test-email",
    });
    res.json({ success: true, message: "Test email sent ✅" });
  } catch (err) {
    console.error("❌ Test email failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// 🚀 Start Server
// =====================================================
const PORT = process.env.PORT || 5000;
server.listen(PORT, "0.0.0.0", () =>
  console.log(`🚀 Server running on port ${PORT}`)
);
