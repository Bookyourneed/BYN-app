// models/BookingRequest.js
const mongoose = require("mongoose");

const BookingRequestSchema = new mongoose.Schema(
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

    /* =====================================================
       📍 ROUTE INFO (Supports STOP logic)
    ===================================================== */
    from: String,           // for normal rides
    to: String,
    message: String,

    // ⭐ NEW STOP FIELDS
    segmentFrom: { type: String, default: null },
    segmentTo: { type: String, default: null },
    segmentPrice: { type: Number, default: null },
    isStop: { type: Boolean, default: false },

    /* =====================================================
       🧍 Seats
    ===================================================== */
    seatsRequested: {
      type: Number,
      default: 1,
    },

    /* =====================================================
       💵 PRICE FIELDS
       price = the rider-price (seat or stop)
    ===================================================== */
    price: Number,          // rider price
    totalPrice: Number,     // old field (keep for compatibility)
    finalPrice: Number,     // old field (safe to keep)

    // ⭐ NEW (used in backend confirm-booking)
    totalPaid: { type: Number, default: 0 },   // includes booking fee

    /* =====================================================
       💳 PAYMENT
    ===================================================== */
    paymentIntentId: String,
    paymentStatus: {
      type: String,
      enum: ["authorized", "captured", "refunded", "failed"],
      default: "authorized",
    },

    payoutStatus: {
      type: String,
      enum: ["pending", "paid", "failed"],
      default: "pending",
    },

    driverPaid: { type: Boolean, default: false },
    paidOutAt: { type: Date },
    refundedAt: { type: Date },

    /* =====================================================
       🚦 REQUEST STATUS
    ===================================================== */
    requestStatus: {
      type: String,
      enum: [
        "pending",
        "accepted",
        "declined",
        "worker_completed",
        "completed",
        "cancelled_by_driver",
        "refunded",
        "disputed",
      ],
      default: "pending",
    },

    /* =====================================================
       🎉 COMPLETION LOGIC
    ===================================================== */
    driverComplete: { type: Boolean, default: false },
    customerComplete: { type: Boolean, default: false },

    driverCompletedAt: { type: Date },
    customerCompletedAt: { type: Date },

    acceptedAt: { type: Date },

    /* =====================================================
       ⚠️ DISPUTES
    ===================================================== */
    disputedBy: { type: String, enum: ["customer", "worker", null], default: null },
    disputeReason: { type: String },
    disputedAt: { type: Date },

    /* =====================================================
       🧹 CLEANUP / ARCHIVE
    ===================================================== */
    archived: { type: Boolean, default: false },

    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

BookingRequestSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model("BookingRequest", BookingRequestSchema);
