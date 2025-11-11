// ✅ socket.js — 2025 stable, unified, and fixed
const { Server } = require("socket.io");

let io;

<<<<<<< HEAD
/**
 * Initialize Socket.IO with shared CORS rules
 * @param {http.Server} server - The HTTP server instance
 * @param {object} corsOptions - CORS options from server.js
 */
function initSocket(server, corsOptions = {}) {
=======
function initSocket(server) {
>>>>>>> e4ee6847563ff9f15949edfa509b77226308059b
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
<<<<<<< HEAD
        "https://api.bookyourneed.com",
        "https://app.bookyourneed.com",
=======
>>>>>>> e4ee6847563ff9f15949edfa509b77226308059b
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

<<<<<<< HEAD
    socket.on("registerWorker", (payload) => {
      const workerId = typeof payload === "object" ? payload.workerId : payload;
      const services = typeof payload === "object" ? payload.services || [] : [];
      const wid = toStr(workerId);
      if (!wid) return;

      socket.join(`worker_${wid}`);
      socket.join(wid); // legacy
      socket.data.workerId = wid;

=======
    // Worker registers (accepts string OR object)
    socket.on("registerWorker", (payload) => {
      const workerId = typeof payload === "object" ? payload.workerId : payload;
      const services = typeof payload === "object" ? payload.services || [] : [];

      const wid = toStr(workerId);
      if (!wid) return;

      // Back-compat rooms
      socket.join(`worker_${wid}`);
      socket.join(wid); // raw room for legacy emitters
      socket.data.workerId = wid;

      // Service subscription
>>>>>>> e4ee6847563ff9f15949edfa509b77226308059b
      services.forEach((s) => {
        const room = `service_${toStr(s).toLowerCase()}`;
        if (room !== "service_") socket.join(room);
      });
<<<<<<< HEAD
      console.log(`🧑‍🔧 Worker registered: ${wid}`);
    });

=======

          });

    // Customer registers (accepts string OR object)
>>>>>>> e4ee6847563ff9f15949edfa509b77226308059b
    socket.on("registerCustomer", (payload) => {
      const customerId = typeof payload === "object" ? payload.customerId : payload;
      const cid = toStr(customerId);
      if (!cid) return;

      socket.join(`customer_${cid}`);
<<<<<<< HEAD
      socket.join(cid);
=======
      socket.join(cid); // raw room for legacy emitters
>>>>>>> e4ee6847563ff9f15949edfa509b77226308059b
      socket.data.customerId = cid;

      console.log(`🙋 Customer registered: ${cid}`);
    });

<<<<<<< HEAD
=======
    // Optional explicit job room (for a specific job detail page)
>>>>>>> e4ee6847563ff9f15949edfa509b77226308059b
    socket.on("joinJobRoom", (jobId) => {
      const jid = toStr(jobId);
      if (!jid) return;
      socket.join(`job_${jid}`);
      console.log(`📦 Joined job room: job_${jid}`);
    });

<<<<<<< HEAD
=======
    // Workers can subscribe services later (e.g., after profile fetch)
>>>>>>> e4ee6847563ff9f15949edfa509b77226308059b
    socket.on("subscribeService", ({ services = [] } = {}) => {
      services.forEach((s) => {
        const room = `service_${toStr(s).toLowerCase()}`;
        if (room !== "service_") socket.join(room);
      });
      console.log(`🧑‍🔧 Subscribed services: ${services.join(", ")}`);
    });

<<<<<<< HEAD
=======
    // Job posted → broadcast to matching service room(s)
>>>>>>> e4ee6847563ff9f15949edfa509b77226308059b
    socket.on("job:new", ({ job } = {}) => {
      if (!job) return;
      const serviceRoom = `service_${toStr(job.serviceType || "general").toLowerCase()}`;
      io.to(serviceRoom).emit("job:new", job);
      console.log(`📢 Job broadcast to ${serviceRoom}`);
    });

<<<<<<< HEAD
=======
    // Worker submitted a bid → notify that job’s customer
>>>>>>> e4ee6847563ff9f15949edfa509b77226308059b
    socket.on("job:bidSubmitted", ({ jobId, customerId, bid } = {}) => {
      const cid = toStr(customerId);
      if (!jobId || !cid || !bid) return;
      io.to(`customer_${cid}`).emit("job:bidReceived", { jobId, bid });
<<<<<<< HEAD
      io.to(cid).emit("job:bidReceived", { jobId, bid });
      console.log(`💰 Bid submitted for job ${jobId} → customer ${cid}`);
    });

=======
      io.to(cid).emit("job:bidReceived", { jobId, bid }); // back-compat
      console.log(`💰 Bid submitted for job ${jobId} → customer ${cid}`);
    });

    // Customer accepted a bid → notify chosen worker + reflect to customer
