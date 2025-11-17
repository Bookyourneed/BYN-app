const { Server } = require("socket.io");

let io;

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
    /* JOB SYSTEM */
    /* ================================================== */

    socket.on("registerWorker", (payload) => {
      const workerId =
        typeof payload === "object" ? payload.workerId : payload;
      const services =
        typeof payload === "object" ? payload.services || [] : [];
      const wid = toStr(workerId);
      if (!wid) return;

      socket.join(`worker_${wid}`);
      socket.join(wid);
      socket.data.workerId = wid;

      services.forEach((s) => {
        const room = `service_${toStr(s).toLowerCase()}`;
        if (room !== "service_") socket.join(room);
      });
    });

    socket.on("registerCustomer", (payload) => {
      const customerId =
        typeof payload === "object" ? payload.customerId : payload;
      const cid = toStr(customerId);
      if (!cid) return;

      socket.join(`customer_${cid}`);
      socket.join(cid);
      socket.data.customerId = cid;
    });

    socket.on("joinJobRoom", (jobId) => {
      const jid = toStr(jobId);
      if (!jid) return;
      socket.join(`job_${jid}`);
    });

    socket.on("subscribeService", ({ services = [] } = {}) => {
      services.forEach((s) => {
        const room = `service_${toStr(s).toLowerCase()}`;
        if (room !== "service_") socket.join(room);
      });
    });

    socket.on("job:new", ({ job } = {}) => {
      if (!job) return;
      const serviceRoom = `service_${toStr(
        job.serviceType || "general"
      ).toLowerCase()}`;
      io.to(serviceRoom).emit("job:new", job);
    });

    socket.on("job:bidSubmitted", ({ jobId, customerId, bid } = {}) => {
      const cid = toStr(customerId);
      if (!jobId || !cid || !bid) return;
      io.to(`customer_${cid}`).emit("job:bidReceived", {
        jobId,
        bid,
      });
      io.to(cid).emit("job:bidReceived", { jobId, bid });
    });

    socket.on("job:accepted", ({ jobId, workerId, customerId } = {}) => {
      const wid = toStr(workerId);
      const cid = toStr(customerId);
      if (!jobId || !wid || !cid) return;

      io.to(`worker_${wid}`).emit("job:assigned", { jobId });
      io.to(wid).emit("job:assigned", { jobId });
      io.to(`customer_${cid}`).emit("job:update", {
        jobId,
        status: "assigned",
      });
      io.to(cid).emit("job:update", { jobId, status: "assigned" });
    });

    socket.on("job:workerCompleted", ({ jobId, customerId } = {}) => {
      const cid = toStr(customerId);
      if (!jobId || !cid) return;
      io.to(`customer_${cid}`).emit("job:update", {
        jobId,
        status: "worker_completed",
      });
      io.to(cid).emit("job:update", {
        jobId,
        status: "worker_completed",
      });
    });

    socket.on("job:customerConfirmed", ({ jobId, workerId } = {}) => {
      const wid = toStr(workerId);
      if (!jobId || !wid) return;
      io.to(`worker_${wid}`).emit("job:update", {
        jobId,
        status: "completed",
      });
      io.to(wid).emit("job:update", { jobId, status: "completed" });
    });

    socket.on("job:reopened", ({ jobId, customerId } = {}) => {
      const cid = toStr(customerId);
      if (!jobId || !cid) return;
      io.to(`customer_${cid}`).emit("job:update", {
        jobId,
        status: "reopened",
      });
      io.to(cid).emit("job:update", { jobId, status: "reopened" });
    });

    socket.on("job:cancelledByWorker", ({ jobId, customerId } = {}) => {
      const cid = toStr(customerId);
      if (!jobId || !cid) return;
      io.to(`customer_${cid}`).emit("job:update", {
        jobId,
        status: "cancelled_by_worker",
      });
      io.to(cid).emit("job:update", {
        jobId,
        status: "cancelled_by_worker",
      });
    });

    socket.on("job:cancelledByCustomer", ({ jobId, workerId } = {}) => {
      const wid = toStr(workerId);
      if (!jobId || !wid) return;
      io.to(`worker_${wid}`).emit("job:update", {
        jobId,
        status: "cancelled_by_customer",
      });
      io.to(wid).emit("job:update", {
        jobId,
        status: "cancelled_by_customer",
      });
    });

    /* ================================================== */
    /* RIDE SYSTEM */
    /* ================================================== */

    socket.on("registerRideDriver", (workerId) => {
      const wid = toStr(workerId);
      if (!wid) return;
      socket.join(`ride_driver_${wid}`);
    });

    socket.on("registerRideCustomer", (customerId) => {
      const cid = toStr(customerId);
      if (!cid) return;
      socket.join(`ride_customer_${cid}`);
    });

    socket.on("joinRideRoom", ({ rideId } = {}) => {
      const rid = toStr(rideId);
      if (!rid) return;
      socket.join(`ride_${rid}`);
    });

    socket.on("ride:bookingRequest", ({ rideId, customerId }) => {
      const rid = toStr(rideId);
      const cid = toStr(customerId);
      if (!rid || !cid) return;
      io.to(`ride_${rid}`).emit("ride:update", {
        rideId: rid,
        event: "booking_request",
        customerId: cid,
      });
    });

    socket.on("ride:bookingAccepted", ({ rideId, customerId }) => {
      const rid = toStr(rideId);
      const cid = toStr(customerId);
      if (!rid || !cid) return;
      io.to(`ride_customer_${cid}`).emit("ride:update", {
        rideId: rid,
        event: "accepted",
      });
    });

    socket.on("ride:bookingCancelled", ({ rideId, customerId }) => {
      const rid = toStr(rideId);
      const cid = toStr(customerId);
      if (!rid || !cid) return;
      io.to(`ride_customer_${cid}`).emit("ride:update", {
        rideId: rid,
        event: "cancelled",
      });
    });

    socket.on("ride:completedByDriver", ({ rideId, customerId }) => {
      const rid = toStr(rideId);
      const cid = toStr(customerId);
      if (!rid || !cid) return;
      io.to(`ride_customer_${cid}`).emit("ride:update", {
        rideId: rid,
        event: "driver_completed",
      });
    });

    socket.on("ride:customerConfirmed", ({ rideId, workerId }) => {
      const rid = toStr(rideId);
      const wid = toStr(workerId);
      if (!rid || !wid) return;
      io.to(`ride_driver_${wid}`).emit("ride:update", {
        rideId: rid,
        event: "completed",
      });
    });

    /* ================================================== */
    /* CHAT */
    /* ================================================== */

    socket.on("joinRoom", (roomId) => {
      const rid = toStr(roomId);
      if (!rid) return;
      socket.join(rid);
    });

    socket.on("sendMessage", (data = {}) => {
      const { roomId, ...message } = data;
      const rid = toStr(roomId);
      if (!rid) return;
      io.to(rid).emit("receiveMessage", message);
    });
    /* ================================================== */
