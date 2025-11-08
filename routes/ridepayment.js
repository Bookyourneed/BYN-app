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
  const { rideId, customerId } = req.body;

  try {
    const ride = await Ride.findById(rideId);
    const customer = await User.findById(customerId);

    if (!ride || !customer)
      return res.status(404).json({ error: "Ride or Customer not found" });

    // Create Stripe customer if missing
    if (!customer.stripeCustomerId) {
      const stripeCustomer = await stripe.customers.create({
        email: customer.email,
        name: customer.name,
      });
      customer.stripeCustomerId = stripeCustomer.id;
      await customer.save();
    }

    // 💰 Add $4.99 booking fee
    const basePrice = Number(ride.price);
    const bookingFee = 4.99;
    const total = parseFloat((basePrice + bookingFee).toFixed(2));

    // 💳 Create PaymentIntent (manual capture = hold funds)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(total * 100),
      currency: "cad",
      customer: customer.stripeCustomerId,
      capture_method: "manual", // ✅ hold payment
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      description: `Ride booking ${ride.from} → ${ride.to} ($${basePrice} + $4.99 fee)`,
      metadata: { rideId, customerId, basePrice, bookingFee, total },
    });

    res.json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      basePrice,
      bookingFee,
      total,
    });
  } catch (err) {
    console.error("❌ Create-intent error:", err.message);
    res.status(500).json({ error: "Failed to create payment intent" });
  }
});
// =====================================================
// ✅ Step 2: Confirm booking AFTER successful payment
//      + Socket + Email notify driver
// =====================================================
router.post("/confirm-booking", async (req, res) => {
  try {
    const { rideId, customerId, from, to, message, paymentIntentId } = req.body;

    if (!rideId || !customerId || !paymentIntentId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Core docs
    const ride = await Ride.findById(rideId).populate("workerId", "name email");
    if (!ride) return res.status(404).json({ error: "Ride not found" });

    const customer = await User.findById(customerId).select("name email");
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    // Upsert booking (status set to pending after Stripe success)
    const booking = await BookingRequest.findOneAndUpdate(
      { rideId, customerId },
      {
        $set: {
          rideId,
          customerId,
          from,
          to,
          price: ride.price,
          message,
          status: "pending",
          paymentIntentId,
          escrowStatus: "on_hold",
          rideStatus: "pending",
          updatedAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );

    // --- Realtime + Email ---
    const io = req.app.get("socketio");
    const { sendRideEmail } = require("../emailService");

    // Payload summary for UIs
    const payload = {
      bookingId: booking._id,
      rideId,
      customerId,
      customerName: customer.name,
      driverId: ride.workerId?._id,
      driverName: ride.workerId?.name,
      from: ride.from,
      to: ride.to,
      price: ride.price,
      date: ride.date,
      time: ride.time,
      message,
      status: booking.status,
      escrowStatus: booking.escrowStatus,
      rideStatus: booking.rideStatus,
      createdAt: booking.createdAt,
      updatedAt: booking.updatedAt,
    };

    // 1) Notify everyone in the ride room
    io.to(`ride_${rideId}`).emit("ride-request:new", payload);

    // 2) Notify the driver (personal ride channel)
    if (ride.workerId?._id) {
      io.to(`ride_driver_${ride.workerId._id}`).emit("ride-request:driver", payload);
    }

    // 3) Notify the customer (personal ride channel) for UI confirmation
    io.to(`ride_customer_${customerId}`).emit("ride-request:customer", payload);

    // 4) Email the driver about the new request
    if (ride.workerId?.email) {
      await sendRideEmail("rideRequest", {
        to: ride.workerId.email,
        customerName: customer.name,
        driverName: ride.workerId.name,
        from: ride.from,
        toLocation: ride.to,
        date: ride.date,
        time: ride.time,
      });
    }

    res.json({ success: true, booking });
  } catch (err) {
    console.error("❌ Confirm booking error:", err);
    res.status(500).json({ error: "Failed to confirm booking" });
  }
});


// ✅ Cancel ride by worker (refund if applicable) + Email + Socket alerts
router.post("/cancel-by-worker", async (req, res) => {
  try {
    const { rideId, workerId } = req.body;
    const io = req.app.get("socketio");
    const { sendRideEmail } = require("../emailService");

    const ride = await Ride.findById(rideId)
      .populate("workerId", "name email")
      .lean();

    if (!ride) return res.status(404).json({ error: "Ride not found" });

    // 🧩 Find all active or pending requests for this ride
    const requests = await BookingRequest.find({
      rideId,
      status: { $in: ["pending", "accepted", "active"] },
    }).populate("customerId", "name email");

    console.log(`🚫 Worker cancelled ride ${rideId}. ${requests.length} passengers affected.`);

    for (const req of requests) {
      // --- Refund or cancel logic ---
      if (req.status === "accepted" || req.escrowStatus === "on_hold") {
        // 💳 Stripe refund (mocked)
        // await stripe.refunds.create({ payment_intent: req.paymentIntentId });
        req.status = "refunded";
        req.rideStatus = "cancelled";
        req.escrowStatus = "refunded";
      } else {
        req.status = "cancelled";
        req.rideStatus = "cancelled";
      }
      await req.save();

      // --- Real-time socket notify customer ---
      io.to(`ride_customer_${req.customerId._id}`).emit("ride-cancelled", {
        rideId,
        message: `Your driver ${ride.workerId.name} cancelled the ride from ${ride.from} to ${ride.to}. Refunds (if applicable) will be processed automatically.`,
        status: req.status,
        refund: req.escrowStatus === "refunded",
      });

      // --- Email notify customer ---
      if (req.customerId?.email) {
        await sendRideEmail("rideDisputed", {
          to: req.customerId.email,
          customerName: req.customerId.name,
          driverName: ride.workerId.name,
          from: ride.from,
          toLocation: ride.to,
          date: ride.date,
          time: ride.time,
        });
      }
    }

    // --- Update ride status ---
    await Ride.findByIdAndUpdate(rideId, { status: "cancelled" });

    // --- Notify driver & admin sockets ---
    io.to(`ride_driver_${workerId}`).emit("ride-cancelled:driver", {
      rideId,
      message: "You cancelled this ride. All passengers have been refunded or notified.",
    });

    io.to(`ride_${rideId}`).emit("ride-cancelled:room", {
      rideId,
      status: "cancelled",
    });

    console.log(`📧 Emails sent to all passengers for ride ${rideId}`);

    res.json({
      success: true,
      message: "Ride cancelled successfully. Refunds issued where applicable.",
    });
  } catch (err) {
    console.error("❌ Cancel-by-worker error:", err);
    res.status(500).json({ error: "Failed to cancel ride" });
  }
});


// =====================================================
// ✅ Admin release funds
// =====================================================
router.post("/rides/:bookingId/release", async (req, res) => {
  try {
    const booking = await BookingRequest.findById(req.params.bookingId);
    if (!booking) return res.status(404).json({ error: "Booking not found" });

    const pi = await stripe.paymentIntents.capture(booking.paymentIntentId);

    booking.status = "paid";
    booking.escrowStatus = "released";
    await booking.save();

    res.json({ success: true, booking, stripePayment: pi });
  } catch (err) {
    console.error("❌ Release error:", err);
    res.status(500).json({ error: "Could not release payment" });
  }
});

// GET /api/ridepayment/check-booking
router.get("/check-booking", async (req, res) => {
  try {
    const { rideId, customerId } = req.query;

    if (!rideId || !customerId) {
      return res.status(400).json({ error: "rideId and customerId are required" });
    }

    const booking = await BookingRequest.findOne({ rideId, customerId });

    if (!booking) {
      return res.status(404).json(null); // no booking yet
    }

    res.json(booking);
  } catch (err) {
    console.error("❌ Error in check-booking:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});


// =====================================================
// ✅ Admin refund
// =====================================================
router.post("/rides/:bookingId/refund", async (req, res) => {
  try {
    const booking = await BookingRequest.findById(req.params.bookingId);
    if (!booking) return res.status(404).json({ error: "Booking not found" });

    const refund = await stripe.refunds.create({
      payment_intent: booking.paymentIntentId,
    });

    booking.status = "rejected";
    booking.escrowStatus = "refunded";
    await booking.save();

    res.json({ success: true, booking, stripeRefund: refund });
  } catch (err) {
    console.error("❌ Refund error:", err);
    res.status(500).json({ error: "Refund failed" });
  }
});

// =====================================================
// ✅ DRIVER ACCEPTS RIDE → Capture Payment + Notify Both
// =====================================================
router.post("/approve-request", async (req, res) => {
  const { requestId } = req.body;
  const io = getIO();

  try {
    const booking = await BookingRequest.findById(requestId)
      .populate({
        path: "rideId",
        populate: { path: "workerId", select: "name email" },
      })
      .populate("customerId", "name email");

    if (!booking)
      return res.status(404).json({ error: "Booking not found" });

    booking.status = "accepted";
    await booking.save();

    // ✅ Capture the payment once driver accepts
    if (booking.paymentIntentId) {
      try {
        const capture = await stripe.paymentIntents.capture(
          booking.paymentIntentId
        );
        console.log(`💳 Captured ride payment: ${capture.id}`);

        booking.escrowStatus = "captured";
        booking.capturedAt = new Date();
        await booking.save();
      } catch (err) {
        console.error("❌ Payment capture failed:", err.message);
      }
    }

    const customer = booking.customerId;
    const driver = booking.rideId?.workerId;
    const ride = booking.rideId;

    // =====================================================
    // 🔔 SOCKET NOTIFICATIONS
    // =====================================================
    io.to(`customer_${customer._id}`).emit("ride:update", {
      message: "🚗 Your ride has been accepted!",
      rideId: ride._id,
      status: "accepted",
    });

    io.to(`worker_${driver?._id}`).emit("ride:update", {
      message: "✅ You accepted a ride. Payment captured successfully!",
      rideId: ride._id,
      status: "accepted",
    });

    // =====================================================
    // ✉️ EMAIL NOTIFICATIONS
    // =====================================================

    // Customer email
    if (customer?.email) {
      await sendEmailSafe({
        to: customer.email,
        subject: "🚗 Your Ride Has Been Accepted!",
        html: `
          <h2>Hi ${customer.name || "there"},</h2>
          <p>Your ride request from <b>${ride.from}</b> to <b>${ride.to}</b> has been <b>accepted</b> by a driver.</p>
          <p>Your payment has been securely captured and is being held until the ride is completed.</p>
          <p><strong>Ride Details:</strong></p>
          <ul>
            <li>Date: ${ride.date || "TBD"}</li>
            <li>Time: ${ride.time || "TBD"}</li>
            <li>Driver: ${driver?.name || "Assigned Driver"}</li>
          </ul>
          <p>Thank you for using <b>Book Your Need</b>. You’re all set!</p>
          <br>
          <p>— The Book Your Need Team</p>
        `,
      });
    }

    // Driver email
    if (driver?.email) {
      await sendEmailSafe({
        to: driver.email,
        subject: "✅ Ride Accepted – Payment Captured",
        html: `
          <h2>Hi ${driver.name || "Driver"},</h2>
          <p>You’ve accepted a ride from <b>${ride.from}</b> to <b>${ride.to}</b>.</p>
          <p>The customer's payment has been <b>successfully captured</b> and is now held securely until the ride is completed.</p>
          <p>Once the customer marks the ride as complete, your earnings (minus platform fees) will be released to your wallet.</p>
          <p>Thank you for keeping BYN customers moving safely!</p>
          <br>
          <p>— The Book Your Need Team</p>
        `,
      });
    }

    // =====================================================
    // ✅ FINAL RESPONSE
    // =====================================================
    res.json({
      success: true,
      message: "Ride accepted, payment captured, and emails sent.",
    });
  } catch (err) {
    console.error("❌ Approve-request error:", err);
    res.status(500).json({ error: "Failed to approve booking." });
  }
});

// =====================================================
// ✅ Decline request → refund customer & lock request
// =====================================================
router.post("/decline-request", async (req, res) => {
  try {
    const { requestId } = req.body;
    const io = req.app.get("socketio");

    const request = await BookingRequest.findById(requestId)
      .populate("rideId")
      .populate("customerId", "name email")
      .lean();

    if (!request) return res.status(404).json({ error: "Request not found" });
    if (request.status !== "pending")
      return res.status(400).json({ error: "Request is not pending" });

    // ✅ Refund logic (mocked)
    if (request.paymentIntentId) {
      console.log(`💳 Refunded payment for ${request.paymentIntentId}`);
    }

    // ✅ Update to declined/refunded
    await BookingRequest.findByIdAndUpdate(requestId, {
      $set: {
        status: "declined",
        rideStatus: "cancelled",
        escrowStatus: "refunded",
        updatedAt: new Date(),
      },
    });

    const ride = await Ride.findById(request.rideId).populate("workerId", "name email");

    // --- SOCKET NOTIFICATIONS ---
    const payload = {
      requestId,
      rideId: request.rideId,
      customerName: request.customerId.name,
      driverName: ride.workerId.name,
      from: ride.from,
      to: ride.to,
      status: "declined",
    };

    io.to(`ride_customer_${request.customerId._id}`).emit("ride-declined", payload);
    io.to(`ride_driver_${ride.workerId._id}`).emit("ride-declined:driver", payload);
    io.to(`ride_${request.rideId}`).emit("ride-update", payload);

    // --- EMAIL NOTIFICATIONS ---
    await sendEmailSafe({
      to: request.customerId.email,
      subject: "🚗 Ride Declined & Refunded",
      html: `
        <h2>Hi ${request.customerId.name},</h2>
        <p>Your ride from <b>${ride.from}</b> to <b>${ride.to}</b> was declined.</p>
        <p>Your refund has been processed successfully.</p>
        <br><p>— Book Your Need</p>
      `,
    });

    await sendEmailSafe({
      to: ride.workerId.email,
      subject: "⚠️ Ride Declined Confirmation",
      html: `
        <h2>Hi ${ride.workerId.name},</h2>
        <p>The ride from <b>${ride.from}</b> to <b>${ride.to}</b> was declined.</p>
        <br><p>— Book Your Need</p>
      `,
    });

    res.json({
      success: true,
      message: "Request declined & refunded.",
    });
  } catch (err) {
    console.error("❌ Decline request error:", err);
    res.status(500).json({ error: "Failed to decline request" });
  }
});

// =====================================================
// ✅ Worker Marks Ride Complete → Start 48h Escrow Timer
// =====================================================
router.post("/worker-complete", async (req, res) => {
  try {
    const { rideId, workerId } = req.body;
    const io = req.app.get("socketio");

    // 🧩 1️⃣ Find the booking for this ride
console.log("🔍 Looking for booking with rideId:", rideId, "and workerId:", workerId);

const booking = await BookingRequest.findOne({
  rideId,
  $or: [
    { rideStatus: "accepted" },
    { rideStatus: "active" },
    { status: "accepted" },
    { status: "active" }
  ],
})
  .populate("customerId", "name email")
  .populate("rideId")
  .lean();

if (!booking) {
  console.warn("⚠️ No booking found matching rideId and status for worker:", workerId);
  return res.status(404).json({ error: "Booking not found or not accepted yet" });
}

console.log("✅ Found booking:", {
  bookingId: booking._id,
  rideStatus: booking.rideStatus,
  status: booking.status,
  customer: booking.customerId?.email,
});


    if (!booking)
      return res.status(404).json({ error: "Booking not found or not accepted yet" });

    await BookingRequest.findByIdAndUpdate(booking._id, {
      rideStatus: "worker_completed",
      escrowStatus: "pending_release",
      workerCompletedAt: new Date(),
      releaseDate: new Date(Date.now() + 48 * 60 * 60 * 1000),
    });

    const ride = await Ride.findByIdAndUpdate(
      rideId,
      { status: "worker_completed", updatedAt: new Date() },
      { new: true }
    ).populate("workerId", "name email");

    const payload = {
      rideId,
      bookingId: booking._id,
      customerId: booking.customerId._id,
      driverId: ride.workerId._id,
      from: ride.from,
      to: ride.to,
      date: ride.date,
      time: ride.time,
      status: "worker_completed",
      message: "Driver marked ride complete. Awaiting your confirmation.",
    };

    io.to(`ride_customer_${booking.customerId._id}`).emit("ride-worker-completed", payload);
    io.to(`ride_driver_${ride.workerId._id}`).emit("ride-worker-completed:driver", payload);
    io.to(`ride_${rideId}`).emit("ride-update", payload);

    if (booking.customerId?.email) {
      await sendEmailSafe({
        to: booking.customerId.email,
        subject: "🚗 Driver Marked Ride Complete",
        html: `
          <h2>Hi ${booking.customerId.name || "Customer"},</h2>
          <p>Your driver <b>${ride.workerId.name}</b> marked your ride from <b>${ride.from}</b> to <b>${ride.to}</b> as complete.</p>
          <p>Please confirm or payment will auto-release in 48 hours.</p>
          <br><p>— Book Your Need</p>
        `,
      });
    }

    res.json({
      success: true,
      message: "Ride marked complete. Awaiting customer confirmation or auto-release.",
    });
  } catch (err) {
    console.error("❌ Worker complete error:", err);
    res.status(500).json({ error: "Failed to mark ride complete" });
  }
});

// =====================================================
// ✅ Customer Completes Ride → Credit driver wallet
// =====================================================
router.post("/customer-complete", async (req, res) => {
  const { rideId } = req.body;
  const io = req.app.get("socketio");

  try {
    console.log("🚗 [CUSTOMER-COMPLETE] Incoming rideId:", rideId);

    // 🔹 Find booking tied to this ride
    const booking = await BookingRequest.findOne({ rideId })
      .populate("rideId")
      .populate("customerId");

    if (!booking) {
      console.warn("⚠️ [CUSTOMER-COMPLETE] Booking not found for ride:", rideId);
      return res.status(404).json({ error: "Booking not found" });
    }

    const ride = booking.rideId;
    const customer = booking.customerId;

    if (!ride) return res.status(400).json({ error: "Ride not found" });

    // 🔹 Ensure driver exists
    const driver = await Worker.findById(ride.workerId);
    if (!driver) return res.status(400).json({ error: "No driver assigned" });

    // 💵 Calculate payout
    const baseFare = Number(ride.price);
    const platformFee = 2; // BYN keeps $2 per ride
    const driverEarning = Math.max(0, baseFare - platformFee);

    console.log("💰 [CUSTOMER-COMPLETE] Base:", baseFare, "→ Driver earns:", driverEarning);

    // 💼 Credit driver's wallet
    driver.walletBalance = (driver.walletBalance || 0) + driverEarning;
    driver.walletHistory.push({
      type: "credit",
      amount: driverEarning,
      rideId: ride._id,
      date: new Date(),
      notes: "Ride completed payout",
    });
    await driver.save();

    // ✅ Mark both booking & ride completed
    booking.status = "completed";
    await booking.save();
    ride.status = "completed";
    await ride.save();

    console.log("📦 [CUSTOMER-COMPLETE] Booking + Ride updated to completed.");

    // 🔔 Socket notifications
    io.to(`worker_${driver._id}`).emit("ride:update", {
      rideId: ride._id,
      status: "completed",
      message: `🎉 Ride completed. You earned $${driverEarning}.`,
    });

    io.to(`customer_${customer._id}`).emit("ride:update", {
      rideId: ride._id,
      status: "completed",
      message: "✅ Ride marked complete and driver paid.",
    });

    // ✉️ Send emails
    await sendEmailSafe({
      to: driver.email,
      subject: "💰 Ride Payment Released",
      html: `
        <h2>Hi ${driver.name},</h2>
        <p>Your ride <b>${ride.from} → ${ride.to}</b> has been completed.</p>
        <p>You earned <b>$${driverEarning}</b> (after $2 BYN fee).</p>
        <br><p>— Book Your Need</p>
      `,
    });

    await sendEmailSafe({
      to: customer.email,
      subject: "✅ Ride Completed",
      html: `
        <h2>Hi ${customer.name || "Customer"},</h2>
        <p>Your ride <b>${ride.from} → ${ride.to}</b> has been completed successfully.</p>
        <p>Thanks for using Book Your Need 🚗</p>
      `,
    });

    console.log("📧 [CUSTOMER-COMPLETE] Emails sent to both driver and customer.");

    res.json({
      success: true,
      message: `Ride completed. Driver earned $${driverEarning}.`,
    });
  } catch (err) {
    console.error("❌ [CUSTOMER-COMPLETE] Error:", err);
    res.status(500).json({ error: "Failed to complete ride." });
  }
});

// =====================================================
// ⚠️ Step 4: Dispute Ride → Hold Payment
// =====================================================
router.post("/dispute", async (req, res) => {
  try {
    const { bookingId, reason, raisedBy } = req.body; // raisedBy = 'customer' or 'worker'

    const booking = await BookingRequest.findById(bookingId);
    if (!booking) return res.status(404).json({ error: "Booking not found" });

    booking.rideStatus = "dispute_pending";
    booking.escrowStatus = "disputed";
    booking.status = "disputed";
    await booking.save();

    // (optional) Email admin@bookyourneed.com
    console.log(`🚨 Dispute raised by ${raisedBy} for booking ${bookingId}: ${reason}`);

    res.json({
      success: true,
      message: "Dispute raised successfully. Payment is on hold until admin review.",
      booking,
    });
  } catch (err) {
    console.error("❌ Dispute error:", err);
    res.status(500).json({ error: "Failed to raise dispute" });
  }
});

// =====================================================
// 🕒 Step 5: Auto-Complete after 48h → Release Payment + Emails + Wallet Update
// =====================================================
router.post("/auto-complete", async (req, res) => {
  try {
    const io = req.app.get("socketio");
    const { sendRideEmail } = require("../emailService");
    const now = new Date();

    // 1️⃣ Find all rides where driver completed 48h ago, customer didn’t confirm
    const bookings = await BookingRequest.find({
      rideStatus: "worker_completed",
      escrowStatus: { $in: ["pending_release", "on_hold", "captured"] },
      releaseDate: { $lte: now },
    })
      .populate({
        path: "rideId",
        populate: { path: "workerId", select: "name email walletBalance walletHistory" },
      })
      .populate("customerId", "name email")
      .lean();

    if (!bookings.length)
      return res.json({ success: true, message: "No bookings ready for auto-release" });

    let releasedCount = 0;
    const failed = [];

    for (const booking of bookings) {
      try {
        const ride = booking.rideId;
        const driver = ride?.workerId;
        if (!ride || !driver) continue;

        // 2️⃣ Capture payment if not already captured
        try {
          const intent = await stripe.paymentIntents.retrieve(booking.paymentIntentId);
          if (intent.status === "requires_capture") {
            await stripe.paymentIntents.capture(booking.paymentIntentId);
            console.log(`💳 Auto-captured payment for booking ${booking._id}`);
          } else {
            console.log(`ℹ️ Payment already captured for booking ${booking._id}`);
          }
        } catch (err) {
          console.warn(`⚠️ Stripe capture skipped for ${booking._id}: ${err.message}`);
        }

        // 3️⃣ Credit driver's wallet (base fare minus $2 fee)
        const baseFare = Number(ride.price);
        const platformFee = 2;
        const earning = Math.max(0, baseFare - platformFee);

        const driverDoc = await require("../models/Worker").findById(driver._id);
        driverDoc.walletBalance = (driverDoc.walletBalance || 0) + earning;
        driverDoc.walletHistory.push({
          type: "credit",
          amount: earning,
          rideId: ride._id,
          date: new Date(),
          notes: "Auto-completed after 48h (system payout)",
        });
        await driverDoc.save();

        // 4️⃣ Update booking + ride statuses
        await BookingRequest.findByIdAndUpdate(booking._id, {
          rideStatus: "completed",
          escrowStatus: "released",
          status: "completed",
          customerConfirmedAt: new Date(),
        });

        await require("../models/Ride").findByIdAndUpdate(ride._id, {
          status: "completed",
          updatedAt: new Date(),
        });

        // 5️⃣ Notify both parties in real-time
        const payload = {
          rideId: ride._id,
          bookingId: booking._id,
          customerId: booking.customerId._id,
          driverId: driver._id,
          from: ride.from,
          to: ride.to,
          date: ride.date,
          time: ride.time,
          status: "completed",
          message: `✅ Ride auto-completed after 48 hours. $${earning} released to driver.`,
        };

        io.to(`ride_customer_${booking.customerId._id}`).emit("ride-auto-complete", payload);
        io.to(`ride_driver_${driver._id}`).emit("ride-auto-complete:driver", payload);
        io.to(`ride_${ride._id}`).emit("ride-update", payload);

        // 6️⃣ Email notifications
        if (booking.customerId?.email) {
          await sendRideEmail("rideConfirmed", {
            to: booking.customerId.email,
            customerName: booking.customerId.name,
            driverName: driver.name,
            from: ride.from,
            toLocation: ride.to,
            date: ride.date,
            time: ride.time,
          });
        }

        if (driver?.email) {
          await sendRideEmail("rideConfirmed", {
            to: driver.email,
            customerName: booking.customerId.name,
            driverName: driver.name,
            from: ride.from,
            toLocation: ride.to,
            date: ride.date,
            time: ride.time,
          });
        }

        releasedCount++;
        console.log(`💰 Auto-released booking ${booking._id} → Driver ${driver.email} got $${earning}`);
      } catch (err) {
        console.error(`❌ Failed to auto-release ${booking._id}:`, err.message);
        failed.push({ bookingId: booking._id, error: err.message });
      }
    }

    res.json({
      success: true,
      message: `Auto-complete finished: ${releasedCount} released, ${failed.length} failed.`,
      failed,
    });
  } catch (err) {
    console.error("❌ Auto-complete error:", err);
    res.status(500).json({ error: "Auto-complete process failed" });
  }
});


// =====================================================
// 🧹 Step 6: Cleanup completed & paid rides + Admin Email
// =====================================================
router.post("/cleanup-completed", async (req, res) => {
  try {
    const { sendEmailSafe } = require("../emailService");

    const completed = await BookingRequest.find({
      rideStatus: "completed",
      escrowStatus: "released",
    }).lean();

    if (!completed.length)
      return res.json({ success: true, message: "No completed rides to clean up" });

    const Chat = require("../models/RideChat");
    const Ride = require("../models/Ride");
    let cleanedCount = 0;

    for (const b of completed) {
      try {
        await Chat.deleteMany({ rideId: b.rideId });
        await Ride.findByIdAndUpdate(b.rideId, { isArchived: true });
        await BookingRequest.findByIdAndDelete(b._id);
        cleanedCount++;
      } catch (err) {
        console.error(`❌ Cleanup failed for booking ${b._id}:`, err.message);
      }
    }

    // 📧 Optional admin notification
    await sendEmailSafe({
      to: "admin@bookyourneed.com",
      subject: `🧹 Cleanup Completed (${cleanedCount} rides)`,
      html: `<p>${cleanedCount} completed & paid rides were archived successfully.</p>`,
      context: "cleanup-completed",
    });

    res.json({
      success: true,
      message: `🧹 Cleaned up ${cleanedCount} completed rides`,
      count: cleanedCount,
    });
  } catch (err) {
    console.error("❌ Cleanup error:", err);
    res.status(500).json({ error: "Failed to clean up completed rides" });
  }
});


module.exports = router;

