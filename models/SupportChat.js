const mongoose = require("mongoose");

const MessageSchema = new mongoose.Schema({
  sender: { type: String, required: true },
  email: { type: String, required: true },
  text: { type: String, required: true }, // ✅ renamed from 'content'
  time: { type: Date, default: Date.now }, // ✅ renamed from 'timestamp'
  seen: { type: Boolean, default: false },
});

const SupportChatSchema = new mongoose.Schema({
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: "SupportSession" },
  participants: [String],
  messages: [MessageSchema],
});

module.exports = mongoose.model("SupportChat", SupportChatSchema);
