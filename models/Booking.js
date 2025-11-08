const mongoose = require("mongoose");

const BookingSchema = new mongoose.Schema({
  // 🔹 Reference to the ride this booking belongs to
  rideId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Ride", 
    required: true 
  },

  // 🔹 Customer who made the booking
  customerId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User", 
    required: true 
  },

  // 🔹 Booking status
  status: {
    type: String,
    enum: [
      "pending",   // waiting for driver confirmation
      "confirmed", // accepted / confirmed by driver
      "rejected",  // declined
      "cancelled", // cancelled by user or driver
      "completed", // ride finished
    ],
    default: "pending",
  },

  // 🔹 Number of seats reserved
  seatsBooked: { 
    type: Number, 
    default: 1 
  },

  // 🔹 Booking creation timestamp
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
});

module.exports = mongoose.model("Booking", BookingSchema);
