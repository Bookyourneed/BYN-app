// routes/user.js
const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const User = require("../models/User");
const nodemailer = require("nodemailer");
const crypto = require("crypto");

// In-memory store for email OTPs (can move to Redis/DB later)
let otpStore = {};

router.post("/send-email-otp", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: "Email is required" });

  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    user.emailOTP = otp;
    user.emailOTPExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 min expiry
    await user.save();

    // send email
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.OTP_EMAIL, // your gmail
        pass: process.env.OTP_PASS,  // your app password
      },
    });

    await transporter.sendMail({
      from: `"Book Your Need" <${process.env.OTP_EMAIL}>`,
      to: email,
      subject: "Your Email Verification OTP",
      html: `<p>Your OTP is <b>${otp}</b>. It expires in 10 minutes.</p>`,
    });

    res.json({ message: "OTP sent" });
  } catch (err) {
    console.error("Error sending OTP:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/verify-email-otp", async (req, res) => {
  const { email, otp } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    const isExpired = user.emailOTPExpires < Date.now();
    const isValid = user.emailOTP === otp;

    if (!isValid || isExpired) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    user.emailVerified = true;
    user.emailOTP = undefined;
    user.emailOTPExpires = undefined;
    await user.save();

    res.json({ message: "Email verified" });
  } catch (err) {
    console.error("Verification error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});


// ✅ Google Login
router.post("/google-login", async (req, res) => {
  const { name, email, googleId } = req.body;

  try {
    let user = await User.findOne({ email });

    if (!user) {
      user = new User({ name, email, googleId, profileCompleted: false });
      await user.save();
    }

    res.status(200).json({ profileCompleted: user.profileCompleted });
  } catch (error) {
    console.error("❌ Google login error:", error);
    res.status(500).json({ error: "Server error during Google login" });
  }
});

// ✅ Email/Password Signup
router.post("/signup", async (req, res) => {
  const { email, password } = req.body;

  try {
    if (!email || !password) {
      return res.status(400).json({ message: "Missing fields" });
    }

    const exists = await User.findOne({ email });
    if (exists) {
      return res.status(409).json({ message: "Email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ email, password: hashedPassword, profileCompleted: false });
    await newUser.save();

    return res.status(201).json({ message: "Signup successful", profileCompleted: false });
  } catch (err) {
    console.error("Signup error:", err);
    return res.status(500).json({ message: "Signup failed" });
  }
});

// ✅ Save phone after Firebase OTP verification
router.post("/save-phone", async (req, res) => {
  const { email, phone } = req.body;

  if (!email || !phone || !email.includes("@")) {
    return res.status(400).json({ message: "Invalid email or phone" });
  }

  try {
    const existingPhone = await User.findOne({ phone });
    if (existingPhone && existingPhone.email !== email) {
      return res.status(409).json({ message: "⚠️ Phone number already in use" });
    }

    let user = await User.findOne({ email });

    if (!user) {
      user = new User({ email, phone });
    } else {
      user.phone = phone;
    }

    // Set profileCompleted if all required fields are filled
    if (user.name && user.lastName && user.address) {
      user.profileCompleted = true;
    }

    await user.save();
    return res.status(200).json({ message: "Phone saved!" });
  } catch (err) {
    console.error("Save phone error:", err);
    res.status(500).json({ message: "Failed to save phone" });
  }
});

// ✅ Update Name, Address, etc.
router.post("/update-profile", async (req, res) => {
  const {
    email, name, lastName, phone,
    address, street, city, province, postalCode,
  } = req.body;

  const profileCompleted = !!(name && lastName && phone && address);

  try {
    const user = await User.findOneAndUpdate(
      { email },
      {
        name, lastName, phone, address,
        street, city, province, postalCode,
        profileCompleted
      },
      { new: true }
    );

    res.status(200).json({ message: "Profile updated successfully!" });
  } catch (err) {
    console.error("Profile update error:", err);
    res.status(500).json({ message: "Failed to update profile" });
  }
});

// ✅ Send Email OTP (Forgot Password)
router.post("/send-reset-otp", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: "Email is required" });

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000;
    otpStore[email] = { otp, expiresAt };

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: `"BookYourNeed" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Reset Your BYN Password",
      html: `<h3>Your OTP is: ${otp}</h3><p>It expires in 5 minutes.</p>`,
      headers: {
        "Content-Type": "text/html"
      }
    });

    res.json({ message: "OTP sent to email" });
  } catch (err) {
    console.error("Send OTP error:", err);
    res.status(500).json({ message: "Failed to send OTP" });
  }
});

// ✅ Verify OTP and Reset Password
router.post("/verify-reset-otp", async (req, res) => {
  const { email, otp, newPassword } = req.body;

  const record = otpStore[email];
  if (!record) return res.status(400).json({ message: "No OTP sent" });
  if (Date.now() > record.expiresAt) {
    delete otpStore[email];
    return res.status(400).json({ message: "OTP expired" });
  }
  if (record.otp !== otp) return res.status(400).json({ message: "Invalid OTP" });

  try {
    const hashed = await bcrypt.hash(newPassword, 10);
    await User.findOneAndUpdate({ email }, { password: hashed });
    delete otpStore[email];

    res.json({ message: "Password reset successful" });
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).json({ message: "Failed to reset password" });
  }
});

// ✅ Get Profile by Email
router.get("/user-profile/:email", async (req, res) => {
  try {
    const user = await User.findOne({ email: req.params.email });
    if (!user) return res.status(404).json({ message: "User not found" });

    res.status(200).json(user);
  } catch (err) {
    console.error("Profile fetch error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ✅ Check Phone Uniqueness
router.post("/check-phone", async (req, res) => {
  const { phone } = req.body;

  try {
    const existing = await User.findOne({ phone });
    if (existing) return res.status(409).json({ message: "Phone number already in use" });

    res.status(200).json({ message: "Phone number is available" });
  } catch (err) {
    console.error("Check phone error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
