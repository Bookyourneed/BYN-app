const express = require("express");
const router = express.Router();
const BookingRequest = require("../models/BookingRequest");
const Ride = require("../models/Ride");
const User = require("../models/User");
const Worker = require("../models/Worker");

// ✅ POST: Customer books a ride + email driver
router.post("/request-booking", async (req, res) => {
  const { rideId, customerId, message, from, to } = req.body;

  if (!rideId || !customerId) {
    return res.status(400).json({ error: "Missing rideId or customerId" });
  }

  try {
    const existingRequest = await BookingRequest.findOne({ rideId, customerId });
    if (existingRequest) {
      return res.status(409).json({ error: "You have already requested this ride." });
    }

    console.log("🔥 Booking request received:", req.body);

    const ride = await Ride.findById(rideId).populate("workerId", "name email");
    if (!ride) return res.status(404).json({ error: "Ride not found" });

    if (ride.bookedBy && ride.status !== "cancelled") {
      return res.status(409).json({ error: "This ride is already booked." });
    }

    // 🔹 Calculate final price (with stop support)
    let finalPrice = ride.price;
    let bookedFrom = from || ride.from;
    let bookedTo = to || ride.to;

    if (ride.stops?.length && from && to) {
      const fromStop = ride.stops.find(s => s.name === from || s.pickup === from);
      const toStop = ride.stops.find(s => s.name === to || s.pickup === to);

      if (fromStop && toStop) {
        finalPrice = Math.max(toStop.price - fromStop.price, 0);
        bookedFrom = from;
        bookedTo = to;
      } else if (toStop) {
        finalPrice = toStop.price;
        bookedTo = to;
      } else if (fromStop) {
        finalPrice = fromStop.price;
        bookedFrom = from;
      }
    }

    // ✅ Update ride
    ride.bookedBy = customerId;
    ride.bookingMessage = message || "";
    ride.status = "pending";
    ride.finalPrice = finalPrice;
    ride.bookedFrom = bookedFrom;
    ride.bookedTo = bookedTo;
    await ride.save();

    // ✅ Save booking request
    const booking = await BookingRequest.create({
      rideId,
      customerId,
      from: bookedFrom,
      to: bookedTo,
      price: finalPrice,
      message,
      status: "pending",
    });

    console.log("✅ Booking and ride saved");

    // 🔹 Send email to the driver
    const { sendRideEmail } = require("../emailService");
    const io = req.app.get("socketio");

    // Fetch customer info
    const customer = await User.findById(customerId).select("name email");

    if (ride.workerId?.email) {
      await sendRideEmail("rideRequest", {
        to: ride.workerId.email,
        customerName: customer?.name || "Customer",
        driverName: ride.workerId.name,
        from: bookedFrom,
        toLocation: bookedTo,
        date: ride.date,
        time: ride.time,
      });
      console.log(`📧 Ride request email sent to driver: ${ride.workerId.email}`);
    }

    // 🔹 Emit socket notification (optional)
    io.to(`ride_driver_${ride.workerId._id}`).emit("ride-requested", {
      rideId,
      customerId,
      from: bookedFrom,
      to: bookedTo,
      price: finalPrice,
      message,
      status: "pending",
    });

    res.status(200).json({ success: true, ride, booking });
  } catch (err) {
    console.error("❌ Error during booking:", err);
    res.status(500).json({ error: "Server error while booking the ride" });
  }
});

// ✅ POST: Approve booking request
router.post("/approve-request", async (req, res) => {
  try {
    const { requestId } = req.body;
    await BookingRequest.findByIdAndUpdate(requestId, { status: "approved" });
    res.status(200).json({ message: "Booking request approved" });
  } catch (err) {
    console.error("❌ Error approving request:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ POST: Reject booking request
router.post("/reject-request", async (req, res) => {
  try {
    const { requestId } = req.body;
    await BookingRequest.findByIdAndUpdate(requestId, { status: "rejected" });
    res.status(200).json({ message: "Booking request rejected" });
  } catch (err) {
    console.error("❌ Error rejecting request:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ GET: Invite matches
router.get("/invite-matches/:rideId", async (req, res) => {
  try {
    const ride = await Ride.findById(req.params.rideId);
    if (!ride) return res.status(404).json({ error: "Ride not found" });

    const matches = await BookingRequest.find({
      from: ride.from,
      to: ride.to,
      status: "pending",
    });

    res.status(200).json({ matches });
  } catch (err) {
    console.error("❌ Error finding invite matches:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ POST: Invite customer to ride
router.post("/invite", async (req, res) => {
  try {
    const { customerId, rideId } = req.body;

    await BookingRequest.findOneAndUpdate(
      { customerId, status: "pending" },
      { rideId, status: "invited" }
    );

    res.status(200).json({ message: "Invite sent" });
  } catch (err) {
    console.error("❌ Error sending invite:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ GET: All bookings by customer
router.get("/customer/:customerId", async (req, res) => {
  try {
    const bookings = await BookingRequest.find({ customerId: req.params.customerId })
      .populate("rideId")
      .sort({ createdAt: -1 });

    res.status(200).json({ bookings });
  } catch (err) {
    console.error("❌ Booking fetch error (customer):", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Get all ride requests for a customer
router.get("/my-requests/:customerId", async (req, res) => {
  try {
    const { customerId } = req.params;

    const requests = await BookingRequest.find({ customerId })
      .populate({
        path: "rideId",
        populate: { path: "workerId", select: "name profilePhotoUrl" }, // driver info
      })
      .sort({ createdAt: -1 });

    res.json(requests);
  } catch (err) {
    console.error("❌ Error fetching ride requests:", err.message);
    res.status(500).json({ error: "Failed to fetch ride requests" });
  }
});


// ✅ GET: All bookings for a ride
router.get("/ride/:rideId", async (req, res) => {
  try {
    const bookings = await BookingRequest.find({ rideId: req.params.rideId })
      .populate("customerId", "name email");

    res.status(200).json({ bookings });
  } catch (err) {
    console.error("❌ Booking fetch error (ride):", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
