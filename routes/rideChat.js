const express = require("express");
const router = express.Router();
const RideChat = require("../models/RideChat");
const User = require("../models/User");
const Worker = require("../models/Worker");
const Ride = require("../models/Ride");
const BookingRequest = require("../models/BookingRequest");
const CustomerRequest = require("../models/CustomerRequest");



// ✅ GET: All messages for a ride (flattened sender)
router.get("/:rideId", async (req, res) => {
  try {
    const chat = await RideChat.findOne({ rideId: req.params.rideId })
      .populate("customerId", "name profilePhotoUrl")
      .populate("workerId", "name profilePhotoUrl")
      .populate("messages.sender", "name profilePhotoUrl");

    if (!chat) return res.status(200).json({ messages: [] });

    // flatten sender
    const messages = chat.messages.map((m) => ({
      senderId: m.sender?._id?.toString() || m.sender?.toString(),
      senderName: m.sender?.name || undefined,
      senderPhoto: m.sender?.profilePhotoUrl || undefined,
      senderModel: m.senderModel,
      text: m.text,
      timestamp: m.timestamp,
      seen: m.seen,
    }));

    res.status(200).json({
      messages,
      participants: {
        customer: chat.customerId,
        worker: chat.workerId,
      },
    });
  } catch (err) {
    console.error("❌ Error fetching ride chat:", err.message);
    res.status(500).json({ error: "Failed to fetch ride chat" });
  }
});

// ✅ POST: Send a message (PRIVATE ROOM + Email Notification)
router.post("/send", async (req, res) => {
  try {
    const { rideId, roomId, senderId, senderModel, text } = req.body;

    if (!rideId || !roomId || !senderId || !senderModel || !text)
      return res.status(400).json({ error: "Missing required fields" });

    if (!text.trim())
      return res.status(400).json({ error: "Message cannot be empty" });

    const io = req.app.get("socketio");
    const { sendRideEmail } = require("../emailService");

    // Fetch ride
    const ride = await Ride.findById(rideId)
      .populate("workerId", "name email")
      .lean();
    if (!ride) return res.status(404).json({ error: "Ride not found" });

    // Find or create chat thread
    let chat = await RideChat.findOne({ rideId });
    if (!chat) {
      chat = new RideChat({
        rideId,
        customerId:
          senderModel === "User"
            ? senderId
            : ride.bookedBy, // fallback
        workerId: ride.workerId?._id,
        messages: [],
      });
    }

    // Ensure chat has customer
    if (!chat.customerId) chat.customerId = ride.bookedBy;

    // Fetch sender document
    let senderDoc = null;
    if (senderModel === "User") {
      senderDoc = await User.findById(senderId).select(
        "name email profilePhotoUrl"
      );
    } else {
      senderDoc = await Worker.findById(senderId).select(
        "name email profilePhotoUrl"
      );
    }

    // Decide email recipient
    let receiverEmail = null;
    let receiverName = null;

    if (senderModel === "User") {
      receiverEmail = ride.workerId?.email;
      receiverName = ride.workerId?.name;
    } else {
      // sender is worker → email customer
      const customerData = await User.findById(chat.customerId).select(
        "name email"
      );
      receiverEmail = customerData?.email;
      receiverName = customerData?.name;
    }

    // Create message
    const newMsg = {
      sender: senderId,
      senderModel,
      text,
      timestamp: new Date(),
      seen: false,
    };

    chat.messages.push(newMsg);
    chat.lastMessage = text;
    chat.lastMessageAt = new Date();
    await chat.save();

    // Flatten for frontend
    const flatMsg = {
      senderId,
      senderModel,
      senderName: senderDoc?.name,
      senderPhoto: senderDoc?.profilePhotoUrl || null,
      text,
      timestamp: newMsg.timestamp,
      seen: false,
    };

    // 🔥 Emit to PRIVATE ROOM (NOT ride_ room)
    io.to(roomId).emit("ride-message", {
      roomId,
      rideId,
      message: flatMsg,
    });

    io.to(roomId).emit("ride-chat-update", {
      roomId,
      rideId,
      lastMessage: text,
      timestamp: newMsg.timestamp,
      senderId,
      senderName: senderDoc?.name,
      senderPhoto: senderDoc?.profilePhotoUrl,
    });

    // 🔥 Email Notification (only if receiver exists)
    if (receiverEmail && receiverEmail !== senderDoc?.email) {
      await sendRideEmail("rideRequest", {
        to: receiverEmail,
        customerName:
          senderModel === "User" ? senderDoc?.name : receiverName,
        driverName:
          senderModel === "Worker" ? senderDoc?.name : receiverName,
        from: ride.from,
        toLocation: ride.to,
        date: ride.date,
        time: ride.time,
      });
      console.log("📧 Chat email sent:", receiverEmail);
    } else {
      console.log("⚠️ No valid receiver email found for chat message");
    }

    res.status(200).json({
      success: true,
      message: flatMsg,
    });
  } catch (err) {
    console.error("❌ Ride chat send error:", err);
    res.status(500).json({ error: "Failed to send ride chat message" });
  }
});



// ✅ POST: Create chat when booking request happens
router.post("/init", async (req, res) => {
  try {
    const { rideId, customerId, workerId, autoExpireAt } = req.body;

    let chat = await RideChat.findOne({ rideId });
    if (!chat) {
      chat = new RideChat({
        rideId,
        customerId,
        workerId,
        messages: [],
        autoExpireAt,
      });
      await chat.save();
    } else {
      if (autoExpireAt) {
        chat.autoExpireAt = autoExpireAt;
        await chat.save();
      }
    }

    res.status(200).json(chat);
  } catch (err) {
    console.error("❌ Error initializing ride chat:", err.message);
    res.status(500).json({ error: "Failed to initialize chat" });
  }
});

/// ✅ GET: All chats for a customer
router.get("/my-chats/:customerId", async (req, res) => {
  try {
    const { customerId } = req.params;

    const chats = await RideChat.find({ customerId })
      .populate("workerId", "name profilePhotoUrl")
      .populate("rideId", "from to price date time")
      .sort({ lastMessageAt: -1, updatedAt: -1 });

    const formatted = chats.map((c) => ({
      _id: c._id,
      rideId: c.rideId?._id,
      from: c.rideId?.from,
      to: c.rideId?.to,
      price: c.rideId?.price,
      date: c.rideId?.date,
      time: c.rideId?.time,
      lastMessage: c.lastMessage,
      lastMessageAt: c.lastMessageAt || c.updatedAt || c.createdAt,
      timestamp: c.lastMessageAt || c.updatedAt || c.createdAt,
      worker: c.workerId,
    }));

    res.json(formatted);
  } catch (err) {
    console.error("❌ Error fetching chats:", err.message);
    res.status(500).json({ error: "Failed to fetch chats" });
  }
});



module.exports = router;