>>>>>>> e4ee6847563ff9f15949edfa509b77226308059b
    socket.on("job:accepted", ({ jobId, workerId, customerId } = {}) => {
      const wid = toStr(workerId);
      const cid = toStr(customerId);
      if (!jobId || !wid || !cid) return;

      io.to(`worker_${wid}`).emit("job:assigned", { jobId });
<<<<<<< HEAD
      io.to(wid).emit("job:assigned", { jobId });
      io.to(`customer_${cid}`).emit("job:update", { jobId, status: "assigned" });
      io.to(cid).emit("job:update", { jobId, status: "assigned" });
      console.log(`✅ Job ${jobId} assigned → worker ${wid}`);
    });

=======
      io.to(wid).emit("job:assigned", { jobId }); // back-compat
      io.to(`customer_${cid}`).emit("job:update", { jobId, status: "assigned" });
      io.to(cid).emit("job:update", { jobId, status: "assigned" }); // back-compat
      console.log(`✅ Job ${jobId} assigned → worker ${wid}`);
    });

    // Worker marked job complete → ping customer
>>>>>>> e4ee6847563ff9f15949edfa509b77226308059b
    socket.on("job:workerCompleted", ({ jobId, customerId } = {}) => {
      const cid = toStr(customerId);
      if (!jobId || !cid) return;
      io.to(`customer_${cid}`).emit("job:update", { jobId, status: "worker_completed" });
<<<<<<< HEAD
      io.to(cid).emit("job:update", { jobId, status: "worker_completed" });
      console.log(`🧰 Worker completed job ${jobId}`);
    });

=======
      io.to(cid).emit("job:update", { jobId, status: "worker_completed" }); // back-compat
      console.log(`🧰 Worker completed job ${jobId}`);
    });

    // Customer confirmed completion → notify worker
>>>>>>> e4ee6847563ff9f15949edfa509b77226308059b
    socket.on("job:customerConfirmed", ({ jobId, workerId } = {}) => {
      const wid = toStr(workerId);
      if (!jobId || !wid) return;
      io.to(`worker_${wid}`).emit("job:update", { jobId, status: "completed" });
<<<<<<< HEAD
      io.to(wid).emit("job:update", { jobId, status: "completed" });
      console.log(`🎉 Customer confirmed completion for ${jobId}`);
    });

=======
      io.to(wid).emit("job:update", { jobId, status: "completed" }); // back-compat
      console.log(`🎉 Customer confirmed completion for ${jobId}`);
    });

    // Job reopened/cancelled → notify customer (UI can re-prompt)
>>>>>>> e4ee6847563ff9f15949edfa509b77226308059b
    socket.on("job:reopened", ({ jobId, customerId } = {}) => {
      const cid = toStr(customerId);
      if (!jobId || !cid) return;
      io.to(`customer_${cid}`).emit("job:update", { jobId, status: "reopened" });
<<<<<<< HEAD
      io.to(cid).emit("job:update", { jobId, status: "reopened" });
      console.log(`🚨 Job ${jobId} reopened`);
    });

    socket.on("job:cancelledByWorker", ({ jobId, customerId } = {}) => {
      const cid = toStr(customerId);
      if (!jobId || !cid) return;
      io.to(`customer_${cid}`).emit("job:update", { jobId, status: "cancelled_by_worker" });
      io.to(cid).emit("job:update", { jobId, status: "cancelled_by_worker" });
      console.log(`🚫 Job ${jobId} cancelled by worker`);
    });

    socket.on("job:cancelledByCustomer", ({ jobId, workerId } = {}) => {
      const wid = toStr(workerId);
      if (!jobId || !wid) return;
      io.to(`worker_${wid}`).emit("job:update", { jobId, status: "cancelled_by_customer" });
      io.to(wid).emit("job:update", { jobId, status: "cancelled_by_customer" });
      console.log(`🚫 Job ${jobId} cancelled by customer`);
    });
