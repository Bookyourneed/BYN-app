// routes/chat.js
const express = require("express");
const router = express.Router();
const Chat = require("../models/Chat");
const User = require("../models/User");
const Worker = require("../models/Worker");
const Job = require("../models/Job");
const { sendEmailSafe } = require("../emailService"); // ✅ switched to safe version

// 🔍 Get all messages for a specific job between customer and worker
router.get("/:senderId/:receiverId/:jobId", async (req, res) => {
  const { senderId, receiverId, jobId } = req.params;

  if (!senderId || !receiverId || !jobId) {
    return res
      .status(400)
      .json({ message: "Missing senderId, receiverId, or jobId" });
  }

  try {
    const chat = await Chat.findOne({
      participants: { $all: [senderId, receiverId] },
      jobId,
    });

    const messages = chat ? chat.messages : [];
    return res.status(200).json(messages);
  } catch (error) {
    console.error("❌ [chat] fetch error:", error);
    return res.status(500).json({ message: "Failed to load messages." });
  }
});

// ✉️ Send a message in a specific job thread
router.post("/send", async (req, res) => {
  let { senderId, receiverId, message, jobId } = req.body;

  console.log("➡️ Incoming message payload:", req.body);

  if (!senderId || !receiverId || !message || !jobId) {
    return res
      .status(400)
      .json({ message: "Missing senderId, receiverId, message, or jobId" });
  }

  try {
    senderId = String(senderId);
    receiverId = String(receiverId);
    jobId = String(jobId);

    // ✅ Find or create chat
    let chat = await Chat.findOne({
      participants: { $all: [senderId, receiverId] },
      jobId,
    });

    if (!chat) {
      chat = new Chat({
        participants: [senderId, receiverId],
        jobId,
        messages: [],
      });
    }

    const newMessage = {
      senderId,
      receiverId,
      message,
      timestamp: new Date(),
      seen: false,
    };

    chat.messages.push(newMessage);
    await chat.save();

    // ✅ Notify via socket.io
    const roomId = [senderId, receiverId].sort().join("-") + `-${jobId}`;
    req.app.get("socketio").to(roomId).emit("receiveMessage", newMessage);

    // ✅ Email Notification (safe + styled)
    const receiver =
      (await User.findById(receiverId)) || (await Worker.findById(receiverId));
    const sender =
      (await User.findById(senderId)) || (await Worker.findById(senderId));
    const job = await Job.findById(jobId);

    if (receiver?.email) {
      await sendEmailSafe({
        to: receiver.email,
        subject: `💬 New Message from ${sender?.name || "a user"} on Book Your Need`,
        html: `
          <h2>Hello ${receiver.name || "there"},</h2>
          <p>You’ve received a new message regarding your job:
            <strong>${job?.jobTitle || "Job Inquiry"}</strong>.</p>
          <blockquote style="background:#f9f9f9;padding:12px;border-left:3px solid #2563eb;color:#333;margin-top:10px;">
            ${message}
          </blockquote>
          <p style="margin-top:20px;">
            <a href="https://bookyourneed.com/login" 
               style="background-color:#2563eb;color:white;padding:10px 20px;
               text-decoration:none;border-radius:6px;display:inline-block;">
               Reply Now
            </a>
          </p>
          <br/>
          <p style="font-size:13px;color:#888;">— Book Your Need Team</p>
        `,
        context: "chat-notification",
      });
      console.log(`📧 Chat email sent safely to ${receiver.email}`);
    } else {
      console.log("⚠️ No email found for receiver, skipping email");
    }

    return res.status(200).json({ message: newMessage });
  } catch (error) {
    console.error("❌ [chat] send error:", error);
    return res.status(500).json({ message: "Failed to send message." });
  }
});

// ✅ Mark messages as seen
router.post("/mark-seen", async (req, res) => {
  const { customerId, workerId, jobId } = req.body;

  if (!customerId || !workerId || !jobId) {
    return res
      .status(400)
      .json({ message: "Missing customerId, workerId, or jobId" });
  }

  try {
    const chat = await Chat.findOne({
      participants: { $all: [customerId, workerId] },
      jobId,
    });

    if (!chat) return res.status(404).json({ message: "Chat not found" });

    let updated = false;
    chat.messages.forEach((msg) => {
      if (msg.senderId === customerId && !msg.seen) {
        msg.seen = true;
        updated = true;
      }
    });

    if (updated) await chat.save();

    return res.status(200).json({ message: "Messages marked as seen ✅" });
  } catch (err) {
    console.error("❌ [chat] mark-seen error:", err);
    return res.status(500).json({ message: "Failed to update message status." });
  }
});

module.exports = router;
