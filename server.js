// BYN Backend Server (Restarted from Scratch)
require("dotenv").config();
const express = require("express");
const multer = require("multer");
const path = require("path");
const http = require("http");
const socketIo = require("socket.io");
const nodemailer = require("nodemailer");
const admin = require("firebase-admin");
const webpush = require("web-push");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Enable CORS for frontend access
app.use(cors());

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize Firebase Admin SDK
try {
    
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
    });

} catch (error) {
    console.error("Firebase initialization error:", error);
}

// In-Memory Data Stores
const jobs = [];
const workers = [];
const customers = [];
const reviews = [];
const workerSubscriptions = {};
const customerSubscriptions = {};

// Web Push Notifications Setup
webpush.setVapidDetails(
    "mailto:your-email@gmail.com",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
);

// Health Check API
app.get("/api/health-check", (req, res) => {
    res.json({ status: "Backend is running successfully!" });
});

// User Signup API
app.post("/api/signup", (req, res) => {
    const { email, password, role } = req.body;
    if (!email || !password || !role) {
        return res.status(400).json({ message: "Missing required fields." });
    }

    if (role === "worker") {
        workers.push({ email, password, role, rating: 5, jobsCompleted: 0, reviews: [] });
    } else if (role === "customer") {
        customers.push({ email, password, role });
    } else {
        return res.status(400).json({ message: "Invalid role." });
    }

    res.status(201).json({ message: "Signup successful!" });
});

// Worker Subscription for Push Notifications
app.post("/subscribe-worker", (req, res) => {
    const { workerId, subscription } = req.body;
    workerSubscriptions[workerId] = subscription;
    res.status(201).json({ message: "Worker subscription saved" });
});

// Customer Subscription for Push Notifications
app.post("/subscribe-customer", (req, res) => {
    const { customerId, subscription } = req.body;
    customerSubscriptions[customerId] = subscription;
    res.status(201).json({ message: "Customer subscription saved" });
});

// Start Server
server.listen(5000, "0.0.0.0", () => console.log("Server running on port 5000"));
