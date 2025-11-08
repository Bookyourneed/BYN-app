const mongoose = require("mongoose");

const SupportSessionSchema = new mongoose.Schema({
  email: { type: String, required: true },
  name: { type: String },
  isOpen: { type: Boolean, default: true },
  startedAt: { type: Date, default: Date.now },
  closedAt: { type: Date },
  closedByAdmin: { type: Boolean, default: false },
});

module.exports = mongoose.model("SupportSession", SupportSessionSchema);
