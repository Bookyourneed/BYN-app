<<<<<<< HEAD
require("dotenv").config(); // ✅ load environment variables first
=======
>>>>>>> e4ee6847563ff9f15949edfa509b77226308059b
const express = require("express");
const router = express.Router();
const Job = require("../models/Job");
const Bid = require("../models/Bid");
const Worker = require("../models/Worker");
const User = require("../models/User");
const sendWorkerNotification = require("../utils/sendWorkerNotification");
const { sendEmailSafe } = require("../emailService");
const { getIO } = require("../socket"); // ✅ Added for real-time

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
<<<<<<< HEAD
=======



>>>>>>> e4ee6847563ff9f15949edfa509b77226308059b
// 🌍 Distance helper
const haversine = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};


router.post("/check-availability", async (req, res) => {
  try {
    const {
      serviceType,
      latitude,
      longitude,
      city,
      province,
      jobTitle,
      description,
      budget,
    } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json({ error: "Latitude and longitude required." });
    }

    // 1. Get all approved workers
    const workers = await Worker.find({ status: "approved" });
    let workersFound = 0;

    for (const worker of workers) {
      if (!worker.latitude || !worker.longitude) continue;

      const approvedServices = (worker.services || [])
        .filter((s) =>
          s.certStatus === "approved" ||
          s.certStatus === null ||
          s.certStatus === undefined
        )
        .map((s) => s.name.toLowerCase().trim());

      const jobService = (serviceType || "").toLowerCase().trim();

      // ✅ Loosen matching: allow substring match
      const matches = approvedServices.some(
        (svc) => svc === jobService || jobService.includes(svc) || svc.includes(jobService)
      );
      if (!matches) continue;

      // ✅ Fix distance (haversine already returns km)
      const distKm = haversine(worker.latitude, worker.longitude, latitude, longitude);
      if (distKm <= 150) {
        workersFound++;
      }
    }

    // 2. Handle waitlist
    if (workersFound === 0) {
      await sendEmailSafe({
        to: process.env.ADMIN_EMAIL || "bhattdamanjot@gmail.com",
        subject: "⚠️ Job Waitlisted - No Workers Available",
        html: `
          <h2>Job Waitlisted</h2>
          <p>No approved workers found within 150km.</p>
          <ul>
            <li><strong>Service:</strong> ${serviceType}</li>
            <li><strong>Title:</strong> ${jobTitle || "N/A"}</li>
            <li><strong>Budget:</strong> $${budget || "N/A"}</li>
            <li><strong>Location:</strong> ${city || ""}, ${province || ""}</li>
            <li><strong>Description:</strong> ${description || "N/A"}</li>
          </ul>
        `,
      });

      return res.json({
        status: "waitlisted",
        workersFound: 0,
        waitlistReason: `No approved ${serviceType} workers within 150km of ${city || province || "location"}`,
      });
    }

    // 3. Return success
    return res.json({
      status: "ok",
      workersFound,
      message: `✅ Found ${workersFound} approved workers nearby.`,
    });
  } catch (err) {
    console.error("❌ Error checking availability:", err);
    res.status(500).json({ error: "Server error while checking availability." });
  }
});

