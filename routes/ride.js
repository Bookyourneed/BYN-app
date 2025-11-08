
const express = require("express");
const router = express.Router();
const Ride = require("../models/Ride");
const BookingRequest = require("../models/BookingRequest");
const CustomerRequest = require("../models/CustomerRequest");
const Worker = require("../models/Worker");
const User = require("../models/User");


const RideChat = require("../models/RideChat");

const { sendEmail } = require("../emailService");

// ✅ POST: Create new ride with bookingType + rideOptions + dropOffNotes
router.post("/post", async (req, res) => {
  try {
    const {
      workerId,
      from,
      to,
      date,
      time,
      price,
      seatsAvailable,
      pickupLocation,
      stops,
      bookingType,
      rideOptions,
      dropOffNotes,
    } = req.body;

    console.log("📦 POST /ride -> body:", req.body);

    // ✅ Validation
    const missingFields = [];
    if (!workerId?.toString().trim()) missingFields.push("workerId");
    if (!from?.toString().trim()) missingFields.push("from");
    if (!to?.toString().trim()) missingFields.push("to");
    if (!date?.toString().trim()) missingFields.push("date");
    if (!time?.toString().trim()) missingFields.push("time");
    if (price === undefined || isNaN(price)) missingFields.push("price");
    if (seatsAvailable === undefined || isNaN(seatsAvailable)) missingFields.push("seatsAvailable");
    if (!pickupLocation?.toString().trim()) missingFields.push("pickupLocation");

    if (missingFields.length > 0) {
      return res.status(400).json({
        error: `Missing or invalid fields: ${missingFields.join(", ")}`,
      });
    }

    if (rideOptions && typeof rideOptions !== "object") {
      return res.status(400).json({
        error: "rideOptions must be an object (e.g. { luggage: 'large', winterTires: true })",
      });
    }

    // ✅ Validate stops
    const validStops = Array.isArray(stops)
      ? stops.filter((s) => s.name && s.price && s.pickup && s.time)
      : [];

    // ✅ Create ride
    const ride = new Ride({
      workerId,
      from,
      to,
      date,
      time,
      price: parseFloat(price),
      seatsAvailable: parseInt(seatsAvailable),
      pickupLocation,
      stops: validStops,
      bookingType: bookingType || "manual",
      rideOptions: rideOptions || {},
      dropOffNotes: dropOffNotes || "",
      passengers: [], // ✅ keep empty — passengers added after booking
      status: "active",
    });

    await ride.save();
    console.log("✅ Ride saved:", ride._id);

    res.status(200).json({
      message: "✅ Ride posted successfully",
      ride,
    });
  } catch (err) {
    console.error("❌ Error saving ride:", err.message, err.stack);
    res.status(500).json({ error: "Server error while posting ride" });
  }
});

