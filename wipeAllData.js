const mongoose = require("mongoose");
const dotenv = require("dotenv");
dotenv.config();

// Import all models
const User = require("./models/User");
const Worker = require("./models/Worker");
const Job = require("./models/Job");
const Bid = require("./models/Bid");
const RideChat = require("./models/RideChat"); // optional
const Message = require("./models/Message");   // optional
const Notification = require("./models/Notification"); // if any

async function start() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("🔗 Connected to MongoDB");

    await Promise.all([
      User.deleteMany({}),
      Worker.deleteMany({}),
      Job.deleteMany({}),
      Bid.deleteMany({}),
      RideChat?.deleteMany?.({}),
      Message?.deleteMany?.({}),
      Notification?.deleteMany?.({})
    ]);

    console.log("✅ All collections wiped: Users, Workers, Jobs, Bids, Chats, Messages, Notifications");
    process.exit(0);
  } catch (err) {
    console.error("❌ Wipe failed:", err);
    process.exit(1);
  }
}

start();
