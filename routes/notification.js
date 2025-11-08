const express = require("express");
const router = express.Router();
const Notification = require("../models/Notification");

// GET unread count
router.get("/unread/:userId", async (req, res) => {
  try {
    const count = await Notification.countDocuments({ userId: req.params.userId, read: false });
    res.json({ unreadCount: count });
  } catch (err) {
    res.status(500).json({ error: "Failed to get unread count" });
  }
});

// GET all notifications
router.get("/all/:userId", async (req, res) => {
  try {
    const notifications = await Notification.find({ userId: req.params.userId }).sort({ createdAt: -1 });
    res.json({ notifications });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

// ✅ Optionally create a new notification
router.post("/send", async (req, res) => {
  try {
    const notif = new Notification(req.body);
    await notif.save();
    res.json({ success: true, notification: notif });
  } catch (err) {
    res.status(500).json({ error: "Failed to create notification" });
  }
});

module.exports = router;
