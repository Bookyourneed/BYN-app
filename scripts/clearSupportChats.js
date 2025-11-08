const mongoose = require("mongoose");
require("dotenv").config();

// ✅ Go up one level to reach the real models folder
const SupportChat = require("../models/SupportChat");

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

(async () => {
  try {
    const result = await SupportChat.deleteMany({});
    console.log(`🧹 Deleted ${result.deletedCount} SupportChat records.`);
    process.exit(0);
  } catch (err) {
    console.error("❌ Delete failed:", err);
    process.exit(1);
  }
})();
