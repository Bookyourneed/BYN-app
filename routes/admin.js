const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const Admin = require('../models/Admin');
const Job = require('../models/Job');
const Worker = require('../models/Worker');
const Ride = require("../models/Ride");
const Bid = require("../models/Bid");

const BookingRequest = require("../models/BookingRequest");

// ✅ Stripe & dependencies
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { getIO } = require("../socket");

const HelpTicket = require('../models/HelpTicket');
const User = require('../models/User'); // Make sure this is defined
const { sendEmailSafe } = require("../emailService");

// ✅ In routes/admin.js or wherever admin routes are:
router.get("/worker/:workerId", async (req, res) => {
  try {
    const worker = await Worker.findById(req.params.workerId);
    if (!worker) return res.status(404).send("Worker not found.");
    res.json(worker);
  } catch (err) {
    res.status(500).send("Server error.");
  }
});

// ✅ Admin Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const admin = await Admin.findOne({ email });
    if (!admin) return res.status(404).json({ message: 'Admin not found' });

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) return res.status(401).json({ message: 'Invalid credentials' });

    res.status(200).json({
      id: admin._id,
      name: admin.name,
      role: admin.role,
      token: 'mock-jwt-for-now',
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/update-doc-status/:workerId', async (req, res) => {
  const { field, value, reason } = req.body;
  const { workerId } = req.params;

  const allowedFields = [
    "selfieStatus",
    "profilePhotoStatus",
    "backgroundCheckStatus",
    "permitStatus",
    "rideLicenseStatus",
    "rideInsuranceStatus",
    "vehicleRegistrationStatus",
  ];

  if (!allowedFields.includes(field)) {
    return res.status(400).json({ message: "Invalid field" });
  }

  try {
    const worker = await Worker.findById(workerId);
    if (!worker) {
      console.error("❌ Worker not found");
      return res.status(404).json({ message: "Worker not found" });
    }

    if (!worker.email) {
      console.error("❌ Worker has no email");
      return res.status(400).json({ message: "Worker email missing" });
    }

    worker[field] = value;
    await worker.save();

    // ✅ Send Rejection Email
    if (value === "rejected") {
      console.log("📨 About to send REJECTION email to:", worker.email);
      try {
        await sendEmailSafe({
          to: worker.email,
          subject: `❌ Document Rejected: ${field}`,
          text: `Hi ${worker.name || "there"},\n\nOne of your submitted documents was rejected during review.\n\nRejected Document: ${field}\nReason: ${reason || "Not specified"}\n\nPlease log in to update the document and resubmit.\n\n– Team BYN`
        });
        console.log(`📧 Rejection email sent to ${worker.email} for field "${field}"`);
      } catch (err) {
        console.error(`❌ Failed to send rejection email to ${worker.email}`, err);
      }
    }

    // ✅ Send Approval Email
    if (value === "approved") {
      console.log("📨 About to send APPROVAL email to:", worker.email);
      try {
        await sendEmailSafe({
          to: worker.email,
          subject: `✅ Document Approved: ${field}`,
          text: `Hi ${worker.name || "there"},\n\nYour submitted document for '${field}' has been approved by our team.\n\nThanks for verifying your profile!\n\n– Team BYN`
        });
        console.log(`📧 Approval email sent to ${worker.email} for field "${field}"`);
      } catch (err) {
        console.error(`❌ Failed to send approval email to ${worker.email}`, err);
      }
    }

    res.json({ message: `${field} updated to ${value}`, worker });
  } catch (err) {
    console.error("❌ Error updating doc status:", err);
    res.status(500).json({ message: "Failed to update document status" });
  }
});

// ❌ Reject worker with a final reason and send email
router.post("/reject-worker/:workerId", async (req, res) => {
  const { reason } = req.body;

  try {
    const worker = await Worker.findById(req.params.workerId);
    if (!worker) return res.status(404).json({ message: "Worker not found" });

    worker.status = "rejected";
    await worker.save();

    // Send rejection email
    await sendEmailSafe({
      to: worker.email,
      subject: "⚠️ Your BYN Profile Was Rejected",
      text: `Hi ${worker.name || "there"},\n\nYour profile could not be approved at this time.\n\nReason: ${reason || "No reason provided"}\n\nPlease log in and update the required documents to proceed.\n\nThanks,\nTeam BYN`
    });

    res.json({ message: "Worker rejected and email sent" });
  } catch (err) {
    console.error("❌ Error rejecting worker:", err);
    res.status(500).json({ message: "Failed to reject worker" });
  }
});

