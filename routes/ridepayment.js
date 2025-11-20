// routes/ridepayment.js
const express = require("express");
const router = express.Router();
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { sendEmailSafe } = require("../emailService"); // ✅ switched to safe version

const Ride = require("../models/Ride");
const Worker = require("../models/Worker");

const User = require("../models/User");
const BookingRequest = require("../models/BookingRequest");
const { getIO } = require("../socket"); // ✅ adjust path if needed


// =====================================================
// ✅ 1️⃣ Create PaymentIntent (Hold funds in escrow)
// =====================================================
router.post("/create-intent", async (req, res) => {
  const { rideId, customerId, basePrice, finalPrice, seatsRequested = 1 } = req.body;

  try {
    const ride = await Ride.findById(rideId);
    const customer = await User.findById(customerId);

    if (!ride || !customer) {
      return res.status(404).json({ error: "Ride or Customer not found" });
    }

    // 🔐 Ensure Stripe Customer exists
    if (!customer.stripeCustomerId) {
      const stripeCustomer = await stripe.customers.create({
        email: customer.email,
        name: customer.name,
      });
      customer.stripeCustomerId = stripeCustomer.id;
      await customer.save();
    }

    // 🔥 USE STOP PRICE or SEAT PRICE correctly
    let chargePrice = Number(finalPrice) || Number(basePrice);

    if (!chargePrice || isNaN(chargePrice)) {
      // fallback if frontend failed
      chargePrice = Number(ride.pricePerSeat);
    }

    // Booking fee
    const bookingFee = 4.99;

    // Final total customer pays
    const total = parseFloat((chargePrice + bookingFee).toFixed(2));

    // 💳 Create PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(total * 100),
      currency: "cad",
      customer: customer.stripeCustomerId,
      capture_method: "manual",
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      description: `Ride booking ${ride.from} → ${ride.to}`,
      metadata: {
        rideId,
        customerId,
        seatsRequested,
        basePrice: chargePrice,
        bookingFee,
        total,
      },
    });

    return res.json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      basePrice: chargePrice,
      bookingFee,
      total,
    });

  } catch (err) {
    console.error("❌ Create-intent error:", err);
    return res.status(500).json({ error: "Failed to create payment intent" });
  }
});


