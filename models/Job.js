// models/Job.js
const mongoose = require("mongoose");

const jobSchema = new mongoose.Schema(
  {
    /* ============================================================
       👤 Customer Info
    ============================================================ */
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    email: String,
    customerName: String,

    /* ============================================================
       💼 Job Details
    ============================================================ */
    jobTitle: String,
    description: String,
    budget: String,
    location: String,
    scheduledAt: Date,

    /* ============================================================
       ⚙️ Status Tracking
    ============================================================ */
    status: {
      type: String,
      enum: [
        "pending",          // posted & waiting for bids
        "assigned",         // assigned to a worker
        "worker_completed", // worker pressed Complete
        "completed",        // customer confirmed (or auto-confirmed)
        "dispute",          // customer disputed
        "disputed",         // admin confirmed dispute
        "cancelled",        // cancelled by customer/admin
        "waitlisted",       // no approved workers available
        "reopened",         // reopened after worker cancel
      ],
      default: "pending",
    },

    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Worker",
      default: null,
    },
    assignedPrice: {
      type: Number,
      default: null,
    },

    /* ============================================================
       💳 Payment Info
    ============================================================ */
    paymentStatus: {
      type: String,
      enum: [
        "unpaid",
        "holding",          // funds on hold in escrow
        "pending_release",  // waiting for auto release
        "released",         // released to worker
        "refunded",
        "partial_refund",
      ],
      default: "unpaid",
    },

    refundAmount: { type: Number, default: 0 },
    commissionAmount: { type: Number, default: 0 },
    cancellationFee: { type: Number, default: 0 },

    stripePaymentIntentId: { type: String, default: null },

    // ✅ detailed payment info (escrow state, dates, etc.)
    paymentInfo: {
      escrowStatus: { type: String, default: "none" }, // "holding" | "released" | "dispute"
      releasedAt: Date,
      refundedAt: Date,
      lastActionAt: Date,
    },

    /* ============================================================
       🕒 Completion Flow
    ============================================================ */
    completion: {
      workerMarkedAt: Date,       // worker pressed Complete
      customerConfirmedAt: Date,  // customer confirmed
      autoConfirmedAt: Date,      // system auto-approved (48h)
      disputeAt: Date,            // customer filed dispute
      releaseDate: Date,          // payout eligible date
    },

    /* ============================================================
       📍 Address & Geo
    ============================================================ */
    city: { type: String, index: true },
    province: { type: String, index: true },
    street: String,
    postalCode: String,
    latitude: Number,
    longitude: Number,

    /* ============================================================
       ❌ Cancellation / Reopening
    ============================================================ */
    cancelReason: String,
    cancelledAt: Date,
    reopenedAt: Date,
    cancelBy: {
      type: String,
      enum: ["customer", "worker", "admin", null],
      default: null,
    },

    /* ============================================================
       🕐 Waitlist Handling
    ============================================================ */
    waitlistReason: { type: String, default: null },
    workersFound: { type: Number, default: 0 },
    notifiedAdmin: { type: Boolean, default: false },

    /* ============================================================
       💬 Dispute Tracking
    ============================================================ */
    disputeReason: { type: String, default: "" }, // reason entered by customer

    /* ============================================================
       🔨 Job-Worker Relations
    ============================================================ */
    bids: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Bid",
      },
    ],

    blockedWorkers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Worker",
      },
    ],

    /* ============================================================
       🔁 Repost Tracking
    ============================================================ */
    repostCount: { type: Number, default: 0 },

    /* ============================================================
       🧾 Audit Log
    ============================================================ */
    history: [
      {
        action: String, // "created", "assigned", "worker_completed", "customer_confirmed", "auto_confirmed", "dispute_filed"
        by: String,     // "system" | "customer" | "worker" | "admin"
        actorId: { type: mongoose.Schema.Types.ObjectId },
        at: { type: Date, default: Date.now },
        notes: String,
      },
    ],
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.Job || mongoose.model("Job", jobSchema);