// 🔄 Reset worker status to 'pending'
router.post("/reset-worker/:workerId", async (req, res) => {
  try {
    const worker = await Worker.findById(req.params.workerId);
    if (!worker) return res.status(404).json({ message: "Worker not found" });

    worker.status = "pending";

    // Optional: Reset individual doc statuses too
    worker.profilePhotoStatus = "pending";
    worker.selfieStatus = "pending";
    worker.backgroundCheckStatus = "pending";
    worker.permitStatus = "pending";
    worker.rideLicenseStatus = "pending";
    worker.rideInsuranceStatus = "pending";
    worker.vehicleRegistrationStatus = "pending";

    worker.services = worker.services.map(service => ({
      ...service,
      certStatus: "pending"
    }));

    await worker.save();

    res.json({ message: "Worker reset to pending", worker });
  } catch (err) {
    console.error("❌ Error resetting worker:", err);
    res.status(500).json({ message: "Failed to reset worker" });
  }
});


// ✅ Admin Dashboard Stats
router.get('/stats', async (req, res) => {
  try {
    const totalJobs = await Job.countDocuments();
    const totalWorkers = await Worker.countDocuments();

    const pendingApprovals = await Worker.countDocuments({
      $or: [
        { status: 'pending' },
        { 'services.certStatus': 'pending' },
        { backgroundCheckStatus: 'pending' },
        { permitStatus: 'pending' },
        { profilePhotoStatus: 'pending' },
      ],
    });

    res.json({
      totalJobs,
      totalWorkers,
      pendingApprovals,
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ message: 'Failed to fetch stats' });
  }
});

// ✅ Get All Workers
router.get('/workers', async (req, res) => {
  try {
    const allWorkers = await Worker.find().sort({ createdAt: -1 });
    res.json(allWorkers);
  } catch (err) {
    console.error('Failed to fetch workers:', err);
    res.status(500).json({ message: 'Failed to load workers' });
  }
});

// ✅ Update Worker Status + Documents
router.post('/update-status/:workerId', async (req, res) => {
  const { status } = req.body;

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ message: 'Invalid status' });
  }

  try {
    const worker = await Worker.findById(req.params.workerId);
    if (!worker) return res.status(404).json({ message: 'Worker not found' });

    worker.status = status;

    if (status === 'approved') {
      worker.profilePhotoStatus = 'approved';
      worker.backgroundCheckStatus = 'approved';
      worker.permitStatus = 'approved';
      worker.services = worker.services.map(service => ({
        ...service,
        certStatus: 'approved',
      }));
    }

    await worker.save();
    res.json({ message: `Worker ${status}`, worker });
  } catch (err) {
    console.error('Update status error:', err);
    res.status(500).json({ message: 'Failed to update status' });
  }
});

// ✅ Get All Jobs
router.get('/jobs', async (req, res) => {
  try {
    const jobs = await Job.find().sort({ createdAt: -1 });
    res.json(jobs);
  } catch (err) {
    console.error('Error fetching jobs:', err);
    res.status(500).json({ message: 'Failed to fetch jobs' });
  }
});

// ✅ Delete job + save cancel reason
router.delete('/delete-job/:jobId', async (req, res) => {
  const { jobId } = req.params;
  const { reason } = req.body;

  try {
    const job = await Job.findByIdAndUpdate(
      jobId,
      {
        status: 'cancelled',
        cancelReason: reason || 'No reason provided',
        cancelledAt: new Date(),
      },
      { new: true }
    );

    if (!job) return res.status(404).json({ message: 'Job not found' });

    res.status(200).json({ message: 'Job cancelled', job });
  } catch (err) {
    console.error('Cancel job error:', err);
    res.status(500).json({ message: 'Failed to cancel job' });
  }
});

// ✅ Help Center - Get Tickets
router.get('/help/all', async (req, res) => {
  try {
    const tickets = await HelpTicket.find().sort({ createdAt: -1 });
    res.json(tickets);
  } catch (err) {
    res.status(500).json({ message: 'Error loading tickets' });
  }
});

