const express = require("express");
const fs = require("fs");
const path = require("path");

const Chat = require("../models/Chat");
const Job = require("../models/Job");

const router = express.Router();

/**
 * DELETE /api/admin/cleanup/chat-media/completed
 *
 * Deletes:
 *  - Files on disk for image messages on COMPLETED jobs only
 *  - The image messages themselves from Chat documents
 *
 * Ongoing jobs (pending / assigned / in_progress / worker_completed / dispute)
 * are NOT touched.
 */
router.delete("/cleanup/chat-media/completed", async (req, res) => {
  try {
    // OPTIONAL: super simple "admin key" check
    // if (req.query.key !== process.env.ADMIN_CLEANUP_KEY) {
    //   return res.status(403).json({ error: "Forbidden" });
    // }

    // 1) Find jobs that are truly finished
    const completedStatuses = ["completed", "customer_confirmed", "auto_confirmed"];

    const completedJobs = await Job.find({
      status: { $in: completedStatuses },
      paymentStatus: "released", // extra safety so worker already got paid
    }).select("_id");

    if (!completedJobs.length) {
      return res.json({
        success: true,
        message: "No completed jobs found. Nothing to clean.",
      });
    }

    const completedJobIds = completedJobs.map((j) => String(j._id));

    // 2) Find all chats for those completed jobs and collect image paths
    const chats = await Chat.find({
      jobId: { $in: completedJobIds },
    }).select("messages jobId");

    const rootDir = path.join(__dirname, "..");
    const filesToDelete = new Set();

    chats.forEach((chat) => {
      (chat.messages || []).forEach((m) => {
        if (m.imageUrl) {
          // imageUrl is like "/uploads/chat/xyz.png"
          const rel = m.imageUrl.replace(/^\//, ""); // remove leading slash
          const fullPath = path.join(rootDir, rel);
          filesToDelete.add(fullPath);
        }
      });
    });

    // 3) Delete files from disk (only those used by completed jobs)
    let deletedCount = 0;
    filesToDelete.forEach((filePath) => {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          deletedCount += 1;
        }
      } catch (e) {
        console.error("⚠️ Failed to delete file:", filePath, e.message);
      }
    });

    // 4) Remove image messages from chats (for completed jobs only)
    const updateResult = await Chat.updateMany(
      { jobId: { $in: completedJobIds } },
      { $pull: { messages: { imageUrl: { $ne: null } } } }
    );

    return res.json({
      success: true,
      message: "Chat media cleanup for completed jobs finished.",
      jobsAffected: completedJobIds.length,
      filesDeleted: deletedCount,
      mongoUpdated: updateResult.modifiedCount || updateResult.nModified || 0,
    });
  } catch (err) {
    console.error("❌ Cleanup failed:", err);
    return res.status(500).json({ error: "Cleanup failed" });
  }
});

module.exports = router;
