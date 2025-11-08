const mongoose = require("mongoose");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");

dotenv.config();

// Import all models
const User = require("./models/User");
const Worker = require("./models/Worker");
const Job = require("./models/Job");
const Bid = require("./models/Bid");
const Chat = require("./models/Chat");           // ✅ added
const RideChat = require("./models/RideChat");   // Optional
const Notification = require("./models/Notification"); // Optional

const wipeUploads = () => {
  const uploadDirs = ["uploads/certifications", "uploads/ids", "uploads/cars"];

  uploadDirs.forEach((dir) => {
    const fullPath = path.join(__dirname, dir);
    if (fs.existsSync(fullPath)) {
      fs.readdir(fullPath, (err, files) => {
        if (err) return console.error(`❌ Error reading ${dir}:`, err);

        for (const file of files) {
          fs.unlink(path.join(fullPath, file), (err) => {
            if (err) console.error(`❌ Failed to delete ${file} in ${dir}:`, err);
          });
        }
      });
    }
  });
};

async function wipeAll() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("🔗 Connected to MongoDB");

    await Promise.all([
      User.deleteMany({}),
      Worker.deleteMany({}),
      Job.deleteMany({}),
      Bid.deleteMany({}),
      Chat.deleteMany({}),           // ✅ wipe chats
      RideChat?.deleteMany?.({}),
      Notification?.deleteMany?.({})
    ]);

    console.log("✅ Database wiped: Users, Workers, Jobs, Bids, Chats, RideChats, Notifications");

    wipeUploads();
    console.log("🧹 Uploaded files cleaned from /uploads");

    setTimeout(() => {
      console.log("✅ Everything wiped successfully. Exiting...");
      process.exit(0);
    }, 1000);
  } catch (err) {
    console.error("❌ Wipe failed:", err);
    process.exit(1);
  }
}

wipeAll();
