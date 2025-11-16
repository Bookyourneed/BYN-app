const express = require("express");
const router = express.Router();

const RideChat = require("../models/RideChat");
const Ride = require("../models/Ride");        // ✅ FIXED
const User = require("../models/User");
const Worker = require("../models/Worker");

const { sendChatEmail } = require("../emailService");

// normalize ID
const norm = (id) =>
  typeof id === "string" ? id : id?._id || id?.id || "";

/* ======================================================
   🟣 WORKER — List all passengers they chatted with
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
      lastMessage: c.messages?.[c.messages.length - 1]?.text || "",
      lastTimestamp:
        c.messages?.[c.messages.length - 1]?.timestamp || c.updatedAt,
    }));

    res.json(formatted);
  } catch (err) {
    console.error("❌ Worker participants error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ======================================================
   🟦  CUSTOMER — Get chat (rideId + ?customerId)
   Example → /api/ride-chat/123?customerId=321
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
   🟩  SEND MESSAGE (socket + 🌟 EMAIL NOTIFICATION)
====================================================== */

// 5-minute cooldown map
const chatCooldown = new Map();

router.post("/send", async (req, res) => {
  try {
    const { rideId, roomId, senderId, senderModel, text } = req.body;

    if (!rideId || !roomId || !senderId || !text)
      return res.status(400).json({ error: "Missing fields" });

    // roomId format → "rideId-customerId-workerId"
    const parts = roomId.split("-");
    const customerId = parts[1];

    if (!customerId)
      return res.status(400).json({ error: "Invalid roomId" });

    let chat = await RideChat.findOne({ rideId, customerId })
      .populate("rideId")
      .populate("customerId", "name email profilePhotoUrl")
      .populate("workerId", "name email profilePhotoUrl");

    if (!chat) {
      chat = await RideChat.create({
        rideId,
        customerId,
        workerId: chat?.rideId?.workerId,
        messages: [],
      });

      chat = await RideChat.findById(chat._id)
        .populate("rideId")
        .populate("customerId", "name email profilePhotoUrl")
        .populate("workerId", "name email profilePhotoUrl");
    }

    const msg = {
      text,
      senderId,
      senderModel,
      timestamp: new Date(),
    };

    chat.messages.push(msg);
    await chat.save();

    /* -----------------------------------------------
       🔥 SOCKET BROADCAST (PRIVATE ROOM)
    ------------------------------------------------ */
    req.io.to(roomId).emit("ride-message", {
      roomId,
      message: msg,
    });

    /* ===================================================
       💌 EMAIL NOTIFICATION (every 5 minutes ONLY)
    ==================================================== */

    const cooldownKey = `${rideId}-${customerId}-${senderModel}`;
    const now = Date.now();

    if (!chatCooldown.has(cooldownKey) ||
        now - chatCooldown.get(cooldownKey) > 5 * 60 * 1000) {
      
      chatCooldown.set(cooldownKey, now); // update cooldown

      const rideFrom = chat.rideId?.from;
      const rideTo = chat.rideId?.to;

      if (senderModel === "User") {
        // CUSTOMER → DRIVER
        await sendChatEmail("messageToDriver", {
          to: chat.workerId.email,
          senderName: chat.customerId.name,
          receiverName: chat.workerId.name,
          rideFrom,
          rideTo,
          message: text,
        });
      } else if (senderModel === "Worker") {
        // DRIVER → CUSTOMER
        await sendChatEmail("messageToCustomer", {
          to: chat.customerId.email,
          senderName: chat.workerId.name,
          receiverName: chat.customerId.name,
          rideFrom,
          rideTo,
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
   🟥 CUSTOMER — List all their ride chats
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
