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
const Chat = require("./models/Chat");
const RideChat = require("./models/RideChat");
const Notification = require("./models/Notification");
const Ride = require("./models/Ride");                // 🔥 added
const BookingRequest = require("./models/BookingRequest"); // 🔥 added
const CustomerRequest = require("./models/CustomerRequest"); // 🔥 added

// 🧨 Delete ALL uploaded files (FULL uploads wipe)
const wipeUploads = () => {
  const uploadsRoot = path.join(__dirname, "uploads");

  if (!fs.existsSync(uploadsRoot)) {
    console.log("⚠️ No uploads folder found.");
    return;
  }

  console.log("🧹 Wiping ALL uploaded files...");

  const deleteFolderRecursive = (folderPath) => {
    if (fs.existsSync(folderPath)) {
      fs.readdirSync(folderPath).forEach((file) => {
        const curPath = path.join(folderPath, file);

        if (fs.lstatSync(curPath).isDirectory()) {
          deleteFolderRecursive(curPath);
        } else {
          fs.unlinkSync(curPath);
        }
      });
      fs.rmdirSync(folderPath);
    }
  };

  deleteFolderRecursive(uploadsRoot);
  console.log("🗑️ /uploads folder fully deleted.");
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
      Chat.deleteMany({}),
      RideChat.deleteMany({}),
      Notification.deleteMany({}),
      Ride.deleteMany({}),
      BookingRequest.deleteMany({}),
      CustomerRequest.deleteMany({})
    ]);

    console.log("🔥 Database wiped clean:");
    console.log("   Users, Workers, Jobs, Bids, Chats, RideChats");
    console.log("   Rides, BookingRequests, CustomerRequests, Notifications");

    wipeUploads();

    console.log("✨ Everything wiped successfully. Fresh start ready!");

    setTimeout(() => process.exit(0), 1000);
  } catch (err) {
    console.error("❌ Wipe failed:", err);
    process.exit(1);
  }
}

wipeAll();
