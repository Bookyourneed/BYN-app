const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const Worker = require("../models/Worker");
const { sendEmailSafe } = require("../emailService");

const router = express.Router();

const generateOtp = () =>
  String(Math.floor(100000 + Math.random() * 900000));

const hashOtp = (otp) =>
  crypto.createHash("sha256").update(otp).digest("hex");

/* =====================================================
   📧 SEND RESET OTP (WORKER)
   POST /api/worker/send-reset-otp
===================================================== */
router.post("/send-reset-otp", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email?.trim())
      return res.status(200).json({ message: "If account exists, OTP sent." });

    const worker = await Worker.findOne({
      email: email.trim().toLowerCase(),
    });

    if (!worker) {
      return res.status(200).json({ message: "If account exists, OTP sent." });
    }

    const otp = generateOtp();
    worker.resetOtpHash = hashOtp(otp);
    worker.resetOtpExpires = new Date(Date.now() + 10 * 60 * 1000);
    await worker.save();

    await sendEmailSafe({
      to: worker.email,
      subject: "Book Your Need – Worker Password Reset",
      html: `
        <div style="font-family:Arial,sans-serif">
          <h2>Password Reset</h2>
          <p>Your verification code:</p>
          <div style="font-size:28px;font-weight:700;letter-spacing:4px">
            ${otp}
          </div>
          <p>This code expires in 10 minutes.</p>
        </div>
      `,
      context: "worker_password_reset",
    });

    res.status(200).json({ message: "If account exists, OTP sent." });
  } catch (err) {
    console.error("❌ Worker send-reset-otp error:", err);
    res.status(500).json({ message: "Failed to send reset code." });
  }
});

/* =====================================================
   🔐 RESET PASSWORD (WORKER)
   POST /api/worker/reset-password
===================================================== */
router.post("/reset-password", async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({ message: "Missing fields." });
    }

    const worker = await Worker.findOne({
      email: email.trim().toLowerCase(),
    });

    if (
      !worker ||
      !worker.resetOtpHash ||
      !worker.resetOtpExpires
    ) {
      return res.status(400).json({ message: "Invalid or expired code." });
    }

    if (new Date() > worker.resetOtpExpires) {
      return res.status(400).json({ message: "Code expired." });
    }

    if (hashOtp(otp) !== worker.resetOtpHash) {
      return res.status(400).json({ message: "Invalid or expired code." });
    }

    const salt = await bcrypt.genSalt(10);
    worker.password = await bcrypt.hash(newPassword, salt);

    worker.resetOtpHash = null;
    worker.resetOtpExpires = null;
    await worker.save();

    res.status(200).json({ message: "Password updated successfully." });
  } catch (err) {
    console.error("❌ Worker reset-password error:", err);
    res.status(500).json({ message: "Failed to reset password." });
  }
});

module.exports = router;
