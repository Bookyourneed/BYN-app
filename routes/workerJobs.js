const express = require("express");
const router = express.Router();
const Job = require("../models/Job");
const Bid = require("../models/Bid");
const Worker = require("../models/Worker");
const User = require("../models/User");
const sendWorkerNotification = require("../utils/sendWorkerNotification");
const { sendEmailSafe } = require("../emailService");
const { getIO } = require("../socket");



const haversine = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};


// ✅ GET all bids submitted by a worker
router.get("/my-bids/:workerId", async (req, res) => {
  try {
    const bids = await Bid.find({ workerId: req.params.workerId }).populate({
      path: "jobId",
      populate: { path: "customerId", strictPopulate: false },
    });

    const filtered = bids.filter(b => b.jobId);
    res.json(filtered);
  } catch (err) {
    console.error("❌ Error fetching bids:", err);
    res.status(500).json({ message: "Server error fetching bids." });
  }
});

// 💰 Calculate earnings by bid tiers
const calculateEarnings = (bidAmount) => {
  if (bidAmount < 100) return bidAmount - 4.49;
  if (bidAmount < 250) return bidAmount * 0.92;
  if (bidAmount < 500) return bidAmount * 0.93;
  if (bidAmount < 1000) return bidAmount * 0.94;
  return bidAmount * 0.95;
};

// ✅ Submit Bid (handles reopened jobs too)
router.post("/submit-bid", async (req, res) => {
  const { jobId, workerId, price, message = "" } = req.body;

  try {
    const job = await Job.findById(jobId).populate("customerId", "email name");
    if (!job) return res.status(404).json({ message: "Job not found" });

    // ✅ Handle reopened jobs or prevent duplicate
    if (job.status === "reopened") {
      await Bid.updateMany({ jobId, workerId }, { $set: { status: "rejected" } });
    } else {
      const existingBid = await Bid.findOne({ jobId, workerId });
      if (existingBid)
        return res.status(400).json({ message: "You have already submitted a bid for this job." });
    }

    // 💰 Calculate estimated earnings
    const estimatedEarnings = parseFloat(calculateEarnings(Number(price)).toFixed(2));

    // 🆕 Create bid
    const newBid = await Bid.create({
      jobId,
      workerId,
      price,
      message,
      estimatedEarnings,
      status: "pending",
    });

    // 🧩 Link bid to job
    await Job.findByIdAndUpdate(jobId, { $addToSet: { bids: newBid._id } });

    const worker = await Worker.findById(workerId);

    // 📧 Notify Worker
    if (worker?.email) {
      await sendEmailSafe({
        to: worker.email,
        subject: "✅ Your Bid Was Submitted",
        html: `
          <h2>Hi ${worker.name || "there"},</h2>
          <p>Your bid of <strong>$${price}</strong> was submitted successfully for the job: 
          <strong>${job.jobTitle}</strong>.</p>
          <p>We’ll notify you when the customer responds.</p>
          <br><p>— Book Your Need</p>
        `,
        context: "worker-bid-submitted",
      });
    }

    // 📧 Notify Customer
    if (job?.customerId?.email) {
      await sendEmailSafe({
        to: job.customerId.email,
        subject: "📩 New Bid on Your Job",
        html: `
          <h2>Hello ${job.customerId.name || "there"},</h2>
          <p>You’ve received a new bid for <strong>${job.jobTitle}</strong>.</p>
          <p><strong>${worker?.name || "A worker"}</strong> submitted a bid for 
          <strong>$${price}</strong>.</p>
          <p>Login to your dashboard to view and respond to this bid.</p>
          <br><p>— Book Your Need</p>
        `,
        context: "customer-new-bid",
      });
    }

    // ⚡ Real-time Socket Emit (Customer sees new bid instantly)
    try {
      const io = getIO();
      if (job?.customerId?._id) {
        io.to(`customer_${job.customerId._id}`).emit("job:bidReceived", {
          jobId,
          bid: newBid,
        });
        console.log(`📩 Socket → job:bidReceived → customer ${job.customerId._id}`);
      }
    } catch (socketErr) {
      console.error("⚠️ Socket emit failed (job:bidReceived):", socketErr.message);
    }

    res.status(200).json({ message: "Bid submitted", bid: newBid });
  } catch (err) {
    console.error("❌ Error submitting bid:", err);
    res.status(500).json({ message: "Failed to submit bid" });
  }
});

