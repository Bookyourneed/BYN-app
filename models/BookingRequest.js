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
    price: Number,       // legacy support
    totalPrice: Number,  // frontend + trips
    finalPrice: Number,  // for backend calculations

    /* 🔥 PAYMENT */
    paymentIntentId: { type: String },

    /* 🔥 STATUS */
    requestStatus: {
      type: String,
      enum: [
        "pending",
        "accepted",
        "declined",
        "cancelled",
        "completed",
        "worker_completed",
        "refunded",
        "disputed",
      ],
      default: "pending",
    },

    driverComplete: { type: Boolean, default: false },
    customerComplete: { type: Boolean, default: false },

    driverCompletedAt: { type: Date },
    customerCompletedAt: { type: Date },

    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Auto-update timestamps
BookingRequestSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model("BookingRequest", BookingRequestSchema);

