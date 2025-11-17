const express = require("express");
const router = express.Router();

const RideChat = require("../models/RideChat");
const Ride = require("../models/Ride");
const User = require("../models/User");
const Worker = require("../models/Worker");

const { sendChatEmail } = require("../emailService");

// Normalize ID
const norm = (id) =>
  typeof id === "string" ? id : id?._id || id?.id || "";

/* ======================================================
   🟣 WORKER — List passengers driver chatted with
====================================================== */
router.get("/participants/:workerId", async (req, res) => {
  try {
    const { workerId } = req.params;

    const chats = await RideChat.find({ workerId })
      .populate("rideId")
      .populate("customerId", "name profilePhotoUrl");

    const formatted = chats.map((c) => ({
      rideId: c.rideId?._id,
      customerId: c.customerId?._id,
      customerName: c.customerId?.name,
      customerPhoto: c.customerId?.profilePhotoUrl,
      lastMessage: c.lastMessage || "",
      lastTimestamp: c.lastMessageAt || c.updatedAt,
    }));

    res.json(formatted);
  } catch (err) {
    console.error("❌ Worker participants error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ======================================================
   🟦 LOAD CHAT: rideId + customerId
====================================================== */
router.get("/:rideId", async (req, res) => {
  try {
    const { rideId } = req.params;
    const { customerId } = req.query;

    if (!customerId)
      return res.status(400).json({ error: "customerId is required" });

    let chat = await RideChat.findOne({ rideId, customerId })
      .populate("rideId")
      .populate("customerId", "name email profilePhotoUrl")
      .populate("workerId", "name email profilePhotoUrl");

    // If missing → create it
    if (!chat) {
      const ride = await Ride.findById(rideId);
      if (!ride) return res.status(404).json({ error: "Ride not found" });

      chat = await RideChat.create({
        rideId,
        customerId,
        workerId: ride.workerId,
        messages: [],
      });

      chat = await RideChat.findById(chat._id)
        .populate("rideId")
        .populate("customerId", "name email profilePhotoUrl")
        .populate("workerId", "name email profilePhotoUrl");
    }

    res.json({
      rideId: chat.rideId?._id,
      customerId: chat.customerId?._id,
      workerId: chat.workerId?._id,
      messages: chat.messages,
    });
  } catch (err) {
    console.error("❌ rideChat GET error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ======================================================
   🟩 SEND MESSAGE (SOCKET + EMAIL)
====================================================== */

const chatCooldown = new Map(); // 5-minute cooldown

router.post("/send", async (req, res) => {
  try {
    const { rideId, roomId, sender, senderModel, text } = req.body;

    if (!rideId || !roomId || !sender || !text)
      return res.status(400).json({ error: "Missing fields" });

    const parts = roomId.split("-");
    const customerId = parts[1];
    const workerId = parts[2];

    if (!customerId || !workerId)
      return res.status(400).json({ error: "Invalid roomId format" });

    let chat = await RideChat.findOne({ rideId, customerId })
      .populate("rideId")
      .populate("customerId", "name email profilePhotoUrl")
      .populate("workerId", "name email profilePhotoUrl");

    // Create chat if missing
    if (!chat) {
      chat = await RideChat.create({
        rideId,
        customerId,
        workerId,
        messages: [],
      });

      chat = await RideChat.findById(chat._id)
        .populate("rideId")
        .populate("customerId", "name email profilePhotoUrl")
        .populate("workerId", "name email profilePhotoUrl");
    }

    // ⭐ MUST MATCH SCHEMA
    const msg = {
      text,
      sender, // <<< FIXED HERE (must be sender)
      senderModel,
      timestamp: new Date(),
    };

    chat.messages.push(msg);
    await chat.save();

    /* Emit the message */
    req.io.to(roomId).emit("ride-message", {
      roomId,
      message: msg,
    });

    /* EMAIL NOTIFICATION — 5 MIN COOLDOWN */
    const cooldownKey = `${rideId}-${customerId}-${senderModel}`;
    const now = Date.now();

    if (!chatCooldown.has(cooldownKey) ||
        now - chatCooldown.get(cooldownKey) > 5 * 60 * 1000) {
    
      chatCooldown.set(cooldownKey, now);

      if (senderModel === "User") {
        await sendChatEmail({
          to: chat.workerId.email,
          senderName: chat.customerId.name,
          message: text,
        });
      } else {
        await sendChatEmail({
          to: chat.customerId.email,
          senderName: chat.workerId.name,
          message: text,
        });
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Send message error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ======================================================
   🟥 CUSTOMER — list chats in “Your Trips”
====================================================== */
router.get("/my-chats/:customerId", async (req, res) => {
  try {
    const { customerId } = req.params;

    const chats = await RideChat.find({ customerId }).populate({
      path: "rideId",
      select: "from to date time workerId",
      populate: {
        path: "workerId",
        model: "Worker",
        select: "name profilePhotoUrl",
      },
    });

    res.json(chats);
  } catch (err) {
    console.error("❌ Customer chat list error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
