const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const Worker = require('../models/Worker');
const Job = require('../models/Job');
const Bid = require("../models/Bid");
const jwt = require("jsonwebtoken");
const SECRET_KEY = process.env.SECRET_KEY || "default_secret_key";

const mongoose = require("mongoose");


const { sendEmailSafe } = require("../emailService");
const haversine = require("haversine-distance");

// ---------------- MULTER CONFIG ----------------
const certUploader = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = 'uploads/certifications/';
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      cb(null, `${file.fieldname}-${Date.now()}${path.extname(file.originalname)}`);
    }
  })
});


const idUploader = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = 'uploads/ids';
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, `${file.fieldname}-${Date.now()}${path.extname(file.originalname)}`)
  })
});

const profileUploader = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = 'uploads/profile-photos';
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, `profile-${Date.now()}${path.extname(file.originalname)}`)
  })
});

const showcaseUploader = multer({ dest: 'uploads/' });

const driverDocsUploader = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = "uploads/driver-docs";
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      cb(null, `${file.fieldname}-${Date.now()}${path.extname(file.originalname)}`);
    },
  }),
});

router.delete("/delete-portfolio", async (req, res) => {
  try {
    const { workerId, imageUrl } = req.body;

    const worker = await Worker.findById(workerId);
    if (!worker) return res.status(404).json({ message: "Worker not found" });

    worker.portfolio = worker.portfolio.filter((item) => item.imageUrl !== imageUrl);
    await worker.save();

    const fullPath = path.join(__dirname, "..", "uploads", path.basename(imageUrl));
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);

    res.status(200).json({ message: "Image deleted", updatedPortfolio: worker.portfolio });
  } catch (err) {
    console.error("❌ Failed to delete portfolio image:", err);
    res.status(500).json({ message: "Server error deleting image" });
  }
});


// ===========================================
// ✅ Save Worker Phone After OTP Verification
// ===========================================
router.post("/save-phone", async (req, res) => {
  try {
    const { email, phone } = req.body;

    if (!email || !phone) {
      return res.status(400).json({ message: "Email and phone are required." });
    }

    const worker = await Worker.findOneAndUpdate(
      { email },
      { phone },
      { new: true }
    );

    if (!worker) {
      return res.status(404).json({ message: "Worker not found." });
    }

    console.log(`📞 Worker phone saved for ${email}: ${phone}`);
    return res.status(200).json({ success: true, worker });
  } catch (err) {
    console.error("❌ Error saving worker phone:", err);
    res.status(500).json({ message: "Server error saving phone." });
  }
});

