// models/Ride.js
const mongoose = require("mongoose");

const StopSchema = new mongoose.Schema({
  name: String,
  pickup: String,
  price: Number,
  time: String,
});

const PassengerSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  seats: { type: Number, default: 1 },
  bookedFrom: { type: String, default: "" },
  bookedTo: { type: String, default: "" },
  bookingMessage: { type: String, default: "" },
  status: {
    type: String,
    enum: ["pending", "accepted", "cancelled"],
    default: "pending",
  },
  createdAt: { type: Date, default: Date.now },
});

const RideSchema = new mongoose.Schema({
  // ✅ Worker offering the ride
  workerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Worker",
    required: true,
  },

  // ✅ Basic ride details
  from: { type: String, required: true },
  to: { type: String, required: true },
  date: { type: String, required: true }, // yyyy-mm-dd
  time: { type: String, required: true }, // hh:mm
  price: { type: Number, required: true },
  seatsAvailable: { type: Number, required: true },
  pickupLocation: { type: String, required: true },

  // ✅ Stops
  stops: [StopSchema],

  // ✅ Car picture
  carPicture: { type: String, default: "" },

  // ✅ Ride options (pets, luggage, etc.)
  rideOptions: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {},
  },

  // ✅ Ride type
  bookingType: {
    type: String,
    enum: ["manual", "instant"],
    default: "manual",
  },

  dropOffNotes: { type: String, default: "" },
  passengers: [PassengerSchema],

  // ✅ User who booked (customer)
  bookedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },

  // ✅ Lifecycle
  status: {
    type: String,
    enum: [
      "active",
      "pending",
      "accepted",
      "completed",
      "cancelled",
    ],
    default: "active",
  },

  finalPrice: { type: Number, default: 0 },

  // ✅ Payment + Wallet Info
  paymentStatus: {
    type: String,
    enum: ["unpaid", "held", "paid", "refunded"],
    default: "unpaid",
  },

  stripePaymentIntentId: { type: String, default: "" },

  // ✅ Payout Tracking
  payoutAmount: { type: Number, default: 0 },
  payoutDate: { type: Date, default: null },
  payoutStatus: {
    type: String,
    enum: ["pending", "processing", "completed", "failed"],
    default: "pending",
  },

  // ✅ Control flags
  isPaidOut: { type: Boolean, default: false },  // true once Stripe payout done
  isArchived: { type: Boolean, default: false }, // hidden after cleanup

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Keep updatedAt current
RideSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model("Ride", RideSchema);
