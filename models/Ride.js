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
  workerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Worker",
    required: true,
  },

  // ✅ Ride details
  from: { type: String, required: true },
  to: { type: String, required: true },
  date: { type: String, required: true }, // yyyy-mm-dd
  time: { type: String, required: true }, // hh:mm
  price: { type: Number, required: true },
  seatsAvailable: { type: Number, required: true },
  pickupLocation: { type: String, required: true },

  // ✅ Stops along the way
  stops: [StopSchema],

  // ✅ Car picture
  carPicture: { type: String, default: "" },

  // ✅ Ride options (pets, luggage, etc.)
  rideOptions: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {},
  },

  bookingType: {
    type: String,
    enum: ["manual", "instant"],
    default: "manual",
  },

  dropOffNotes: { type: String, default: "" },

  passengers: [PassengerSchema],

  bookedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },

  // ✅ Main ride lifecycle
  status: {
    type: String,
    enum: [
      "active",       // live and visible to customers
      "pending",      // waiting for driver or passengers
      "accepted",     // driver accepted bookings
      "completed",    // ride done, awaiting cleanup
      "cancelled",    // cancelled manually
    ],
    default: "active",
  },

  finalPrice: { type: Number, default: 0 },

  // ✅ Added: flags for payout and visibility
  isPaidOut: { type: Boolean, default: false },  // true once payment released to driver
  isArchived: { type: Boolean, default: false }, // hide from both sides after cleanup

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Keep updatedAt current
RideSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model("Ride", RideSchema);