// ✅ SMART RIDE SEARCH – includes worker profilePhotoUrl
router.post("/search", async (req, res) => {
  try {
    const { from, to, date } = req.body;

    if (!from || !to || !date) {
      return res.status(400).json({ error: "Missing from, to, or date" });
    }

    const rides = await Ride.find({
      $and: [
        {
          $or: [
            { from },
            { "stops.pickup": from },
            { "stops.name": from },
          ],
        },
        {
          $or: [
            { to },
            { "stops.pickup": to },
            { "stops.name": to },
          ],
        },
        { date },
        { status: "active" },
      ],
    }).populate(
      "workerId",
      "name email profilePhotoUrl driverProfile"
    ); // ✅ make sure profilePhotoUrl comes through

    const processedRides = rides.map((ride) => {
      let matchedFrom = ride.from;
      let matchedTo = ride.to;
      let finalPrice = ride.price;
      let fromStop = null;
      let toStop = null;

      if (ride.stops && ride.stops.length > 0) {
        for (const stop of ride.stops) {
          if (stop.name === from || stop.pickup === from) fromStop = stop;
          if (stop.name === to || stop.pickup === to) toStop = stop;
        }

        if (fromStop && toStop) {
          matchedFrom = from;
          matchedTo = to;
          finalPrice =
            toStop.price - fromStop.price >= 0
              ? toStop.price - fromStop.price
              : toStop.price;
        } else if (fromStop) {
          matchedFrom = from;
          finalPrice = fromStop.price;
        } else if (toStop) {
          matchedTo = to;
          finalPrice = toStop.price;
        }
      }

      return {
        ...ride.toObject(),
        matchedFrom,
        matchedTo,
        finalPrice,
      };
    });

    res.json(processedRides);
  } catch (err) {
    console.error("❌ Ride search error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/preview/:rideId", async (req, res) => {
  try {
    const { from, to } = req.query;

    const ride = await Ride.findById(req.params.rideId).populate("workerId", "name profilePhotoUrl driverProfile");
    if (!ride) return res.status(404).json({ error: "Ride not found" });

    let matchedFrom = ride.from;
    let matchedTo = ride.to;
    let finalPrice = ride.price;

    if (ride.stops?.length && (from || to)) {
      let fromStop = null;
      let toStop = null;

      for (const stop of ride.stops) {
        if ((stop.name === from || stop.pickup === from) && !fromStop) fromStop = stop;
        if ((stop.name === to || stop.pickup === to) && !toStop) toStop = stop;
      }

      if (fromStop && toStop) {
        matchedFrom = from;
        matchedTo = to;
        finalPrice = Math.max(toStop.price - fromStop.price, toStop.price);
      } else if (toStop) {
        matchedTo = to;
        finalPrice = toStop.price;
      } else if (fromStop) {
        matchedFrom = from;
        finalPrice = fromStop.price;
      }
    }

    return res.status(200).json({
      ...ride.toObject(),
      matchedFrom,
      matchedTo,
      finalPrice,
    });
  } catch (err) {
    console.error("❌ Error fetching ride preview:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// =====================================================
// ✅ GET My Rides (Driver / Worker) — Active, Past, Completed, Cancelled, Disputed
// =====================================================
router.get("/my-rides/:workerId", async (req, res) => {
  try {
    const { workerId } = req.params;
    if (!workerId) {
      return res.status(400).json({ error: "Missing workerId" });
    }

    const today = new Date().toISOString().split("T")[0];

    // 🧭 Fetch ALL rides for this worker
    const rides = await Ride.find({ workerId })
      .sort({ date: -1, time: 1 })
      .lean();

    // 🧠 Normalize and enrich ride data
    const formatted = rides.map((r) => {
      const status = r.status || "active";
      const rideStatus = r.rideStatus || status;

      const isArchived = Boolean(r.isArchived);
      const isCancelled = Boolean(r.isCancelled);
      const isWorkerCompleted =
        status === "worker_completed" || rideStatus === "worker_completed";
      const isDisputed =
        status === "disputed" || rideStatus === "disputed" || r.escrowStatus === "disputed";

      // Flag if ride is "today"
      const rideDate = r.date ? r.date.toString().split("T")[0] : null;
      const isTodayRide = rideDate === today;

      // 🏷️ Display-friendly status
      let displayStatus = status;
      if (isWorkerCompleted) displayStatus = "worker_completed";
      if (isDisputed) displayStatus = "disputed";

      return {
        ...r,
        status: displayStatus,
        rideStatus,
        isArchived,
        isCancelled,
        isWorkerCompleted,
        isDisputed,
        isTodayRide,
      };
    });

    // ✅ Include all useful rides (including worker_completed + disputed)
    const prioritized = formatted.filter(
      (r) =>
        [
          "active",
          "pending",
          "accepted",
          "completed",
          "cancelled",
          "worker_completed",
          "disputed",
        ].includes(r.status) || r.isTodayRide
    );

    res.status(200).json(prioritized);
  } catch (err) {
    console.error("❌ Failed to fetch rides:", err);
    res.status(500).json({ error: "Server error" });
  }
});


// ✅ PUT: Update ride with full editable fields
router.put("/update/:rideId", async (req, res) => {
  try {
    const {
      date,
      time,
      price,
      seatsAvailable,
      pickupLocation,
      stops,
      extras,
      luggage,
      backRow,
      bookingType,
    } = req.body;

    const updatedFields = {
      date,
      time,
      price,
      seatsAvailable,
      pickupLocation,
      stops,
      extras,
      luggage,
      backRow,
      bookingType,
    };

    const updatedRide = await Ride.findByIdAndUpdate(
      req.params.rideId,
      updatedFields,
      { new: true }
    )
      .populate("workerId", "name email")
      .populate("passengers.userId", "name email"); // ✅ populate user info inside passengers

    if (!updatedRide) return res.status(404).json({ error: "Ride not found" });

    // ✅ Email to driver
    if (updatedRide.workerId?.email) {
      try {
        await sendEmail({
          to: updatedRide.workerId.email,
          subject: "✅ Your Ride Details Were Updated",
          html: `
            <h2>Hi ${updatedRide.workerId.name || "Driver"},</h2>
            <p>Your ride from <strong>${updatedRide.from}</strong> to <strong>${updatedRide.to}</strong> has been updated.</p>
            <p><b>New Details:</b></p>
            <ul>
              <li>Date: ${updatedRide.date}</li>
              <li>Time: ${updatedRide.time}</li>
              <li>Price: $${updatedRide.price}</li>
              <li>Seats Available: ${updatedRide.seatsAvailable}</li>
            </ul>
            <p>Keep your passengers updated 🚗</p>
            <br/>
            <p>— Team BYN</p>
          `,
        });
      } catch (err) {
        console.error("❌ Failed to email driver about ride update:", err.message);
      }
    }

    // ✅ Emails to all passengers
    if (updatedRide.passengers?.length > 0) {
      for (const passenger of updatedRide.passengers) {
        const user = passenger.userId; // ✅ correct field
        if (!user?.email) continue;
        try {
          await sendEmail({
            to: user.email,
            subject: "ℹ️ Ride Update Notification",
            html: `
              <h2>Hi ${user.name || "Passenger"},</h2>
              <p>The ride you booked from <strong>${updatedRide.from}</strong> to <strong>${updatedRide.to}</strong> has been updated.</p>
              <p><b>Updated Details:</b></p>
              <ul>
                <li>Date: ${updatedRide.date}</li>
                <li>Time: ${updatedRide.time}</li>
                <li>Price: $${updatedRide.price}</li>
                <li>Seats Available: ${updatedRide.seatsAvailable}</li>
              </ul>
              <p>Please check your app for the latest information.</p>
              <br/>
              <p>— Team BYN</p>
            `,
          });
        } catch (err) {
          console.error(
            `❌ Failed to email passenger ${user.email} about ride update:`,
            err.message
          );
        }
      }
    }

    res
      .status(200)
      .json({ message: "✅ Ride updated & emails sent", ride: updatedRide });
  } catch (err) {
    console.error("❌ Error updating ride:", err);
    res.status(500).json({ error: "Server error" });
  }
});



// ✅ GET: Available rides matching customer search
router.get("/search", async (req, res) => {
  try {
    const { from, to, date, seats } = req.query;

    if (!from || !to || !date || !seats) {
      return res.status(400).json({ error: "Missing search parameters" });
    }

    const rides = await Ride.find({
      from,
      to,
      date,
      status: "active",
      seatsAvailable: { $gte: parseInt(seats) },
    }).sort({ time: 1 });

    res.status(200).json({ rides });
  } catch (err) {
    console.error("❌ Error fetching available rides:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ GET: Find matching available rides for customers
router.get("/available/:from/:to/:date/:seats", async (req, res) => {
  try {
    const { from, to, date, seats } = req.params;

    const rides = await Ride.find({
      from,
      to,
      date,
      status: "active",
      seatsAvailable: { $gte: parseInt(seats) },
    }).sort({ time: 1 });

    res.status(200).json(rides);
  } catch (err) {
    console.error("❌ Error fetching available rides:", err);
    res.status(500).json({ error: "Server error" });
  }
});


router.get("/user-rides/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    const rides = await Ride.find({ bookedBy: userId });
    const pending = rides.filter((r) => r.status === "pending");
    res.status(200).json({ pending });
  } catch (err) {
    console.error("❌ Error fetching user rides:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET a single ride by ID
router.get('/:id', async (req, res) => {
  try {
    const ride = await Ride.findById(req.params.id);
    if (!ride) {
      return res.status(404).json({ message: 'Ride not found' });
    }
    res.json(ride);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ✅ GET: Requests + Chats (deduplicated, auto-fix missing names)
router.get("/:rideId/requests-and-chats", async (req, res) => {
  try {
    const { rideId } = req.params;
    console.log("📡 Fetching requests and chats for rideId:", rideId);

    // 1️⃣ Fetch ride details
    const ride = await Ride.findById(rideId).lean();
    if (!ride) return res.status(404).json({ error: "Ride not found" });

    const today = new Date().toISOString().split("T")[0];
    console.log("📅 Today's date:", today);
    console.log("🛣️ Ride date:", ride.date);

    // 2️⃣ Fetch booking requests (pending / active / accepted)
    const requests = await BookingRequest.find({
      rideId,
      status: { $in: ["pending", "active", "accepted"] },
    })
      .populate("customerId", "name profilePhotoUrl email")
      .populate("rideId", "date time from to status")
      .lean();

    console.log("✅ Booking requests found:", requests.length);

    // 3️⃣ Fetch ride chat with sender info
    let rideChat = await RideChat.findOne({ rideId })
      .populate("messages.sender", "name profilePhotoUrl email")
      .lean();

    let chatParticipants = [];

    if (rideChat && rideChat.messages?.length) {
      // ✅ Repair missing sender info for messages (auto-populate)
      for (const msg of rideChat.messages) {
        if (
          msg.senderModel === "User" &&
          (!msg.sender?.name || !msg.sender?.profilePhotoUrl)
        ) {
          const user = await User.findById(msg.sender).select(
            "name profilePhotoUrl"
          );
          if (user) {
            msg.sender = {
              _id: user._id,
              name: user.name,
              profilePhotoUrl: user.profilePhotoUrl,
            };
          }
        }
      }

      // ✅ Deduplicate by sender (latest message only)
      const customerMsgs = rideChat.messages.filter(
        (m) => m.senderModel === "User"
      );

      const map = new Map();
      customerMsgs.forEach((m) => {
        const id = String(m.sender?._id || m.sender);
        const existing = map.get(id);
        if (!existing || new Date(m.timestamp) > new Date(existing.timestamp)) {
          map.set(id, {
            customerId: id,
            name: m.sender?.name || "Passenger",
            profilePhotoUrl: m.sender?.profilePhotoUrl || null,
            lastMessage: m.text,
            timestamp: m.timestamp,
          });
        }
      });

      chatParticipants = [...map.values()];
    }

    // 4️⃣ Filter out users who already have requests
    const requestIds = new Set(
      requests.map((r) => String(r.customerId?._id || r.customerId))
    );
    chatParticipants = chatParticipants.filter(
      (c) => !requestIds.has(String(c.customerId))
    );

    // ✅ Final response
    res.json({
      ride,
      requests,
      chatParticipants,
    });
  } catch (err) {
    console.error("❌ Error fetching requests+chats:", err);
    res.status(500).json({ error: "Failed to fetch ride requests+chats" });
  }
});



module.exports = router;
