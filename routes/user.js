
require("dotenv").config();
const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const User = require("../models/User");
const nodemailer = require("nodemailer");
const multer = require("multer");
const path = require("path");

const jwt = require("jsonwebtoken");
const SECRET_KEY = process.env.SECRET_KEY || "default_secret_key";
const crypto = require("crypto");
// ✅ Use the universal safe email fallback
const emailService = require("../emailService");
const sendEmailSafe = emailService.sendEmailSafe || emailService.sendSafe || (() => {});
const sendEmail = sendEmailSafe;

const fs = require("fs");

// ✅ Multer setup with auto-folder creation
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = "uploads/profile-pictures";
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true }); // auto-create folders
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `profile-${Date.now()}${path.extname(file.originalname)}`);
  },
});

const upload = multer({ storage });



// ✅ Get user by Mongo ID
router.get("/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (err) {
    console.error("❌ Failed to get user:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ✅ User Signup
router.post("/signup", async (req, res) => {
  const { email, password } = req.body;

  try {
    if (!email || !password)
      return res.status(400).json({ message: "Missing fields" });

    const exists = await User.findOne({ email });
    if (exists)
      return res.status(409).json({ message: "Email already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new User({
      email,
      password: hashedPassword,
      profileCompleted: false,
    });

    await newUser.save();

    // ✅ Send Welcome Email
    try {
      await sendEmailSafe({
        to: email,
        subject: "🎉 Welcome to Book Your Need!",
        html: `
          <h2>Welcome to Book Your Need,</h2>
          <p>Thank you for signing up! You can now book trusted professionals for services anytime.</p>
          <p>Start by completing your profile and posting your first job.</p>
          <br>
          <p>Need help? Reach out to our support team anytime.</p>
          <p>— The BYN Team</p>
        `,
      });
      console.log("✅ Welcome email sent to:", email);
    } catch (emailErr) {
      console.error("❌ Failed to send welcome email:", emailErr.message);
    }

    const token = jwt.sign({ userId: newUser._id }, SECRET_KEY, {
      expiresIn: "2h",
    });

    return res.status(201).json({
      message: "Signup successful",
      token,
      _id: newUser._id,
      email,
      profileCompleted: false,
    });
  } catch (err) {
    console.error("Signup error:", err);
    return res.status(500).json({ message: "Signup failed" });
  }
});


// ✅ Login (email + password)
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email: email });
    if (!user)
      return res.status(404).json({ message: "User not found." });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(401).json({ message: "Incorrect password." });

    const token = jwt.sign({ userId: user._id }, SECRET_KEY, { expiresIn: "2h" });

    return res.status(200).json({ token, _id: user._id, email });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ✅ Google Login
router.post("/google-login", async (req, res) => {
  const { name, email, googleId } = req.body;

  try {
    let user = await User.findOne({ email: email });
    const isNewUser = !user;

    if (isNewUser) {
      user = new User({
        name,
        email,
        googleId,
        profileCompleted: false,
      });

      await user.save();

      // ✅ Send Welcome Email
      try {
        await sendEmailSafe({
          to: email,
          subject: "🎉 Welcome to Book Your Need!",
          html: `
            <h2>Welcome to Book Your Need, ${name || "there"}!</h2>
            <p>Your account has been created using Google.</p>
            <p>You can now book trusted professionals for any service you need.</p>
            <br>
            <p>Need help? Reach out to our support team anytime.</p>
            <p>— The BYN Team</p>
          `,
        });
        console.log("✅ Welcome email sent to:", email);
      } catch (emailErr) {
        console.error("❌ Failed to send welcome email:", emailErr.message);
      }
    }

    const token = jwt.sign({ userId: user._id }, SECRET_KEY, {
      expiresIn: "2h",
    });

    res.status(200).json({
      token,
      _id: user._id,
      email: user.email,
      profileCompleted: user.profileCompleted,
    });
  } catch (error) {
    console.error("❌ Google login error:", error);
    res.status(500).json({ error: "Server error during Google login" });
  }
});

// ✅ Send OTP (for email verification or reset)
router.post("/send-email-otp", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: "Email is required" });

  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    user.emailOTP = otp;
    user.emailOTPExpires = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.OTP_EMAIL,
        pass: process.env.OTP_PASS,
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