router.post("/driver-docs", driverDocsUploader.fields([
  { name: "licenseFile", maxCount: 1 },
  { name: "insuranceFile", maxCount: 1 },
  { name: "carPhotoFile", maxCount: 1 }, // ✅ support car photo
]), async (req, res) => {
  try {
    const { workerId, make, model, year } = req.body;
    const { licenseFile, insuranceFile, carPhotoFile } = req.files;

    // ✅ Basic validation
    if (!workerId || !make || !model || !year || !licenseFile || !insuranceFile || !carPhotoFile) {
      return res.status(400).json({ error: "Missing required fields or files" });
    }

    const driverProfile = {
      make,
      model,
      year,
      licenseUrl: `/uploads/driver-docs/${licenseFile[0].filename}`,
      insuranceUrl: `/uploads/driver-docs/${insuranceFile[0].filename}`,
      carPhotoUrl: `/uploads/driver-docs/${carPhotoFile[0].filename}`,
      status: "pending",
    };

    const updated = await Worker.findByIdAndUpdate(
      workerId,
      { $set: { driverProfile } },
      { new: true, upsert: false }
    );

    if (!updated) return res.status(404).json({ error: "Worker not found" });

    res.status(200).json({ message: "✅ Driver documents saved", driverProfile });
  } catch (err) {
    console.error("❌ Failed to save driver documents:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ---------------- AUTH ----------------
router.post('/signup', async (req, res) => {
  const { email, password } = req.body;

  try {
    if (!email || !password)
      return res.status(400).json({ message: 'Email and password are required' });

    const existing = await Worker.findOne({ email });
    if (existing)
      return res.status(409).json({ message: 'Email already exists' });

    const hashed = await bcrypt.hash(password, 10);

    const newWorker = new Worker({
      email,
      password: hashed,
      profileCompleted: false,
      status: 'incomplete', // means needs profile steps
    });

    await newWorker.save();

    // ✅ Send Welcome Email
    try {
      await sendEmail({
        to: email,
        subject: "🎉 Welcome to Book Your Need (Worker)",
        html: `
          <h2>Hi there!</h2>
          <p>Welcome to <strong>Book Your Need</strong>. You're now registered as a service provider!</p>
          <p>Complete your profile, upload documents, and select your services to start getting job requests.</p>
          <br>
          <p>We’re excited to have you on board 🚀</p>
          <p>— The BYN Team</p>
        `,
      });
      console.log("✅ Welcome email sent to worker:", email);
    } catch (emailErr) {
      console.error("❌ Failed to send welcome email:", emailErr.message);
    }

    res.status(201).json({ message: 'Signup successful', _id: newWorker._id });
  } catch (err) {
    console.error("❌ Worker signup error:", err);
    res.status(500).json({ message: 'Signup failed' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const worker = await Worker.findOne({ email });
    if (!worker) return res.status(404).json({ message: 'User not found' });

    const match = await bcrypt.compare(password, worker.password);
    if (!match) return res.status(401).json({ message: 'Incorrect password' });

    res.status(200).json({
      message: 'Login successful',
      _id: worker._id,
      name: worker.name,
      phone: worker.phone,
      status: worker.status,
      email: worker.email,
    });
  } catch {
    res.status(500).json({ message: 'Login failed' });
  }
});
// ✅ Google Login for Worker
// ✅ Google Login for Worker
router.post("/google-login", async (req, res) => {
  const { email, googleId } = req.body;

  if (!email) return res.status(400).json({ error: "Email is required" });

  try {
    let worker = await Worker.findOne({ email });

    const isNew = !worker;

    if (isNew) {
      worker = new Worker({
        email,
        googleId,
        status: "incomplete",
        profileCompleted: false,
      });

      await worker.save();

      // ✅ Send Welcome Email to new Google signups
      try {
        await sendEmail({
          to: email,
          subject: "🎉 Welcome to Book Your Need (Worker)",
          html: `
            <h2>Welcome to Book Your Need!</h2>
            <p>Your worker account was created using Google.</p>
            <p>Please complete your profile, upload your ID, and select your services to get started.</p>
            <br>
            <p>Let’s get you earning 💼</p>
            <p>— The BYN Team</p>
          `,
        });
        console.log("✅ Welcome email sent to new Google worker:", email);
      } catch (err) {
        console.error("❌ Failed to send Google welcome email:", err.message);
      }
    }

    // ✅ Always sign a token
    const token = jwt.sign({ userId: worker._id }, SECRET_KEY, {
      expiresIn: "2h",
    });

    // ✅ Return the full worker object + token
    return res.status(200).json({
      ...worker.toObject(),
      token,
    });

  } catch (error) {
    console.error("❌ Google login error:", error);
    res.status(500).json({ error: "Google login failed" });
  }
});


// ---------------- PROFILE ----------------
router.post('/update-profile', async (req, res) => {
  const {
    workerId,
    name,
    phone,
    address,
    city,
    province,
    postalCode,
    latitude,
    longitude
  } = req.body;

  try {
    const worker = await Worker.findById(workerId);
    if (!worker) return res.status(404).json({ error: 'Worker not found' });

    const wasNameEmpty = !worker.name; // to check if name was empty before

    // ✅ Update fields
    worker.name = name || worker.name;
    worker.phone = phone || worker.phone;
    worker.address = address || worker.address;
    worker.city = city || worker.city;
    worker.province = province || worker.province;
    worker.postalCode = postalCode || worker.postalCode;
    worker.latitude = latitude || worker.latitude;
    worker.longitude = longitude || worker.longitude;

    // ✅ Check profile completeness
    worker.profileCompleted = !!(
      worker.name &&
      worker.phone &&
      worker.address &&
      worker.city &&
      worker.province &&
      worker.postalCode
    );

    await worker.save();

    // ✅ Send welcome email if name was just added
    if (wasNameEmpty && worker.name && worker.email) {
      try {
        await sendEmail({
          to: worker.email,
          subject: "🎉 Welcome to Book Your Need (Worker)",
          html: `
            <h2>Welcome, ${worker.name} 👋</h2>
            <p>You’ve successfully updated your profile on <strong>Book Your Need</strong>.</p>
            <p>Next step: upload your ID and select your services to start receiving jobs.</p>
            <br>
            <p>Let’s get to work 💼</p>
            <p>— The BYN Team</p>
          `,
        });
        console.log("✅ Welcome email sent to:", worker.email);
      } catch (emailErr) {
        console.error("❌ Welcome email failed:", emailErr.message);
      }
    }

    res.status(200).json({ message: '✅ Profile updated', profileCompleted: worker.profileCompleted });
  } catch (err) {
    console.error("❌ Error in update-profile:", err);
    res.status(500).json({ error: 'Server error' });
  }
});


router.post('/upload-profile-photo', profileUploader.single('photo'), async (req, res) => {
  const { workerId } = req.body;
  if (!req.file || !workerId) return res.status(400).json({ error: 'Missing file or workerId' });
  try {
    const imagePath = `/uploads/profile-photos/${req.file.filename}`;
    await Worker.findByIdAndUpdate(workerId, {
      profilePhotoUrl: imagePath,
      profilePhotoStatus: 'pending',
    });
    res.status(200).json({ message: '✅ Profile photo uploaded', imageUrl: imagePath });
  } catch {
    res.status(500).json({ error: 'Upload failed' });
  }
});

router.post(
  "/upload-ids",
  idUploader.fields([
    { name: "id1Front", maxCount: 1 },
    { name: "id1Back", maxCount: 1 },
    { name: "id2Front", maxCount: 1 },
    { name: "id2Back", maxCount: 1 },
    { name: "permitFile", maxCount: 1 },
    { name: "selfieFile", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const { workerId, id1Type, id2Type, isInternational } = req.body;
      const files = req.files;

      // ✅ Validate worker ID
      if (!workerId || !mongoose.Types.ObjectId.isValid(workerId)) {
        return res.status(400).json({ error: "Invalid or missing worker ID" });
      }

      // ✅ Validate ID Types
      if (!id1Type || !id2Type || id1Type === id2Type) {
        return res.status(400).json({ error: "Invalid or duplicate ID types" });
      }

      // ✅ Build update object
      const update = {
        id1Type,
        id2Type,
        isInternational: isInternational === "true",
      };

      if (files.id1Front?.[0]) update.id1FrontUrl = `/uploads/ids/${files.id1Front[0].filename}`;
      if (files.id1Back?.[0]) update.id1BackUrl = `/uploads/ids/${files.id1Back[0].filename}`;
      if (files.id2Front?.[0]) update.id2FrontUrl = `/uploads/ids/${files.id2Front[0].filename}`;
      if (files.id2Back?.[0]) update.id2BackUrl = `/uploads/ids/${files.id2Back[0].filename}`;
      if (files.permitFile?.[0]) update.permitUrl = `/uploads/ids/${files.permitFile[0].filename}`;
      if (files.selfieFile?.[0]) update.selfieUrl = `/uploads/ids/${files.selfieFile[0].filename}`;

      const updated = await Worker.findByIdAndUpdate(workerId, update, { new: true });

      if (!updated) {
        return res.status(404).json({ error: "Worker not found" });
      }

      res.status(200).json({
        message: "✅ Documents uploaded successfully",
        worker: updated,
      });
    } catch (err) {
      console.error("❌ Error during ID upload:", err);
      res.status(500).json({ error: "Server error during ID upload" });
    }
  }
);

router.post(
  "/reupload-documents",
  idUploader.fields([
    { name: "id1Front", maxCount: 1 },
    { name: "id1Back", maxCount: 1 },
    { name: "id2Front", maxCount: 1 },
    { name: "id2Back", maxCount: 1 },
    { name: "permitFile", maxCount: 1 },
    { name: "selfieFile", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const { workerId, id1Type, id2Type, isInternational } = req.body;
      const files = req.files;

      if (!workerId || !mongoose.Types.ObjectId.isValid(workerId)) {
        return res.status(400).json({ error: "Invalid or missing worker ID" });
      }

      if (!id1Type || !id2Type || id1Type === id2Type) {
        return res.status(400).json({ error: "Invalid or duplicate ID types" });
      }

      const update = {
        id1Type,
        id2Type,
        isInternational: isInternational === "true",
        profilePhotoStatus: "pending",
        backgroundCheckStatus: "pending",
        permitStatus: "pending",
        selfieUrl: undefined,
      };

      // Replace file URLs if provided
      if (files.id1Front?.[0]) update.id1FrontUrl = `/uploads/ids/${files.id1Front[0].filename}`;
      if (files.id1Back?.[0]) update.id1BackUrl = `/uploads/ids/${files.id1Back[0].filename}`;
      if (files.id2Front?.[0]) update.id2FrontUrl = `/uploads/ids/${files.id2Front[0].filename}`;
      if (files.id2Back?.[0]) update.id2BackUrl = `/uploads/ids/${files.id2Back[0].filename}`;
      if (files.permitFile?.[0]) update.permitUrl = `/uploads/ids/${files.permitFile[0].filename}`;
      if (files.selfieFile?.[0]) update.selfieUrl = `/uploads/ids/${files.selfieFile[0].filename}`;

      const worker = await Worker.findById(workerId);
      if (!worker) return res.status(404).json({ error: "Worker not found" });

      // Reset individual statuses for resubmission
      worker.profilePhotoStatus = "pending";
      worker.backgroundCheckStatus = "pending";
      worker.permitStatus = "pending";

      // Update the fields
      Object.assign(worker, update);
      await worker.save();

      res.status(200).json({ message: "✅ Reuploaded documents successfully", worker });
    } catch (err) {
      console.error("❌ Error in reupload-documents:", err);
      res.status(500).json({ error: "Server error during reupload" });
    }
  }
);

router.post("/save-services", certUploader.any(), async (req, res) => {
  try {
    let { workerId, services } = req.body;
    if (!workerId || !services) {
      return res.status(400).json({ error: "Missing workerId or services" });
    }

    if (typeof services === "string") {
      services = JSON.parse(services);
    }

    const worker = await Worker.findById(workerId);
    if (!worker) return res.status(404).json({ error: "Worker not found" });

    // Map certs by service name
    const fileMap = {};
    if (req.files && req.files.length > 0) {
      req.files.forEach((file) => {
        const match = file.fieldname.match(/certFiles\[(.+)\]/);
        if (match) {
          const serviceKey = match[1];
          fileMap[serviceKey] = `/uploads/certifications/${file.filename}`;
        }
      });
    }

    const sanitizeKey = (name) =>
      name.replace(/[^\w\s-]/gi, "").replace(/\s+/g, "_");

    // Normalize incoming services
    const normalizedServices = services.map((s) => {
      const key = sanitizeKey(s.name);
      return {
        name: s.name,
        hasTools: s.hasTools || false,
        hasTruck: s.hasTruck || false,
        certUrl: fileMap[key] || s.certUrl || null,
        certStatus: fileMap[key] ? "pending" : s.certStatus || "pending",
      };
    });

    // ✅ Merge with existing services
    const updatedServices = [...worker.services];
    normalizedServices.forEach((newService) => {
      const existingIndex = updatedServices.findIndex(
        (s) => s.name === newService.name
      );

      if (existingIndex > -1) {
        // Update existing service
        updatedServices[existingIndex] = {
          ...updatedServices[existingIndex],
          ...newService,
        };
      } else {
        // Add new service
        updatedServices.push(newService);
      }
    });

    worker.services = updatedServices;

    // ✅ Force worker into review step
    worker.status = "incomplete";      // must go to /review-profile
    worker.profileCompleted = false;   // reset until review submitted

    await worker.save();

    res.json({
      message: "✅ Services saved, worker moved to review step",
      services: worker.services,
      status: worker.status,
    });
  } catch (err) {
    console.error("❌ Error saving services:", err);
    res.status(500).json({ error: "Server error" });
  }
});



router.post("/worker/cancel-job", async (req, res) => {
  const { jobId, workerId } = req.body;
  try {
    const job = await Job.findById(jobId);
    if (!job || job.acceptedBy?.toString() !== workerId)
      return res.status(403).json({ message: "You are not authorized to cancel this job." });
    job.status = "pending";
    job.acceptedBy = null;
    job.cancelledAt = new Date();
    await job.save();
    res.status(200).json({ message: "Job unassigned" });
  } catch {
    res.status(500).json({ message: "Failed to cancel job" });
  }
});

router.get("/available-jobs/:workerId", async (req, res) => {
  try {
    const workerId = req.params.workerId;
    const worker = await Worker.findById(workerId);
    if (!worker) return res.status(404).json({ error: "Worker not found" });

    if (!worker.latitude || !worker.longitude) {
      return res.status(400).json({ error: "Worker location data incomplete" });
    }

    const selectedServices = (worker.services || []).map((s) => s.name.toLowerCase());
    const approvedServices = (worker.services || [])
      .filter((s) => s.certStatus === "approved")
      .map((s) => s.name.toLowerCase());

    const workerLoc = { lat: worker.latitude, lng: worker.longitude };

    // ✅ Fetch both pending and reopened jobs
    const allJobs = await Job.find({ status: { $in: ["pending", "reopened"] } })
      .populate("bids");

    const enhancedJobs = [];

    for (const job of allJobs) {
      const serviceName = (job.service || job.jobTitle || "").toLowerCase();
      if (!selectedServices.includes(serviceName)) continue;

      if (!job.latitude || !job.longitude) continue;
      const jobLoc = { lat: job.latitude, lng: job.longitude };
      const distance = haversine(workerLoc, jobLoc) / 1000;
      if (distance > 150) continue;

      const hasBid = job.bids?.some(
        (bid) => bid.workerId?.toString() === workerId
      );
      const canBid = approvedServices.includes(serviceName);

      const plainJob = job.toObject();
      plainJob.hasBidByThisWorker = hasBid;
      plainJob.canBid = canBid;

      enhancedJobs.push(plainJob);
    }

    res.json(enhancedJobs);
  } catch (err) {
    console.error("❌ Error fetching available jobs:", err);
    res.status(500).json({ error: "Server error while fetching jobs" });
  }
});


router.post(
  "/upload-certificate/:workerId/:serviceName",
  certUploader.single("certificate"),
  async (req, res) => {
    try {
      const { workerId, serviceName } = req.params;
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const worker = await Worker.findById(workerId);
      if (!worker) return res.status(404).json({ error: "Worker not found" });

      const serviceIndex = worker.services.findIndex(
        (s) => s.name === serviceName
      );
      if (serviceIndex === -1) {
        return res.status(404).json({ error: "Service not found" });
      }

      // ✅ Update certUrl & reset status
      worker.services[serviceIndex].certUrl = `https://api.bookyourneed.com/uploads/certifications/${req.file.filename}`;
      worker.services[serviceIndex].certStatus = "pending";

      // ✅ Reset overall worker status too (so admin sees it again)
      worker.status = "pending";

      await worker.save();

      res.status(200).json({
        message: "✅ Certificate uploaded, awaiting approval",
        services: worker.services,
      });
    } catch (err) {
      console.error("❌ Error uploading certificate:", err);
      res.status(500).json({ error: "Server error" });
    }
  }
);


// ---------------- SHOWCASE ----------------
router.post('/update-showcase', showcaseUploader.array('portfolio', 10), async (req, res) => {
  const { workerId, aboutMe, experience, badges } = req.body;
  const imageUrls = req.files?.map(file => `/uploads/${file.filename}`) || [];
  try {
    const updated = await Worker.findByIdAndUpdate(workerId, {
      aboutMe,
      experience,
      badges: badges ? JSON.parse(badges) : [],
    }, { new: true });
    if (!updated) return res.status(404).json({ error: 'Worker not found' });
    if (imageUrls.length) {
      updated.portfolio.push(...imageUrls.map(url => ({ imageUrl: url })));
      await updated.save();
    }
    res.status(200).json({ message: 'Showcase updated!', data: updated });
  } catch {
    res.status(500).json({ error: 'Failed to update showcase' });
  }
});

router.get('/public-profile/:workerId', async (req, res) => {
  try {
    const worker = await Worker.findById(req.params.workerId)
      .select("name tier profilePhotoUrl aboutMe experience services portfolio");
    if (!worker) return res.status(404).json({ message: "Worker not found" });
    res.json(worker);
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

router.post('/delete-work', async (req, res) => {
  const { workerId, imageUrl } = req.body;
  try {
    const worker = await Worker.findById(workerId);
    if (!worker) return res.status(404).json({ error: 'Worker not found' });
    worker.portfolio = worker.portfolio.filter(p => p.imageUrl !== imageUrl);
    await worker.save();
    res.status(200).json(worker);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post("/submit-profile", async (req, res) => {
  const { workerId } = req.body;

  try {
    const worker = await Worker.findById(workerId);
    if (!worker) return res.status(404).json({ error: "Worker not found" });

    // ✅ Only allow submission if profile is incomplete
    if (worker.status !== "incomplete") {
      return res
        .status(400)
        .json({ error: "Profile already submitted or reviewed." });
    }

    // ✅ Update status & lock profile
    worker.status = "pending";
    worker.profileCompleted = true;
    await worker.save();

    // ✅ Send confirmation email (safe version)
    const subject = "📄 Your Profile is Under Review";
    const message = `
Hi ${worker.name || "Worker"},

Thank you for submitting your profile and uploading your documents.

Our verification team is now reviewing your information. If any additional documents are required, we’ll reach out to you via this email.

✅ You'll be notified once your profile is approved and you are eligible to receive job offers.

Thank you for being a part of Book Your Needs!

– Team BYN
`;

    // 🔹 Safe email wrapper (no crash if email fails)
    const emailService = require("../emailService");
    const sendEmailSafe =
      emailService.sendEmailSafe || emailService.sendSafe || (() => {});

    await sendEmailSafe({
      to: worker.email,
      subject,
      text: message,
      html: message.replace(/\n/g, "<br>"),
      context: "worker-profile-submit",
    });

    console.log("📧 Safe confirmation email sent to:", worker.email);

    // ✅ Return updated worker
    res.json({
      success: true,
      message: "Profile submitted for review",
      worker,
    });
  } catch (err) {
    console.error("❌ Error in /submit-profile:", err);
    res.status(500).json({ error: "Server error" });
  }
});



router.post('/accept-terms', async (req, res) => {
  const { workerId, acceptedAt } = req.body;
  try {
    await Worker.findByIdAndUpdate(workerId, {
      termsAccepted: true,
      termsAcceptedAt: acceptedAt,
    });
    res.json({ message: "Terms accepted" });
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Get worker profile by ID
router.get("/profile/:id", async (req, res) => {
  try {
    const worker = await Worker.findById(req.params.id);
    if (!worker) return res.status(404).json({ message: "Worker not found" });
    res.status(200).json(worker);
  } catch {
    res.status(500).json({ message: "Failed to fetch worker profile" });
  }
});
// ✅ Get worker profile by email
router.get("/email/:email", async (req, res) => {
  try {
    const worker = await Worker.findOne({ email: req.params.email });
    if (!worker) return res.status(404).json({ message: "Worker not found" });
    res.status(200).json(worker);
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/my-bids/:workerId", async (req, res) => {
  try {
    const bids = await Bid.find({ workerId: req.params.workerId }).populate({
      path: "jobId",
      populate: [
        {
          path: "customerId",
          strictPopulate: false,
        },
        {
          path: "acceptedBy", // ✅ FIXED: populate this field too!
          select: "_id",
          strictPopulate: false,
        },
      ],
    });

    const filtered = bids.filter((b) => b.jobId); // filter out any null jobs
    res.json(filtered);
  } catch (err) {
    console.error("❌ Error fetching bids:", err);
    res.status(500).json({ message: "Server error fetching bids." });
  }
});

// ✅ GET: Fetch all notifications for a worker
router.get("/notifications/:workerId", async (req, res) => {
  const { workerId } = req.params;

  try {
    const worker = await Worker.findById(workerId);
    if (!worker) return res.status(404).json({ error: "Worker not found" });

    res.json(worker.notifications || []);
  } catch (err) {
    console.error("Error fetching notifications:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/complete-job", async (req, res) => {
  const { jobId, workerId } = req.body;

  try {
    const job = await Job.findById(jobId);
    if (!job) return res.status(404).json({ message: "Job not found" });

    const bid = await Bid.findOne({ jobId, workerId });
    if (!bid) return res.status(404).json({ message: "Bid not found for this job" });

    const worker = await Worker.findById(workerId);
    if (!worker) return res.status(404).json({ message: "Worker not found" });

    const estimatedEarnings = bid.estimatedEarnings;
    const budget = job.budget;
    const bidAmount = bid.price;

    // ✅ Refund Logic Placeholder (you’ll expand this later)
    if (budget !== bidAmount) {
      console.log("Handle refund/payment difference logic here");
      // You can add Stripe refund & new charge logic
    }

    // ✅ Update job as completed
    job.status = "completed";
    job.completedAt = new Date();
    await job.save();

    // ✅ Add pending wallet credit (available after 24h)
    worker.walletHistory.push({
  type: "credit",
  amount: estimatedEarnings,
  jobId: job._id,
  date: new Date(),
  availableAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  released: false,
  blocked: false,
});


    await worker.save();

    return res.status(200).json({ message: "Job marked complete. Wallet will update in 24h." });
  } catch (err) {
    console.error("❌ Job complete error:", err);
    res.status(500).json({ error: "Failed to mark job as completed" });
  }
});

router.get("/completed-jobs/:workerId", async (req, res) => {
  try {
    const count = await Job.countDocuments({
      acceptedBy: req.params.workerId,
      status: "completed",
    });
    res.json({ count });
  } catch (err) {
    console.error("❌ Error counting completed jobs", err);
    res.status(500).json({ error: "Server error" });
  }
});




module.exports = router;

