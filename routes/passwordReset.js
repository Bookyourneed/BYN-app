const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const User = require("../models/User"); // <-- adjust path/name if yours differs
const { sendEmailSafe } = require("../emailService"); // <-- use your existing Brevo setup

const router = express.Router();

// Helpers
const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000)); // 6-digit
const hashOtp = (otp) => crypto.createHash("sha256").update(otp).digest("hex");

// =====================================================
// ✅ SEND RESET OTP (EMAIL)
// POST /api/user/send-reset-otp
// body: { email }
// =====================================================
router.post("/send-reset-otp", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email?.trim()) return res.status(400).json({ message: "Email is required." });

    const user = await User.findOne({ email: email.trim().toLowerCase() });
    // Security: don't reveal if email exists
    if (!user) {
      return res.status(200).json({ message: "If the account exists, we sent a reset code." });
    }

    const otp = generateOtp();
    const otpHash = hashOtp(otp);

    user.resetOtpHash = otpHash;
    user.resetOtpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    await user.save();

    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.5">
        <h2 style="margin:0 0 10px">Book Your Need – Password Reset</h2>
        <p>Your verification code is:</p>
        <div style="font-size:28px;font-weight:700;letter-spacing:4px;margin:10px 0">${otp}</div>
        <p>This code expires in <b>10 minutes</b>.</p>
        <p>If you didn’t request this, you can ignore this email.</p>
      </div>
    `;

    await sendEmailSafe({
      to: user.email,
      subject: "Your Book Your Need password reset code",
      html,
      context: "password_reset_otp",
    });

    return res.status(200).json({ message: "If the account exists, we sent a reset code." });
  } catch (err) {
    console.error("❌ send-reset-otp error:", err);
    return res.status(500).json({ message: "Failed to send reset code." });
  }
});

// =====================================================
// ✅ RESET PASSWORD WITH OTP
// POST /api/user/reset-password
// body: { email, otp, newPassword }
// =====================================================
router.post("/reset-password", async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email?.trim() || !otp?.trim() || !newPassword?.trim()) {
      return res.status(400).json({ message: "Email, OTP, and new password are required." });
    }

    const user = await User.findOne({ email: email.trim().toLowerCase() });
    if (!user || !user.resetOtpHash || !user.resetOtpExpires) {
      return res.status(400).json({ message: "Invalid or expired code." });
    }

    if (new Date() > new Date(user.resetOtpExpires)) {
      return res.status(400).json({ message: "Code expired. Please request a new one." });
    }

    const incomingHash = hashOtp(otp.trim());
    if (incomingHash !== user.resetOtpHash) {
      return res.status(400).json({ message: "Invalid or expired code." });
    }

    // Update password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);

    // Clear reset fields
    user.resetOtpHash = null;
    user.resetOtpExpires = null;
    await user.save();

    return res.status(200).json({ message: "Password updated successfully." });
  } catch (err) {
    console.error("❌ reset-password error:", err);
    return res.status(500).json({ message: "Failed to reset password." });
  }
});

module.exports = router;
