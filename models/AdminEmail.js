const mongoose = require("mongoose");

const AdminEmailSchema = new mongoose.Schema({
  to: String,
  role: String, // customer | worker
  subject: String,
  message: String,
  sentBy: { type: String, default: "admin" },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("AdminEmail", AdminEmailSchema);
