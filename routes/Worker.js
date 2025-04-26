const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const Worker = require('../models/Worker');
const Job = require('../models/Job');

// ---------------- MULTER CONFIG ----------------
const certStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/certifications/'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = file.fieldname.replace(/\W/g, '') + '-' + Date.now() + ext;
    cb(null, name);
  },
});
const certUploader = multer({ storage: certStorage });

const idStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/ids';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = file.fieldname.replace(/\W/g, '') + '-' + Date.now() + ext;
    cb(null, name);
  },
});
const idUploader = multer({ storage: idStorage });

const showcaseUploader = multer({ dest: 'uploads/' });

// ---------------- AUTH ----------------
router.post('/signup', async (req, res) => {
  const { email, password } = req.body;
  try {
    if (!email || !password) return res.status(400).json({ message: 'Email and password are required' });

    const existing = await Worker.findOne({ email });
    if (existing) return res.status(409).json({ message: 'Email already exists' });

    const hashed = await bcrypt.hash(password, 10);
    const newWorker = new Worker({ email, password: hashed, profileCompleted: false, status: 'incomplete' });
    await newWorker.save();
    res.status(201).json({ message: 'Signup successful', _id: newWorker._id });
  } catch (err) {
    console.error('Signup error:', err);
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

    res.status(200).json({ message: 'Login successful', _id: worker._id, profileCompleted: worker.profileCompleted });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Login failed' });
  }
});

router.post('/create', async (req, res) => {
  const { email, name } = req.body;
  try {
    if (!email) return res.status(400).json({ error: 'Email is required' });

    let worker = await Worker.findOne({ email });
    if (!worker) {
      worker = new Worker({ email, name: name || '', status: 'incomplete', profileCompleted: false });
      await worker.save();
    }

    res.status(201).json(worker);
  } catch (err) {
    console.error('Error creating worker:', err);
    res.status(500).json({ error: 'Failed to create worker' });
  }
});

