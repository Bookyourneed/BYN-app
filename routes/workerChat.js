// routes/workerChat.js
const express = require("express");
const router = express.Router();
const Chat = require("../models/Chat");
const Worker = require("../models/Worker");
const User = require("../models/User");
const Job = require("../models/Job");
const { sendEmailSafe } = require("../emailService"); // ✅ Updated import

// 🔍 Get all messages for a specific job between worker and customer
//   GET /api/worker-chat/:workerId/:customerId/:jobId
router.get("/:workerId/:customerId/:jobId", async (req, res) => {
  const { workerId, customerId, jobId } = req.params;
  if (!workerId || !customerId || !jobId) {
    return res
      .status(400)
      .json({ message: "Missing workerId, customerId, or jobId" });
  }

  try {
    const chat = await Chat.findOne({
      participants: { $all: [workerId, customerId] },
      jobId,
    });

    const messages = chat ? chat.messages : [];
    return res.status(200).json(messages);
  } catch (error) {
    console.error("❌ [worker-chat] fetch error:", error);
    return res.status(500).json({ message: "Failed to load messages." });
  }
});

// ✉️ Send a message in a specific job thread
//   POST /api/worker-chat/send
//   body: { sender, receiver, message, jobId, chatOpen }
router.post("/send", async (req, res) => {
  const { sender, receiver, message, jobId, chatOpen } = req.body;
  if (!sender || !receiver || !message || !jobId) {
    return res
      .status(400)
      .json({ message: "Missing sender, receiver, message, or jobId" });
  }

  try {
    let chat = await Chat.findOne({
      participants: { $all: [sender, receiver] },
      jobId,
    });

    if (!chat) {
      chat = new Chat({
        participants: [sender, receiver],
        jobId,
        messages: [],
      });
    }

    const newMessage = {
      sender,
      message,
      timestamp: new Date(),
      seen: false,
    };

    chat.messages.push(newMessage);
    await chat.save();

    // If recipient doesn't have the chat open, email them
    if (!chatOpen) {
      const receiverUser =
        (await Worker.findById(receiver)) || (await User.findById(receiver));
      const senderUser =
        (await Worker.findById(sender)) || (await User.findById(sender));
      const job = await Job.findById(jobId);

      if (receiverUser?.email) {
        await sendEmailSafe({
          to: receiverUser.email,
          subject: `💬 New Message from ${senderUser?.name || "a user"} on Book Your Need`,
          html: `
            <h2>Hi ${receiverUser?.name || "there"},</h2>
            <p>You’ve received a new message regarding your job: 
            <strong>${job?.jobTitle || "Job Inquiry"}</strong>.</p>
            <blockquote style="background:#f9f9f9; padding:10px; border-left:3px solid #4f46e5; font-style:italic; color:#333;">
              ${message}
            </blockquote>
            <p style="margin-top:20px;">
              <a href="https://bookyourneed.com/login" 
                 style="padding:10px 20px; background-color:#4f46e5; color:#fff; border-radius:5px; text-decoration:none;">
                Reply Now
              </a>
            </p>
            <br>
            <p style="color:#888; font-size:13px;">— Book Your Need Support Team</p>
          `,
          context: "chat-notification",
        });
      }
    }

    return res.status(200).json({ message: newMessage });
  } catch (error) {
    console.error("❌ [worker-chat] send error:", error);
    return res.status(500).json({ message: "Failed to send message." });
  }
});

// ✅ Mark customer messages as seen by the worker (per job)
//   POST /api/worker-chat/mark-seen
//   body: { customerId, workerId, jobId }
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
      if (msg.sender === customerId && !msg.seen) {
        msg.seen = true;
        updated = true;
      }
    });

    if (updated) await chat.save();
    return res.status(200).json({ message: "Messages marked as seen ✅" });
  } catch (err) {
    console.error("❌ [worker-chat] mark-seen error:", err);
    return res.status(500).json({ message: "Failed to update message status." });
  }
});

module.exports = router;
