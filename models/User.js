const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
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
    phone: {
      type: String,
      unique: true,
      sparse: true,
    },
    address: {
      type: String,
      trim: true,
    },
    street: String,
    city: String,
    province: String,
    postalCode: String,

    // ✅ New Optional Fields
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
      immutable: true, // ❌ Cannot be changed after first set
    },

    profileCompleted: {
      type: Boolean,
      default: false,
    },

    // ✅ Email Verification
    emailVerified: {
      type: Boolean,
      default: false,
    },
    emailOTP: String,
    emailOTPExpires: Date,

    // ✅ Stripe Customer Info
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
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