router.post("/confirm-booking", async (req, res) => {
  try {
    const {
      rideId,
      customerId,
      from,
      to,
      message,
      paymentIntentId,
      seatsRequested = 1,
      totalPrice, // <-- from frontend
    } = req.body;

    if (!rideId || !customerId || !paymentIntentId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Fetch ride & customer
    const ride = await Ride.findById(rideId).populate("workerId", "name email");
    if (!ride) return res.status(404).json({ error: "Ride not found" });

    const customer = await User.findById(customerId).select("name email");
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    // Price fallback (if frontend didn't send totalPrice)
    const seatPrice = Number(ride.pricePerSeat) || 0;
    const computedPrice = seatPrice * seatsRequested;
    const finalPrice = Number(totalPrice) || computedPrice;

    // Create / update booking
    const booking = await BookingRequest.findOneAndUpdate(
      { rideId, customerId },
      {
        $set: {
          rideId,
          customerId,
          from,
          to,
          seatsRequested,
          price: finalPrice,      // legacy field
          totalPrice: finalPrice, // new field
          finalPrice: finalPrice, // unified field
          message,
          paymentIntentId,
          requestStatus: "pending",
          updatedAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );

    // SOCKET + EMAIL
    const io = req.app.get("socketio");
    const { sendRideEmail } = require("../emailService");

    const payload = {
      bookingId: booking._id,
      rideId,
      customerId,
      customerName: customer.name,
      driverId: ride.workerId?._id,
      driverName: ride.workerId?.name,
      from,
      to,
      pricePerSeat: seatPrice,
      seatsRequested,
      total: finalPrice,
      totalPrice: finalPrice,
      finalPrice: finalPrice,
      date: ride.date,
      time: ride.time,
      message,
      requestStatus: booking.requestStatus,
      createdAt: booking.createdAt,
      updatedAt: booking.updatedAt,
    };

    // Notify ride room
    io.to(`ride_${rideId}`).emit("ride-request:new", payload);

    // Notify driver
    if (ride.workerId?._id) {
      io.to(`ride_driver_${ride.workerId._id}`).emit("ride-request:driver", payload);
    }

    // Notify customer
    io.to(`ride_customer_${customerId}`).emit("ride-request:customer", payload);

    // Send email to driver
    if (ride.workerId?.email) {
      await sendRideEmail("rideRequest", {
        to: ride.workerId.email,
        customerName: customer.name,
        driverName: ride.workerId.name,
        from,
        toLocation: to,
        date: ride.date,
        time: ride.time,
      });
    }

    return res.json({ success: true, booking });
  } catch (err) {
    console.error("❌ Confirm booking error:", err);
    res.status(500).json({ error: "Failed to confirm booking" });
  }
});


// =====================================================
// 🚫 Worker cancels a ride (refund all PAID bookings)
// =====================================================
router.post("/cancel-by-worker", async (req, res) => {
  try {
    const { rideId, workerId } = req.body;
    const io = req.app.get("socketio");
    const { sendRideEmail } = require("../emailService");

    if (!rideId || !workerId) {
      return res.status(400).json({ error: "Missing rideId or workerId" });
    }

    // 1️⃣ Fetch ride & verify ownership
    const ride = await Ride.findById(rideId).populate("workerId", "name email");
    if (!ride) return res.status(404).json({ error: "Ride not found" });

    if (String(ride.workerId?._id) !== String(workerId)) {
      return res
        .status(403)
        .json({ error: "You are not authorized to cancel this ride" });
    }

    // 2️⃣ Find all bookings that are still "active" in any way
    // (we will refund only those that actually have a paymentIntentId)
    const activeStatuses = [
      "pending",
      "accepted",
      "worker_completed",
      "dispute_pending",
      "confirmed",
    ];

    const bookings = await BookingRequest.find({
      rideId,
      requestStatus: { $in: activeStatuses },
    }).populate("customerId", "name email");

    console.log(
      `🚫 Worker cancelled ride ${rideId}. ${bookings.length} bookings affected.`
    );

    for (const booking of bookings) {
      let refunded = false;
      let stripeRefund = null;

      // 3️⃣ Only refund those who actually PAID (have paymentIntentId)
      if (booking.paymentIntentId) {
        try {
          stripeRefund = await stripe.refunds.create({
            payment_intent: booking.paymentIntentId,
          });
          refunded = true;
          console.log(
            `💸 Refunded booking ${booking._id} (PI: ${booking.paymentIntentId})`
          );
        } catch (err) {
          console.error(
            `❌ Failed to refund booking ${booking._id}:`,
            err.message
          );
        }
      }

      // 4️⃣ Update booking status
      booking.requestStatus = refunded ? "refunded" : "cancelled_by_driver";
      booking.rideStatus = booking.requestStatus;
      booking.updatedAt = new Date();
      booking.driverPaid = false;
      await booking.save();

      // 5️⃣ SOCKET → notify customer app
      if (io) {
        io.to(`ride_customer_${booking.customerId._id}`).emit("ride-cancelled", {
          bookingId: booking._id,
          rideId,
          refunded,
          status: booking.requestStatus,
          message: `Your driver ${ride.workerId.name} cancelled this ride. ${
            refunded
              ? "Your payment (including booking fee) will be refunded."
              : "No payment was captured, so no refund was needed."
          }`,
        });
      }

      // 6️⃣ EMAIL → notify customer
      if (booking.customerId?.email) {
        await sendRideEmail("rideCancelled", {
          to: booking.customerId.email,
          customerName: booking.customerId.name,
          driverName: ride.workerId.name,
          from: ride.from,
          toLocation: ride.to,
          date: ride.date,
          time: ride.time,
        });
      }
    }

    // 7️⃣ Mark ride fully cancelled so it won't appear as bookable / payable
    ride.status = "cancelled";
    await ride.save();

    // 8️⃣ Notify worker UI
    if (io) {
      io.to(`ride_driver_${workerId}`).emit("ride-cancelled:driver", {
        rideId,
        message:
          "You cancelled this ride. All passengers have been refunded (if paid) or notified.",
      });

      io.to(`ride_${rideId}`).emit("ride-cancelled:room", {
        rideId,
        status: "cancelled",
      });
    }

    console.log(`📧 All cancellation emails sent for ride ${rideId}`);

    return res.json({
      success: true,
      message:
        "Ride cancelled. All active bookings updated and refunds issued where applicable.",
    });
  } catch (err) {
    console.error("❌ Cancel-by-worker error:", err);
    return res.status(500).json({ error: "Failed to cancel ride" });
  }
});


// =====================================================
// ✅ Step 4: Admin manually releases funds to driver
// =====================================================
router.post("/rides/:bookingId/release", async (req, res) => {
  try {
    const bookingId = req.params.bookingId;

    // Fetch booking with customer + ride + driver
    const booking = await BookingRequest.findById(bookingId)
      .populate("customerId", "name email")
      .populate("rideId")
      .exec();

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    const ride = await Ride.findById(booking.rideId)
      .populate("workerId", "name email stripeAccountId")
      .exec();

    if (!ride) {
      return res.status(404).json({ error: "Ride not found" });
    }

    const driver = ride.workerId;

    // 🔴 Block release if not fully completed
    if (!booking.customerComplete || !booking.driverComplete) {
      return res.status(400).json({
        error: "Both customer and driver must complete the ride before releasing funds.",
      });
    }

    // 🔴 Check duplicate payments
    if (booking.requestStatus === "paid" || booking.driverPaid) {
      return res.status(400).json({
        error: "Funds were already released for this booking.",
      });
    }

    // 🔐 Stripe capture the PaymentIntent (we held it earlier)
    const captured = await stripe.paymentIntents.capture(
      booking.paymentIntentId
    );

    // 💸 Transfer funds to driver
    const transferAmount = Math.round(booking.finalPrice * 100); // in cents

    if (!driver.stripeAccountId) {
      return res.status(400).json({
        error: "Driver does not have a connected Stripe account.",
      });
    }

    const transfer = await stripe.transfers.create({
      amount: transferAmount,
      currency: "cad",
      destination: driver.stripeAccountId,
    });

    // Update booking
    booking.requestStatus = "paid";
    booking.driverPaid = true;
    booking.paidAt = new Date();
    await booking.save();

    // Check if ALL bookings under this ride are completed & paid
    const remaining = await BookingRequest.countDocuments({
      rideId: ride._id,
      requestStatus: { $ne: "paid" },
    });

    if (remaining === 0) {
      ride.status = "completed";
      await ride.save();
    }

    // SOCKET NOTIFICATIONS
    const io = req.app.get("socketio");

    io.to(`ride_driver_${driver._id}`).emit("payout:released", {
      bookingId,
      rideId: ride._id,
      amount: booking.finalPrice,
      message: "Admin has released your payout.",
    });

    io.to(`ride_customer_${booking.customerId._id}`).emit(
      "booking:finalized",
      {
        bookingId,
        rideId: ride._id,
        message: "Your payment has been finalized and released to the driver.",
      }
    );

    // EMAILS
    const { sendRideEmail } = require("../emailService");

    if (driver.email) {
      await sendRideEmail("payoutReleased", {
        to: driver.email,
        driverName: driver.name,
        amount: booking.finalPrice,
        from: ride.from,
        toLocation: ride.to,
        date: ride.date,
        time: ride.time,
      });
    }

    if (booking.customerId?.email) {
      await sendRideEmail("rideCompleted", {
        to: booking.customerId.email,
        customerName: booking.customerId.name,
        driverName: driver.name,
        from: ride.from,
        toLocation: ride.to,
        date: ride.date,
        time: ride.time,
      });
    }

    res.json({
      success: true,
      booking,
      stripeCapture: captured,
      stripeTransfer: transfer,
    });
  } catch (err) {
    console.error("❌ Release funds error:", err);
    res.status(500).json({ error: "Could not release payment" });
  }
});

// =====================================================
// ✅ Step 5: Check if customer already has a booking on this ride
// =====================================================
router.get("/check-booking", async (req, res) => {
  try {
    const { rideId, customerId } = req.query;

    if (!rideId || !customerId) {
      return res.status(400).json({
        error: "rideId and customerId are required",
      });
    }

    // We only care about ACTIVE bookings
    const booking = await BookingRequest.findOne({
      rideId,
      customerId,
      requestStatus: { $in: ["pending", "accepted", "paid", "active"] },
    })
      .populate("rideId", "from to date time pricePerSeat status")
      .populate("customerId", "name email profilePhotoUrl")
      .lean();

    if (!booking) {
      return res.json({ exists: false, booking: null });
    }

    // Return a SAFE booking object (no Stripe fields)
    return res.json({
      exists: true,
      booking: {
        bookingId: booking._id,
        rideId: booking.rideId?._id,
        from: booking.from,
        to: booking.to,
        pricePerSeat: booking.pricePerSeat || booking.finalPrice,
        seatsRequested: booking.seatsRequested || 1,
        message: booking.message || "",
        requestStatus: booking.requestStatus,
        driverComplete: booking.driverComplete || false,
        customerComplete: booking.customerComplete || false,
        createdAt: booking.createdAt,
      },
    });

  } catch (err) {
    console.error("❌ Error in check-booking:", err);
    return res.status(500).json({ error: "Server error" });
  }
});


// =====================================================
// ✅ Step 6: Admin Refund (manual override)
// =====================================================
router.post("/rides/:bookingId/refund", async (req, res) => {
  try {
    const bookingId = req.params.bookingId;

    // Fetch booking with rider + ride info
    const booking = await BookingRequest.findById(bookingId)
      .populate("customerId", "name email")
      .populate("rideId")
      .exec();

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    const ride = await Ride.findById(booking.rideId)
      .populate("workerId", "name email")
      .exec();

    if (!ride) {
      return res.status(404).json({ error: "Ride not found" });
    }

    // ❌ prevent duplicate refund
    if (booking.requestStatus === "refunded") {
      return res.status(400).json({ error: "Booking already refunded" });
    }

    if (!booking.paymentIntentId) {
      return res.status(400).json({
        error: "No paymentIntent found — cannot refund.",
      });
    }

    // 💳 Stripe refund
    const stripeRefund = await stripe.refunds.create({
      payment_intent: booking.paymentIntentId,
    });

    // Update booking
    booking.requestStatus = "refunded";
    booking.refundedAt = new Date();
    booking.driverPaid = false; // ensure payout can't occur
    await booking.save();

    // Check if all bookings are done → cancel ride automatically
    const remaining = await BookingRequest.countDocuments({
      rideId: ride._id,
      requestStatus: { $nin: ["refunded", "cancelled_by_driver"] },
    });

    if (remaining === 0) {
      ride.status = "cancelled";
      await ride.save();
    }

    const io = req.app.get("socketio");
    const { sendRideEmail } = require("../emailService");

    // SOCKET → notify customer
    io.to(`ride_customer_${booking.customerId._id}`).emit("booking:refunded", {
      bookingId,
      rideId: ride._id,
      message: "Your booking was refunded by an administrator.",
    });

    // SOCKET → notify driver
    io.to(`ride_driver_${ride.workerId._id}`).emit("booking:refunded:driver", {
      bookingId,
      rideId: ride._id,
      message: "A booking for your ride was refunded by admin.",
    });

    // EMAIL TO CUSTOMER
    if (booking.customerId?.email) {
      await sendRideEmail("rideRefunded", {
        to: booking.customerId.email,
        customerName: booking.customerId.name,
        from: ride.from,
        toLocation: ride.to,
        date: ride.date,
        time: ride.time,
      });
    }

    // EMAIL TO DRIVER
    if (ride.workerId?.email) {
      await sendRideEmail("adminRefundDriverNotice", {
        to: ride.workerId.email,
        driverName: ride.workerId.name,
        customerName: booking.customerId.name,
        from: ride.from,
        toLocation: ride.to,
        date: ride.date,
        time: ride.time,
      });
    }

    return res.json({
      success: true,
      booking,
      stripeRefund,
    });

  } catch (err) {
    console.error("❌ Admin refund error:", err);
    return res.status(500).json({ error: "Refund failed" });
  }
});

// =====================================================
// ✅ DRIVER ACCEPTS BOOKING (requestStatus = accepted)
//    (NO payment capture here — PI stays on hold)
// =====================================================
router.post("/approve-request", async (req, res) => {
  try {
    const { requestId } = req.body;
    const io = req.app.get("socketio");

    const booking = await BookingRequest.findById(requestId)
      .populate({
        path: "rideId",
        populate: { path: "workerId", select: "name email" }
      })
      .populate("customerId", "name email");

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    // Prevent double acceptance
    if (booking.requestStatus !== "pending") {
      return res.status(400).json({ error: "Booking already processed" });
    }

    // UPDATE BOOKING
    booking.requestStatus = "accepted";
    booking.acceptedAt = new Date();
    await booking.save();

    const customer = booking.customerId;
    const driver = booking.rideId.workerId;
    const ride = booking.rideId;

    // SOCKETS → notify both sides
    io.to(`ride_customer_${customer._id}`).emit("booking:accepted", {
      bookingId: booking._id,
      rideId: ride._id,
      driverName: driver.name,
      message: "Your ride request has been accepted."
    });

    io.to(`ride_driver_${driver._id}`).emit("booking:accepted:driver", {
      bookingId: booking._id,
      rideId: ride._id,
      message: "You accepted a booking request."
    });

    // EMAILS → both sides
    const { sendRideEmail } = require("../emailService");

    if (customer.email) {
      await sendRideEmail("bookingAcceptedCustomer", {
        to: customer.email,
        customerName: customer.name,
        driverName: driver.name,
        from: ride.from,
        toLocation: ride.to,
        date: ride.date,
        time: ride.time,
      });
    }

    if (driver.email) {
      await sendRideEmail("bookingAcceptedDriver", {
        to: driver.email,
        driverName: driver.name,
        customerName: customer.name,
        from: ride.from,
        toLocation: ride.to,
        date: ride.date,
        time: ride.time,
      });
    }

    return res.json({
      success: true,
      message: "Booking accepted successfully.",
      bookingId: booking._id,
    });

  } catch (err) {
    console.error("❌ Approve-request error:", err);
    res.status(500).json({ error: "Failed to approve booking" });
  }
});

// =====================================================
// ✅ DRIVER DECLINES BOOKING → Refund + Notify
// =====================================================
router.post("/decline-request", async (req, res) => {
  try {
    const { requestId } = req.body;
    const io = req.app.get("socketio");

    const booking = await BookingRequest.findById(requestId)
      .populate("customerId", "name email")
      .populate({
        path: "rideId",
        populate: { path: "workerId", select: "name email" }
      });

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    if (booking.requestStatus !== "pending") {
      return res.status(400).json({ error: "Only pending bookings can be declined." });
    }

    const ride = booking.rideId;
    const customer = booking.customerId;
    const driver = ride.workerId;

    // 💳 Process refund if payment intent exists
    let stripeRefund = null;
    if (booking.paymentIntentId) {
      try {
        stripeRefund = await stripe.refunds.create({
          payment_intent: booking.paymentIntentId,
        });
      } catch (err) {
        console.error("❌ Refund failed:", err.message);
      }
    }

    // UPDATE BOOKING
    booking.requestStatus = "declined";
    booking.refundedAt = new Date();
    booking.driverPaid = false;
    await booking.save();

    // SOCKET → customer
    io.to(`ride_customer_${customer._id}`).emit("booking:declined", {
      bookingId: booking._id,
      rideId: ride._id,
      refunded: !!stripeRefund,
      message: "Your booking was declined by the driver."
    });

    // SOCKET → driver
    io.to(`ride_driver_${driver._id}`).emit("booking:declined:driver", {
      bookingId: booking._id,
      rideId: ride._id,
      message: "You declined the booking."
    });

    // EMAILS
    const { sendRideEmail } = require("../emailService");

    if (customer.email) {
      await sendRideEmail("bookingDeclinedCustomer", {
        to: customer.email,
        customerName: customer.name,
        driverName: driver.name,
        from: ride.from,
        toLocation: ride.to,
        date: ride.date,
        time: ride.time,
        refunded: !!stripeRefund,
      });
    }

    if (driver.email) {
      await sendRideEmail("bookingDeclinedDriver", {
        to: driver.email,
        driverName: driver.name,
        customerName: customer.name,
        from: ride.from,
        toLocation: ride.to,
        date: ride.date,
        time: ride.time,
      });
    }

    return res.json({
      success: true,
      message: "Booking declined and refund processed.",
      refunded: !!stripeRefund,
    });

  } catch (err) {
    console.error("❌ Decline request error:", err);
    res.status(500).json({ error: "Failed to decline booking" });
  }
});

// =====================================================
// ✅ DRIVER MARKS BOOKING COMPLETE (new booking-based system)
// =====================================================
router.post("/worker-complete", async (req, res) => {
  try {
    const { bookingId, workerId } = req.body;
    const io = req.app.get("socketio");
    const { sendRideEmail } = require("../emailService");

    if (!bookingId || !workerId) {
      return res.status(400).json({ error: "bookingId and workerId are required" });
    }

    const booking = await BookingRequest.findById(bookingId)
      .populate("customerId", "name email")
      .populate({
        path: "rideId",
        populate: { path: "workerId", select: "name email" }
      });

    if (!booking) return res.status(404).json({ error: "Booking not found" });

    if (String(booking.rideId.workerId._id) !== String(workerId)) {
      return res.status(403).json({ error: "Unauthorized – driver mismatch" });
    }

    // prevent double complete
    if (booking.requestStatus === "worker_completed") {
      return res.json({ success: true, message: "Already marked complete." });
    }

    // UPDATE BOOKING
    booking.driverComplete = true;
    booking.driverCompletedAt = new Date();
    booking.requestStatus = "worker_completed";
    await booking.save();

    // UPDATE RIDE (optional but recommended)
    booking.rideId.rideStatus = "worker_completed";
    await booking.rideId.save();

    // SOCKET → notify customer
    io.to(`ride_customer_${booking.customerId._id}`).emit("ride-status-update", {
      bookingId,
      rideId: booking.rideId._id,
      status: "worker_completed",
    });

    // SOCKET → notify driver
    io.to(`ride_driver_${workerId}`).emit("ride-status-update:driver", {
      bookingId,
      rideId: booking.rideId._id,
      status: "worker_completed",
    });

    // EMAIL
    if (booking.customerId.email) {
      await sendRideEmail("driverMarkedComplete", {
        to: booking.customerId.email,
        customerName: booking.customerId.name,
        driverName: booking.rideId.workerId.name,
        from: booking.rideId.from,
        toLocation: booking.rideId.to,
        date: booking.rideId.date,
        time: booking.rideId.time,
      });
    }

    return res.json({
      success: true,
      message: "Booking marked complete by driver. Awaiting customer confirmation.",
    });

  } catch (err) {
    console.error("❌ Worker complete error:", err);
    res.status(500).json({ error: "Failed to mark ride complete" });
  }
});

// =====================================================
// ✅ CUSTOMER MARKS BOOKING COMPLETE + AUTO-PAYOUT
// =====================================================
router.post("/customer-complete", async (req, res) => {
  try {
    const { bookingId, customerId } = req.body;
    const io = req.app.get("socketio");
    const { sendRideEmail } = require("../emailService");

    if (!bookingId || !customerId) {
      return res.status(400).json({
        error: "bookingId and customerId are required"
      });
    }

    // Fetch booking
    const booking = await BookingRequest.findById(bookingId)
      .populate("customerId", "name email")
      .populate({
        path: "rideId",
        populate: { path: "workerId", select: "name email stripeAccountId" }
      });

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    // Security check
    if (String(booking.customerId._id) !== String(customerId)) {
      return res.status(403).json({ error: "Unauthorized customer" });
    }

    // Prevent double confirm
    if (booking.customerComplete) {
      return res.json({
        success: true,
        message: "Customer already marked complete.",
        alreadyComplete: true
      });
    }

    // Mark customer complete
    booking.customerComplete = true;
    booking.customerCompletedAt = new Date();
    booking.requestStatus = "completed";
    await booking.save();

    const ride = booking.rideId;
    const customer = booking.customerId;
    const driver = ride.workerId;

    // Notify driver
    io.to(`ride_driver_${driver._id}`).emit("booking:customerComplete", {
      bookingId,
      rideId: ride._id,
      message: `Customer ${customer.name} confirmed the ride.`
    });

    // Notify customer
    io.to(`ride_customer_${customer._id}`).emit(
      "booking:customerComplete:customer",
      {
        bookingId,
        rideId: ride._id,
        message: "You confirmed this ride."
      }
    );

    // Email → driver
    if (driver.email) {
      await sendRideEmail("customerMarkedComplete", {
        to: driver.email,
        driverName: driver.name,
        customerName: customer.name,
        from: ride.from,
        toLocation: ride.to,
        date: ride.date,
        time: ride.time
      });
    }

    // =====================================================
    // ⭐ AUTO-PAYOUT (NEW!)
    // =====================================================
    let payoutSuccess = false;

    if (booking.driverComplete && booking.customerComplete) {
      console.log("🔵 Both sides completed → releasing payout now.");

      try {
        // release full payment for this booking only
        const transfer = await stripe.transfers.create({
          amount: Math.round(Number(booking.finalPrice) * 100),
          currency: "cad",
          destination: driver.stripeAccountId,
          transfer_group: `ride_${ride._id}`
        });

        payoutSuccess = true;
        booking.driverPaid = true;
        booking.paidOutAt = new Date();
        await booking.save();

        io.to(`ride_driver_${driver._id}`).emit("booking:payoutReleased", {
          bookingId,
          amount: booking.finalPrice
        });

        io.to(`ride_customer_${customer._id}`).emit("booking:payoutReleased", {
          bookingId
        });

      } catch (err) {
        console.error("❌ Stripe payout failed:", err.message);
      }
    }

    return res.json({
      success: true,
      message: "Customer marked booking complete.",
      payoutSuccess
    });

  } catch (err) {
    console.error("❌ Customer complete error:", err);
    return res.status(500).json({ error: "Failed to complete booking" });
  }
});

// =====================================================
// ✅ Step 4: Raise Dispute on Booking (new booking-based system)
// =====================================================
router.post("/dispute", async (req, res) => {
  try {
    const { bookingId, reason, raisedBy } = req.body;
    const io = req.app.get("socketio");
    const { sendRideEmail } = require("../emailService");

    if (!bookingId || !reason || !raisedBy) {
      return res.status(400).json({
        error: "bookingId, reason, and raisedBy are required",
      });
    }

    const booking = await BookingRequest.findById(bookingId)
      .populate("customerId", "name email")
      .populate({
        path: "rideId",
        populate: { path: "workerId", select: "name email" },
      });

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    const ride = booking.rideId;
    const customer = booking.customerId;
    const driver = ride.workerId;

    // 🔐 Prevent double disputes
    if (booking.requestStatus === "disputed") {
      return res.json({
        success: true,
        message: "A dispute for this booking already exists.",
      });
    }

    // Update booking
    booking.requestStatus = "disputed";
    booking.disputedBy = raisedBy;                 // "customer" | "worker"
    booking.disputeReason = reason;
    booking.disputedAt = new Date();
    await booking.save();

    // 🔔 SOCKET NOTIFICATIONS
    io.to(`ride_customer_${customer._id}`).emit("booking:disputed", {
      bookingId,
      rideId: ride._id,
      raisedBy,
      reason,
      message: "A dispute has been filed for this booking.",
    });

    io.to(`ride_driver_${driver._id}`).emit("booking:disputed:driver", {
      bookingId,
      rideId: ride._id,
      raisedBy,
      reason,
      message: "A dispute has been raised on this booking.",
    });

    // ✉️ EMAIL — notify customer/driver
    if (raisedBy === "customer" && driver.email) {
      await sendRideEmail("customerRaisedDispute", {
        to: driver.email,
        driverName: driver.name,
        customerName: customer.name,
        reason,
        from: ride.from,
        toLocation: ride.to,
        date: ride.date,
        time: ride.time,
      });
    }

    if (raisedBy === "worker" && customer.email) {
      await sendRideEmail("driverRaisedDispute", {
        to: customer.email,
        customerName: customer.name,
        driverName: driver.name,
        reason,
        from: ride.from,
        toLocation: ride.to,
        date: ride.date,
        time: ride.time,
      });
    }

    // 📧 Email admin
    if (process.env.ADMIN_EMAIL) {
      await sendRideEmail("adminDisputeNotice", {
        to: process.env.ADMIN_EMAIL,
        customerName: customer.name,
        driverName: driver.name,
        reason,
        from: ride.from,
        toLocation: ride.to,
        bookingId,
      });
    } else {
      console.log(
        `📨 Admin email missing. Dispute logged for booking ${bookingId}: ${reason}`
      );
    }

    return res.json({
      success: true,
      message: "Dispute raised successfully. Admin will review this case.",
    });

  } catch (err) {
    console.error("❌ Dispute error:", err);
    return res.status(500).json({ error: "Failed to raise dispute" });
  }
});

// =====================================================
// ✅ AUTO-COMPLETE + AUTO-PAYOUT + WALLET CREDIT (48h)
// =====================================================
router.post("/auto-complete", async (req, res) => {
  try {
    const { bookingId } = req.body;
    const io = req.app.get("socketio");
    const { sendRideEmail } = require("../emailService");

    if (!bookingId) {
      return res.status(400).json({ error: "bookingId is required" });
    }

    // Fetch booking fully
    const booking = await BookingRequest.findById(bookingId)
      .populate("customerId", "name email")
      .populate({
        path: "rideId",
        populate: { path: "workerId", select: "name email stripeAccountId walletBalance walletHistory" }
      });

    if (!booking) return res.status(404).json({ error: "Booking not found" });

    const ride = booking.rideId;
    const customer = booking.customerId;
    const driver = ride.workerId;

    // ❌ Block if dispute exists
    if (booking.requestStatus === "disputed") {
      return res.json({
        success: false,
        message: "Booking has a dispute — auto-complete blocked.",
      });
    }

    // ❌ Only auto-complete if driver marked done
    if (!booking.driverComplete || booking.customerComplete) {
      return res.json({
        success: false,
        message: "Booking not eligible for auto-complete.",
      });
    }

    // STEP 1 — Mark customer side complete
    booking.customerComplete = true;
    booking.customerCompletedAt = new Date();
    await booking.save();

    // STEP 2 — Calculate payout
    const baseFare = Number(booking.finalPrice || ride.price); 
    const stripeFee = 0.36;
    const platformFee = 2.0;
    const finalPayout = Math.max(0, baseFare - stripeFee - platformFee);

    let stripeCapture = null;
    let stripeTransfer = null;

    // STEP 3 — Capture + Payout
    try {
      if (!booking.paymentIntentId) {
        throw new Error("Missing paymentIntentId, cannot auto-capture.");
      }

      // Capture payment
      stripeCapture = await stripe.paymentIntents.capture(booking.paymentIntentId);

      // Stripe transfer (optional)
      if (driver.stripeAccountId) {
        stripeTransfer = await stripe.transfers.create({
          amount: Math.round(finalPayout * 100),
          currency: "cad",
          destination: driver.stripeAccountId,
          description: `BYN auto-payout for booking ${booking._id}`,
        });
      }

      // Mark booking paid
      booking.requestStatus = "paid";
      booking.escrowStatus = "released";
      booking.paidAt = new Date();
      await booking.save();

    } catch (err) {
      console.error("❌ AUTO-PAYOUT FAILED:", err.message);
    }

    // STEP 4 — ALWAYS CREDIT DRIVER WALLET (internal ledger)
    driver.walletBalance = (driver.walletBalance || 0) + finalPayout;

    driver.walletHistory.push({
      type: "credit",
      amount: finalPayout,
      bookingId: booking._id,
      rideId: ride._id,
      released: true,
      date: new Date(),
      notes: `Auto-complete payout (after $${(stripeFee + platformFee).toFixed(2)} fees)`,
    });

    await driver.save();

    // STEP 5 — If all bookings for ride are paid, mark ride completed
    const remaining = await BookingRequest.countDocuments({
      rideId: ride._id,
      requestStatus: { $nin: ["paid"] },
    });

    if (remaining === 0) {
      ride.status = "completed";
      await ride.save();
    }

    // STEP 6 — SOCKET notifications
    io.to(`ride_customer_${customer._id}`).emit("booking:autoPaid", {
      bookingId,
      rideId: ride._id,
      message: "Your booking was auto-completed after 48 hours.",
      payout: finalPayout,
    });

    io.to(`ride_driver_${driver._id}`).emit("booking:autoPaid:driver", {
      bookingId,
      rideId: ride._id,
      payout: finalPayout,
      message: `Auto-payout released: $${finalPayout}.`,
    });

    // STEP 7 — EMAIL notifications
    if (customer.email) {
      await sendRideEmail("autoCompleteCustomer", {
        to: customer.email,
        customerName: customer.name,
        driverName: driver.name,
        from: ride.from,
        toLocation: ride.to,
        date: ride.date,
        time: ride.time,
      });
    }

    if (driver.email) {
      await sendRideEmail("autoPayoutDriver", {
        to: driver.email,
        driverName: driver.name,
        customerName: customer.name,
        payout: finalPayout,
        from: ride.from,
        toLocation: ride.to,
        date: ride.date,
        time: ride.time,
      });
    }

    return res.json({
      success: true,
      message: `Auto-complete done. Driver earned $${finalPayout}.`,
      autoPayout: true,
    });

  } catch (err) {
    console.error("❌ Auto-complete error:", err);
    return res.status(500).json({ error: "Auto-complete failed" });
  }
});


// =====================================================
// 🧹 Step 6: Cleanup old completed bookings (SAFE VERSION)
//   • Does NOT delete booking
//   • Archives ride only when all bookings done
//   • Deletes ONLY chat threads
//   • Leaves wallet + payouts intact
// =====================================================
router.post("/cleanup-completed", async (req, res) => {
  try {
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - THIRTY_DAYS;

    const Chat = require("../models/RideChat");
    const Ride = require("../models/Ride");

    // 1️⃣ Find all fully completed & paid bookings older than 30 days
    const bookings = await BookingRequest.find({
      requestStatus: "paid",
      customerComplete: true,
      driverComplete: true,
      paidAt: { $lte: new Date(cutoff) },
      archived: { $ne: true },
    });

    if (!bookings.length) {
      return res.json({
        success: true,
        message: "No bookings eligible for cleanup",
      });
    }

    let cleanedCount = 0;

    for (const b of bookings) {
      try {
        // 2️⃣ Delete chat for this booking ONLY
        await Chat.deleteMany({
          rideId: b.rideId,
          customerId: b.customerId,
        });

        // 3️⃣ Mark booking archived (do NOT delete)
        b.archived = true;
        await b.save();

        cleanedCount++;

        // 4️⃣ Check if all bookings for this ride are archived → archive ride
        const remaining = await BookingRequest.countDocuments({
          rideId: b.rideId,
          archived: { $ne: true },
        });

        if (remaining === 0) {
          await Ride.findByIdAndUpdate(b.rideId, {
            isArchived: true,
            updatedAt: new Date(),
          });
        }

      } catch (err) {
        console.error(`❌ Cleanup failed for booking ${b._id}:`, err.message);
      }
    }

    return res.json({
      success: true,
      message: `Cleaned ${cleanedCount} old bookings safely.`,
      cleaned: cleanedCount,
    });

  } catch (err) {
    console.error("❌ Cleanup error:", err);
    res.status(500).json({ error: "Cleanup failed" });
  }
});


module.exports = router;