// ✅ Get jobs assigned to a worker (includes disputes)
router.get("/assigned/:workerId", async (req, res) => {
  try {
    const { workerId } = req.params;

    const jobs = await Job.find({
      assignedTo: workerId,
      status: {
        $in: [
          "assigned",
          "worker_completed",
          "completed",
          "customer_confirmed",
          "auto_confirmed",
          "dispute",        // 👈 added
          "disputed",       // 👈 added
        ],
      },
    })
      .populate("customerId", "name email")
      .sort({ createdAt: -1 });

    res.json(jobs);
  } catch (err) {
    console.error("❌ Error fetching worker jobs:", err);
    res.status(500).json({ error: "Server error" });
  }
});


router.get("/bid/:jobId/:workerId", async (req, res) => {
  try {
    const { jobId, workerId } = req.params;
    const bid = await Bid.findOne({ jobId, workerId });

    if (!bid) {
      return res.status(404).json({ message: "No bid found for this worker on job" });
    }

    res.json(bid);
  } catch (err) {
    console.error("❌ Error fetching bid:", err);
    res.status(500).json({ message: "Failed to fetch bid" });
  }
});

// ✅ GET job details and bids
router.get("/jobs/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;

    const job = await Job.findById(jobId);
    if (!job) return res.status(404).json({ message: "Job not found" });

    const bids = await Bid.find({ jobId }).populate("workerId", "name email");

    const formattedBids = bids.map((bid) => ({
      _id: bid._id,
      price: bid.price,
      message: bid.message,	
      workerId: bid.workerId._id,
      workerName: bid.workerId.name,
      workerEmail: bid.workerId.email,
    }));

    res.json({ job, bids: formattedBids });
  } catch (error) {
    console.error("❌ Error fetching job details:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// ✅ Accept Job
router.post("/accept-job", async (req, res) => {
  const { jobId, workerId } = req.body;

  try {
    const job = await Job.findById(jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });

    if (job.status === "assigned") {
      return res.status(400).json({ error: "Job already assigned" });
    }

    const acceptedBid = await Bid.findOne({ jobId, workerId });
    if (!acceptedBid) return res.status(404).json({ error: "Accepted bid not found" });

    job.assignedTo = workerId;
    job.status = "assigned";
    job.assignedPrice = acceptedBid.price;
    await job.save();

    const worker = await Worker.findById(workerId);
    if (worker?.email) {
      await sendEmail(
        worker.email,
        "🎉 You’ve Been Assigned a Job!",
        `
          <h2>Hi ${worker.name || "there"},</h2>
          <p>You’ve been assigned the job: <strong>${job.jobTitle}</strong></p>
          <p>Location: ${job.location}</p>
          <p>Scheduled: ${new Date(job.scheduledAt).toLocaleString()}</p>
          <p>Log in to begin chatting with the customer.</p>
          <br><p>— Book Your Need</p>
        `
      );
    }

    const io = getIO();
    io.to(workerId).emit("job-assigned", {
      jobId,
      message: "✅ Your bid has been accepted! You’ve been assigned this job.",
    });

    const otherBids = await Bid.find({ jobId, workerId: { $ne: workerId } });
    otherBids.forEach((bid) => {
      io.to(bid.workerId.toString()).emit("bid-rejected", {
        jobId,
        message: "❌ The customer accepted a different worker for this job.",
      });
    });

    return res.status(200).json({ success: true, job });
  } catch (err) {
    console.error("❌ Accept Job Error:", err);
    return res.status(500).json({ error: "Failed to accept job" });
  }
});

// ✅ Worker marks job as complete (with socket + email)
router.post("/worker-complete/:jobId", async (req, res) => {
  const { jobId } = req.params;
  const { workerId, customerId } = req.body; // ✅ include customerId from frontend
  const io = getIO();

  if (!jobId || !workerId) {
    return res.status(400).json({ message: "Missing required fields." });
  }

  try {
    const job = await Job.findById(jobId)
      .populate("customerId", "email name")
      .populate("assignedTo", "email name");

    if (!job) return res.status(404).json({ message: "Job not found" });
    if (!job.assignedTo || job.assignedTo._id.toString() !== workerId)
      return res.status(403).json({ message: "Not your job" });

    // 🗓️ Safety: can only mark complete on or after scheduled date
    const now = new Date();
    const jobDate = new Date(job.scheduledAt);
    if (now.setHours(0, 0, 0, 0) < jobDate.setHours(0, 0, 0, 0)) {
      return res.status(400).json({
        message: "You can only complete this job on or after the scheduled date.",
      });
    }

    // ✅ Update job
    job.status = "worker_completed";
    job.completion = job.completion || {};
    job.completion.workerMarkedAt = new Date();

    job.history.push({
      action: "worker_completed",
      by: "worker",
      actorId: workerId,
      at: new Date(),
      notes: "Worker marked job complete.",
    });

    await job.save();

    // =====================================================
    // ⚡ Real-time socket events (with fallback handling)
    // =====================================================
    const customerRoom =
      job.customerId?.email || `customer_${customerId || job.customerId}`;
    io.to(customerRoom).emit("job:update", {
      jobId: job._id,
      status: "worker_completed",
      message: `🛠️ ${job.assignedTo.name} marked your job as complete.`,
    });

    io.to(`worker_${workerId}`).emit("job:update", {
      jobId: job._id,
      status: "worker_completed",
      message: "✅ You marked the job as complete.",
    });

    // =====================================================
    // 📧 Email Notifications
    // =====================================================
    if (job.assignedTo?.email) {
      await sendEmailSafe({
        to: job.assignedTo.email,
        subject: "✅ Job Completion Recorded",
        html: `
          <h2>Hi ${job.assignedTo.name || "Worker"},</h2>
          <p>You marked job <strong>${job.jobTitle}</strong> as completed.</p>
          <p>The customer has 48 hours to confirm or raise a dispute.</p>
          <br><p>— Book Your Need Team</p>
        `,
      });
    }

    if (job.customerId?.email) {
      await sendEmailSafe({
        to: job.customerId.email,
        subject: "⚠️ Action Required: Worker Completed Your Job",
        html: `
          <h2>Hi ${job.customerId.name || "Customer"},</h2>
          <p>Your worker marked <strong>${job.jobTitle}</strong> as complete.</p>
          <p>Please confirm completion or file a dispute within 48 hours.</p>
          <br><p>— Book Your Need Team</p>
        `,
      });
    }

    // =====================================================
    // ✅ Response
    // =====================================================
    res.json({
      success: true,
      message: "Job marked complete and notifications sent.",
    });
  } catch (err) {
    console.error("❌ Worker complete error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// ✅ Cancel job by worker (with socket + reopen logic)
router.post("/cancel-by-worker", async (req, res) => {
  const { jobId, workerId } = req.body;
  const io = getIO();

  try {
    const job = await Job.findById(jobId)
      .populate("customerId", "name email")
      .populate("bids");
    const worker = await Worker.findById(workerId);

    if (!job || !worker)
      return res.status(404).json({ error: "Job or worker not found" });
    if (!job.assignedTo || job.assignedTo.toString() !== workerId)
      return res
        .status(403)
        .json({ error: "You are not assigned to this job" });

    // 🧾 Increment worker cancellation count
    worker.cancellationCount = (worker.cancellationCount || 0) + 1;
    worker.lastCancellationAt = new Date();

    let suspensionMessage = "";
    if (worker.cancellationCount === 1)
      suspensionMessage = "⚠️ First warning for cancelling a job.";
    else if (worker.cancellationCount === 2) {
      worker.status = "suspended";
      worker.suspendedUntil = new Date(Date.now() + 7 * 86400000);
      suspensionMessage = "🚫 Suspended for 7 days.";
    } else if (worker.cancellationCount === 3) {
      worker.status = "suspended";
      worker.suspendedUntil = new Date(Date.now() + 14 * 86400000);
      suspensionMessage = "🚫 Suspended for 14 days.";
    } else if (worker.cancellationCount >= 4) {
      worker.requiresAdminReview = true;
      worker.status = "banned";
      suspensionMessage = "⛔ Escalated to admin for permanent review.";
      await sendEmailSafe({
        to: "admin@bookyourneed.com",
        subject: "🚨 Worker Escalation Required",
        html: `
          <p>Worker ${worker.name} (${worker.email}) has cancelled 4+ jobs. Please review.</p>
        `,
      });
    }
    await worker.save();

    // 🧹 Reopen job for other workers
    const oldBids = [...job.bids];
    job.status = "reopened";
    job.assignedTo = null;
    job.assignedPrice = null;
    job.reopenedAt = new Date();
    job.repostCount = (job.repostCount || 0) + 1;
    job.cancelBy = "worker";
    job.cancelReason = "Cancelled by worker";
    job.cancelledAt = new Date();

    job.history.push({
      action: "worker_cancelled",
      by: "worker",
      actorId: worker._id,
      at: new Date(),
      notes: "Job cancelled by assigned worker.",
    });

    await Bid.updateMany({ jobId: job._id }, { $set: { status: "rejected" } });
    job.bids = [];
    await job.save();

    // ✅ SOCKET.IO updates
    io.to(`customer_${job.customerId.email}`).emit("job:update", {
      jobId: job._id,
      status: "reopened",
      message: "🚨 Worker cancelled job. Your job has been reopened.",
    });

    io.to(`worker_${workerId}`).emit("job:update", {
      jobId: job._id,
      status: "cancelled_by_worker",
      message: "❌ You cancelled this job.",
    });

    // 📧 Email notifications
    if (job.customerId?.email) {
      await sendEmailSafe({
        to: job.customerId.email,
        subject: "⚠️ Job Reopened - Worker Cancelled",
        html: `
          <h2>Hi ${job.customerId.name || "Customer"},</h2>
          <p>Your assigned worker (${worker.name}) cancelled the job.</p>
          <p>The job <strong>${job.jobTitle}</strong> has been reopened for new bids.</p>
          <br><p>— Book Your Need</p>
        `,
      });
    }

    await sendEmailSafe({
      to: worker.email,
      subject: "❌ Job Cancelled Confirmation",
      html: `
        <h2>Hi ${worker.name || "Worker"},</h2>
        <p>You cancelled job <strong>${job.jobTitle}</strong>.</p>
        <p>${suspensionMessage}</p>
        <br><p>— Book Your Need</p>
      `,
    });

    // 🔔 Notify previously rejected workers of reopen
    for (const bidId of oldBids) {
      const bid = await Bid.findById(bidId).populate("workerId");
      if (bid?.workerId?.email && bid.workerId._id.toString() !== workerId) {
        await sendEmailSafe({
          to: bid.workerId.email,
          subject: "A job you applied for has reopened",
          html: `
            <h2>Hi ${bid.workerId.name || "Worker"},</h2>
            <p>The job <strong>${job.jobTitle}</strong> that you applied for has reopened.</p>
            <p>You can now submit a new bid.</p>
            <br><p>— Book Your Need</p>
          `,
        });
      }
    }

    res.status(200).json({
      success: true,
      message: "Job cancelled by worker and reopened.",
      suspensionMessage,
    });
  } catch (err) {
    console.error("❌ Cancel Job Error:", err);
    res.status(500).json({ error: "Failed to cancel job." });
  }
});

// ✅ Worker bid change request (now real-time)
router.post("/bids/change", async (req, res) => {
  const { bidId, newAmount, message } = req.body;
  const io = getIO(); // ✅ import at top: const { getIO } = require("../socket");

  try {
    const bid = await Bid.findById(bidId)
      .populate({
        path: "jobId",
        populate: { path: "customerId", select: "name email" },
      })
      .populate("workerId", "name email");

    if (!bid) return res.status(404).json({ error: "Bid not found" });

    // 💰 Calculate new earnings using BYN tiers
    const newEarnings = calculateEarnings(Number(newAmount)).toFixed(2);

    // 🔹 Update changeRequest object
    bid.changeRequest = {
      newPrice: newAmount,
      newEarnings,
      message: message || "",
      status: "pending",
      requestedAt: new Date(),
    };

    await bid.save();

    // ⚡ SOCKET — Notify customer in real time
    const job = bid.jobId;
    const customerEmail = job?.customerId?.email;
    if (customerEmail) {
      io.to(`customer_${customerEmail}`).emit("bid:changeUpdate", {
        type: "request",
        jobId: job._id,
        jobTitle: job.jobTitle,
        workerName: bid.workerId?.name || "Worker",
        workerId: bid.workerId?._id,
        newPrice: newAmount,
        newEarnings,
        message: message || "",
        status: "pending",
      });
      console.log(`📡 Sent bid:changeUpdate → customer_${customerEmail}`);
    }

    // 📧 Email customer as backup
    if (customerEmail) {
      await sendEmailSafe({
        to: customerEmail,
        subject: "💬 Bid Change Request",
        html: `
          <h2>Hi ${job.customerId?.name || "Customer"},</h2>
          <p>Worker <strong>${bid.workerId.name}</strong> updated their bid for <strong>${job.jobTitle}</strong>.</p>
          <p>New proposed amount: <strong>$${newAmount}</strong></p>
          
          <p>Login to your dashboard to review this update.</p>
          <br><p>— Book Your Need</p>
        `,
        context: "worker-bid-change",
      });
    }

    res.json({
      message: "Bid change submitted successfully ✅",
      newEarnings,
    });
  } catch (err) {
    console.error("❌ Error changing bid:", err);
    res.status(500).json({ error: "Server error" });
  }
});
// ✅ Worker cancels a pending bid change request
router.post("/bids/change/cancel", async (req, res) => {
  const { bidId, workerId } = req.body;

  try {
    const bid = await Bid.findById(bidId).populate("jobId");

    if (!bid) return res.status(404).json({ error: "Bid not found" });

    // 🛑 Ensure only the same worker can cancel their request
    if (String(bid.workerId) !== String(workerId)) {
      return res.status(403).json({ error: "Unauthorized: Not your bid" });
    }

    // 🟡 Only allow cancel if changeRequest is pending
    if (!bid.changeRequest || bid.changeRequest.status !== "pending") {
      return res
        .status(400)
        .json({ error: "No active pending bid change request" });
    }

    // ❌ Clear the changeRequest field
    bid.changeRequest = undefined;
    await bid.save();

    // 📨 Notify the customer if already emailed
    const customerEmail = bid.jobId?.email || bid.jobId?.customerId?.email;
    if (customerEmail) {
      await sendEmailSafe({
        to: customerEmail,
        subject: "Bid Change Cancelled - Book Your Need",
        html: `
          <h2>Hi,</h2>
          <p>The worker has cancelled their previous bid change request for your job:</p>
          <p><strong>${bid.jobId?.jobTitle || "Job"}</strong></p>
          <p>No action is required on your end.</p>
          <br/>
          <p>— Book Your Need</p>
        `,
      });
    }

    res.json({
      success: true,
      message: "Bid change request cancelled successfully",
    });
  } catch (err) {
    console.error("❌ Error cancelling bid change:", err);
    res.status(500).json({ error: "Server error while cancelling bid change" });
  }
});



module.exports = router;
