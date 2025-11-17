const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: "senderModel",
    required: true,
  },
  senderModel: {
    type: String,
    enum: ["User", "Worker"],
    required: true,
  },
  text: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  seen: { type: Boolean, default: false },
});

const rideChatSchema = new mongoose.Schema(
  {
    rideId: { type: mongoose.Schema.Types.ObjectId, ref: "Ride", required: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    workerId: { type: mongoose.Schema.Types.ObjectId, ref: "Worker", required: true },
    messages: [messageSchema],
    lastMessage: String,
    lastMessageAt: Date,
  },
  { timestamps: true }
);

module.exports = mongoose.model("RideChat", rideChatSchema);

