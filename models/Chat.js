const mongoose = require("mongoose");

const chatSchema = new mongoose.Schema({
  participants: {
    type: [String], // [customerId, workerId]
    required: true,
  },
  jobId: {
    type: String,
    required: true,
  },
  messages: [
    {
      senderId: {
        type: String,
        required: true, // always set
      },
      receiverId: {
        type: String,
        required: true, // always set
      },
      message: {
        type: String,
        required: true,
      },
      timestamp: {
        type: Date,
        default: Date.now,
      },
      seen: {
        type: Boolean,
        default: false,
      },
    },
  ],
});

module.exports = mongoose.model("Chat", chatSchema);