router.post("/post-job", async (req, res) => {
  try {
    const {
      customerId,
      serviceType,
      jobTitle,
      description,
      budget,
      location,
      scheduledAt,
      email,
      city,
      province,
      street,
      postalCode,
      latitude,
      longitude,
      stripePaymentIntentId,
    } = req.body;

    if (!stripePaymentIntentId)
      return res.status(400).json({ error: "Payment not completed yet." });

    const paymentIntent = await stripe.paymentIntents.retrieve(stripePaymentIntentId);
    if (!paymentIntent || paymentIntent.status !== "succeeded")
      return res.status(400).json({ error: "Payment not successful." });

    const workers = await Worker.find({ status: "approved" });
    let matchingWorkers = [];

    for (const worker of workers) {
      if (!worker.latitude || !worker.longitude) continue;

      const approvedServices = (worker.services || [])
        .filter(
          (s) =>
            s.certStatus === "approved" ||
            s.certStatus === null ||
            s.certStatus === undefined
        )
        .map((s) => s.name.toLowerCase().trim());

      const jobService = (serviceType || "").toLowerCase().trim();
      const matches = approvedServices.some(
        (svc) =>
          svc === jobService ||
          jobService.includes(svc) ||
          svc.includes(jobService)
      );

      if (!matches) continue;

      const distKm = haversine(latitude, longitude, worker.latitude, worker.longitude);
      if (distKm <= 150) matchingWorkers.push(worker);
    }

    const newJob = new Job({
      customerId,
      serviceType,
      jobTitle,
      description,
      budget,
      location,
      scheduledAt,
      email,
      city,
      province,
      street,
      postalCode,
      latitude,
      longitude,
      stripePaymentIntentId,
      workersFound: matchingWorkers.length,
      status: matchingWorkers.length === 0 ? "waitlisted" : "pending",
      paymentStatus: "holding",
      paymentInfo: {
        intentId: stripePaymentIntentId,
        amount: budget,
        currency: "cad",
        escrowStatus: "holding",
        createdAt: new Date(),
      },
      history: [
        {
          action: "payment_received",
          by: "customer",
          at: new Date(),
          notes: "Funds captured and held in escrow.",
        },
      ],
    });

    const savedJob = await newJob.save();
    console.log(`💾 Job ${savedJob._id} created with escrow hold.`);

    // ✅ SOCKET: broadcast to workers
    try {
      const io = getIO();
      io.emit("job:new", { job: savedJob });
      console.log(`📡 Socket broadcast → job:new for ${savedJob.serviceType}`);
    } catch (err) {
      console.error("⚠️ Socket emit failed (job:new):", err.message);
    }

    // 📧 Emails remain unchanged
    for (const worker of matchingWorkers) {
      if (!worker.email) continue;
      await sendEmailSafe({
        to: worker.email,
        subject: `🔔 New ${serviceType} Job Posted - Book Your Need`,
        html: `
          <h2>Hi ${worker.name || "Worker"},</h2>
          <p>A new <strong>${serviceType}</strong> job has been posted in your area:</p>
          <ul>
            <li><strong>Title:</strong> ${jobTitle}</li>
            <li><strong>Budget:</strong> $${budget}</li>
            <li><strong>Location:</strong> ${city}, ${province}</li>
            <li><strong>Scheduled:</strong> ${new Date(scheduledAt).toLocaleString()}</li>
          </ul>
          <p>Open the BYN Worker App to review and place a bid.</p>
        `,
      });
    }

    if (email) {
      await sendEmailSafe({
        to: email,
        subject: "✅ Your Job Has Been Posted - Book Your Need",
        html: `
          <h2>Hi,</h2>
          <p>Your job has been successfully posted and paid for.</p>
          <p>We'll notify you once a worker accepts your job.</p>
          <br/>
          <p>Thank you for using <strong>Book Your Need</strong>!</p>
        `,
      });
    }

    res.status(201).json({
      jobId: savedJob._id,
      workersFound: matchingWorkers.length,
      status: savedJob.status,
      message:
        matchingWorkers.length > 0
          ? `✅ Job posted successfully!`
          : "⚠️ No approved workers nearby, job waitlisted.",
    });
  } catch (err) {
    console.error("❌ Failed to save job:", err.message);
    res.status(500).json({ error: "Server error: failed to save job." });
  }
});


