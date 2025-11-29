const express = require("express");
const router = express.Router();
const SupportTicket = require("../models/SupportTicket");
const SupportChat = require("../models/SupportChat");
const SupportSession = require("../models/SupportSession");

const { sendSupportEmail } = require("../emailService");

/* ------------------------------------------------------------------------- */
/* 💬 LIVE CHAT SESSION SYSTEM                                               */
/* ------------------------------------------------------------------------- */

router.post("/send-worker-ticket", async (req, res) => {
  const { subject, message, workerEmail, workerName } = req.body;

  if (!workerEmail) {
    return res.status(400).json({ error: "Worker email missing" });
  }

  try {
    // 1️⃣ SAVE TICKET IN DATABASE
    const ticket = await SupportTicket.create({
      name: workerName || "Worker",
      email: workerEmail,
      subject,
      message,
      type: "worker", // <-- NEW FIELD
      createdAt: new Date(),
    });

    // 2️⃣ SEND EMAIL TO ADMIN
    await sendSupportEmail("supportTicketToAdmin", {
      to: "donotreply@bookyourneed.com",
      customerName: workerName || "Worker",
      customerEmail: workerEmail,
      subject,
      message,
    });

    // 3️⃣ SEND CONFIRMATION TO WORKER
    await sendSupportEmail("supportTicketConfirmation", {
      to: workerEmail,
      customerName: workerName || "Worker",
      subject,
    });

    return res.status(200).json({
      success: true,
      message: "Worker ticket saved & emailed",
      ticket,
    });
  } catch (err) {
    console.error("❌ send-worker-ticket error:", err);
    res.status(500).json({ error: "Failed to submit worker ticket" });
  }
});

// ✅ Start new support chat session
router.post("/start-session", async (req, res) => {
  const { email, name } = req.body;
  try {
    let session = await SupportSession.findOne({ email, isOpen: true });

    if (!session) {
      session = await SupportSession.create({
        email,
        name,
        isOpen: true,
        startedAt: new Date(),
      });

      // 💬 Send notification emails
      await sendSupportEmail("supportUserNotice", {
        to: email,
        customerName: name,
        customerEmail: email,
      });

      await sendSupportEmail("supportNewChat", {
        to: "donotreply@bookyourneed.com",
        customerName: name,
        customerEmail: email,
      });
    }

    res.status(200).json(session);
  } catch (err) {
    console.error("❌ start-session error:", err);
    res.status(500).json({ message: "Server error starting support chat" });
  }
});
// ✅ Get current session by email
router.get("/chat-session/:email", async (req, res) => {
  try {
    const session = await SupportSession.findOne({
      email: req.params.email,
      isOpen: true,
    });
    if (!session) return res.status(200).json({ isOpen: false });
    res.status(200).json({ isOpen: true, session });
  } catch (err) {
    console.error("❌ get chat-session error:", err);
    res.status(500).json({ message: "Server error fetching session" });
  }
});

router.get("/chat-session-list", async (req, res) => {
  try {
    const sessions = await SupportSession.find({ isOpen: true })
      .sort({ startedAt: -1 })
      .lean();

    // If you have User model
    const User = require("../models/User");
    const enhanced = await Promise.all(
      sessions.map(async (s) => {
        const u = await User.findOne({ email: s.email });
        return { ...s, userInfo: u || null };
      })
    );

    res.status(200).json(enhanced);
  } catch (err) {
    console.error("chat-session-list error:", err);
    res.status(500).json({ message: "Server error fetching sessions" });
  }
});

// ✅ End chat session (user or admin)
router.post("/end-session", async (req, res) => {
  const { email, closedByAdmin } = req.body;
  try {
    const session = await SupportSession.findOneAndUpdate(
      { email, isOpen: true },
      { isOpen: false, closedByAdmin, closedAt: new Date() },
      { new: true }
    );

    // ✅ Notify both sides
    const io = req.app.get("io");
    if (io) {
      io.to(`support_${email}`).emit("support:ended", {
        message:
          closedByAdmin
            ? "This chat has been closed by support."
            : "You have ended the chat session.",
      });
      io.to("support_admins").emit("support:ended", { email });
    }

    res.status(200).json({ message: "Session closed", session });
  } catch (err) {
    console.error("❌ end-session error:", err);
    res.status(500).json({ message: "Server error closing session" });
  }
});

/* ------------------------------------------------------------------------- */
/* 🧠 CHAT MESSAGES                                                          */
/* ------------------------------------------------------------------------- */