/* PRIVATE RIDE CHAT ROOM (1–1 Chat) */
/* ================================================== */
socket.on("join-private-ride-chat", ({ roomId }) => {
  const rid = toStr(roomId);
  if (!rid) return;
  console.log("👥 Joined private ride chat:", rid);
  socket.join(rid);
});
    socket.on("typing", (data = {}) => {
      const rid = toStr(data.roomId);
      if (!rid) return;
      io.to(rid).emit("typing", data);
    });

    /* ================================================== */
    /* SUPPORT */
    /* ================================================== */

    socket.on("joinSupportRoom", ({ email } = {}) => {
      const e = toStr(email);
      if (!e) return;
      socket.join(`support_${e}`);
    });

    socket.on("registerSupportAdmin", () => {
      socket.join("support_admins");
    });

    socket.on("support:message", (msg = {}) => {
      const { email, sender } = msg;
      const e = toStr(email);
      if (!e) return;

      if (sender === "Admin") {
        io.to(`support_${e}`).emit("support:message", msg);
      } else {
        io.to("support_admins").emit("support:message", msg);
      }
    });

    socket.on("support:endSession", ({ email } = {}) => {
      const e = toStr(email);
      if (!e) return;
      io.to(`support_${e}`).emit("support:ended", {
        message: "Chat closed.",
      });
    });

    /* ================================================== */
    /* DISCONNECT */
    /* ================================================== */

    socket.on("disconnect", () => {
      console.log("❌ Socket disconnected:", socket.id);
    });
  });

  return io;
}

function getIO() {
  if (!io) throw new Error("Socket.io not initialized!");
  return io;
}

module.exports = { initSocket, getIO };
