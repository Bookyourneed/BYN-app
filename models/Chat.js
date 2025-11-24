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
        required: true,
      },

      receiverId: {
        type: String,
        required: true,
      },

      // 🟢 TEXT MESSAGE (optional now)
      message: {
        type: String,
        default: "",
      },

      // 🟢 IMAGE MESSAGE (new field)
      imageUrl: {
        type: String,
        default: null,
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
