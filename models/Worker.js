// models/Worker.js

const mongoose = require('mongoose');

const WorkerSchema = new mongoose.Schema({
  name: String,
  email: {
    type: String,
    required: true,
    unique: true,
  },
  password: {
    type: String,
    required: false, // Optional for Google login
  },
  phone: String,
  address: String,
  city: String,
  province: String,
  postalCode: String,

  services: [
    {
      name: String,
      certUrl: String,
      hasTools: Boolean,
      hasTruck: Boolean,
      certStatus: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending',
      },
    },
  ],

  // ✅ ID Verification
  id1Type: String,
  id2Type: String,
  id1Url: String,
  id2Url: String,
  isInternational: Boolean,
  permitUrl: String,

  // ✅ Document Statuses
  profilePhotoUrl: String,
  profilePhotoStatus: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
  },
  backgroundCheckStatus: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
  },
  permitStatus: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
  },

  // ✅ Terms and Conditions
  termsAccepted: {
    type: Boolean,
    default: false,
  },
  termsAcceptedAt: {
    type: Date,
  },

  // ✅ Public Profile Additions
  aboutMe: {
    type: String,
    default: '',
  },
  experience: {
    type: String,
    default: '',
  },
  badges: [
    {
      label: String,        // e.g., "Certified Hairdresser"
      icon: String,         // future: emoji/icon name or file path
    },
  ],
  portfolio: [
    {
      imageUrl: String,     // path to image
      caption: String,      // optional text/caption
    },
  ],

  // ✅ Profile Status
  status: {
    type: String,
    enum: ['incomplete', 'pending', 'approved', 'rejected'],
    default: 'incomplete',
  },
  points: {
    type: Number,
    default: 0,
  },
  tier: {
    type: String,
    enum: ['silver', 'gold', 'platinum'],
    default: 'silver',
  },
  commissionRate: {
    type: Number,
    default: 0.15,
  },
  profileCompleted: {
    type: Boolean,
    default: false,
  },
}, { timestamps: true });

module.exports = mongoose.model('Worker', WorkerSchema);
