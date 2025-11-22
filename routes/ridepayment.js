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
// ✅ 1️⃣ CREATE PAYMENT INTENT (Auto-Capture Immediately)
// =====================================================
router.post("/create-intent", async (req, res) => {
  const { rideId, customerId, basePrice, finalPrice, seatsRequested = 1 } = req.body;

  try {
    const ride = await Ride.findById(rideId);
    const customer = await User.findById(customerId);

    if (!ride || !customer) {
      return res.status(404).json({ error: "Ride or Customer not found" });
    }

    // 🔐 Create Stripe Customer if missing
    if (!customer.stripeCustomerId) {
      const stripeCustomer = await stripe.customers.create({
        email: customer.email,
        name: customer.name,
      });

      customer.stripeCustomerId = stripeCustomer.id;
      await customer.save();
    }

    // 💵 Determine price
    let chargePrice = Number(finalPrice) || Number(basePrice) || Number(ride.pricePerSeat);

    if (!chargePrice || isNaN(chargePrice)) {
      chargePrice = Number(ride.pricePerSeat);
    }

    // Platform booking fee
    const bookingFee = 4.99;

    // 💰 Final amount customer pays
    const total = parseFloat((chargePrice + bookingFee).toFixed(2));

    // 💳 Stripe PaymentIntent (AUTO-CAPTURE)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(total * 100),
      currency: "cad",
      customer: customer.stripeCustomerId,
      automatic_payment_methods: { enabled: true },
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




// =====================================================
// ✅ 2️⃣ CONFIRM BOOKING (Mark Payment as CAPTURED)
// =====================================================
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
      totalPrice,
    } = req.body;

    if (!rideId || !customerId || !paymentIntentId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Fetch ride + customer
    const ride = await Ride.findById(rideId).populate("workerId", "name email");
    if (!ride) return res.status(404).json({ error: "Ride not found" });

    const customer = await User.findById(customerId).select("name email");
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    // 💵 Price fallback logic
    const seatPrice = Number(ride.pricePerSeat) || 0;
    const computedPrice = seatPrice * seatsRequested;
    const finalPrice = Number(totalPrice) || computedPrice;

    // 💳 Retrieve payment intent to confirm it was captured
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (intent.status !== "succeeded") {
      return res.status(400).json({
        error: "Payment not captured. Please try again.",
      });
    }

    // 💾 Create/update booking request
    const booking = await BookingRequest.findOneAndUpdate(
      { rideId, customerId },
      {
        $set: {
          rideId,
          customerId,
          from,
          to,
          seatsRequested,
          price: finalPrice,
          totalPrice: finalPrice,
          finalPrice: finalPrice,
          message,
          paymentIntentId,
          paymentStatus: "captured",   // 🔥 NEW
          requestStatus: "pending",    // waiting for driver
          updatedAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );

    // ⚡ SOCKET + EMAIL
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

    // Notify rooms
    io.to(`ride_${rideId}`).emit("ride-request:new", payload);
    if (ride.workerId?._id)
      io.to(`ride_driver_${ride.workerId._id}`).emit("ride-request:driver", payload);
    io.to(`ride_customer_${customerId}`).emit("ride-request:customer", payload);

    // Email notification
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
// 🚫 Worker cancels a ride (Refund all CAPTURED bookings)
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
      return res.status(403).json({
        error: "You are not authorized to cancel this ride",
      });
    }

    // 2️⃣ Fetch active bookings
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

      // 3️⃣ Only refund CAPTURED payments
      if (
        booking.paymentStatus === "captured" &&
        booking.paymentIntentId
      ) {
        try {
          await stripe.refunds.create({
            payment_intent: booking.paymentIntentId,
          });

          refunded = true;
          booking.paymentStatus = "refunded";

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

      // 5️⃣ SOCKET → notify customer
      io?.to(`ride_customer_${booking.customerId._id}`).emit("ride-cancelled", {
        bookingId: booking._id,
        rideId,
        refunded,
        status: booking.requestStatus,
        message: refunded
          ? `Your payment has been refunded.`
          : `The ride was cancelled — no payment was taken.`,
      });

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

    // 7️⃣ Mark ride cancelled
    ride.status = "cancelled";
    await ride.save();

    // 8️⃣ Notify worker UI
    io?.to(`ride_driver_${workerId}`).emit("ride-cancelled:driver", {
      rideId,
      message: "Ride cancelled. All passengers refunded or notified.",
    });

    io?.to(`ride_${rideId}`).emit("ride-cancelled:room", {
      rideId,
      status: "cancelled",
    });

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
// ✅ Step 5: Check if customer already has a VALID booking
// =====================================================
router.get("/check-booking", async (req, res) => {
  try {
    const { rideId, customerId } = req.query;

    if (!rideId || !customerId) {
      return res.status(400).json({
        error: "rideId and customerId are required",
      });
    }

    // Only consider ACTIVE (blocking) booking states
    const blockingStatuses = [
      "pending",          // waiting for driver
      "accepted",         // driver accepted, seats deducted
      "dispute_pending",  // if dispute ever added
    ];

    const booking = await BookingRequest.findOne({
      rideId,
      customerId,
      requestStatus: { $in: blockingStatuses },
    })
      .populate("rideId", "from to date time pricePerSeat status")
      .populate("customerId", "name email profilePhotoUrl")
      .lean();

    if (!booking) {
      return res.json({ exists: false, booking: null });
    }

    // Return clean booking object
    return res.json({
      exists: true,
      booking: {
        bookingId: booking._id,
        rideId: booking.rideId?._id,
        from: booking.from,
        to: booking.to,
        seatsRequested: booking.seatsRequested || 1,
        finalPrice: booking.finalPrice, // 🚀 the actual amount paid
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
// ✅ DRIVER ACCEPTS BOOKING
//    - Deduct seats
//    - Mark as accepted
//    - Update paymentStatus (already captured earlier)
//    - Block if seats unavailable
// =====================================================
router.post("/approve-request", async (req, res) => {
  try {
    const { requestId } = req.body;
    const io = req.app.get("socketio");
    const { sendRideEmail } = require("../emailService");

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

    const ride = booking.rideId;
    const driver = ride.workerId;
    const customer = booking.customerId;

    // =====================================================
    // 1️⃣ SEAT VALIDATION
    // =====================================================
    const seatsRequested = booking.seatsRequested || 1;

    if (ride.seatsAvailable < seatsRequested) {
      return res.status(400).json({
        error: "Not enough seats available.",
      });
    }

    // =====================================================
    // 2️⃣ DEDUCT SEATS
    // =====================================================
    ride.seatsAvailable -= seatsRequested;

    // If ride becomes full → update status
    if (ride.seatsAvailable <= 0) {
      ride.status = "full";
    }

    await ride.save();

    // =====================================================
    // 3️⃣ UPDATE BOOKING STATUS
    // =====================================================
    booking.requestStatus = "accepted";
    booking.acceptedAt = new Date();
    booking.paymentStatus = "captured"; // money already captured earlier
    await booking.save();

    // =====================================================
    // 4️⃣ SOCKET EVENTS
    // =====================================================

    // Notify customer
    io.to(`ride_customer_${customer._id}`).emit("booking:accepted", {
      bookingId: booking._id,
      rideId: ride._id,
      driverName: driver.name,
      seatsRequested,
      message: "Your ride request has been accepted.",
    });

    // Notify driver
    io.to(`ride_driver_${driver._id}`).emit("booking:accepted:driver", {
      bookingId: booking._id,
      rideId: ride._id,
      message: "You accepted a booking request.",
      seatsRemaining: ride.seatsAvailable,
    });

    // Notify ride room
    io.to(`ride_${ride._id}`).emit("ride:update", {
      rideId: ride._id,
      seatsAvailable: ride.seatsAvailable,
      status: ride.status,
    });

    // =====================================================
    // 5️⃣ EMAILS
    // =====================================================
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
      seatsRemaining: ride.seatsAvailable,
      rideStatus: ride.status,
    });

  } catch (err) {
    console.error("❌ Approve-request error:", err);
    res.status(500).json({ error: "Failed to approve booking" });
  }
});

// =====================================================
// ❌ DRIVER DECLINES BOOKING → REFUND + NOTIFY
// =====================================================
router.post("/decline-request", async (req, res) => {
  try {
    const { requestId } = req.body;
    const io = req.app.get("socketio");
    const { sendRideEmail } = require("../emailService");

    const booking = await BookingRequest.findById(requestId)
      .populate("customerId", "name email")
      .populate({
        path: "rideId",
        populate: { path: "workerId", select: "name email" }
      });

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    // Only pending requests can be declined
    if (booking.requestStatus !== "pending") {
      return res.status(400).json({
        error: "Only pending bookings can be declined.",
      });
    }

    const ride = booking.rideId;
    const customer = booking.customerId;
    const driver = ride.workerId;

    // =====================================================
    // 💳 REFUND (ONLY if payment was captured)
    // =====================================================
    let stripeRefund = null;

    if (
      booking.paymentStatus === "captured" && 
      booking.paymentIntentId
    ) {
      try {
        stripeRefund = await stripe.refunds.create({
          payment_intent: booking.paymentIntentId,
        });

        booking.paymentStatus = "refunded";
        booking.refundedAt = new Date();

        console.log(`💸 Refunded PI: ${booking.paymentIntentId}`);
      } catch (err) {
        console.error("❌ Refund failed:", err.message);
      }
    }

    // =====================================================
    // 📝 UPDATE BOOKING STATUS
    // =====================================================
    booking.requestStatus = "declined";
    booking.driverPaid = false;
    await booking.save();

    // =====================================================
    // 📡 SOCKET → CUSTOMER
    // =====================================================
    io.to(`ride_customer_${customer._id}`).emit("booking:declined", {
      bookingId: booking._id,
      rideId: ride._id,
      refunded: !!stripeRefund,
      message: `Your booking was declined by the driver.${
        stripeRefund ? " Your payment was refunded." : ""
      }`,
    });

    // 📡 SOCKET → DRIVER
    io.to(`ride_driver_${driver._id}`).emit("booking:declined:driver", {
      bookingId: booking._id,
      rideId: ride._id,
      message: "You declined the booking.",
    });

    // =====================================================
    // 📧 EMAIL NOTIFICATIONS
    // =====================================================
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
      message: "Booking declined successfully.",
      refunded: !!stripeRefund,
    });

  } catch (err) {
    console.error("❌ Decline request error:", err);
    res.status(500).json({ error: "Failed to decline booking" });
  }
});

// =====================================================
// ✅ DRIVER MARKS BOOKING COMPLETE (Start 48h Timer)
// =====================================================
router.post("/worker-complete", async (req, res) => {
  try {
    const { bookingId, workerId } = req.body;
    const io = req.app.get("socketio");
    const { sendRideEmail } = require("../emailService");

    if (!bookingId || !workerId) {
      return res.status(400).json({
        error: "bookingId and workerId are required"
      });
    }

    const booking = await BookingRequest.findById(bookingId)
      .populate("customerId", "name email")
      .populate({
        path: "rideId",
        populate: { path: "workerId", select: "name email" }
      });

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    // Ensure correct driver
    if (String(booking.rideId.workerId._id) !== String(workerId)) {
      return res.status(403).json({ error: "Unauthorized – driver mismatch" });
    }

    // Prevent double complete
    if (booking.requestStatus === "worker_completed") {
      return res.json({
        success: true,
        message: "Driver already marked this booking complete."
      });
    }

    // =====================================================
    // 1️⃣ UPDATE BOOKING – START 48h TIMER
    // =====================================================
    booking.driverComplete = true;
    booking.driverCompletedAt = new Date();
    booking.requestStatus = "worker_completed";

    // payment still captured, payout not done yet
    booking.payoutStatus = "pending";

    await booking.save();

    // =====================================================
    // 2️⃣ UPDATE RIDE STATUS (optional)
    // =====================================================
    // Only update ride if EVERY booking is completed
    const ride = booking.rideId;

    const incompleteExists = await BookingRequest.exists({
      rideId: ride._id,
      requestStatus: { $nin: ["worker_completed", "completed", "refunded"] }
    });

    if (!incompleteExists) {
      ride.status = "worker_completed";
      await ride.save();
    }

    // =====================================================
    // 3️⃣ SOCKET EVENTS
    // =====================================================

    // Notify customer
    io.to(`ride_customer_${booking.customerId._id}`).emit("ride-status-update", {
      bookingId,
      rideId: ride._id,
      status: "worker_completed",
      message: "Driver marked this ride complete. Awaiting final confirmation.",
    });

    // Notify driver
    io.to(`ride_driver_${workerId}`).emit("ride-status-update:driver", {
      bookingId,
      rideId: ride._id,
      status: "worker_completed",
    });

    // =====================================================
    // 4️⃣ EMAIL NOTIFICATION TO CUSTOMER
    // =====================================================
    if (booking.customerId.email) {
      await sendRideEmail("driverMarkedComplete", {
        to: booking.customerId.email,
        customerName: booking.customerId.name,
        driverName: ride.workerId.name,
        from: ride.from,
        toLocation: ride.to,
        date: ride.date,
        time: ride.time,
      });
    }

    return res.json({
      success: true,
      message: "Driver marked booking complete. Auto-release timer started (48h).",
    });

  } catch (err) {
    console.error("❌ Worker complete error:", err);
    res.status(500).json({ error: "Failed to mark ride complete" });
  }
});

// =====================================================
// ✅ CUSTOMER MARKS BOOKING COMPLETE → RELEASE WALLET PAYOUT
// =====================================================
router.post("/customer-complete", async (req, res) => {
  try {
    const { bookingId, customerId } = req.body;
    const io = req.app.get("socketio");
    const { sendRideEmail } = require("../emailService");

    if (!bookingId || !customerId) {
      return res.status(400).json({
        error: "bookingId and customerId are required",
      });
    }

    // Fetch booking + ride + driver
    const booking = await BookingRequest.findById(bookingId)
      .populate("customerId", "name email")
      .populate({
        path: "rideId",
        populate: {
          path: "workerId",
          select:
            "name email walletBalance walletHistory totalEarnings",
        },
      });

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    // Security check (only the real customer can complete)
    if (String(booking.customerId._id) !== String(customerId)) {
      return res.status(403).json({ error: "Unauthorized customer" });
    }

    const ride = booking.rideId;
    const driver = ride.workerId;
    const customer = booking.customerId;

    // Prevent double-confirm
    if (booking.customerComplete) {
      return res.json({
        success: true,
        message: "Customer already marked complete.",
        alreadyComplete: true,
      });
    }

    // =====================================================
    // 1️⃣ UPDATE BOOKING FLAGS & STATUS
    // =====================================================
    booking.customerComplete = true;
    booking.customerCompletedAt = new Date();

    // We only have two "done" states in BookingRequest enum:
    //  - worker_completed
    //  - completed
    // So when BOTH sides are done → mark booking.completed
    if (booking.driverComplete) {
      booking.requestStatus = "completed";
    }

    await booking.save();

    // =====================================================
    // 2️⃣ SOCKET + EMAIL NOTIFICATIONS
    // =====================================================
    io.to(`ride_driver_${driver._id}`).emit("booking:customerComplete", {
      bookingId,
      rideId: ride._id,
      message: `Customer ${customer.name} confirmed the ride.`,
    });

    io.to(`ride_customer_${customer._id}`).emit(
      "booking:customerComplete:customer",
      {
        bookingId,
        rideId: ride._id,
        message: "You confirmed this ride.",
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
        time: ride.time,
      });
    }

    // =====================================================
    // 3️⃣ PAYOUT LOGIC (INTERNAL WALLET)
    //     Only when BOTH driver + customer completed
    // =====================================================
    let payoutSuccess = false;

    if (
      booking.driverComplete &&
      booking.customerComplete &&
      !booking.driverPaid
    ) {
      console.log(
        "💰 Releasing payout to driver wallet for booking:",
        bookingId
      );

      const amount = Number(booking.finalPrice) || 0;

      // Commission rules (same as you had)
      let commission = 0.0445; // 4.45% base
      const previousEarnings = driver.totalEarnings || 0;

      if (previousEarnings >= 100 && previousEarnings < 300) {
        commission = 0.05;
      }

      if (previousEarnings >= 300 && amount > 0) {
        commission = 20 / amount; // flat $20 cap
      }

      const payout =
        commission >= 1
          ? amount - 20
          : parseFloat((amount * (1 - commission)).toFixed(2));

      // 💼 Update driver wallet
      driver.walletBalance = (driver.walletBalance || 0) + payout;

      driver.walletHistory.push({
        type: "credit",
        amount: payout,
        bookingId: booking._id,
        date: new Date(),
        released: true,
        notes: `Ride payout. Base: $${amount}, Commission: ${
          commission >= 1 ? "$20 flat" : (commission * 100).toFixed(2) + "%"
        }.`,
      });

      driver.totalEarnings = (driver.totalEarnings || 0) + payout;
      await driver.save();

      // Mark booking as paid out
      booking.driverPaid = true;
      booking.paidOutAt = new Date();
      booking.payoutStatus = "paid";
      await booking.save();

      // Live wallet update to driver
      io.to(`ride_driver_${driver._id}`).emit("wallet:update", {
        walletBalance: driver.walletBalance,
      });

      payoutSuccess = true;
    }

    // =====================================================
    // 4️⃣ IF ALL BOOKINGS ARE DONE → CLOSE THE RIDE
    // =====================================================
    try {
      const rideId = ride._id;

      const hasOpenBookings = await BookingRequest.exists({
        rideId,
        // any booking that is NOT completed or refunded keeps the ride "open"
        requestStatus: { $nin: ["completed", "refunded", "declined"] },
      });

      if (!hasOpenBookings) {
        ride.status = "completed"; // final state shown in MyRides "Completed" tab
        await ride.save();

        // Push status update to driver's MyRides via socket
        io.to(`ride_driver_${driver._id}`).emit("ride-status-update", {
          rideId,
          status: "completed",
        });
      }
    } catch (statusErr) {
      console.error(
        "⚠️ Failed to sync ride status after customer-complete:",
        statusErr
      );
    }

    return res.json({
      success: true,
      message: "Customer marked ride complete.",
      payoutSuccess,
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

