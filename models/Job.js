// models/Job.js
const mongoose = require("mongoose");

const jobSchema = new mongoose.Schema({
  email: String,
  jobTitle: String,
  description: String,
  budget: String,
  location: String,
  preferredDateTime: String,
  scheduledAt: Date,
  status: {
    type: String,
    enum: ['pending', 'accepted', 'completed', 'cancelled'], // added cancelled
    default: 'pending',
  },
  acceptedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Worker',
    default: null,
  },
  customerName: String,
  city: String,
  street: String,
  postalCode: String,
  cancelReason: String,
  cancelledAt: Date,
}, { timestamps: true });

// ✅ Fix OverwriteModelError
module.exports = mongoose.models.Job || mongoose.model("Job", jobSchema);
