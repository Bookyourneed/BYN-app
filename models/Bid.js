const mongoose = require("mongoose");

const bidSchema = new mongoose.Schema(
  {
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      required: true,
    },
    workerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Worker",
      required: true,
    },

    // ✅ Current active bid amount
    price: {
      type: Number,
      required: true,
    },

    // ✅ Worker’s estimated earnings after commission/fees
    estimatedEarnings: {
      type: Number,
      required: true,
    },

    message: {
      type: String,
      default: "",
    },

    // ✅ Status of this bid
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected"],
      default: "pending",
    },

    isWinningBid: {
      type: Boolean,
      default: false,
    },

    cancelledByWorker: {
      type: Boolean,
      default: false,
    },

    // 🔄 New fields for Change Bid
    changeRequest: {
      newPrice: { type: Number },          // New proposed price
      newEarnings: { type: Number },       // New earnings after commission
      message: { type: String, default: "" }, // Worker’s note for change
      status: {
        type: String,
        enum: ["none", "pending", "accepted", "rejected"],
        default: "none",
      },
      requestedAt: { type: Date },         // When worker requested change
      respondedAt: { type: Date },         // When customer responded
    },

    // 📜 Optional: keep a history of all price changes
    history: [
      {
        price: Number,
        earnings: Number,
        message: String,
        changedAt: { type: Date, default: Date.now },
        status: {
          type: String,
          enum: ["original", "updated", "accepted", "rejected"],
          default: "updated",
        },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Bid", bidSchema);
