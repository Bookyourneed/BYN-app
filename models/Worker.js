const mongoose = require("mongoose");

const WorkerSchema = new mongoose.Schema(
  {
    // 🧑‍💼 Basic Info
    name: String,
    email: {
      type: String,
      required: true,
      unique: true,
    },
    googleId: { type: String, default: null },
    password: { type: String, required: false },
    phone: String,
    address: String,
    city: String,
    province: String,
    postalCode: String,
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },

    // 🧰 Services and Certifications
    services: [
      {
        name: String,
        certUrl: String,
        hasTools: Boolean,
        hasTruck: Boolean,
        certStatus: {
          type: String,
          enum: ["pending", "approved", "rejected"],
          default: "pending",
        },
      },
    ],

    // 🔔 Notifications
    notifications: [
      {
        title: String,
        message: String,
        createdAt: { type: Date, default: Date.now },
      },
    ],

    // 🪪 ID Verification
    id1Type: String,
    id2Type: String,
    id1FrontUrl: String,
    id1BackUrl: String,
    id2FrontUrl: String,
    id2BackUrl: String,
    isInternational: Boolean,
    permitUrl: String,
    selfieUrl: String,

    // 📄 Document Statuses
    profilePhotoUrl: String,
    profilePhotoStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    backgroundCheckStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    permitStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },

    // 🚗 Ride Driver Info
    driverProfile: {
      make: String,
      model: String,
      year: String,
      licenseUrl: String,
      insuranceUrl: String,
      carPhotoUrl: String,
      status: {
        type: String,
        enum: ["pending", "approved", "rejected"],
        default: "pending",
      },
    },
    rideDriverApproved: { type: Boolean, default: false },

    // 📜 Agreements
    termsAccepted: { type: Boolean, default: false },
    termsAcceptedAt: Date,

    // 🧾 Public Profile Details
    aboutMe: { type: String, default: "" },
    experience: { type: String, default: "" },
    badges: [{ label: String, icon: String }],
    portfolio: [{ imageUrl: String, caption: String }],

    // 🏅 Worker System Metadata
    status: {
      type: String,
      enum: [
        "incomplete",
        "pending",
        "approved",
        "rejected",
        "suspended",
        "banned",
      ],
      default: "incomplete",
    },
    points: { type: Number, default: 0 },
    tier: {
      type: String,
      enum: ["silver", "gold", "platinum"],
      default: "silver",
    },
    commissionRate: { type: Number, default: 0.15 },
    profileCompleted: { type: Boolean, default: false },

    // 📧 Email tracking (per job)
    jobEmailHistory: {
      type: Map,
      of: Date, // jobId: timestamp
      default: {},
    },

    // 💰 Wallet System
    walletBalance: { type: Number, default: 0 },
    walletHistory: [
      {
        type: { type: String, enum: ["credit", "debit"] },
        amount: { type: Number, required: true },
        jobId: { type: mongoose.Schema.Types.ObjectId, ref: "Job" },
        date: { type: Date, default: Date.now },
        availableAt: Date,
        released: { type: Boolean, default: false },
        blocked: { type: Boolean, default: false },
        notes: String,
      },
    ],

    // 💸 Stripe + Payout Settings
    stripeAccountId: { type: String, default: null }, // For instant payouts
    payoutPreferences: {
      defaultMethod: {
        type: String,
        enum: ["Stripe Instant Payout", "Interac e-Transfer", "Bank Deposit"],
        default: "Stripe Instant Payout",
      },
      interacEmail: { type: String, default: "" },
      bankAccount: {
        institutionNumber: String,
        transitNumber: String,
        accountNumber: String,
        accountHolderName: String,
      },
    },

    // 🚫 Cancellation & Suspension Tracking
    cancellationCount: { type: Number, default: 0 },
    suspendedUntil: { type: Date, default: null },
    warnings: [
      {
        message: String,
        at: { type: Date, default: Date.now },
      },
    ],
    requiresAdminReview: {
      type: Boolean,
      default: false, // true if escalated after 4+ cancels
    },
    lastCancellationAt: Date,
  },
  { timestamps: true }
);

module.exports = mongoose.model("Worker", WorkerSchema);
