const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    // =========================
    // 🔐 AUTH
    // =========================
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    password: {
      type: String,
      default: null, // Optional for Google users
    },

    googleId: {
      type: String,
      default: null,
    },

    // =========================
    // 👤 BASIC PROFILE
    // =========================
    name: {
      type: String,
      trim: true,
    },

    lastName: {
      type: String,
      trim: true,
    },

    profilePicture: {
      type: String,
      default: null,
    },

    profilePictureSkipped: {
      type: Boolean,
      default: false,
    },

    termsAccepted: {
      type: Boolean,
      default: false,
    },

    profileCompleted: {
      type: Boolean,
      default: false,
    },

    // =========================
    // 📞 PHONE VERIFICATION
    // =========================
    phone: {
      type: String,
      unique: true,
      sparse: true, // Allows multiple null values
    },

    // =========================
    // 🏠 ADDRESS
    // =========================
    address: {
      type: String,
      trim: true,
    },

    street: {
      type: String,
      trim: true,
    },

    city: {
      type: String,
      trim: true,
    },

    province: {
      type: String,
      trim: true,
    },

    postalCode: {
      type: String,
      trim: true,
    },

    latitude: {
      type: Number,
      default: null,
    },

    longitude: {
      type: Number,
      default: null,
    },

    // =========================
    // 🧠 OPTIONAL PROFILE INFO
    // =========================
    bio: {
      type: String,
      default: "",
    },

    hobbies: {
      type: String,
      default: "",
    },

    birthday: {
      type: Date,
      default: null,
      immutable: true, // ❌ Cannot be changed once set
    },

    // =========================
    // ✉️ EMAIL VERIFICATION
    // =========================
    emailVerified: {
      type: Boolean,
      default: false,
    },

    emailOTP: {
      type: String,
      default: null,
    },

    emailOTPExpires: {
      type: Date,
      default: null,
    },

    // =========================
    // 🔁 PASSWORD RESET (EMAIL OTP)
    // =========================
    resetOtpHash: {
      type: String,
      default: null,
    },

    resetOtpExpires: {
      type: Date,
      default: null,
    },

    // =========================
    // 💳 STRIPE
    // =========================
    stripeCustomerId: {
      type: String,
      default: null,
    },

    cards: [
      {
        brand: String,
        last4: String,
        exp_month: Number,
        exp_year: Number,
        paymentMethodId: String,
        addedAt: {
          type: Date,
          default: Date.now,
        },
        isDefault: {
          type: Boolean,
          default: false,
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("User", userSchema);
