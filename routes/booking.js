const express = require("express");
const router = express.Router();
const Booking = require("../models/Booking");
const Ride = require("../models/Ride");

router.post("/create", async (req, res) => {
  try {
    const { rideId, customerId, seatsBooked } = req.body;

    if (!rideId || !customerId) {
      return res.status(400).json({ error: "Missing rideId or customerId" });
    }

    const ride = await Ride.findById(rideId);
    if (!ride) {
      return res.status(404).json({ error: "Ride not found" });
    }

    if (ride.seatsAvailable < seatsBooked) {
      return res.status(400).json({ error: "Not enough seats available" });
    }

    const status = ride.bookingType === "instant" ? "confirmed" : "pending";

    const booking = new Booking({
      rideId,
      customerId,
      seatsBooked: seatsBooked || 1,
      status,
    });

    await booking.save();

    // Optional: Reduce available seats if instant booking
    if (status === "confirmed") {
      ride.seatsAvailable -= booking.seatsBooked;
      await ride.save();
    }

    res.status(200).json({
      message: `✅ Booking ${status}`,
      booking,
    });
  } catch (err) {
    console.error("❌ Booking error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
