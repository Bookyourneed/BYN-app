const express = require("express");
const router = express.Router();
const RideChat = require("../models/RideChat");
const Ride = require("../models/Rides");
const User = require("../models/User");
const Worker = require("../models/Worker");

// normalize id for comparison
const norm = (id) =>
  typeof id === "string" ? id : id?._id || id?.id || "";

/* ======================================================
   🟦  Get chat for (rideId + customerId)
====================================================== */
router.get("/:rideId/:customerId", async (req, res) => {
  try {
    const { rideId, customerId } = req.params;

    const chat = await RideChat.findOne({ rideId, customerId }).lean();

    if (!chat)
      return res.json({
        rideId,
        customerId,
        messages: [],
      });

    res.json(chat);
  } catch (err) {
    console.error("❌ GET chat error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ======================================================
   🟧  Initialize chat for (rideId + customerId)
====================================================== */
router.post("/init", async (req, res) => {
  try {
    const { rideId, customerId } = req.body;

    if (!rideId || !customerId)
      return res.status(400).json({ error: "Missing params" });

    let chat = await RideChat.findOne({ rideId, customerId });

    if (!chat) {
      chat = await RideChat.create({
        rideId,
        customerId,
        messages: [],
      });
    }

    res.json(chat);
  } catch (err) {
    console.error("❌ Init chat error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ======================================================
   🟩  Send message (PRIVATE 1–1)
====================================================== */
router.post("/send", async (req, res) => {
  try {
    const { rideId, roomId, senderId, senderModel, text } = req.body;

    if (!rideId || !senderId || !text)
      return res.status(400).json({ error: "Missing fields" });

    // Extract customerId from roomId (rid-cid-wid)
    const parts = roomId.split("-");
    const customerId = parts[1];

    if (!customerId)
      return res.status(400).json({ error: "Invalid room id" });

    let chat = await RideChat.findOne({ rideId, customerId });

    // if not exists, create chat
    if (!chat) {
      chat = await RideChat.create({
        rideId,
        customerId,
        messages: [],
      });
    }

    const msg = {
      text,
      senderId,
      senderModel,
      timestamp: new Date(),
    };

    chat.messages.push(msg);
    await chat.save();

    // Emit socket event
    req.io.to(roomId).emit("ride-message", {
      rideId,
      roomId,
      message: msg,
    });

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Send chat error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ======================================================
   🟥  List all chats for a customer (YourTrips)
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
    console.error("❌ List customer chats error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ======================================================
   🟪  List chat participants for a ride (Worker side)
====================================================== */
router.get("/participants/:rideId", async (req, res) => {
  try {
    const { rideId } = req.params;

    const chats = await RideChat.find({ rideId }).populate({
      path: "customerId",
      model: "User",
      select: "name profilePhotoUrl",
    });

    res.json(chats);
  } catch (err) {
    console.error("❌ Participants list error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
