const mongoose = require("mongoose");

const CustomerRequestSchema = new mongoose.Schema({
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  from: { type: String, required: true },
  to: { type: String, required: true },
  date: { type: String, required: true }, // YYYY-MM-DD
  seatsNeeded: { type: Number, required: true },
  notes: { type: String },
  status: {
    type: String,
    enum: ["pending", "invited", "approved", "rejected"],
    default: "pending",
  },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("CustomerRequest", CustomerRequestSchema);
