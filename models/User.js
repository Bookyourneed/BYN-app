const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
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
  phone: {
    type: String,
    unique: true,
    sparse: true, // Allows multiple nulls
  },
  address: {
    type: String,
    trim: true,
  },
  street: String,
  city: String,
  province: String,
  postalCode: String,
  profileCompleted: {
    type: Boolean,
    default: false,
  },

  // ✅ NEW FIELDS FOR EMAIL VERIFICATION
  emailVerified: {
    type: Boolean,
    default: false,
  },
  emailOTP: {
    type: String,
  },
  emailOTPExpires: {
    type: Date,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model("User", userSchema);