// ---------------- PROFILE ----------------
router.post('/update-profile', async (req, res) => {
  const { workerId, name, phone, address, city, province, postalCode } = req.body;
  try {
    const profileCompleted = !!(name && phone && address && city && province && postalCode);
    const updated = await Worker.findByIdAndUpdate(
      workerId,
      { name, phone, address, city, province, postalCode, profileCompleted },
      { new: true }
    );
    if (!updated) return res.status(404).json({ error: 'Worker not found' });
    res.status(200).json({ message: '✅ Profile updated', profileCompleted });
  } catch (err) {
    console.error('Error updating profile:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/profile/:id', async (req, res) => {
  try {
    const worker = await Worker.findById(req.params.id);
    if (!worker) return res.status(404).json({ error: 'Worker not found' });
    res.status(200).json(worker);
  } catch (err) {
    console.error('Error fetching profile:', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// ---------------- SHOWCASE PUBLIC PROFILE ----------------
router.post('/update-showcase', showcaseUploader.array('portfolio', 10), async (req, res) => {
  const { workerId, aboutMe, experience, badges } = req.body;
  if (!workerId) return res.status(400).json({ error: 'Missing workerId' });

  try {
    const imageUrls = req.files?.map(file => `/uploads/${file.filename}`) || [];

    // Step 1 – update aboutMe, experience, badges
    const updated = await Worker.findByIdAndUpdate(workerId, {
      aboutMe,
      experience,
      badges: badges ? JSON.parse(badges) : [],
    }, { new: true });

    if (!updated) return res.status(404).json({ error: 'Worker not found' });

    // Step 2 – push images
    if (imageUrls.length > 0) {
      updated.portfolio.push(...imageUrls.map(url => ({ imageUrl: url })));
      await updated.save();
    }

    res.status(200).json({ message: 'Showcase updated!', data: updated });
  } catch (err) {
    console.error('❌ Showcase update error:', err);
    res.status(500).json({ error: 'Failed to update showcase' });
  }
});

router.get('/showcase/:id', async (req, res) => {
  try {
    const worker = await Worker.findById(req.params.id).select('aboutMe experience badges portfolio');
    if (!worker) return res.status(404).json({ error: 'Worker not found' });
    res.json(worker);
  } catch (err) {
    console.error('❌ Showcase fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch showcase' });
  }
});

// ---------------- ID UPLOAD ----------------
router.post('/upload-ids', idUploader.fields([
  { name: 'id1File', maxCount: 1 },
  { name: 'id2File', maxCount: 1 },
  { name: 'permitFile', maxCount: 1 },
]), async (req, res) => {
  try {
    const { workerId, id1Type, id2Type, isInternational } = req.body;
    const files = req.files;

    if (!workerId || !id1Type || !id2Type || !files.id1File || !files.id2File) {
      return res.status(400).json({ error: 'Missing required fields or files' });
    }

    const updated = await Worker.findByIdAndUpdate(workerId, {
      id1Type,
      id2Type,
      id1Url: `/uploads/ids/${files.id1File[0].filename}`,
      id2Url: `/uploads/ids/${files.id2File[0].filename}`,
      isInternational: isInternational === 'true',
      permitUrl: files.permitFile ? `/uploads/ids/${files.permitFile[0].filename}` : null
    }, { new: true });

    if (!updated) return res.status(404).json({ error: 'Worker not found' });

    res.status(200).json({ message: '✅ IDs uploaded successfully', worker: updated });
  } catch (err) {
    console.error('❌ Failed to upload IDs:', err);
    res.status(500).json({ error: 'Server error during ID upload' });
  }
});

// ---------------- SERVICES ----------------
router.post('/save-services', certUploader.any(), async (req, res) => {
  try {
    const { workerId } = req.body;
    const files = req.files;

    let rawServices = req.body['services[]'] || req.body.services || [];
    const serviceList = Array.isArray(rawServices) ? rawServices : [rawServices];

    if (!serviceList || serviceList.length === 0 || !serviceList[0]) {
      return res.status(400).json({ error: 'No services provided' });
    }

    const finalServices = serviceList.map(serviceName => {
      const certFile = files.find(f => f.fieldname === `certFiles[${serviceName}]`);
      const hasTools = req.body[`tools[${serviceName}]`] === 'true';
      const hasTruck = req.body[`truck[${serviceName}]`] === 'true';

      return {
        name: serviceName,
        hasTools,
        hasTruck,
        certUrl: certFile ? `/uploads/certifications/${certFile.filename}` : null,
      };
    });

    const updated = await Worker.findByIdAndUpdate(workerId, { services: finalServices }, { new: true });
    if (!updated) return res.status(404).json({ error: 'Worker not found' });

    console.log("✅ Services saved to DB:", finalServices);
    res.status(200).json({ message: '✅ Services saved', services: finalServices });
  } catch (err) {
    console.error('❌ Error saving services:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/submit-profile', async (req, res) => {
  const { workerId } = req.body;
  try {
    const updated = await Worker.findByIdAndUpdate(
      workerId,
      { status: 'pending' },
      { new: true }
    );
    if (!updated) return res.status(404).json({ error: 'Worker not found' });

    res.status(200).json({ message: '✅ Profile submitted for review' });
  } catch (err) {
    console.error('❌ Error submitting profile:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------------- JOBS ----------------
router.get('/available-jobs/:id', async (req, res) => {
  try {
    const worker = await Worker.findById(req.params.id);
    if (!worker || !worker.services?.length) return res.status(404).json({ error: 'Worker services not found' });

    const serviceNames = worker.services.map(s => s.name);
    const matchingJobs = await Job.find({ jobTitle: { $in: serviceNames }, status: 'pending' });
    res.status(200).json(matchingJobs);
  } catch (err) {
    console.error('Error fetching jobs:', err);
    res.status(500).json({ error: 'Failed to load available jobs' });
  }
});

router.post('/accept-job', async (req, res) => {
  try {
    const { jobId, workerId } = req.body;
    const job = await Job.findById(jobId);
    if (!job || job.status !== 'pending') return res.status(400).json({ error: 'Job not available' });

    job.status = 'accepted';
    job.acceptedBy = workerId;
    await job.save();
    res.status(200).json({ message: 'Job accepted successfully' });
  } catch (err) {
    console.error('Error accepting job:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/my-jobs/:workerId', async (req, res) => {
  try {
    const jobs = await Job.find({ acceptedBy: req.params.workerId }).sort({ createdAt: -1 });
    res.status(200).json(jobs);
  } catch (err) {
    console.error('Error fetching my jobs:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/complete-job', async (req, res) => {
  try {
    const { jobId, workerId } = req.body;
    const job = await Job.findById(jobId);
    if (!job || job.acceptedBy?.toString() !== workerId) return res.status(403).json({ error: 'Not authorized' });

    job.status = 'completed';
    await job.save();
    res.status(200).json({ message: 'Job marked as completed' });
  } catch (err) {
    console.error('Error completing job:', err);
    res.status(500).json({ error: 'Failed to complete job' });
  }
});

router.post("/accept-terms", async (req, res) => {
  const { workerId, acceptedAt } = req.body;

  try {
    await Worker.findByIdAndUpdate(workerId, {
      termsAccepted: true,
      termsAcceptedAt: acceptedAt,
    });

    res.json({ message: "Terms accepted" });
  } catch (err) {
    console.error("Failed to save terms acceptance:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/public-profile/:id", async (req, res) => {
  try {
    const worker = await Worker.findById(req.params.id).select(
      "name profilePhotoUrl aboutMe experience photos services"
    );
    if (!worker) return res.status(404).json({ error: "Worker not found" });

    res.json(worker);
  } catch (err) {
    console.error("Error fetching public profile:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// delete-work route for deleting an image
router.post('/delete-work', async (req, res) => {
  const { workerId, imageUrl } = req.body;
  try {
    const worker = await Worker.findById(workerId);
    if (!worker) return res.status(404).json({ error: 'Worker not found' });

    worker.portfolio = worker.portfolio.filter(p => p !== imageUrl);
    await worker.save();

    res.status(200).json(worker);
  } catch (err) {
    console.error('❌ Delete work error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

const profileUploader = multer({ 
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = 'uploads/profile-photos';
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `profile-${Date.now()}${ext}`);
    }
  })
});

router.post('/upload-profile-photo', profileUploader.single('photo'), async (req, res) => {
  const { workerId } = req.body;

  if (!req.file || !workerId) {
    return res.status(400).json({ error: 'Missing file or workerId' });
  }

  try {
    const imagePath = `/uploads/profile-photos/${req.file.filename}`;
    const updated = await Worker.findByIdAndUpdate(
      workerId,
      {
        profilePhotoUrl: imagePath,
        profilePhotoStatus: 'pending',
      },
      { new: true }
    );
    res.status(200).json({ message: '✅ Profile photo uploaded', imageUrl: imagePath });
  } catch (err) {
    console.error("Profile upload error:", err);
    res.status(500).json({ error: 'Upload failed' });
  }
});



module.exports = router;