// ✅ Help Center - Update Ticket
router.post('/help/update/:ticketId', async (req, res) => {
  const { status, adminNotes } = req.body;

  try {
    const ticket = await HelpTicket.findByIdAndUpdate(
      req.params.ticketId,
      {
        status,
        adminNotes,
        resolvedAt: status === 'resolved' ? new Date() : null,
      },
      { new: true }
    );

    res.json({ message: 'Ticket updated', ticket });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update ticket' });
  }
});

// ✅ View Customers
router.get('/customers', async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    console.error('Failed to fetch customers:', err);
    res.status(500).json({ message: 'Failed to load customers' });
  }
});

router.post("/update-document-status/:workerId", async (req, res) => {
  const { field, status, serviceIndex } = req.body;

  try {
    const worker = await Worker.findById(req.params.workerId);
    if (!worker) return res.status(404).json({ message: "Worker not found" });

    if (field.startsWith("services")) {
      // For example: field = "services", serviceIndex = 1
      worker.services[serviceIndex].certStatus = status;
    } else {
      worker[field] = status;
    }

    await worker.save();
    res.json({ message: `${field} updated to ${status}`, worker });
  } catch (err) {
    console.error("Document status update error:", err);
    res.status(500).json({ message: "Failed to update document status" });
  }
});

// Update individual document status
router.post('/update-doc-status/:workerId', async (req, res) => {
  const { field, value } = req.body;
  const { workerId } = req.params;

  const allowedFields = [
    "profilePhotoStatus",
    "backgroundCheckStatus",
    "permitStatus",
  ];

  if (!allowedFields.includes(field)) {
    return res.status(400).json({ message: "Invalid field" });
  }

  try {
    const worker = await Worker.findById(workerId);
    if (!worker) return res.status(404).json({ message: "Worker not found" });

    worker[field] = value;
    await worker.save();

    res.json({ message: `${field} updated to ${value}`, worker });
  } catch (err) {
    console.error("❌ Error updating doc status:", err);
    res.status(500).json({ message: "Failed to update document status" });
  }
});
// ✅ Approve/reject certification for a specific service with email
router.post("/approve-cert", async (req, res) => {
  const { workerId, serviceName, status, reason } = req.body;

  try {
    const worker = await Worker.findById(workerId);
    if (!worker) return res.status(404).json({ error: "Worker not found" });

    const service = worker.services.find((s) => s.name === serviceName);
    if (!service) return res.status(404).json({ error: "Service not found" });

    // ✅ Update cert status and optional reason
    service.certStatus = status;
    if (reason) service.rejectionReason = reason;

    await worker.save();

    // ✅ Immediately respond to frontend (Axios will now always succeed)
    res.status(200).json({ success: true, message: "Certification status updated" });

    // 📨 Send email **after** response (non-blocking)
    setImmediate(async () => {
      try {
        if (status === "approved") {
          await sendEmailSafe({
            to: worker.email,
            subject: `✅ Certificate Approved — ${serviceName}`,
            text: `Hi ${worker.name || "there"},\n\nYour certificate for "${serviceName}" has been approved.\nYou're one step closer to getting jobs!\n\n— Team BYN`,
          });
        } else if (status === "rejected") {
          await sendEmailSafe({
            to: worker.email,
            subject: `❌ Certificate Rejected — ${serviceName}`,
            text: `Hi ${worker.name || "there"},\n\nUnfortunately, your certificate for "${serviceName}" was rejected.\n\nReason: ${reason || "No reason provided"}\n\n— Team BYN`,
          });
        }
      } catch (err) {
        console.error("⚠️ Email send failed:", err);
      }
    });
  } catch (err) {
    console.error("❌ Cert status update error:", err);
    res.status(500).json({ error: "Server error updating certificate" });
  }
});

