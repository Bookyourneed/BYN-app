// utils/sendWorkerNotification.js
const Worker = require("../models/Worker");

const sendWorkerNotification = async (workerId, title, message) => {
  try {
    const worker = await Worker.findById(workerId);
    if (!worker) return;

    worker.notifications.unshift({
      title,
      message,
      createdAt: new Date(),
    });

    // Optional: Keep only latest 30
    if (worker.notifications.length > 30) {
      worker.notifications = worker.notifications.slice(0, 30);
    }

    await worker.save();
  } catch (err) {
    console.error("❌ Error sending notification to worker:", err);
  }
};

module.exports = sendWorkerNotification;
