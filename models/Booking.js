// models/Booking.js
const mongoose = require("mongoose");

const BookingSchema = new mongoose.Schema(
  {
    bookingId: { type: String, required: true, unique: true }, // auto-generate

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

    seatsBooked: { type: Number, default: 1 },

    // PRICE & PAYMENT
    price: { type: Number, required: true },

    paymentIntentId: { type: String },
    paymentStatus: {
      type: String,
      enum: ["on_hold", "captured", "released", "refunded"],
      default: "on_hold",
    },

    // STATUS system
    status: {
      type: String,
      enum: [
        "pending",     // waiting for driver to accept
        "accepted",    // driver accepted
        "active",      // ride ongoing
        "completed",   // both sides done
        "cancelled",
        "disputed",
      ],
      default: "pending",
    },

    // COMPLETION FLAGS
    driverComplete: { type: Boolean, default: false },
    customerComplete: { type: Boolean, default: false },

    driverCompletedAt: { type: Date },
    customerCompletedAt: { type: Date },

    // AUTO RELEASE DATE
    releaseDate: { type: Date },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

BookingSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model("Booking", BookingSchema);
