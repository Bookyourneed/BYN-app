// ===========================================
// ✅ emailService.js (Book Your Need – Brevo API)
// ===========================================
require("dotenv").config();
const Brevo = require("@getbrevo/brevo");

console.log("📨 EmailService.js loaded — using Brevo API...");

// ===========================================
// 🔐 Initialize Brevo Client
// ===========================================
const brevoClient = new Brevo.TransactionalEmailsApi();
brevoClient.authentications["apiKey"].apiKey = process.env.EMAIL_PASS; // Your Brevo API key

// ===========================================
// ✉️ Base Safe Email Sender
// ===========================================
async function sendEmailSafe({ to, subject, html, text, context }) {
  try {
    const emailData = {
      sender: { name: "Book Your Need", email: process.env.EMAIL_USER },
      to: [{ email: to }],
      subject,
      htmlContent: html || text,
    };

    await brevoClient.sendTransacEmail(emailData);
    console.log(`📤 [${context || "general"}] Email sent to ${to}`);
  } catch (err) {
    const msg = err.response?.text || err.message || JSON.stringify(err);
    console.error("❌ Email send failed:", msg);
  }
}

// ===========================================
// 🎨 Shared HTML Template
// ===========================================
function generateEmailHTML(title, body) {
  return `
  <div style="font-family:'Poppins',Arial,sans-serif;background:#f9fafb;padding:30px;">
    <div style="max-width:600px;margin:auto;background:#ffffff;border-radius:12px;
                box-shadow:0 4px 10px rgba(0,0,0,0.05);overflow:hidden;">
      <div style="background:linear-gradient(90deg,#111827,#374151);color:white;padding:15px 25px;">
        <h2 style="margin:0;font-weight:600;">Book Your Need</h2>
      </div>
      <div style="padding:25px 30px;color:#333333;font-size:15px;line-height:1.6;">
        <h3 style="color:#111827;margin-bottom:10px;">${title}</h3>
        ${body}
      </div>
      <div style="background:#f3f4f6;color:#6b7280;padding:15px;text-align:center;font-size:12px;">
        <p>© ${new Date().getFullYear()} Book Your Need — All Rights Reserved.</p>
      </div>
    </div>
  </div>`;
}

// ===========================================
// 🧰 Job Email Templates
// ===========================================
async function sendJobEmail(type, data) {
  const { to, customerName, workerName, jobTitle } = data;
  const templates = {
    jobRequest: {
      subject: `📢 New Job Request from ${customerName}`,
      html: generateEmailHTML(
        "New Job Request",
        `<p><b>${customerName}</b> posted a new job: <b>${jobTitle}</b>.</p>`
      ),
    },
    jobAccepted: {
      subject: `✅ Your job "${jobTitle}" was accepted`,
      html: generateEmailHTML(
        "Job Accepted",
        `<p><b>${workerName}</b> has accepted the job. Work will begin soon.</p>`
      ),
    },
    jobCompleted: {
      subject: `🎉 Job Completed`,
      html: generateEmailHTML(
        "Job Completed",
        `<p><b>${workerName}</b> marked your job as completed. Please confirm.</p>`
      ),
    },
    jobDisputed: {
      subject: `⚠️ Job Dispute Raised`,
      html: generateEmailHTML(
        "Job Dispute Raised",
        `<p>A dispute has been raised for "<b>${jobTitle}</b>". Admin will review it shortly.</p>`
      ),
    },
  };

  const t = templates[type];
  if (!t) return console.warn("⚠️ Unknown job email type:", type);
  await sendEmailSafe({ to, subject: t.subject, html: t.html, context: `job-${type}` });
}
// ===========================================
// 💬 Chat Message Email Notifications
// ===========================================
async function sendChatEmail({ to, senderName, message }) {
  return sendEmailSafe({
    to,
    subject: `💬 New Chat Message from ${senderName}`,
    html: generateEmailHTML(
      "New Chat Message",
      `<p>You received a new message from <b>${senderName}</b>:</p>
       <blockquote style="border-left:4px solid #ccc;padding-left:10px;margin:10px 0;">
         ${message}
       </blockquote>
       <p>Please reply inside the BYN app.</p>`
    ),
    context: "chat-message",
  });
}

// ===========================================
// 🚗 Ride Email Templates
// ===========================================
async function sendRideEmail(type, data) {
  const { to, customerName, driverName, from, toLocation, date, time } = data;
  const templates = {
    rideRequest: {
      subject: `🚕 New Ride Request from ${customerName}`,
      html: generateEmailHTML(
        "New Ride Request",
        `<p><b>${customerName}</b> requested a ride from <b>${from}</b> to <b>${toLocation}</b> on ${date} at ${time}.</p>`
      ),
    },
    rideAccepted: {
      subject: `✅ Ride Confirmed — ${from} → ${toLocation}`,
      html: generateEmailHTML(
        "Ride Confirmed",
        `<p>Your driver <b>${driverName}</b> accepted your ride scheduled for ${date} at ${time}.</p>`
      ),
    },
    rideCompleted: {
      subject: `🎉 Ride Completed`,
      html: generateEmailHTML(
        "Ride Completed",
        `<p>Your driver <b>${driverName}</b> has marked your ride as complete. Please confirm or report any issue.</p>`
      ),
    },
    rideDisputed: {
      subject: `⚠️ Ride Dispute Raised`,
      html: generateEmailHTML(
        "Ride Dispute Raised",
        `<p><b>${customerName}</b> reported a problem with their ride from <b>${from}</b> to <b>${toLocation}</b>. The issue is under review.</p>`
      ),
    },
  };

  const t = templates[type];
  if (!t) return console.warn("⚠️ Unknown ride email type:", type);
  await sendEmailSafe({ to, subject: t.subject, html: t.html, context: `ride-${type}` });
}

// ===========================================
// 💬 Support Ticket Emails
// ===========================================
async function sendSupportEmail(type, data) {
  const { to, customerName, customerEmail, subject, message } = data;
  const templates = {
    supportTicketToAdmin: {
      subject: `📩 New Support Ticket from ${customerName}`,
      html: generateEmailHTML(
        "New Support Ticket",
        `<p><b>${customerName}</b> (${customerEmail}) opened a new support ticket.</p>
         <p><b>Subject:</b> ${subject}</p>
         <blockquote>${message}</blockquote>`
      ),
    },
    supportTicketConfirmation: {
      subject: `✅ Ticket Received — Book Your Need`,
      html: generateEmailHTML(
        "We've Received Your Support Request",
        `<p>Hi <b>${customerName}</b>,</p>
         <p>Thanks for reaching out! We've received your ticket regarding:</p>
         <p><b>${subject}</b></p>
         <p>Our team will reply soon at this email address.</p>`
      ),
    },
  };

  const t = templates[type];
  if (!t) return console.warn("⚠️ Unknown support email type:", type);
  await sendEmailSafe({ to, subject: t.subject, html: t.html, context: `support-${type}` });
}

// ===========================================
// ✅ Exports
// ===========================================
module.exports = {
  sendEmailSafe,
  sendJobEmail,
  sendRideEmail,
  sendChatEmail,
  sendSupportEmail,
};