=======
      io.to(cid).emit("job:update", { jobId, status: "reopened" }); // back-compat
      console.log(`🚨 Job ${jobId} reopened`);
    });
    // ==================================================
// 🚫 Job cancelled by worker or customer
// ==================================================

// Worker cancels a job → notify customer
socket.on("job:cancelledByWorker", ({ jobId, customerId } = {}) => {
  const cid = toStr(customerId);
  if (!jobId || !cid) return;
  io.to(`customer_${cid}`).emit("job:update", { jobId, status: "cancelled_by_worker" });
  io.to(cid).emit("job:update", { jobId, status: "cancelled_by_worker" }); // back-compat
  console.log(`🚫 Job ${jobId} cancelled by worker`);
});

// Customer cancels a job → notify worker
socket.on("job:cancelledByCustomer", ({ jobId, workerId } = {}) => {
  const wid = toStr(workerId);
  if (!jobId || !wid) return;
  io.to(`worker_${wid}`).emit("job:update", { jobId, status: "cancelled_by_customer" });
  io.to(wid).emit("job:update", { jobId, status: "cancelled_by_customer" }); // back-compat
  console.log(`🚫 Job ${jobId} cancelled by customer`);
});

>>>>>>> e4ee6847563ff9f15949edfa509b77226308059b

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
<<<<<<< HEAD
=======
      console.log(`📨 New chat message in ${rid}: ${message.message}`);
>>>>>>> e4ee6847563ff9f15949edfa509b77226308059b
      io.to(rid).emit("receiveMessage", message);
    });

    socket.on("typing", (data = {}) => {
      const rid = toStr(data.roomId);
      if (!rid) return;
      io.to(rid).emit("typing", data);
    });

    /* ================================================== */
<<<<<<< HEAD
    /* 🆘 SUPPORT CHAT SYSTEM                            */
=======
    /* 🆕 SUPPORT / CUSTOMER SERVICE CHAT SYSTEM          */
>>>>>>> e4ee6847563ff9f15949edfa509b77226308059b
    /* ================================================== */
    socket.on("joinSupportRoom", ({ email } = {}) => {
      const e = toStr(email);
      if (!e) return;
      socket.join(`support_${e}`);
<<<<<<< HEAD
      console.log(`🧰 Support user joined: ${e}`);
=======
      console.log(`🧰 Support: ${e} joined support room.`);
>>>>>>> e4ee6847563ff9f15949edfa509b77226308059b
    });

    socket.on("registerSupportAdmin", (adminId) => {
      socket.join("support_admins");
<<<<<<< HEAD
      console.log(`🧑‍💼 Support admin joined: ${adminId}`);
=======
      console.log(`🧑‍💼 Admin joined support channel: ${adminId}`);
>>>>>>> e4ee6847563ff9f15949edfa509b77226308059b
    });

    socket.on("support:message", (msg = {}) => {
      const { email, sender, text } = msg;
      const e = toStr(email);
      if (!e || !text) return;

<<<<<<< HEAD
      if (sender === "Admin") io.to(`support_${e}`).emit("support:message", msg);
      else io.to("support_admins").emit("support:message", msg);

=======
      if (sender === "Admin") {
        io.to(`support_${e}`).emit("support:message", msg); // send to user
      } else {
        io.to("support_admins").emit("support:message", msg); // send to admins
      }
>>>>>>> e4ee6847563ff9f15949edfa509b77226308059b
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
<<<<<<< HEAD
    /* ❌ Disconnect Event                               */
=======
    /* 🔔 Disconnect                                     */
>>>>>>> e4ee6847563ff9f15949edfa509b77226308059b
    /* ================================================== */
    socket.on("disconnect", () => {
      console.log("❌ Socket disconnected:", socket.id);
    });
  });

<<<<<<< HEAD
  console.log("✅ Socket.IO initialized successfully with CORS");
  return io;
}

// ==================================================
// 📤 Export
// ==================================================
=======
  console.log("✅ Socket.IO initialized successfully");
  return io;
}

/* ================================================== */
/* Export io instance                                 */
/* ================================================== */
>>>>>>> e4ee6847563ff9f15949edfa509b77226308059b
function getIO() {
  if (!io) throw new Error("Socket.io not initialized!");
  return io;
}

module.exports = { initSocket, getIO };