router.get("/ride-docs", async (req, res) => {
  try {
    const workers = await Worker.find({
      $or: [
        { "driverProfile.licenseUrl": { $exists: true, $ne: "" } },
        { "driverProfile.insuranceUrl": { $exists: true, $ne: "" } },
        { "driverProfile.carPhotoUrl": { $exists: true, $ne: "" } },
      ],
    }).select("name email phone driverProfile");

    res.json(workers);
  } catch (err) {
    console.error("❌ Error fetching ride docs:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/update-ride-docs/:workerId", async (req, res) => {
  const { workerId } = req.params;
  const { status, reason } = req.body;

  if (!["approved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  try {
    const worker = await Worker.findById(workerId);
    if (!worker) return res.status(404).json({ error: "Worker not found" });

    worker.driverProfile.status = status;
    await worker.save();

    // ✅ Email content
    const subject = status === "approved"
      ? "🚗 Ride Driver Documents Approved"
      : "❌ Ride Driver Documents Rejected";

    const text = status === "approved"
      ? `Hi ${worker.name},\n\nYour ride driver documents have been approved. You're now eligible to post rides on BYN.\n\nThank you!`
      : `Hi ${worker.name},\n\nUnfortunately, your ride driver documents have been rejected for the following reason:\n\n"${reason}"\n\nPlease re-upload your documents and try again.\n\nThank you.`;

    await sendEmailSafe({
      to: worker.email,
      subject,
      text,
    });

    res.status(200).json({ message: `Driver profile ${status} and email sent` });
  } catch (err) {
    console.error("❌ Error updating ride docs:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Get all workers with uploaded certs
router.get("/certificates", async (req, res) => {
  try {
    const workers = await Worker.find(
      { "services.certUrl": { $exists: true, $ne: "" } },
      {
        name: 1,
        email: 1,
        phone: 1,
        status: 1,
        services: 1,
      }
    ).sort({ createdAt: -1 });

    res.status(200).json({ workers });
  } catch (err) {
    console.error("❌ Error fetching certificates:", err);
    res.status(500).json({ error: "Server error fetching certificates" });
  }
});


router.post("/revoke-ride-access/:workerId", async (req, res) => {
  try {
    const { workerId } = req.params;

    const worker = await Worker.findById(workerId);
    if (!worker) return res.status(404).json({ error: "Worker not found" });

    worker.driverProfile.status = "pending";
    await worker.save();

    // Optionally set all their rides to pending
    await Ride.updateMany(
      { workerId },
      { status: "pending" }
    );

    await sendEmailSafe({
      to: worker.email,
      subject: "⚠️ Ride Access Revoked",
      text: `Hi ${worker.name},\n\nYour ride posting permissions have been revoked and set to pending status. Please contact support to re-enable your ride access.\n\nThanks,\nTeam BYN`
    });

    res.status(200).json({ message: "Ride access revoked and worker set to pending" });
  } catch (err) {
    console.error("❌ Revoke failed:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get('/job/:jobId', async (req, res) => {
  try {
    const job = await Job.findById(req.params.jobId)
      .populate('customerId', 'name email phone address city province postalCode')
      .populate('assignedTo', 'name email phone') // ✅ correct field name
      .lean();

    const bids = await Bid.find({ jobId: req.params.jobId })
      .populate('workerId', 'name phone email')
      .lean();

    res.json({ job, bids });
  } catch (err) {
    console.error("❌ Error fetching job details:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ REAL Stripe Refund + Worker Payout on Dispute Resolution 
router.post("/resolve-dispute/:jobId", async (req, res) => {
  const { jobId } = req.params;

  // New fields from frontend
  const {
    resolution,
    refundAmount,      // old customer refund field
    workerAmount,      // new worker amount field
    adminNotes,
  } = req.body;

  try {
    const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
    const { getIO } = require("../socket");
    const io = getIO();

    const job = await Job.findById(jobId)
      .populate("customerId", "email name")
      .populate("assignedTo", "email name walletBalance commissionRate");

    if (!job) return res.status(404).json({ error: "Job not found" });
    if (job.status !== "dispute")
      return res.status(400).json({ error: "Job is not under dispute" });

    // Update payment info
    job.paymentInfo = job.paymentInfo || {};
    job.paymentInfo.escrowStatus = "resolved";
    job.paymentInfo.lastActionAt = new Date();

    job.history.push({
      action: "dispute_resolved",
      by: "admin",
      at: new Date(),
      notes: adminNotes || `Admin marked resolved: ${resolution}`,
    });

    let resolutionMessage = "";
    let workerEmailMsg = "";
    let customerEmailMsg = "";

    /* ================================================================
       🧾 STRIPE REFUND HELPER
    ================================================================ */
    const processStripeRefund = async (amount) => {
      if (!job.stripePaymentIntentId) {
        console.warn("⚠️ No PaymentIntent found");
        return false;
      }

      try {
        const paymentIntent = await stripe.paymentIntents.retrieve(
          job.stripePaymentIntentId
        );
        const charge = paymentIntent.latest_charge
          ? await stripe.charges.retrieve(paymentIntent.latest_charge)
          : null;

        const paidAmount = charge ? charge.amount / 100 : 0;
        const safeRefund = Math.min(Number(amount), paidAmount);

        if (safeRefund <= 0) return false;

        await stripe.refunds.create({
          payment_intent: job.stripePaymentIntentId,
          amount: Math.round(safeRefund * 100),
        });

        console.log(`💸 Stripe refund processed: $${safeRefund}`);
        return true;
      } catch (err) {
        console.error("❌ Stripe refund failed:", err);
        throw new Error("Stripe refund failed");
      }
    };

    /* ================================================================
       💰 WORKER PAYMENT HELPER
    ================================================================ */
    const creditWorker = async (amount) => {
      if (!job.assignedTo) return;

      const worker = await Worker.findById(job.assignedTo);
      if (!worker) return;

      worker.walletBalance = (worker.walletBalance || 0) + Number(amount);

      worker.walletHistory.push({
        type: "credit",
        amount: Number(amount),
        jobId: job._id,
        date: new Date(),
        released: true,
        notes: "Partial dispute payout",
      });

      await worker.save();
      console.log(`💼 Worker credited: $${amount}`);
    };

    /* ================================================================
       🎯 RESOLUTION OPTIONS
    ================================================================ */

    // ⚠️ Full refund to customer (unchanged)
    if (resolution === "refund_customer") {
      const totalRefund = job.budget || job.assignedPrice || 0;
      await processStripeRefund(totalRefund);

      job.paymentStatus = "refunded";
      job.status = "cancelled";
      job.refundAmount = totalRefund;

      resolutionMessage = `💸 Full refund of $${totalRefund} issued.`;
      workerEmailMsg = `Admin resolved the dispute in favor of the customer. No payout released.`;
      customerEmailMsg = `Your full refund of $${totalRefund} has been processed.`;
    }

    // ⭐ NEW PARTIAL REFUND SYSTEM
    if (resolution === "partial_refund") {
      const customerShare = Math.max(Number(refundAmount) || 0, 0);
      const workerShare = Math.max(Number(workerAmount) || 0, 0);

      // Refund customer (real money)
      if (customerShare > 0) {
        await processStripeRefund(customerShare);
      }

      // Pay worker (wallet credit)
      if (workerShare > 0) {
        await creditWorker(workerShare);
      }

      job.paymentStatus = "partial_refund";
      job.status = "completed";
      job.refundAmount = customerShare;
      job.partialWorkerAmount = workerShare;

      resolutionMessage = `⚖️ Partial refund: $${customerShare} to customer, $${workerShare} to worker.`;

      workerEmailMsg = `You received $${workerShare} from dispute resolution.`;
      customerEmailMsg = `You received a partial refund of $${customerShare}.`;
    }

    // 🟢 Release full amount to worker (unchanged)
    if (resolution === "release_worker") {
      const worker = await Worker.findById(job.assignedTo);
      if (worker) {
        const commission = worker.commissionRate || 0.15;
        const earning = parseFloat(
          (job.assignedPrice * (1 - commission)).toFixed(2)
        );

        await creditWorker(earning);
      }

      job.paymentStatus = "released";
      job.status = "completed";

      resolutionMessage = `💰 Full payout released to worker.`;
      workerEmailMsg = `Your full payment has been released for "${job.jobTitle}".`;
      customerEmailMsg = `The dispute was resolved in favor of the worker.`;
    }

    await job.save();

    /* ================================================================
       📡 REAL-TIME SOCKET EVENTS
    ================================================================ */
    if (job.customerId?.email) {
      io.to(`customer_${job.customerId.email}`).emit("job:update", {
        jobId: job._id,
        status: job.status,
        message: resolutionMessage,
      });
    }

    if (job.assignedTo?._id) {
      io.to(`worker_${job.assignedTo._id}`).emit("job:update", {
        jobId: job._id,
        status: job.status,
        message: resolutionMessage,
      });
    }

    /* ================================================================
       ✉️ EMAILS
    ================================================================ */
    if (job.assignedTo?.email) {
      await sendEmailSafe({
        to: job.assignedTo.email,
        subject: "📩 Dispute Resolved",
        html: `
          <h2>Hi ${job.assignedTo.name || "Worker"},</h2>
          <p>${workerEmailMsg}</p>
          <p><strong>Admin Notes:</strong> ${adminNotes || "N/A"}</p>
          <br><p>— Book Your Need</p>
        `,
      });
    }

    if (job.customerId?.email) {
      await sendEmailSafe({
        to: job.customerId.email,
        subject: "📩 Dispute Resolved",
        html: `
          <h2>Hi ${job.customerId.name || "Customer"},</h2>
          <p>${customerEmailMsg}</p>
          <p><strong>Admin Notes:</strong> ${adminNotes || "N/A"}</p>
          <br><p>— Book Your Need</p>
        `,
      });
    }

    res.json({
      success: true,
      message: resolutionMessage,
      job,
    });
  } catch (err) {
    console.error("❌ Dispute resolution failed:", err);
    res.status(500).json({ error: err.message || "Failed to resolve dispute" });
  }
});


// ✅ Get all active disputes
router.get("/all-disputes", async (req, res) => {
  try {
    const disputes = await Job.find({ status: "dispute" })
      .populate("customerId", "name email")
      .populate("assignedTo", "name email")
      .sort({ createdAt: -1 });
    res.json(disputes);
  } catch (err) {
    console.error("❌ Error fetching disputes:", err);
    res.status(500).json({ error: "Failed to fetch disputes" });
  }
});

// ============================================================
// ✅ AUTO-RELEASE JOB FUNDS (48h Timeout)
// Handles bid changes safely – no re-holds, only diff charge/refund
// ============================================================
async function releasePendingFunds() {
  const now = new Date();
  const io = getIO();

  const readyJobs = await Job.find({
    paymentStatus: "pending_release",
    "completion.releaseDate": { $lte: now },
  })
    .populate("assignedTo", "email name walletBalance commissionRate")
    .populate("customerId", "email name stripeCustomerId");

  for (const job of readyJobs) {
    try {
      const worker = await Worker.findById(job.assignedTo);
      if (!worker) continue;

      const adjustedPrice = job.assignedPrice || 0;

      // =======================================================
      // 💰 SMART PAYMENT RECONCILIATION (fixed)
      // =======================================================
      if (job.stripePaymentIntentId && job.customerId?.stripeCustomerId) {
        try {
          const intent = await stripe.paymentIntents.retrieve(job.stripePaymentIntentId);
          const charge = intent.latest_charge
            ? await stripe.charges.retrieve(intent.latest_charge)
            : null;
          const amountPaid = charge ? charge.amount / 100 : adjustedPrice;
          const difference = parseFloat((adjustedPrice - amountPaid).toFixed(2));

          if (Math.abs(difference) >= 0.5) {
            if (difference > 0) {
              // ⬆️ Price increased → charge the difference automatically
              console.log(`💳 Charging +$${difference} for updated bid (auto-release)`);

              const originalPaymentMethod = intent.payment_method;

              if (!originalPaymentMethod) {
                console.warn("⚠️ No saved payment method found for job", job._id);
              } else {
                // ✅ Attach payment method to customer if not attached
                try {
                  await stripe.paymentMethods.attach(originalPaymentMethod, {
                    customer: job.customerId.stripeCustomerId,
                  });
                  console.log(`🔗 Attached payment method ${originalPaymentMethod} to customer`);
                } catch (attachErr) {
                  if (attachErr.code === "resource_already_exists") {
                    console.log("⚠️ Payment method already attached, continuing...");
                  } else {
                    console.warn("⚠️ Could not attach payment method:", attachErr.message);
                  }
                }

                // ✅ Create and confirm off-session extra charge
                const extraCharge = await stripe.paymentIntents.create({
                  amount: Math.round(difference * 100),
                  currency: "cad",
                  customer: job.customerId.stripeCustomerId,
                  payment_method: originalPaymentMethod,
                  off_session: true,
                  confirm: true,
                  description: `Auto-charge difference for ${job.jobTitle}`,
                  automatic_payment_methods: {
                    enabled: true,
                    allow_redirects: "never", // ✅ prevent redirect requirement
                  },
                });

                console.log(
                  `✅ Auto-charged extra $${difference} (PaymentIntent: ${extraCharge.id})`
                );
              }
            } else {
              // ⬇️ Price decreased → refund the difference
              const refundAmount = Math.abs(difference);
              console.log(`💸 Refunding $${refundAmount} for lowered bid (auto-release)`);

              await stripe.refunds.create({
                payment_intent: job.stripePaymentIntentId,
                amount: Math.round(refundAmount * 100),
              });

              console.log(`✅ Refunded $${refundAmount} successfully`);
            }
          }
        } catch (stripeErr) {
          console.error("❌ Stripe adjustment error:", stripeErr);
        }
      }

      // =======================================================
      // 💎 RELEASE FUNDS TO WORKER
      // =======================================================
      job.paymentStatus = "released";
      job.status = "auto_confirmed";
      job.completion.autoReleasedAt = new Date();

      const commission = worker.commissionRate || 0.15;
      const earning = parseFloat((adjustedPrice * (1 - commission)).toFixed(2));

      // update wallet
      const existing = worker.walletHistory.find(
        (h) => String(h.jobId) === String(job._id) && !h.released
      );
      if (existing) existing.released = true;
      else {
        worker.walletHistory.push({
          type: "credit",
          amount: earning,
          jobId: job._id,
          date: new Date(),
          released: true,
          notes: "Auto release after 48h (smart reconciliation)",
        });
      }

      worker.walletBalance = (worker.walletBalance || 0) + earning;

      await worker.save();
      await job.save();

      // =======================================================
      // ⚡ SOCKET UPDATES
      // =======================================================
      io.to(`worker_${worker._id}`).emit("job:update", {
        jobId: job._id,
        status: "auto_confirmed",
        message: `💰 Payment auto-released ($${adjustedPrice}) after 48 hours.`,
      });

      io.to(`customer_${job.customerId.email}`).emit("job:update", {
        jobId: job._id,
        status: "auto_confirmed",
        message: "✅ Job auto-confirmed after 48 hours.",
      });

      // =======================================================
      // ✉️ EMAILS
      // =======================================================
      await sendEmailSafe({
        to: worker.email,
        subject: "💰 Payment Auto-Released",
        html: `
          <h2>Hi ${worker.name || "Worker"},</h2>
          <p>Your job <strong>${job.jobTitle}</strong> was automatically confirmed after 48 hours.</p>
          <p>You received <strong>$${earning}</strong> from a total of $${adjustedPrice}.</p>
          <br><p>— Book Your Need</p>
        `,
      });

      if (job.customerId?.email) {
        await sendEmailSafe({
          to: job.customerId.email,
          subject: "✅ Job Auto-Confirmed",
          html: `
            <h2>Hi ${job.customerId.name || "Customer"},</h2>
            <p>Your job <strong>${job.jobTitle}</strong> was automatically confirmed after 48 hours.</p>
            <p>The final bid of <strong>$${adjustedPrice}</strong> was released to the worker.</p>
            <br><p>— Book Your Need</p>
          `,
        });
      }

      console.log(`💸 Auto-released $${earning} to ${worker.email}`);
    } catch (err) {
      console.error(`❌ Failed to release funds for job ${job._id}`, err);
    }
  }
}

// Then this works ✅
router.post("/run-auto-release", async (req, res) => {
  try {
    console.log("🛠️ Manual auto-release triggered by admin...");
    await releasePendingFunds(); // Now defined!
    return res.json({ success: true, message: "✅ Auto-release executed successfully." });
  } catch (err) {
    console.error("❌ Manual auto-release failed:", err);
    res.status(500).json({ error: "Failed to execute auto-release.", details: err.message });
  }
});

// =====================================================
// 🚗 Get all rides for admin view
// =====================================================
router.get("/rides", async (req, res) => {
  try {
    const rides = await Ride.find()
      .populate("workerId", "name email")
      .populate("bookedBy", "name email")
      .sort({ createdAt: -1 });
    res.json(rides);
  } catch (err) {
    console.error("❌ Fetch rides failed:", err);
    res.status(500).json({ error: "Failed to load rides" });
  }
});


// =====================================================
// 🕒 AUTO-COMPLETE after 48h → Release Payment + Wallet + Emails
// =====================================================
router.post("/rides/auto-complete", async (req, res) => {
  try {
    const io = req.app.get("socketio");
    const now = new Date();

    // 1️⃣ Find bookings eligible for auto-release
    const bookings = await BookingRequest.find({
      rideStatus: "worker_completed",
      escrowStatus: { $in: ["pending_release", "on_hold", "captured"] },
      releaseDate: { $lte: now },
    })
      .populate({
        path: "rideId",
        populate: { path: "workerId", select: "name email walletBalance walletHistory" },
      })
      .populate("customerId", "name email")
      .lean();

    if (!bookings.length)
      return res.json({ success: true, message: "No bookings ready for auto-release" });

    let releasedCount = 0;
    const failed = [];

    for (const booking of bookings) {
      try {
        const ride = booking.rideId;
        const driver = ride?.workerId;
        if (!ride || !driver) continue;

        // 2️⃣ Capture payment if needed
        try {
          const intent = await stripe.paymentIntents.retrieve(booking.paymentIntentId);
          if (intent.status === "requires_capture") {
            await stripe.paymentIntents.capture(booking.paymentIntentId);
            console.log(`💳 Auto-captured payment for booking ${booking._id}`);
          }
        } catch (err) {
          console.warn(`⚠️ Stripe capture skipped for ${booking._id}: ${err.message}`);
        }

        // 3️⃣ Credit driver's wallet
        const baseFare = Number(ride.price);
        const platformFee = 2;
        const earning = Math.max(0, baseFare - platformFee);

        const driverDoc = await Worker.findById(driver._id);
        driverDoc.walletBalance = (driverDoc.walletBalance || 0) + earning;
        driverDoc.walletHistory.push({
          type: "credit",
          amount: earning,
          rideId: ride._id,
          date: new Date(),
          notes: "Auto-completed after 48h (system payout)",
        });
        await driverDoc.save();

        // 4️⃣ Update booking & ride statuses
        await BookingRequest.findByIdAndUpdate(booking._id, {
          rideStatus: "completed",
          escrowStatus: "released",
          status: "completed",
          autoCompletedAt: new Date(),
        });

        await Ride.findByIdAndUpdate(ride._id, {
          status: "completed",
          updatedAt: new Date(),
        });

        // 5️⃣ Real-time notifications
        const payload = {
          rideId: ride._id,
          bookingId: booking._id,
          customerId: booking.customerId._id,
          driverId: driver._id,
          from: ride.from,
          to: ride.to,
          date: ride.date,
          time: ride.time,
          status: "completed",
          message: `✅ Ride auto-completed after 48 hours. $${earning} released to driver.`,
        };

        io.to(`ride_customer_${booking.customerId._id}`).emit("ride-auto-complete", payload);
        io.to(`ride_driver_${driver._id}`).emit("ride-auto-complete:driver", payload);
        io.to(`ride_${ride._id}`).emit("ride-update", payload);

        // 6️⃣ Email notifications
        await sendEmailSafe({
          to: driver.email,
          subject: "💰 Auto Payment Released",
          html: `
            <h2>Hi ${driver.name},</h2>
            <p>Your ride <b>${ride.from} → ${ride.to}</b> was auto-confirmed after 48 hours.</p>
            <p>You earned <b>$${earning}</b> (after $2 BYN fee).</p>
            <br><p>— Book Your Need</p>
          `,
        });

        await sendEmailSafe({
          to: booking.customerId.email,
          subject: "✅ Ride Auto-Confirmed",
          html: `
            <h2>Hi ${booking.customerId.name || "Customer"},</h2>
            <p>Your ride <b>${ride.from} → ${ride.to}</b> was automatically completed after 48 hours.</p>
            <p>The driver has been paid <b>$${earning}</b>. Thank you for using Book Your Need.</p>
            <br><p>— Book Your Need</p>
          `,
        });

        releasedCount++;
        console.log(`💰 Auto-released booking ${booking._id} → Driver ${driver.email} got $${earning}`);
      } catch (err) {
        console.error(`❌ Failed to auto-release ${booking._id}:`, err.message);
        failed.push({ bookingId: booking._id, error: err.message });
      }
    }

    res.json({
      success: true,
      message: `Auto-complete finished: ${releasedCount} released, ${failed.length} failed.`,
      failed,
    });
  } catch (err) {
    console.error("❌ Auto-complete error:", err);
    res.status(500).json({ error: "Auto-complete process failed" });
  }
});



module.exports = router;
