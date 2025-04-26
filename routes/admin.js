const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const Admin = require('../models/Admin');
const Job = require('../models/Job');
const Worker = require('../models/Worker');
const HelpTicket = require('../models/HelpTicket');
const User = require('../models/User'); // Make sure this is defined

// ✅ Admin Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const admin = await Admin.findOne({ email });
    if (!admin) return res.status(404).json({ message: 'Admin not found' });

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) return res.status(401).json({ message: 'Invalid credentials' });

    res.status(200).json({
      id: admin._id,
      name: admin.name,
      role: admin.role,
      token: 'mock-jwt-for-now',
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ✅ Admin Dashboard Stats
router.get('/stats', async (req, res) => {
  try {
    const totalJobs = await Job.countDocuments();
    const totalWorkers = await Worker.countDocuments();

    const pendingApprovals = await Worker.countDocuments({
      $or: [
        { status: 'pending' },
        { 'services.certStatus': 'pending' },
        { backgroundCheckStatus: 'pending' },
        { permitStatus: 'pending' },
        { profilePhotoStatus: 'pending' },
      ],
    });

    res.json({
      totalJobs,
      totalWorkers,
      pendingApprovals,
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ message: 'Failed to fetch stats' });
  }
});

// ✅ Get All Workers
router.get('/workers', async (req, res) => {
  try {
    const allWorkers = await Worker.find().sort({ createdAt: -1 });
    res.json(allWorkers);
  } catch (err) {
    console.error('Failed to fetch workers:', err);
    res.status(500).json({ message: 'Failed to load workers' });
  }
});

// ✅ Update Worker Status + Documents
router.post('/update-status/:workerId', async (req, res) => {
  const { status } = req.body;

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ message: 'Invalid status' });
  }

  try {
    const worker = await Worker.findById(req.params.workerId);
    if (!worker) return res.status(404).json({ message: 'Worker not found' });

    worker.status = status;

    if (status === 'approved') {
      worker.profilePhotoStatus = 'approved';
      worker.backgroundCheckStatus = 'approved';
      worker.permitStatus = 'approved';
      worker.services = worker.services.map(service => ({
        ...service,
        certStatus: 'approved',
      }));
    }

    await worker.save();
    res.json({ message: `Worker ${status}`, worker });
  } catch (err) {
    console.error('Update status error:', err);
    res.status(500).json({ message: 'Failed to update status' });
  }
});

// ✅ Get All Jobs
router.get('/jobs', async (req, res) => {
  try {
    const jobs = await Job.find().sort({ createdAt: -1 });
    res.json(jobs);
  } catch (err) {
    console.error('Error fetching jobs:', err);
    res.status(500).json({ message: 'Failed to fetch jobs' });
  }
});

// ✅ Delete job + save cancel reason
router.delete('/delete-job/:jobId', async (req, res) => {
  const { jobId } = req.params;
  const { reason } = req.body;

  try {
    const job = await Job.findByIdAndUpdate(
      jobId,
      {
        status: 'cancelled',
        cancelReason: reason || 'No reason provided',
        cancelledAt: new Date(),
      },
      { new: true }
    );

    if (!job) return res.status(404).json({ message: 'Job not found' });

    res.status(200).json({ message: 'Job cancelled', job });
  } catch (err) {
    console.error('Cancel job error:', err);
    res.status(500).json({ message: 'Failed to cancel job' });
  }
});

// ✅ Help Center - Get Tickets
router.get('/help/all', async (req, res) => {
  try {
    const tickets = await HelpTicket.find().sort({ createdAt: -1 });
    res.json(tickets);
  } catch (err) {
    res.status(500).json({ message: 'Error loading tickets' });
  }
});

// ✅ Help Center - Update Ticket
router.post('/help/update/:ticketId', async (req, res) => {
  const { status, adminNotes } = req.body;

  try {
    const ticket = await HelpTicket.findByIdAndUpdate(
      req.params.ticketId,
      {
        status,
        adminNotes,
        resolvedAt: status === 'resolved' ? new Date() : null,
      },
      { new: true }
    );

    res.json({ message: 'Ticket updated', ticket });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update ticket' });
  }
});

// ✅ View Customers
router.get('/customers', async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    console.error('Failed to fetch customers:', err);
    res.status(500).json({ message: 'Failed to load customers' });
  }
});

router.post("/update-document-status/:workerId", async (req, res) => {
  const { field, status, serviceIndex } = req.body;

  try {
    const worker = await Worker.findById(req.params.workerId);
    if (!worker) return res.status(404).json({ message: "Worker not found" });

    if (field.startsWith("services")) {
      // For example: field = "services", serviceIndex = 1
      worker.services[serviceIndex].certStatus = status;
    } else {
      worker[field] = status;
    }

    await worker.save();
    res.json({ message: `${field} updated to ${status}`, worker });
  } catch (err) {
    console.error("Document status update error:", err);
    res.status(500).json({ message: "Failed to update document status" });
  }
});

// Update individual document status
router.post('/update-doc-status/:workerId', async (req, res) => {
  const { field, value } = req.body;
  const { workerId } = req.params;

  const allowedFields = [
    "profilePhotoStatus",
    "backgroundCheckStatus",
    "permitStatus",
  ];

  if (!allowedFields.includes(field)) {
    return res.status(400).json({ message: "Invalid field" });
  }

  try {
    const worker = await Worker.findById(workerId);
    if (!worker) return res.status(404).json({ message: "Worker not found" });

    worker[field] = value;
    await worker.save();

    res.json({ message: `${field} updated to ${value}`, worker });
  } catch (err) {
    console.error("❌ Error updating doc status:", err);
    res.status(500).json({ message: "Failed to update document status" });
  }
});
// Approve/reject certification for a specific service
router.post('/approve-cert/:workerId/:serviceName', async (req, res) => {
  const { workerId, serviceName } = req.params;
  const { status } = req.body;

  if (!["approved", "rejected"].includes(status)) {
    return res.status(400).json({ message: "Invalid status" });
  }

  try {
    const worker = await Worker.findById(workerId);
    if (!worker) return res.status(404).json({ message: "Worker not found" });

    const service = worker.services.find(s => s.name === serviceName);
    if (!service) return res.status(404).json({ message: "Service not found" });

    service.certStatus = status;
    await worker.save();

    res.json({ message: `Certification for ${serviceName} marked as ${status}`, worker });
  } catch (err) {
    console.error("❌ Error updating cert status:", err);
    res.status(500).json({ message: "Failed to update cert status" });
  }
});


module.exports = router;
