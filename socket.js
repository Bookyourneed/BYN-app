// ✅ socket.js — 2025 stable, unified, and fixed
const { Server } = require("socket.io");

let io;

/**
 * Initialize Socket.IO
 * @param {http.Server} server - The HTTP server instance
 */
function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3002",
        "https://bookyourneed.com",
        "https://www.bookyourneed.com",
        "https://worker.bookyourneed.com",
        "https://admin.bookyourneed.com",
        "https://api.bookyourneed.com",
        "https://app.bookyourneed.com",
      ],
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  const toStr = (v) => (v == null ? "" : String(v).trim());

  io.on("connection", (socket) => {
    console.log("🔥 New socket connected:", socket.id);

    /* ================================================== */
    /* 🔹 JOB SYSTEM                                      */
    /* ================================================== */

    // Worker registers (accepts string OR object)
    socket.on("registerWorker", (payload) => {
      const workerId = typeof payload === "object" ? payload.workerId : payload;
      const services = typeof payload === "object" ? payload.services || [] : [];
      const wid = toStr(workerId);
      if (!wid) return;

      socket.join(`worker_${wid}`);
      socket.join(wid); // legacy
      socket.data.workerId = wid;

      services.forEach((s) => {
        const room = `service_${toStr(s).toLowerCase()}`;
        if (room !== "service_") socket.join(room);
      });

      console.log(`🧑‍🔧 Worker registered: ${wid}`);
    });

    // Customer registers (accepts string OR object)
    socket.on("registerCustomer", (payload) => {
      const customerId = typeof payload === "object" ? payload.customerId : payload;
      const cid = toStr(customerId);
      if (!cid) return;

      socket.join(`customer_${cid}`);
      socket.join(cid); // legacy
      socket.data.customerId = cid;

      console.log(`🙋 Customer registered: ${cid}`);
    });

    // Join a specific job room
    socket.on("joinJobRoom", (jobId) => {
      const jid = toStr(jobId);
      if (!jid) return;
      socket.join(`job_${jid}`);
      console.log(`📦 Joined job room: job_${jid}`);
    });

    // Subscribe to services (for workers)
    socket.on("subscribeService", ({ services = [] } = {}) => {
      services.forEach((s) => {
        const room = `service_${toStr(s).toLowerCase()}`;
        if (room !== "service_") socket.join(room);
      });
      console.log(`🧑‍🔧 Subscribed services: ${services.join(", ")}`);
    });

    // Job posted → broadcast to relevant workers
    socket.on("job:new", ({ job } = {}) => {
      if (!job) return;
      const serviceRoom = `service_${toStr(job.serviceType || "general").toLowerCase()}`;
      io.to(serviceRoom).emit("job:new", job);
      console.log(`📢 Job broadcast to ${serviceRoom}`);
    });

    // Worker submits a bid → notify the job's customer
    socket.on("job:bidSubmitted", ({ jobId, customerId, bid } = {}) => {
      const cid = toStr(customerId);
      if (!jobId || !cid || !bid) return;
      io.to(`customer_${cid}`).emit("job:bidReceived", { jobId, bid });
      io.to(cid).emit("job:bidReceived", { jobId, bid }); // legacy
      console.log(`💰 Bid submitted for job ${jobId} → customer ${cid}`);
    });

    // Customer accepts a bid → notify worker
    socket.on("job:accepted", ({ jobId, workerId, customerId } = {}) => {
      const wid = toStr(workerId);
      const cid = toStr(customerId);
      if (!jobId || !wid || !cid) return;

      io.to(`worker_${wid}`).emit("job:assigned", { jobId });
      io.to(wid).emit("job:assigned", { jobId }); // legacy
      io.to(`customer_${cid}`).emit("job:update", { jobId, status: "assigned" });
      io.to(cid).emit("job:update", { jobId, status: "assigned" }); // legacy
      console.log(`✅ Job ${jobId} assigned → worker ${wid}`);
    });

    // Worker marks job complete → notify customer
    socket.on("job:workerCompleted", ({ jobId, customerId } = {}) => {
      const cid = toStr(customerId);
      if (!jobId || !cid) return;
      io.to(`customer_${cid}`).emit("job:update", { jobId, status: "worker_completed" });
      io.to(cid).emit("job:update", { jobId, status: "worker_completed" });
      console.log(`🧰 Worker completed job ${jobId}`);
    });

    // Customer confirms completion → notify worker
    socket.on("job:customerConfirmed", ({ jobId, workerId } = {}) => {
      const wid = toStr(workerId);
      if (!jobId || !wid) return;
      io.to(`worker_${wid}`).emit("job:update", { jobId, status: "completed" });
      io.to(wid).emit("job:update", { jobId, status: "completed" });
      console.log(`🎉 Customer confirmed completion for ${jobId}`);
    });

    // Job reopened → notify customer
    socket.on("job:reopened", ({ jobId, customerId } = {}) => {
      const cid = toStr(customerId);
      if (!jobId || !cid) return;
      io.to(`customer_${cid}`).emit("job:update", { jobId, status: "reopened" });
      io.to(cid).emit("job:update", { jobId, status: "reopened" });
      console.log(`🚨 Job ${jobId} reopened`);
    });

    // Job cancelled by worker → notify customer
    socket.on("job:cancelledByWorker", ({ jobId, customerId } = {}) => {
      const cid = toStr(customerId);
      if (!jobId || !cid) return;
      io.to(`customer_${cid}`).emit("job:update", { jobId, status: "cancelled_by_worker" });
      io.to(cid).emit("job:update", { jobId, status: "cancelled_by_worker" });
      console.log(`🚫 Job ${jobId} cancelled by worker`);
    });

    // Job cancelled by customer → notify worker
    socket.on("job:cancelledByCustomer", ({ jobId, workerId } = {}) => {
      const wid = toStr(workerId);
      if (!jobId || !wid) return;
      io.to(`worker_${wid}`).emit("job:update", { jobId, status: "cancelled_by_customer" });
      io.to(wid).emit("job:update", { jobId, status: "cancelled_by_customer" });
      console.log(`🚫 Job ${jobId} cancelled by customer`);
    });

    /* ================================================== */
    /* 🚗 RIDE SYSTEM                                    */
    /* ================================================== */
    socket.on("registerRideDriver", (workerId) => {
      const wid = toStr(workerId);
      if (!wid) return;
      socket.join(`ride_driver_${wid}`);
      console.log(`🚘 Driver joined ride room: ride_driver_${wid}`);
    });

    socket.on("registerRideCustomer", (customerId) => {
      const cid = toStr(customerId);
      if (!cid) return;
      socket.join(`ride_customer_${cid}`);
      console.log(`🧍 Customer joined ride room: ride_customer_${cid}`);
    });

    socket.on("joinRideRoom", ({ rideId } = {}) => {
      const rid = toStr(rideId);
      if (!rid) return;
      socket.join(`ride_${rid}`);
      console.log(`🛣️ Joined ride room: ride_${rid}`);
    });

    /* ================================================== */
    /* 💬 MAIN CHAT SYSTEM                               */
    /* ================================================== */
    socket.on("joinRoom", (roomId) => {
      const rid = toStr(roomId);
      if (!rid) return;
      socket.join(rid);
      console.log(`💬 Joined chat room: ${rid}`);
    });

    socket.on("sendMessage", (data = {}) => {
      const { roomId, ...message } = data;
      const rid = toStr(roomId);
      if (!rid) return;
      console.log(`📨 New chat message in ${rid}: ${message.message}`);
      io.to(rid).emit("receiveMessage", message);
    });

    socket.on("typing", (data = {}) => {
      const rid = toStr(data.roomId);
      if (!rid) return;
      io.to(rid).emit("typing", data);
    });

    /* ================================================== */
    /* 🆘 SUPPORT CHAT SYSTEM                            */
    /* ================================================== */
    socket.on("joinSupportRoom", ({ email } = {}) => {
      const e = toStr(email);
      if (!e) return;
      socket.join(`support_${e}`);
      console.log(`🧰 Support user joined: ${e}`);
    });

    socket.on("registerSupportAdmin", (adminId) => {
      socket.join("support_admins");
      console.log(`🧑‍💼 Support admin joined: ${adminId}`);
    });

    socket.on("support:message", (msg = {}) => {
      const { email, sender, text } = msg;
      const e = toStr(email);
      if (!e || !text) return;

      if (sender === "Admin") io.to(`support_${e}`).emit("support:message", msg);
      else io.to("support_admins").emit("support:message", msg);

      console.log(`📩 Support message from ${sender}: ${text}`);
    });

    socket.on("support:endSession", ({ email, closedBy } = {}) => {
      const e = toStr(email);
      if (!e) return;
      io.to(`support_${e}`).emit("support:ended", {
        message: `Chat closed by ${closedBy || "Admin"}.`,
      });
      console.log(`🔒 Support session ended for ${e}`);
    });

    socket.on("support:newSession", ({ email, name } = {}) => {
      const e = toStr(email);
      if (!e) return;
      io.to("support_admins").emit("support:newSession", {
        email: e,
        name,
        startedAt: new Date(),
      });
      console.log(`🆕 New support session started: ${e}`);
    });

    /* ================================================== */
    /* ❌ Disconnect Event                               */
    /* ================================================== */
    socket.on("disconnect", () => {
      console.log("❌ Socket disconnected:", socket.id);
    });
  });

  console.log("✅ Socket.IO initialized successfully");
  return io;
}

// ==================================================
// 📤 Export
// ==================================================
function getIO() {
  if (!io) throw new Error("Socket.io not initialized!");
  return io;
}

module.exports = { initSocket, getIO };