router.get("/job/:jobId", async (req, res) => {
  try {
    const job = await Job.findById(req.params.jobId)
      .populate("customerId", "name profilePicture"); // ✅ Fixed line

    if (!job) return res.status(404).json({ error: "Job not found" });

    res.json(job);
  } catch (err) {
    console.error("❌ Error fetching job:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Get a specific bid by jobId and workerId
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

// Utility log
const log = (msg) => console.log("📦 [jobs.js]", msg);

// ============================================================
// ✅ ACCEPT BID CHANGE (Realtime + Escrow-Safe)
// ============================================================
router.post("/bids/change/accept", async (req, res) => {
  const { bidId } = req.body;
  const io = getIO();

  try {
    const bid = await Bid.findById(bidId)
      .populate("workerId", "email name")
      .populate("jobId");

    if (!bid) return res.status(404).json({ message: "Bid not found" });

    // ✅ Mark change accepted
    bid.changeRequest.status = "accepted";
    bid.price = bid.changeRequest.newPrice;
    bid.changeRequest.respondedAt = new Date();
    await bid.save();

    // ✅ Update job
    const job = await Job.findById(bid.jobId);
    if (job) {
      job.assignedPrice = bid.price;
      job.paymentAdjustmentPending = true; // 🧠 Flag for later Stripe adjustment at completion
      job.history.push({
        action: "bid_change_accepted",
        by: "customer",
        actorId: job.customerId,
        notes: `Accepted new bid of $${bid.price}`,
        at: new Date(),
      });
      await job.save();
    }

    // ✅ Notify worker instantly
    io.to(`worker_${bid.workerId._id}`).emit("bid:changeUpdate", {
      workerId: bid.workerId._id,
      jobId: job?._id,
      status: "approved",
      newPrice: bid.price,
      jobTitle: job?.jobTitle,
    });

    // ✅ Notify customer dashboard
    io.to(`customer_${job?.email}`).emit("job:update", {
      jobId: job?._id,
      type: "bidChangeAccepted",
      newPrice: bid.price,
    });

    // ✅ Email worker
    if (bid.workerId?.email) {
      await sendEmailSafe({
        to: bid.workerId.email,
        subject: "✅ Bid Change Accepted",
        html: `
          <h2>Hi ${bid.workerId.name || "Worker"},</h2>
          <p>Your updated bid for <strong>${job?.jobTitle}</strong> was accepted by the customer.</p>
          <p>New amount: <strong>$${bid.price}</strong>.</p>
          <p>Payment will adjust automatically once the customer confirms completion.</p>
          <br><p>— Book Your Need</p>
        `,
      });
    }

    log(`✅ Bid ${bidId} change accepted — ${bid.workerId.name}`);
    return res.json({
      message:
        "Bid change accepted successfully. Adjustment will occur on job completion.",
    });
  } catch (err) {
    console.error("❌ Accept bid change error:", err);
    res
      .status(500)
      .json({ message: "Failed to accept bid change.", error: err.message });
  }
});


// ============================================================
// ✅ REJECT BID CHANGE (Realtime)
// ============================================================
router.post("/bids/change/reject", async (req, res) => {
  const { bidId } = req.body;
  const io = getIO();

  try {
    const bid = await Bid.findById(bidId)
      .populate("workerId", "email name")
      .populate("jobId");

    if (!bid) return res.status(404).json({ message: "Bid not found" });

    bid.changeRequest.status = "rejected";
    bid.changeRequest.respondedAt = new Date();
    await bid.save();

    const job = await Job.findById(bid.jobId);

    // ✅ Socket notify worker instantly
    io.to(`worker_${bid.workerId._id}`).emit("bid:changeUpdate", {
      workerId: bid.workerId._id,
      jobId: job?._id,
      status: "rejected",
      jobTitle: job?.jobTitle,
    });

    // ✅ Notify customer dashboard too
    io.to(`customer_${job?.email}`).emit("job:update", {
      jobId: job?._id,
      type: "bidChangeRejected",
    });

    // ✅ Email worker
    if (bid.workerId?.email) {
      await sendEmailSafe({
        to: bid.workerId.email,
        subject: "❌ Bid Change Rejected",
        html: `
          <h2>Hi ${bid.workerId.name || "Worker"},</h2>
          <p>Your proposed bid update for job <strong>${bid.jobId?.jobTitle}</strong> was rejected by the customer.</p>
          <br><p>— Book Your Need</p>
        `,
      });
    }

    log(`❌ Bid ${bidId} change rejected — ${bid.workerId.name}`);
    return res.json({ message: "Bid change rejected successfully." });
  } catch (err) {
    console.error("❌ Reject bid change error:", err);
    res.status(500).json({ message: "Failed to reject bid change." });
  }
});

// ============================================================
// ✅ GET JOB DETAILS + BIDS
// ============================================================
router.get("/jobs/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;

    const job = await Job.findById(jobId);
    if (!job) return res.status(404).json({ message: "Job not found" });

    const bids = await Bid.find({
      jobId,
      status: { $nin: ["rejected", "cancelled"] },
    }).populate("workerId", "name email");

    const formattedBids = bids.map((bid) => ({
      _id: bid._id,
      price: bid.price,
      message: bid.message,
      workerId: bid.workerId._id,
      workerName: bid.workerId.name,
      workerEmail: bid.workerId.email,
      changeRequest: bid.changeRequest || {},
    }));

    res.json({ job, bids: formattedBids });
  } catch (error) {
    console.error("❌ Error fetching job details:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// ============================================================
// ✅ CUSTOMER JOBS (GROUPED)
// ============================================================
router.get("/user-jobs/:email", async (req, res) => {
  const { email } = req.params;

  try {
    const allJobs = await Job.find({ email })
      .populate("assignedTo", "name email")
      .populate({
        path: "bids",
        populate: {
          path: "workerId",
          select: "name email",
        },
        select: "price message changeRequest workerId status",
      })
      .sort({ createdAt: -1 })
      .lean();

    const pending = allJobs.filter(
      (j) =>
        ["pending", "reopened"].includes(j.status) ||
        (j.status === "assigned" && !j.assignedTo)
    );

    const assigned = allJobs.filter((j) =>
      [
        "assigned",
        "accepted",
        "in_progress",
        "worker_completed",
        "Worker_completed",
        "dispute",
      ].includes(j.status)
    );

    const completed = allJobs.filter((j) =>
      ["completed", "customer_confirmed", "auto_confirmed"].includes(j.status)
    );

    const cancelled = allJobs.filter((j) =>
      ["cancelled", "refunded", "partial_refund"].includes(j.status)
    );

    // 🧹 Removed io.to(...emit("job:refresh")) because it causes recursive refresh loops

    res.status(200).json({ pending, assigned, completed, cancelled });
  } catch (err) {
    console.error("❌ Fetch jobs failed:", err);
    res.status(500).json({ error: "Failed to fetch user jobs" });
  }
});

// ============================================================
// ✅ FETCH ALL BID CHANGE REQUESTS (Realtime capable)
// ============================================================
router.get("/bids/changes/:email", async (req, res) => {
  const { email } = req.params;

  try {
    const jobs = await Job.find({ email })
      .populate({
        path: "bids",
        match: {
          "changeRequest.status": { $in: ["pending", "approved", "rejected"] },
        },
        populate: { path: "workerId", select: "name email" },
        select: "price changeRequest workerId jobId",
      })
      .select("jobTitle email status bids");

    const bidChanges = [];

    jobs.forEach((job) => {
      (job.bids || []).forEach((bid) => {
        if (bid.changeRequest && bid.changeRequest.status !== "none") {
          bidChanges.push({
            jobId: job._id,
            jobTitle: job.jobTitle,
            workerName: bid.workerId?.name || "Unknown Worker",
            workerEmail: bid.workerId?.email || "unknown",
            newPrice: bid.changeRequest.newPrice,
            message: bid.changeRequest.message,
            status: bid.changeRequest.status,
            requestedAt: bid.changeRequest.requestedAt,
            respondedAt: bid.changeRequest.respondedAt,
          });
        }
      });
    });

    res.status(200).json(bidChanges);
  } catch (err) {
    console.error("❌ Error fetching bid changes:", err);
    res.status(500).json({ error: "Failed to fetch bid change requests" });
  }
});




// ✅ Cancel Job and Refund (now with socket emit)
router.post("/cancel-job/:jobId", async (req, res) => {
  const { jobId } = req.params;
  const io = getIO(); // ✅ initialize socket connection

  try {
    const job = await Job.findById(jobId)
      .populate("customerId assignedTo")
      .lean({ virtuals: true });

    if (!job) return res.status(404).json({ message: "Job not found" });

    const wasAssigned =
      job.status === "assigned" || (job.status === "reopened" && job.assignedTo);
    const wasReopenedUnassigned =
      job.status === "reopened" && !job.assignedTo;

    let refundAmount = 0;

    // ✅ Determine refund amount
    if (wasAssigned) {
      refundAmount = job.assignedPrice
        ? Math.max(Number(job.assignedPrice) - 4.99, 0)
        : 0;
      job.paymentStatus = "partial_refund";
      job.cancellationFee = 4.99;
    } else if (job.status === "pending" || wasReopenedUnassigned) {
      refundAmount = Number(job.assignedPrice || job.budget || 0);
      job.paymentStatus = "refunded";
    } else {
      return res
        .status(400)
        .json({ message: "Job cannot be cancelled in current state." });
    }

<<<<<<< HEAD
// ✅ Process Stripe refund safely (with 4.99 deduction logic)
if (job.stripePaymentIntentId) {
  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(job.stripePaymentIntentId);
    const charge = paymentIntent.latest_charge
      ? await stripe.charges.retrieve(paymentIntent.latest_charge)
      : null;

    const paidAmount = charge ? charge.amount / 100 : 0; // in CAD dollars

    // Ensure we have a valid refund amount (never more than paid)
    const refundToIssue = Math.min(refundAmount, paidAmount);

    if (refundToIssue > 0) {
      await stripe.refunds.create({
        payment_intent: job.stripePaymentIntentId,
        amount: Math.round(refundToIssue * 100), // in cents
        reason: "requested_by_customer",
      });
      console.log(`💸 Stripe refund processed: $${refundToIssue.toFixed(2)}`);
    } else {
      console.warn(`⚠️ No refundable amount available for job ${job._id}`);
    }
  } catch (err) {
    console.error("❌ Stripe refund failed:", err);
    return res.status(500).json({
      message: "Stripe refund failed",
      details: err.message,
    });
  }
} else {
  console.warn("⚠️ No stripePaymentIntentId for this job");
}
=======
    // ✅ Process Stripe refund safely
    if (job.stripePaymentIntentId) {
      try {
        const paymentIntent = await stripe.paymentIntents.retrieve(job.stripePaymentIntentId);
        const charge = paymentIntent.latest_charge
          ? await stripe.charges.retrieve(paymentIntent.latest_charge)
          : null;

        const paidAmount = charge ? charge.amount / 100 : 0;
        const safeRefundAmount = Math.min(Number(refundAmount), paidAmount);

        if (safeRefundAmount > 0) {
          await stripe.refunds.create({
            payment_intent: job.stripePaymentIntentId,
            amount: Math.round(safeRefundAmount * 100),
          });
          console.log(`✅ Stripe refund processed: $${safeRefundAmount}`);
        } else {
          console.warn("⚠️ No refundable amount available:", job._id);
        }
      } catch (stripeError) {
        console.error("❌ Stripe refund failed:", stripeError);
        return res.status(500).json({
          message: "Stripe refund failed",
          details: stripeError.message,
        });
      }
    } else {
      console.warn("⚠️ No stripePaymentIntentId for this job");
    }
>>>>>>> e4ee6847563ff9f15949edfa509b77226308059b

    // ✅ Update DB (use findByIdAndUpdate since we used lean)
    const updatedJob = await Job.findByIdAndUpdate(
      jobId,
      {
        status: "cancelled",
        cancelledAt: new Date(),
        refundAmount: Number(refundAmount),
        paymentStatus: job.paymentStatus,
        cancellationFee: job.cancellationFee || 0,
      },
      { new: true }
    ).populate("customerId assignedTo");

    // ✅ Socket Emit (real-time cancellation update)
    if (updatedJob.assignedTo?._id) {
      io.to(`worker_${updatedJob.assignedTo._id}`).emit("job:update", {
        jobId: updatedJob._id,
        status: "cancelled_by_customer",
      });
      console.log(`📡 Sent job:update → worker_${updatedJob.assignedTo._id} (cancelled_by_customer)`);
    }

    if (updatedJob.customerId?._id) {
      io.to(`customer_${updatedJob.customerId.email}`).emit("job:update", {
        jobId: updatedJob._id,
        status: "cancelled_by_customer",
      });
    }

    // ✅ Notify worker by email
    if (wasAssigned && updatedJob.assignedTo?.email) {
      await sendEmailSafe({
        to: updatedJob.assignedTo.email,
        subject: "⚠️ Job Was Cancelled",
        html: `
          <h2>Hi ${updatedJob.assignedTo.name || "Worker"},</h2>
          <p>The job <strong>${updatedJob.jobTitle}</strong> has been cancelled by the customer.</p>
          <p>The customer has been refunded.</p>
          <br><p>— Book Your Need</p>
        `,
      });
    }

    // ✅ Notify customer by email
    if (updatedJob.customerId?.email) {
      await sendEmailSafe({
        to: updatedJob.customerId.email,
        subject: "❌ Job Cancelled & Refund Processed",
        html: `
          <h2>Hi ${updatedJob.customerId.name || "Customer"},</h2>
          <p>Your job <strong>${updatedJob.jobTitle}</strong> was cancelled successfully.</p>
          <p>Refund amount: <strong>$${parseFloat(refundAmount || 0).toFixed(
            2
          )}</strong> has been processed to your payment method.</p>
          <br><p>— Book Your Need</p>
        `,
      });
    }

    res.status(200).json({
      message: "Job cancelled and refund processed safely.",
      refundAmount,
    });
  } catch (err) {
    console.error("❌ Cancel job error:", err);
    res.status(500).json({
      message: "Failed to cancel and refund.",
      error: err.message,
    });
  }
});

// ✅ GET all bids submitted by a worker
router.get("/my-bids/:workerId", async (req, res) => {
  try {
    const bids = await Bid.find({ workerId: req.params.workerId }).populate({
      path: "jobId",
      populate: {
        path: "customerId",
        strictPopulate: false,
      },
    });

    const filtered = bids.filter(b => b.jobId);
    res.json(filtered);
  } catch (err) {
    console.error("❌ Error fetching bids:", err);
    res.status(500).json({ message: "Server error fetching bids." });
  }
});

// 📤 Submit a bid for a job
const calculateEarnings = (bidAmount) => {
  if (bidAmount < 100) return bidAmount - 4.49;
  if (bidAmount < 250) return bidAmount * 0.92;
  if (bidAmount < 500) return bidAmount * 0.93;
  if (bidAmount < 1000) return bidAmount * 0.94;
  return bidAmount * 0.95;
};

router.post("/submit-bid", async (req, res) => {
  const { jobId, workerId, price, message = "" } = req.body;

  try {
    // ✅ Prevent duplicate bid
    const existingBid = await Bid.findOne({ jobId, workerId });
    if (existingBid) {
      return res.status(400).json({ message: "You have already submitted a bid for this job." });
    }

    const estimatedEarnings = parseFloat(calculateEarnings(Number(price)).toFixed(2));

    // ✅ Create new bid
    const newBid = await Bid.create({
      jobId,
      workerId,
      price,
      message,
      estimatedEarnings,
    });

    // ✅ Add to Job's bid array
    await Job.findByIdAndUpdate(jobId, {
      $addToSet: { bids: newBid._id },
    });

    // ✅ Fetch job with populated customer + worker info
    const job = await Job.findById(jobId).populate("customerId", "email name");
    const worker = await Worker.findById(workerId);

    // ✅ Notify Worker
    if (worker?.email) {
      await sendEmailSafe({
        to: worker.email,
        subject: "✅ Your Bid Was Submitted",
        html: `
          <h2>Hi ${worker.name || "there"},</h2>
          <p>Your bid of <strong>$${price}</strong> was submitted successfully for the job: <strong>${job.jobTitle}</strong>.</p>
          <p>We’ll notify you when the customer responds.</p>
          <br>
          <p>— Book Your Need</p>
        `,
      });
      console.log(`✅ Bid email sent to worker: ${worker.email}`);
    }

    // ✅ Notify Customer
    if (job?.customerId?.email) {
      await sendEmailSafe({
        to: job.customerId.email,
        subject: "📩 New Bid on Your Job",
        html: `
          <h2>Hello ${job.customerId.name || "there"},</h2>
          <p>You’ve received a new bid for: <strong>${job.jobTitle}</strong>.</p>
          <p><strong>${worker.name || "A worker"}</strong> submitted a bid for <strong>$${price}</strong>.</p>
          <p>Login to your dashboard to view and respond to this bid.</p>
          <br>
          <p>— Book Your Need</p>
        `,
      });
      console.log(`✅ New bid email sent to customer: ${job.customerId.email}`);
    }

    res.status(200).json({ message: "Bid submitted", bid: newBid });
  } catch (err) {
    console.error("❌ Error submitting bid:", err);
    res.status(500).json({ message: "Failed to submit bid" });
  }
});


// ✅ GET all jobs assigned to this worker
router.get("/assigned/:workerId", async (req, res) => {
  const { workerId } = req.params;
  try {
    const jobs = await Job.find({ acceptedBy: workerId }).sort({ scheduledAt: 1 });
    res.status(200).json(jobs);
  } catch (err) {
    console.error("❌ Error fetching assigned jobs:", err);
    res.status(500).json({ message: "Server error fetching assigned jobs." });
  }
});

// ✅ Accept Bid (customer assigns worker)
router.post("/accept-bid", async (req, res) => {
  const { jobId, workerId } = req.body;

  console.log("📩 Accept Bid Request:", { jobId, workerId });

  try {
    const job = await Job.findById(jobId).populate("customerId");
    if (!job) {
      console.log("❌ Job not found:", jobId);
      return res.status(404).json({ message: "Job not found" });
    }

    const customer = await User.findById(job.customerId?._id || job.customerId);
    const worker = await Worker.findById(workerId);
    const acceptedBid = await Bid.findOne({ jobId, workerId });

    if (!worker || !acceptedBid) {
      console.log("❌ Worker or bid not found.");
      return res.status(404).json({ message: "Worker or bid not found" });
    }

    // ✅ Update job status
    job.status = "assigned";
    job.assignedTo = workerId;
    job.assignedPrice = acceptedBid.price;
    await job.save();
    console.log("✅ Job assigned:", job._id);

    /* ========================================================= */
    /* ⚡ SOCKET.IO REAL-TIME EMITS                              */
    /* ========================================================= */
    try {
      const io = getIO();

      // 🔹 Notify selected worker (assigned)
      io.to(`worker_${workerId}`).emit("job:assigned", {
        jobId,
        message: "🎉 You’ve been assigned this job!",
      });
      console.log(`⚡ Socket → job:assigned → worker_${workerId}`);

      // 🔹 Notify customer (status update)
      if (job.customerId?._id) {
        io.to(`customer_${job.customerId._id}`).emit("job:update", {
          jobId,
          status: "assigned",
        });
        console.log(`⚡ Socket → job:update → customer_${job.customerId._id}`);
      }

      // 🔹 Notify all rejected workers
      const rejectedBids = await Bid.find({
        jobId,
        workerId: { $ne: workerId },
      }).populate("workerId", "_id");

      rejectedBids.forEach((b) => {
        if (b.workerId?._id) {
          io.to(`worker_${b.workerId._id}`).emit("job:update", {
            jobId,
            status: "rejected",
          });
          console.log(`⚡ Socket → job:update (rejected) → worker_${b.workerId._id}`);
        }
      });
    } catch (socketErr) {
      console.error("⚠️ Socket emit failed:", socketErr.message);
    }

    /* ========================================================= */
    /* 📧 EMAIL NOTIFICATIONS                                   */
    /* ========================================================= */

    // ✅ Notify selected worker
    if (worker?.email) {
      await sendEmailSafe({
        to: worker.email,
        subject: "🎉 You've Been Assigned a Job!",
        context: "Assigned Worker",
        html: `
          <h2>Hi ${worker.name || "there"},</h2>
          <p>You’ve been assigned the job: <strong>${job.jobTitle}</strong>.</p>
          <p><strong>Accepted Bid:</strong> $${acceptedBid.price}</p>
          <p><strong>Location:</strong> ${job.location || "N/A"}</p>
          <p><strong>Scheduled:</strong> ${new Date(job.scheduledAt).toLocaleString()}</p>
          <br>
          <p>Please log in to your dashboard to get started.</p>
          <p>— Book Your Need</p>
        `,
      });
      console.log("✅ Email sent to assigned worker:", worker.email);
    }

    // ✅ Notify customer
    if (customer?.email) {
      await sendEmailSafe({
        to: customer.email,
        subject: "✅ You Assigned a Worker!",
        context: "Customer Notification",
        html: `
          <h2>Hi ${customer.name || "there"},</h2>
          <p>You successfully assigned <strong>${worker.name || "the worker"}</strong> 
          to the job: <strong>${job.jobTitle}</strong>.</p>
          <p><strong>Accepted Bid:</strong> $${acceptedBid.price}</p>
          <br>
          <p>Thanks for using Book Your Need!</p>
        `,
      });
      console.log("✅ Email sent to customer:", customer.email);
    }

    // ✅ Notify rejected workers via email
    const rejectedBids = await Bid.find({
      jobId,
      workerId: { $ne: workerId },
    }).populate("workerId", "email name");

    for (const bid of rejectedBids) {
      const rejectedWorker = bid.workerId;

      if (rejectedWorker?.email) {
        await sendEmailSafe({
          to: rejectedWorker.email,
          context: `Rejected Worker ${rejectedWorker._id}`,
          subject: "🙁 You Weren’t Selected This Time",
          html: `
            <h2>Hi ${rejectedWorker.name || "there"},</h2>
            <p>You placed a bid on the job: <strong>${job.jobTitle}</strong>, 
            but another worker was selected.</p>
            <p>Don't worry — new jobs are posted every day!</p>
            <p>Keep your profile active and keep bidding 💪</p>
            <br>
            <p>— Book Your Need</p>
          `,
        });
        console.log("📨 Rejected email sent to:", rejectedWorker.email);
      }
    }

    res.status(200).json({ message: "Worker assigned successfully." });
  } catch (err) {
    console.error("❌ Error accepting bid:", err);
    res.status(500).json({ message: "Server error" });
  }
});


module.exports = router;
