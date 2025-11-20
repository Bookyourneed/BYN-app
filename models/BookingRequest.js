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

    from: String,
    to: String,
    message: String,

    seatsRequested: {
      type: Number,
      default: 1,
    },

    /* 🔥 PRICE FIELDS */
    price: Number,
    totalPrice: Number,
    finalPrice: Number,

    /* 🔥 PAYMENT */
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

    /* 🔥 STATUS */
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

    /* 🔥 COMPLETION */
    driverComplete: { type: Boolean, default: false },
    customerComplete: { type: Boolean, default: false },

    driverCompletedAt: { type: Date },
    customerCompletedAt: { type: Date },

    acceptedAt: { type: Date },

    /* 🔥 DISPUTES */
    disputedBy: { type: String, enum: ["customer", "worker", null], default: null },
    disputeReason: { type: String },
    disputedAt: { type: Date },

    /* 🔥 CLEANUP */
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

