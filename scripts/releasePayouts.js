// backend/scripts/releasePayouts.js
const mongoose = require("mongoose");
const Worker = require("../models/Worker");
require("dotenv").config();

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to DB");

    const workers = await Worker.find({
      "walletHistory.released": false,
      "walletHistory.blocked": false,
    });

    for (const worker of workers) {
      let updated = false;

      for (const entry of worker.walletHistory) {
        if (
          !entry.released &&
          !entry.blocked &&
          entry.availableAt <= new Date()
        ) {
          worker.walletBalance += entry.amount;
          entry.released = true;
          updated = true;
        }
      }

      if (updated) {
        await worker.save();
        console.log(`✅ Released payouts for worker ${worker._id}`);
      }
    }

    console.log("🎉 All eligible payouts processed.");
    process.exit();
  } catch (err) {
    console.error("❌ Error releasing payouts:", err);
    process.exit(1);
  }
})();
