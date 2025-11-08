const mongoose = require("mongoose");

const BookingRequestSchema = new mongoose.Schema({
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

  from: { type: String },
  to: { type: String },
  price: { type: Number },
  message: { type: String },

  // ✅ Ride lifecycle tracking
  rideStatus: {
    type: String,
    enum: [
      "pending",              // 🔥 added for compatibility
      "pending_driver_accept", // customer requested, waiting for driver
      "accepted",              // driver accepted
      "worker_completed",      // driver marked ride complete
      "completed",             // customer confirmed or auto-completed
      "dispute_pending",       // dispute raised (customer or driver)
      "cancelled",             // cancelled by either side before completion
      "refunded",              // refunded to customer
    ],
    default: "pending_driver_accept",
  },

  // ✅ Payment lifecycle
  paymentIntentId: { type: String },
  escrowStatus: {
    type: String,
    enum: [
      "on_hold",          // Payment authorized but not captured yet
      "captured",         // Payment captured (held by BYN)
      "pending_release",  // Waiting for 2-day auto-release
      "released",         // Released to driver
      "refunded",         // Refunded to customer
      "disputed",         // Locked due to dispute
    ],
    default: "on_hold",
  },

  // ✅ Booking status (for internal tracking)
  status: {
    type: String,
    enum: [
      "pending",    // Awaiting driver acceptance
      "accepted",   // Driver accepted, payment captured
      "active",     // Ride ongoing
      "on_hold",    // Temporarily paused
      "completed",  // Finished and confirmed
      "cancelled",  // Cancelled before completion
      "disputed",   // Under admin review
      "refunded",   // Payment refunded
    ],
    default: "pending",
  },

  // ✅ Completion & timeline tracking
  workerCompletedAt: { type: Date },
  customerConfirmedAt: { type: Date },
  releaseDate: { type: Date },

  // ✅ Auto-timestamps
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// ✅ Auto-update `updatedAt` before every save
BookingRequestSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model("BookingRequest", BookingRequestSchema);