router.post("/change-password", async (req, res) => {
  try {
    const { email, currentPassword, newPassword } = req.body;

    // ✅ Validate input
    if (!email || !currentPassword || !newPassword) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // ✅ Find user
    const user = await User.findOne({ email });
    if (!user || !user.password) {
      return res.status(404).json({ message: "User not found" });
    }

    // ✅ Check current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Current password incorrect" });
    }

    // ✅ Hash & save new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await user.save();

    res.json({ message: "Password updated successfully" });
  } catch (error) {
    console.error("❌ Change password error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// ✅ Save phone number
router.post("/save-phone", async (req, res) => {
  const { email, phone } = req.body;

  if (!email || !phone) {
    return res.status(400).json({ message: "Invalid email or phone" });
  }

  try {
    const existingPhone = await User.findOne({ phone });
    if (existingPhone && existingPhone.email !== email) {
      return res.status(409).json({ message: "⚠️ Phone number already in use" });
    }

    let user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    user.phone = phone;

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

router.post("/update-profile", async (req, res) => {
  const {
    email,
    name,
    lastName,
    phone,
    address,
    street,
    city,
    province,
    postalCode,
    latitude,
    longitude,
    profilePictureSkipped,
    bio,
    hobbies,
    birthday,
  } = req.body;

  if (!email) return res.status(400).json({ error: "Email is required." });

  try {
    // ✅ fixed line
    const user = await User.findOne({ email: email });
    if (!user) return res.status(404).json({ error: "User not found" });

    if (name !== undefined) user.name = name;
    if (lastName !== undefined) user.lastName = lastName;
    if (phone !== undefined) user.phone = phone;
    if (address !== undefined) user.address = address;
    if (street !== undefined) user.street = street;
    if (city !== undefined) user.city = city;
    if (province !== undefined) user.province = province;
    if (postalCode !== undefined) user.postalCode = postalCode;
    if (latitude !== undefined) user.latitude = latitude;
    if (longitude !== undefined) user.longitude = longitude;
    if (profilePictureSkipped !== undefined) user.profilePictureSkipped = profilePictureSkipped;
    if (bio !== undefined) user.bio = bio;
    if (hobbies !== undefined) user.hobbies = hobbies;
    if (birthday !== undefined && !user.birthday) user.birthday = birthday;

    await user.save();

    res.json({ success: true, message: "Profile updated", user });
  } catch (err) {
    console.error("❌ Profile update error:", err);
    res.status(500).json({ error: "Server error while updating profile." });
  }
});

// ✅ Forgot Password OTP
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
    });

    res.json({ message: "OTP sent to email" });
  } catch (err) {
    console.error("Send OTP error:", err);
    res.status(500).json({ message: "Failed to send OTP" });
  }
});

router.post("/upload-profile-picture", upload.single("profilePicture"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const profilePicturePath = `/uploads/profile-pictures/${req.file.filename}`;

    const user = await User.findOneAndUpdate(
      { email },
      { profilePicture: profilePicturePath },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({
      message: "✅ Profile picture updated",
      profilePicture: user.profilePicture,
    });
  } catch (err) {
    console.error("❌ Error uploading profile picture:", err);
    res.status(500).json({ message: "Server error" });
  }
});

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
    const { email } = req.params;

    console.log("📩 Fetching profile for:", email);

    const user = await User.findOne({ email: email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json(user);
  } catch (err) {
    console.error("❌ Profile fetch error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/profile/:id", async (req, res) => {
  const { id } = req.params;
  if (!id || id === "null" || id === "undefined") {
    return res.status(400).json({ message: "Invalid user ID" });
  }

  try {
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: "User not found" });
    res.status(200).json(user);
  } catch (err) {
    console.error("❌ Profile fetch error:", err);
    res.status(500).json({ message: "Server error fetching user profile" });
  }
});


// ✅ Accept Terms
router.post("/accept-terms", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email required" });

  try {
    await User.findOneAndUpdate({ email }, { termsAccepted: true });
    res.status(200).json({ success: true });
  } catch (err) {
    console.error("❌ Accept terms error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
