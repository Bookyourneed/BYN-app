const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const Chat = require("../models/Chat");

// ========== STORAGE ==========
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/chat");
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

// ========== UPLOAD IMAGE ==========
router.post("/upload-image", upload.single("image"), async (req, res) => {
  try {
    const { senderId, receiverId, jobId, roomId } = req.body;

    const filePath = `/uploads/chat/${req.file.filename}`;

    // find the chat doc
    let chat = await Chat.findOne({
      participants: { $all: [senderId, receiverId] },
      jobId,
    });

    if (!chat) {
      chat = await Chat.create({
        participants: [senderId, receiverId],
        jobId,
        messages: [],
      });
    }

    const messageObj = {
      senderId,
      receiverId,
      message: "",
      imageUrl: filePath,
      timestamp: new Date(),
    };

    chat.messages.push(messageObj);
    await chat.save();

    // SOCKET EMIT
    const io = req.app.get("socketio");
    io.to(roomId).emit("receiveMessage", {
      ...messageObj,
      jobId,
    });

    res.json({ success: true, message: messageObj });
  } catch (err) {
    console.error("❌ Chat image upload failed:", err);
    res.status(500).json({ error: "Image upload failed" });
  }
});

module.exports = router;
