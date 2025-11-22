// models/Ride.js
const mongoose = require("mongoose");

const StopSchema = new mongoose.Schema({
  name: String,
  pickup: String,
  price: Number,
  time: String,
});

const RideSchema = new mongoose.Schema(
  {
    workerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Worker",
      required: true,
    },

    from: { type: String, required: true },
    to: { type: String, required: true },
    date: { type: String, required: true },
    time: { type: String, required: true },

    pricePerSeat: { type: Number, required: true },

    seatsAvailable: { type: Number, required: true },
    seatsBooked: { type: Number, default: 0 },

    pickupLocation: { type: String, required: true },

    stops: [StopSchema],

    carPicture: { type: String, default: "" },

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

    // ⭐️ UPDATED ENUM – now includes "full"
    status: {
      type: String,
      enum: [
        "active",               // open / available
        "pending",              // request in progress
        "accepted",             // a booking accepted
        "full",                 // NO seats left (important!)
        "worker_completed",     // driver marked complete
        "customer_completed",   // customer marked complete
        "fully_completed",      // both sides done
        "cancelled_by_driver",  // driver cancelled ride
        "cancelled",            // generic cancelled
        "refunded",             // refunded bookings
        "completed"             // legacy final completed
      ],
      default: "active",
    },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

RideSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model("Ride", RideSchema);
