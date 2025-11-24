const mongoose = require("mongoose");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");

dotenv.config();

const Chat = require("./models/Chat");
const Job = require("./models/Job");

async function cleanCompletedChatMedia() {
  try {
    console.log("🔗 Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGO_URI);

    console.log("🔍 Finding completed jobs...");
    const completedStatuses = ["completed", "customer_confirmed", "auto_confirmed"];

    const completedJobs = await Job.find({
      status: { $in: completedStatuses },
      paymentStatus: "released",
    }).select("_id");

    if (!completedJobs.length) {
      console.log("✨ No completed jobs found. Nothing to delete.");
      process.exit(0);
      return;
    }

    const completedJobIds = completedJobs.map((j) => String(j._id));
    console.log(`📦 Completed Jobs Found: ${completedJobIds.length}`);

    console.log("🔍 Scanning chat messages for image files...");

    const chats = await Chat.find({
      jobId: { $in: completedJobIds },
    }).select("messages jobId");

    const rootDir = path.join(__dirname);
    const filesToDelete = new Set();

    chats.forEach((chat) => {
      (chat.messages || []).forEach((msg) => {
        if (msg.imageUrl) {
          const relative = msg.imageUrl.replace(/^\//, "");
          const fullPath = path.join(rootDir, relative);
          filesToDelete.add(fullPath);
        }
      });
    });

    console.log(`🖼 Total image files found: ${filesToDelete.size}`);

    let deleted = 0;

    filesToDelete.forEach((filePath) => {
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
          deleted++;
        } catch (err) {
          console.log("⚠️ Failed deleting:", filePath, err.message);
        }
      }
    });

    console.log(`🗑 Deleted ${deleted} image files.`);

    console.log("🧼 Removing image messages from MongoDB...");
    const updateResult = await Chat.updateMany(
      { jobId: { $in: completedJobIds } },
      { $pull: { messages: { imageUrl: { $ne: null } } } }
    );

    console.log(`📉 MongoDB updated: ${updateResult.modifiedCount || updateResult.nModified} chats modified.`);

    console.log("✨ Cleanup complete for completed jobs only!");
    process.exit(0);
  } catch (err) {
    console.error("❌ Cleanup failed:", err);
    process.exit(1);
  }
}

cleanCompletedChatMedia();
