// ✅ jobs.js – Routes for posting, retrieving, and cancelling jobs
const express = require("express");
const router = express.Router();
const Job = require("../models/Job");

// 📩 POST a new job
router.post("/post-job", async (req, res) => {
  try {
    const job = await Job.create(req.body);

    console.log(`✅ Job created for ${job.email} | ID: ${job._id}`);

    return res.status(200).json({
      message: "Job posted successfully!",
      jobId: job._id, // Return job ID to frontend
    });
  } catch (err) {
    console.error("❌ Error posting job:", err);
    return res.status(500).json({ message: "Server error posting job." });
  }
});

// 📥 GET jobs by user email
router.get("/user-jobs/:email", async (req, res) => {
  const { email } = req.params;

  try {
    const jobs = await Job.find({ email }).sort({ createdAt: -1 });

    const pending = jobs.filter((job) => job.status === "pending");
    const completed = jobs.filter((job) => job.status === "completed");

    return res.status(200).json({ pending, completed });
  } catch (err) {
    console.error("❌ Error fetching user jobs:", err);
    return res.status(500).json({ message: "Server error fetching jobs." });
  }
});

// ❌ DELETE (Cancel) a job by ID
router.delete("/cancel-job/:id", async (req, res) => {
  const jobId = req.params.id;

  try {
    console.log("🧨 Cancel request for Job ID:", jobId);

    const job = await Job.findByIdAndDelete(jobId);

    if (!job) {
      console.warn("⚠️ Job not found for cancellation:", jobId);
      return res.status(404).json({ message: "Job not found." });
    }

    console.log("🗑️ Job canceled:", jobId);
    return res.status(200).json({ message: "Job canceled successfully." });
  } catch (err) {
    console.error("❌ Error cancelling job:", err);
    return res.status(500).json({ message: "Server error cancelling job." });
  }
});

module.exports = router;
