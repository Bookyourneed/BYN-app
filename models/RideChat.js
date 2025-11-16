// models/RideChat.js
const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  text: { type: String, required: true },

  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
  },

  senderModel: {
    type: String,
    enum: ["User", "Worker"],
    required: true,
  },

  timestamp: { type: Date, default: Date.now },
  seen: { type: Boolean, default: false },
});

const rideChatSchema = new mongoose.Schema(
  {
    rideId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ride",
      required: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    workerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Worker",
      required: true,
    },
    messages: [messageSchema],
    lastMessage: { type: String },
    lastMessageAt: { type: Date },
    status: {
      type: String,
      enum: ["active", "expired", "closed"],
      default: "active",
    }
  },
  { timestamps: true }
);

rideChatSchema.pre("save", function (next) {
  if (this.messages.length > 0) {
    const lastMsg = this.messages[this.messages.length - 1];
    this.lastMessage = lastMsg.text;
    this.lastMessageAt = lastMsg.timestamp;
  }
  next();
});

module.exports = mongoose.model("RideChat", rideChatSchema);