// ✅ Send message (store + broadcast)
router.post("/livechat/send", async (req, res) => {
  const { email, sender, text, time } = req.body;

  try {
    const session = await SupportSession.findOne({ email, isOpen: true });
    if (!session)
      return res.status(404).json({ message: "No active support session" });

    let chat = await SupportChat.findOne({ sessionId: session._id });
    if (!chat) {
      chat = new SupportChat({
        sessionId: session._id,
        participants: [email],
        messages: [],
      });
    }

    // ✅ Standardize message shape
    const message = {
      sender,
      email,
      text,                          // ✅ use 'text' field, not 'content'
      time: time ? new Date(time) : new Date(), // ✅ use 'time', not 'timestamp'
      seen: false,
    };

    chat.messages.push(message);
    await chat.save();

    // ✅ Broadcast in real-time (admin + user)
    const io = req.app.get("io");
    if (io) {
      // Send to customer room
      io.to(`support_${email}`).emit("support:message", message);

      // Send to admin room
      io.to("support_admins").emit("support:message", message);
    }

    res.status(200).json({ success: true, message });
  } catch (err) {
    console.error("❌ livechat/send error:", err);
    res.status(500).json({ message: "Server error sending message" });
  }
});

// ✅ Load chat messages for current session (standardized format)
router.get("/livechat/:email", async (req, res) => {
  try {
    const session = await SupportSession.findOne({
      email: req.params.email,
      isOpen: true,
    });
    if (!session)
      return res.status(200).json({ messages: [] });

    const chat = await SupportChat.findOne({ sessionId: session._id });

    if (!chat)
      return res.status(200).json({ messages: [] });

    // 🧠 Normalize all messages to consistent keys
    const normalizedMessages = (chat.messages || []).map((m) => ({
      sender: m.sender || "User",
      email: m.email || req.params.email,
      text: m.text || m.content || "",
      time: m.time || m.timestamp || new Date(),
      seen: m.seen || false,
    }));

    res.status(200).json({
      messages: normalizedMessages,
    });
  } catch (err) {
    console.error("❌ livechat fetch error:", err);
    res.status(500).json({ message: "Server error fetching chat" });
  }
});

/* ------------------------------------------------------------------------- */
/* 📩 SUPPORT TICKETS                                                       */
/* ------------------------------------------------------------------------- */

// ✅ Create a support ticket
router.post("/create-ticket", async (req, res) => {
  const { name, email, subject, message } = req.body;
  try {
    const newTicket = await SupportTicket.create({
      name,
      email,
      subject,
      message,
    });
    res.status(200).json({ message: "✅ Ticket created", ticket: newTicket });
  } catch (err) {
    console.error("❌ Ticket creation failed:", err);
    res.status(500).json({ message: "Server error creating ticket" });
  }
});

// ✅ Get all tickets for one user
router.get("/tickets/:email", async (req, res) => {
  try {
    const tickets = await SupportTicket.find({ email: req.params.email }).sort({
      createdAt: -1,
    });
    res.status(200).json(tickets);
  } catch (err) {
    console.error("❌ User ticket fetch error:", err);
    res.status(500).json({ message: "Server error fetching tickets" });
  }
});

// ✅ Get all tickets (admin)
router.get("/tickets", async (req, res) => {
  try {
    const tickets = await SupportTicket.find().sort({ createdAt: -1 });
    res.status(200).json(tickets);
  } catch (err) {
    console.error("❌ Admin ticket fetch failed:", err);
    res.status(500).json({ message: "Server error fetching tickets" });
  }
});

// ✅ Update ticket status or add response (admin)
router.post("/tickets/update", async (req, res) => {
  const { id, status, response } = req.body;
  try {
    const updated = await SupportTicket.findByIdAndUpdate(
      id,
      { status, response },
      { new: true }
    );
    res.status(200).json({ message: "Ticket updated", ticket: updated });
  } catch (err) {
    console.error("❌ Ticket update error:", err);
    res.status(500).json({ message: "Server error updating ticket" });
  }
});

/* ------------------------------------------------------------------------- */
/* 📧 EMAIL-ONLY SUPPORT TICKET FLOW                                         */
/* ------------------------------------------------------------------------- */

// ✅ Send ticket email to admin + confirmation to user
router.post("/send-ticket-email", async (req, res) => {
  const { subject, message, userEmail, userName } = req.body;

  try {
    // 🔹 Send to admin inbox
    await sendSupportEmail("supportTicketToAdmin", {
      to: "donotreply@bookyourneed.com",
      customerName: userName || "User",
      customerEmail: userEmail,
      subject,
      message,
    });

    // 🔹 Send confirmation to customer
    await sendSupportEmail("supportTicketConfirmation", {
      to: userEmail,
      customerName: userName || "User",
      subject,
    });

    res.status(200).json({ success: true, message: "Ticket email sent successfully" });
  } catch (err) {
    console.error("❌ support/send-ticket-email error:", err);
    res.status(500).json({ message: "Failed to send ticket email" });
  }
});


module.exports = router;
