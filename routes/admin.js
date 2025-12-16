const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const Admin = require('../models/Admin');
const Job = require('../models/Job');
const Worker = require('../models/Worker');
const Ride = require("../models/Ride");
const Bid = require("../models/Bid");
const AdminEmail = require("../models/AdminEmail");
const BookingRequest = require("../models/BookingRequest");

// ✅ Stripe & dependencies
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { getIO } = require("../socket");

const HelpTicket = require('../models/HelpTicket');
const User = require('../models/User'); // Make sure this is defined
const { sendEmailSafe } = require("../emailService");


// ============================================================
// 📡 ADMIN: GET ALL USERS (Customers + Workers)
// ============================================================
router.get("/all-users", async (req, res) => {
  try {
    const customers = await User.find({})
      .select("name email phone city createdAt")
      .lean();

    const workers = await Worker.find({})
      .select("name email phone city status tier createdAt")
      .lean();

    const formattedCustomers = customers.map((u) => ({
      ...u,
      role: "customer",
    }));

    const formattedWorkers = workers.map((u) => ({
      ...u,
      role: "worker",
    }));

    res.json([...formattedCustomers, ...formattedWorkers]);
  } catch (err) {
    console.error("❌ Fetch all users failed:", err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

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

// ============================================================
// ✅ ADMIN: GET ALL JOBS (rich list)
// GET /api/admin/jobs
// ============================================================
router.get("/jobs", async (req, res) => {
  try {
    const jobs = await Job.find()
      .sort({ createdAt: -1 })
      .populate("customerId", "name lastName email phone city province")
      .populate("assignedTo", "name email phone")
      .lean();

    const formatted = jobs.map((j) => {
      const custName = `${j.customerId?.name || ""} ${j.customerId?.lastName || ""}`.trim() || "N/A";
      return {
        ...j,
        customerName: custName,
        customerEmail: j.customerId?.email || "N/A",
        customerPhone: j.customerId?.phone || "N/A",
        city: j.customerId?.city || j.city || "N/A",
        province: j.customerId?.province || j.province || "N/A",
        workerName: j.assignedTo?.name || "N/A",
        workerEmail: j.assignedTo?.email || "N/A",
      };
    });

    res.json(formatted);
  } catch (err) {
    console.error("❌ Admin jobs error:", err);
    res.status(500).json({ error: "Server error" });
  }
});
// ============================================================
// ✅ ADMIN: GET ONE JOB (full details + bids)
// GET /api/admin/jobs/:id
// ============================================================
router.get("/jobs/:id", async (req, res) => {
  try {
    const job = await Job.findById(req.params.id)
      .populate("customerId", "name lastName email phone address street city province postalCode")
      .populate("assignedTo", "name email phone")
      .lean();

    if (!job) return res.status(404).json({ error: "Job not found" });

    const bids = await Bid.find({ jobId: job._id })
      .sort({ createdAt: -1 })
      .populate("workerId", "name email phone")
      .lean();

    res.json({ job, bids });
  } catch (err) {
    console.error("❌ Admin job detail error:", err);
    res.status(500).json({ error: "Server error" });
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

// ============================================================
// ✅ ADMIN: GET ALL CUSTOMERS (with job stats)
// GET /api/admin/customers
// ============================================================
router.get("/customers", async (req, res) => {
  try {
    const customers = await User.find()
      .select("name lastName email phone street city province postalCode address createdAt profileCompleted emailVerified")
      .sort({ createdAt: -1 })
      .lean();

    const customerIds = customers.map((c) => c._id);

    // Aggregate job stats per customer
    const stats = await Job.aggregate([
      { $match: { customerId: { $in: customerIds } } },
      {
        $group: {
          _id: { customerId: "$customerId", status: "$status" },
          count: { $sum: 1 },
          lastJobAt: { $max: "$createdAt" },
        },
      },
    ]);

    // Build lookup: { customerId: { total, byStatus{} , lastJobAt } }
    const lookup = {};
    for (const row of stats) {
      const id = String(row._id.customerId);
      const status = row._id.status || "unknown";
      if (!lookup[id]) lookup[id] = { total: 0, byStatus: {}, lastJobAt: null };
      lookup[id].total += row.count;
      lookup[id].byStatus[status] = row.count;

      if (!lookup[id].lastJobAt || new Date(row.lastJobAt) > new Date(lookup[id].lastJobAt)) {
        lookup[id].lastJobAt = row.lastJobAt;
      }
    }

    const enriched = customers.map((c) => {
      const id = String(c._id);
      const fullName = `${c.name || ""} ${c.lastName || ""}`.trim() || "N/A";
      const jobStats = lookup[id] || { total: 0, byStatus: {}, lastJobAt: null };

      return {
        ...c,
        fullName,
        jobCount: jobStats.total,
        jobStats: jobStats.byStatus,
        lastJobAt: jobStats.lastJobAt,
      };
    });

    res.json(enriched);
  } catch (err) {
    console.error("❌ Admin customers error:", err);
    res.status(500).json({ error: "Server error" });
  }
});
// ============================================================
// ✅ ADMIN: GET ONE CUSTOMER (full details + jobs)
// GET /api/admin/customers/:id
// ============================================================
router.get("/customers/:id", async (req, res) => {
  try {
    const customer = await User.findById(req.params.id).lean();
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    const jobs = await Job.find({ customerId: customer._id })
      .sort({ createdAt: -1 })
      .select("jobTitle service status scheduledAt budget createdAt assignedTo completion history dispute")
      .populate("assignedTo", "name email phone")
      .lean();

    // quick stats
    const stats = jobs.reduce(
      (acc, j) => {
        acc.total++;
        acc.byStatus[j.status] = (acc.byStatus[j.status] || 0) + 1;
        return acc;
      },
      { total: 0, byStatus: {} }
    );

    res.json({
      customer,
      jobs,
      stats,
    });
  } catch (err) {
    console.error("❌ Admin customer detail error:", err);
    res.status(500).json({ error: "Server error" });
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

// ============================================================
// ✅ RESOLVE DISPUTE — BID AWARE + WORKER FIRST
// ============================================================
router.post("/resolve-dispute/:jobId", async (req, res) => {
  const { jobId } = req.params;
  const {
    resolution,        // refund_customer | partial_refund | release_worker
    refundAmount = 0,  // customer refund
    workerAmount = 0,  // worker payout (gross)
    adminNotes,
  } = req.body;

  try {
    const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
    const { getIO } = require("../socket");
    const io = getIO();

    const job = await Job.findById(jobId)
      .populate("customerId", "email name stripeCustomerId")
      .populate("assignedTo", "email name commissionRate");

    if (!job) return res.status(404).json({ error: "Job not found" });
    if (job.status !== "dispute")
      return res.status(400).json({ error: "Job is not under dispute" });
    if (!job.stripePaymentIntentId)
      return res.status(400).json({ error: "No payment intent found" });

    // ============================================================
    // 🔐 STRIPE — SOURCE OF TRUTH
    // ============================================================
    const originalPI = await stripe.paymentIntents.retrieve(
      job.stripePaymentIntentId
    );

    const charge = originalPI.latest_charge
      ? await stripe.charges.retrieve(originalPI.latest_charge)
      : null;

    const customerPaid = charge ? charge.amount / 100 : 0;
    if (customerPaid <= 0)
      return res.status(400).json({ error: "Unable to detect customer payment" });

    const finalJobPrice = job.assignedPrice;

    // ============================================================
    // 💳 CHARGE DIFFERENCE HELPER (REUSED)
    // ============================================================
    const chargeCustomerDifference = async (difference) => {
      if (difference <= 0) return;

      const paymentMethod = originalPI.payment_method;
      if (!paymentMethod)
        throw new Error("No saved payment method for customer");

      await stripe.paymentIntents.create({
        amount: Math.round(difference * 100),
        currency: "cad",
        customer: job.customerId.stripeCustomerId,
        payment_method: paymentMethod,
        off_session: true,
        confirm: true,
        description: `Dispute bid adjustment for ${job.jobTitle}`,
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: "never",
        },
      });

      console.log(`💳 Charged +$${difference} for dispute adjustment`);
    };

    // ============================================================
    // 💰 WORKER CREDIT HELPER
    // ============================================================
    const creditWorker = async (amount, note) => {
      if (!job.assignedTo || amount <= 0) return;

      const worker = await Worker.findById(job.assignedTo._id);
      if (!worker) return;

      worker.walletBalance = (worker.walletBalance || 0) + amount;
      worker.walletHistory.push({
        type: "credit",
        amount,
        jobId: job._id,
        date: new Date(),
        released: true,
        notes: note,
      });

      worker.totalEarnings = (worker.totalEarnings || 0) + amount;
      await worker.save();
    };

    // ============================================================
    // 🧾 JOB META
    // ============================================================
    job.paymentInfo = job.paymentInfo || {};
    job.paymentInfo.escrowStatus = "resolved";
    job.paymentInfo.customerPaid = customerPaid;
    job.paymentInfo.lastActionAt = new Date();

    job.history.push({
      action: "dispute_resolved",
      by: "admin",
      at: new Date(),
      notes: adminNotes || `Resolved as ${resolution}`,
    });

    let resolutionMessage = "";
    let workerMsg = "";
    let customerMsg = "";

    // ============================================================
    // 🔴 FULL REFUND TO CUSTOMER
    // ============================================================
    if (resolution === "refund_customer") {
      await stripe.refunds.create({
        payment_intent: job.stripePaymentIntentId,
        amount: Math.round(customerPaid * 100),
      });

      job.status = "cancelled";
      job.paymentStatus = "refunded";
      job.refundAmount = customerPaid;

      resolutionMessage = `💸 Full refund of $${customerPaid} issued`;
      workerMsg = "Dispute resolved in favor of customer. No payout released.";
      customerMsg = `You have been refunded $${customerPaid}.`;
    }

    // ============================================================
    // 🟡 PARTIAL SPLIT (WORKER PROTECTED)
    // ============================================================
    if (resolution === "partial_refund") {
      const refund = Number(refundAmount);
      const payout = Number(workerAmount);

      const requiredTotal = refund + payout;
      const difference = Math.max(requiredTotal - customerPaid, 0);

      if (difference > 0) {
        await chargeCustomerDifference(difference);
      }

      if (refund > 0) {
        await stripe.refunds.create({
          payment_intent: job.stripePaymentIntentId,
          amount: Math.round(refund * 100),
        });
      }

      const commission = job.assignedTo.commissionRate || 0.0445;
      const net = parseFloat((payout * (1 - commission)).toFixed(2));

      await creditWorker(net, "Partial dispute payout");

      job.status = "completed";
      job.paymentStatus = "partial_refund";
      job.refundAmount = refund;
      job.workerPaidAmount = net;

      resolutionMessage = `⚖️ Partial resolution completed`;
      workerMsg = `You received $${net} after commission.`;
      customerMsg = `You received a $${refund} refund.`;
    }

    // ============================================================
    // 🟢 FULL PAYOUT TO WORKER (BID HONORED)
    // ============================================================
    if (resolution === "release_worker") {
      const difference = Math.max(finalJobPrice - customerPaid, 0);
      if (difference > 0) {
        await chargeCustomerDifference(difference);
      }

      const commission = job.assignedTo.commissionRate || 0.0445;
      const net = parseFloat(
        (finalJobPrice * (1 - commission)).toFixed(2)
      );

      await creditWorker(net, "Full dispute payout");

      job.status = "completed";
      job.paymentStatus = "released";
      job.workerPaidAmount = net;

      resolutionMessage = `💰 Full payout of $${net} released to worker`;
      workerMsg = `Your payment of $${net} has been released.`;
      customerMsg = `Dispute resolved in favor of worker.`;
    }

    await job.save();

    // ============================================================
    // 📡 SOCKETS
    // ============================================================
    io.to(`worker_${job.assignedTo._id}`).emit("job:update", {
      jobId: job._id,
      status: job.status,
      message: resolutionMessage,
    });

    io.to(`customer_${job.customerId.email}`).emit("job:update", {
      jobId: job._id,
      status: job.status,
      message: resolutionMessage,
    });
    // ============================================================
// ✉️ EMAILS — ADMIN / WORKER / CUSTOMER (POLITE + NEUTRAL)
// ============================================================

// 🔔 Admin notification (internal – full details)
await sendEmailSafe({
  to: "admin@bookyourneed.com",
  subject: "📌 Dispute Resolved – Internal Record",
  html: `
    <h3>Dispute Resolution Summary</h3>
    <p><strong>Job Title:</strong> ${job.jobTitle}</p>
    <p><strong>Resolution Type:</strong> ${resolution}</p>
    <p><strong>Handled By:</strong> Admin</p>
    <p><strong>Customer Paid:</strong> $${customerPaid}</p>
    <p><strong>Final Job Price:</strong> $${finalJobPrice}</p>
    <p><strong>Admin Notes:</strong></p>
    <p>${adminNotes || "No additional notes provided."}</p>
  `,
});

// 👷 Worker email (no amounts, respectful tone)
if (job.assignedTo?.email) {
  await sendEmailSafe({
    to: job.assignedTo.email,
    subject: "📩 Update on Your Job Dispute",
    html: `
      <h2>Hello ${job.assignedTo.name || "there"},</h2>

      <p>
        Thank you for your patience while our team carefully reviewed the dispute
        related to your recent job on <strong>Book Your Need</strong>.
      </p>

      <p>
        After reviewing the job details, communication history, and information
        provided by both parties, we’ve reached a resolution in line with our
        platform policies.
      </p>

      <p>
        Any applicable updates related to your earnings have now been processed
        and will reflect in your wallet accordingly.
      </p>

      <p>
        If you have any questions or would like further clarification, our support
        team is always here to help.
      </p>

      <br />
      <p>
        We appreciate your professionalism and the work you contribute to the
        Book Your Need platform.
      </p>

      <p>
        Best regards,<br />
        <strong>Book Your Need Support Team</strong>
      </p>
    `,
  });
}

// 🙋 Customer email (no amounts, calm + reassuring)
if (job.customerId?.email) {
  await sendEmailSafe({
    to: job.customerId.email,
    subject: "📩 Update on Your Book Your Need Job",
    html: `
      <h2>Hello ${job.customerId.name || "there"},</h2>

      <p>
        Thank you for your patience while we carefully reviewed your recent job
        on <strong>Book Your Need</strong>.
      </p>

      <p>
        Our support team has completed a full review of the job details and the
        information shared by both parties.
      </p>

      <p>
        Based on this review, we’ve reached a resolution that aligns with our
        platform policies and the work completed.
      </p>

      <p>
        Any applicable updates related to your payment have been processed and
        will be reflected automatically through your original payment method.
      </p>

      <p>
        If you have questions or believe additional details should be considered,
        please don’t hesitate to contact our support team — we’re here to help.
      </p>

      <br />
      <p>
        Thank you for being part of the Book Your Need community.
      </p>

      <p>
        Warm regards,<br />
        <strong>Book Your Need Support Team</strong>
      </p>
    `,
  });
}

return res.json({
  success: true,
  message: resolutionMessage,
  job,
});


  } catch (err) {
    console.error("❌ Resolve dispute failed:", err);
    res.status(500).json({ error: err.message });
  }
});


// ✅ Get all active disputes (FULL INFO FOR ADMINS)
router.get("/all-disputes", async (req, res) => {
  try {
    const disputes = await Job.find({ status: "dispute" })
      .populate("customerId", "name email")
      .populate("assignedTo", "name email commissionRate")
      .sort({ createdAt: -1 })
      .lean();

    const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

    const enrichedDisputes = await Promise.all(
      disputes.map(async (job) => {
        let customerPaidAmount = 0;

        // 🔐 Get REAL amount paid from Stripe
        if (job.stripePaymentIntentId) {
          try {
            const pi = await stripe.paymentIntents.retrieve(
              job.stripePaymentIntentId
            );

            if (pi?.latest_charge) {
              const charge = await stripe.charges.retrieve(
                pi.latest_charge
              );
              customerPaidAmount = charge.amount / 100;
            }
          } catch (err) {
            console.error(
              `⚠️ Stripe lookup failed for job ${job._id}:`,
              err.message
            );
          }
        }

        return {
          ...job,
          customerPaidAmount, // ⭐ THIS IS THE KEY FIELD
        };
      })
    );

    res.json(enrichedDisputes);
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

// ============================================================
// 📧 ADMIN: SEND EMAIL TO CUSTOMER / WORKER
// POST /api/admin/send-email
// ============================================================
router.post("/send-email", async (req, res) => {
  try {
    const { to, subject, message, role } = req.body;

    await sendEmailSafe({
      to,
      subject,
      html: `<p>${message.replace(/\n/g, "<br/>")}</p>`,
    });

    await AdminEmail.create({
      to,
      role,
      subject,
      message,
    });

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Send email failed:", err);
    res.status(500).json({ error: "Email failed" });
  }
});

// ============================================================
// 📜 ADMIN: Email History by User
// ============================================================
router.get("/email-history/:email", async (req, res) => {
  const { email } = req.params;

  const history = await AdminEmail.find({ to: email })
    .sort({ createdAt: -1 })
    .lean();

  res.json(history);
});


// GET /api/admin/customers/:customerId/details
router.get("/customers/:customerId/details", async (req, res) => {
  const { customerId } = req.params;

  try {
    const customer = await User.findById(customerId).lean();
    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    // All jobs for this customer
    const jobs = await Job.find({ customerId })
      .populate("assignedTo", "name email")
      .populate({
        path: "bids",
        populate: { path: "workerId", select: "name email" },
      })
      .sort({ createdAt: -1 })
      .lean();

    // Build stats
    const stats = jobs.reduce(
      (acc, job) => {
        acc.totalJobs++;

        if (job.status === "completed") acc.completed++;
        if (job.status === "cancelled") acc.cancelled++;
        if (["dispute", "disputed"].includes(job.status)) acc.disputed++;
        if (
          ["pending", "assigned", "worker_completed", "reopened", "waitlisted"].includes(
            job.status
          )
        ) {
          acc.active++;
        }

        const baseAmount =
          job.assignedPrice ||
          (job.budget ? Number(job.budget) : 0) ||
          0;

        acc.totalValue += baseAmount;
        acc.totalRefunded += job.refundAmount || 0;

        if (job.paymentStatus === "released") {
          acc.totalReleased += baseAmount - (job.refundAmount || 0);
        }

        return acc;
      },
      {
        totalJobs: 0,
        completed: 0,
        cancelled: 0,
        disputed: 0,
        active: 0,
        totalValue: 0,
        totalRefunded: 0,
        totalReleased: 0,
      }
    );

    // Shape jobs for the frontend
    const jobDetails = jobs.map((j) => ({
      id: j._id,
      jobTitle: j.jobTitle,
      description: j.description,
      status: j.status,
      paymentStatus: j.paymentStatus,
      assignedPrice: j.assignedPrice,
      refundAmount: j.refundAmount,
      scheduledAt: j.scheduledAt,
      createdAt: j.createdAt,
      city: j.city,
      province: j.province,
      street: j.street,
      disputeReason: j.disputeReason,
      cancelReason: j.cancelReason,
      assignedWorker: j.assignedTo
        ? {
            id: j.assignedTo._id,
            name: j.assignedTo.name,
            email: j.assignedTo.email,
          }
        : null,
    }));

    res.json({
      customer,
      stats,
      jobs: jobDetails,
    });
  } catch (err) {
    console.error("❌ Error fetching customer details:", err);
    res.status(500).json({ message: "Server error" });
  }
});



module.exports = router;
