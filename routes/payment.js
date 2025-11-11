const express = require("express");
const router = express.Router();
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { sendEmailSafe } = require("../emailService");
const Worker = require("../models/Worker");

const User = require("../models/User");
const Job = require("../models/Job");

const { getIO } = require("../socket");


// ============================================================
// ✅ Create PaymentIntent (Escrow Hold + Save for Reuse)
// ============================================================
router.post("/create-intent", async (req, res) => {
  const { amount, customerId, jobId } = req.body;
  console.log("💳 Creating payment intent for:", { customerId, jobId, amount });

  try {
    if (!amount || !customerId) {
      return res.status(400).json({ error: "Missing amount or customerId" });
    }

    // 🔍 Find customer in MongoDB
    const customer = await User.findById(customerId);
    if (!customer) {
      return res.status(404).json({ error: "User not found in database" });
    }

    // ✅ Auto-create Stripe Customer if missing
    if (!customer.stripeCustomerId) {
      console.log(`🆕 Creating Stripe customer for ${customer.email}...`);
      const stripeCustomer = await stripe.customers.create({
        email: customer.email,
        name: `${customer.name || ""} ${customer.lastName || ""}`.trim(),
      });

      customer.stripeCustomerId = stripeCustomer.id;
      await customer.save();

      console.log(`✅ Stripe customer created: ${stripeCustomer.id}`);
    }

    // ✅ Create Stripe PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // cents
      currency: "cad",
      customer: customer.stripeCustomerId, // ✅ Correct ID
      description: jobId
        ? `Escrow hold for BYN Job ${jobId}`
        : "BookYourNeed Job Escrow Payment",
      metadata: {
        jobId: jobId || "not_assigned",
        customerId,
        purpose: "BYN_JOB_ESCROW",
        createdAt: new Date().toISOString(),
      },
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: "never", // prevent redirect URL errors
      },
      setup_future_usage: "off_session", // save card for reuse
    });

    console.log("✅ Stripe PaymentIntent created:", paymentIntent.id);

    // ✅ Attach to Job if exists
    if (jobId) {
      const job = await Job.findById(jobId);
      if (job) {
        job.stripePaymentIntentId = paymentIntent.id;
        job.paymentStatus = "holding";
        await job.save();
        console.log(`💾 Attached PaymentIntent to Job ${jobId}`);
      } else {
        console.warn(`⚠️ Job not found to attach PaymentIntent (${jobId})`);
      }
    }

    // ✅ Return client secret to frontend
    return res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      message: "Payment intent created and funds held in escrow.",
    });

  } catch (err) {
    console.error("❌ Stripe paymentIntent creation error:", err.message);
    return res.status(500).json({
      error: "Failed to create payment intent.",
      details: err.message,
    });
  }
});

// =====================================================
// ✅ Save confirmed card (Multi-card support)
// =====================================================
router.post("/save-card", async (req, res) => {
  const { customerId, paymentMethodId } = req.body;

  try {
    const user = await User.findById(customerId);
    if (!user) return res.status(404).json({ error: "User not found" });

    if (!user.stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
      });
      user.stripeCustomerId = customer.id;
      await user.save();
    }

    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: user.stripeCustomerId,
    });

    await stripe.customers.update(user.stripeCustomerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });

    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
    const cardData = {
      brand: paymentMethod.card.brand,
      last4: paymentMethod.card.last4,
      exp_month: paymentMethod.card.exp_month,
      exp_year: paymentMethod.card.exp_year,
      paymentMethodId: paymentMethod.id,
      addedAt: new Date(),
    };

    user.cards.push(cardData);
    await user.save();

    res.status(200).json({ message: "Card saved successfully", cards: user.cards });
  } catch (err) {
    console.error("❌ Stripe save card error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// =====================================================
// ✅ Get saved cards
// =====================================================
router.get("/get-saved-card/:customerMongoId", async (req, res) => {
  const { customerMongoId } = req.params;
  try {
    const user = await User.findById(customerMongoId);
    if (!user || !user.stripeCustomerId) {
      return res.status(404).json({ error: "Stripe customer not found for user." });
    }

    const paymentMethods = await stripe.paymentMethods.list({
      customer: user.stripeCustomerId,
      type: "card",
    });

    const cards = paymentMethods.data.map((pm) => ({
      last4: pm.card.last4,
      exp_month: pm.card.exp_month,
      exp_year: pm.card.exp_year,
      paymentMethodId: pm.id,
      isDefault: false,
    }));

    res.json(cards);
  } catch (err) {
    console.error("❌ Failed to get saved cards:", err);
    res.status(500).json([]);
  }
});

// =====================================================
// ✅ Set default card
// =====================================================
router.post("/set-default-card", async (req, res) => {
  const { customerId, last4 } = req.body;

  try {
    const user = await User.findById(customerId);
    if (!user || !user.cards) return res.status(404).json({ error: "User or cards not found" });

    user.cards = user.cards.map((card) => ({
      ...card._doc,
      isDefault: card.last4 === last4,
    }));

    await user.save();
    res.status(200).json({ message: "Default card set", cards: user.cards });
  } catch (err) {
    console.error("❌ Set default card error:", err);
    res.status(500).json({ error: "Failed to set default card" });
  }
});

// =====================================================
// ✅ Delete card
// =====================================================
router.delete("/delete-card/:customerId/:last4", async (req, res) => {
  const { customerId, last4 } = req.params;

  try {
    const user = await User.findById(customerId);
    if (!user) return res.status(404).json({ error: "User not found" });

    user.cards = user.cards.filter((card) => card.last4 !== last4);
    await user.save();

    res.status(200).json({ message: "Card deleted", cards: user.cards });
  } catch (err) {
    console.error("❌ Delete card error:", err);
    res.status(500).json({ error: "Failed to delete card" });
  }
});


// ============================================================
// ✅ AUTO-RELEASE JOB FUNDS (48h Timeout)
// Handles bid changes safely – no re-holds, only diff charge/refund
// ============================================================
async function releasePendingFunds() {
  const now = new Date();
  const io = getIO();

  const readyJobs = await Job.find({
    paymentStatus: "pending_release",
    "completion.releaseDate": { $lte: now },
  })
    .populate("assignedTo", "email name walletBalance commissionRate")
    .populate("customerId", "email name stripeCustomerId");

  for (const job of readyJobs) {
    try {
      const worker = await Worker.findById(job.assignedTo);
      if (!worker) continue;

      const adjustedPrice = job.assignedPrice || 0;

      // =======================================================
      // 💰 SMART PAYMENT RECONCILIATION (fixed)
      // =======================================================
      if (job.stripePaymentIntentId && job.customerId?.stripeCustomerId) {
        try {
          const intent = await stripe.paymentIntents.retrieve(job.stripePaymentIntentId);
          const charge = intent.latest_charge
            ? await stripe.charges.retrieve(intent.latest_charge)
            : null;
          const amountPaid = charge ? charge.amount / 100 : adjustedPrice;
          const difference = parseFloat((adjustedPrice - amountPaid).toFixed(2));

          if (Math.abs(difference) >= 0.5) {
            if (difference > 0) {
              // ⬆️ Price increased → charge the difference automatically
              console.log(`💳 Charging +$${difference} for updated bid (auto-release)`);

              const originalPaymentMethod = intent.payment_method;

              if (!originalPaymentMethod) {
                console.warn("⚠️ No saved payment method found for job", job._id);
              } else {
                // ✅ Attach payment method to customer if not attached
                try {
                  await stripe.paymentMethods.attach(originalPaymentMethod, {
                    customer: job.customerId.stripeCustomerId,
                  });
                  console.log(`🔗 Attached payment method ${originalPaymentMethod} to customer`);
                } catch (attachErr) {
                  if (attachErr.code === "resource_already_exists") {
                    console.log("⚠️ Payment method already attached, continuing...");
                  } else {
                    console.warn("⚠️ Could not attach payment method:", attachErr.message);
                  }
                }

                // ✅ Create and confirm off-session extra charge
                const extraCharge = await stripe.paymentIntents.create({
                  amount: Math.round(difference * 100),
                  currency: "cad",
                  customer: job.customerId.stripeCustomerId,
                  payment_method: originalPaymentMethod,
                  off_session: true,
                  confirm: true,
                  description: `Auto-charge difference for ${job.jobTitle}`,
                  automatic_payment_methods: {
                    enabled: true,
                    allow_redirects: "never", // ✅ prevent redirect requirement
                  },
                });

                console.log(
                  `✅ Auto-charged extra $${difference} (PaymentIntent: ${extraCharge.id})`
                );
              }
            } else {
              // ⬇️ Price decreased → refund the difference
              const refundAmount = Math.abs(difference);
              console.log(`💸 Refunding $${refundAmount} for lowered bid (auto-release)`);

              await stripe.refunds.create({
                payment_intent: job.stripePaymentIntentId,
                amount: Math.round(refundAmount * 100),
              });

              console.log(`✅ Refunded $${refundAmount} successfully`);
            }
          }
        } catch (stripeErr) {
          console.error("❌ Stripe adjustment error:", stripeErr);
        }
      }

      // =======================================================
      // 💎 RELEASE FUNDS TO WORKER
      // =======================================================
      job.paymentStatus = "released";
      job.status = "auto_confirmed";
      job.completion.autoReleasedAt = new Date();

      const commission = worker.commissionRate || 0.15;
      const earning = parseFloat((adjustedPrice * (1 - commission)).toFixed(2));

      // update wallet
      const existing = worker.walletHistory.find(
        (h) => String(h.jobId) === String(job._id) && !h.released
      );
      if (existing) existing.released = true;
      else {
        worker.walletHistory.push({
          type: "credit",
          amount: earning,
          jobId: job._id,
          date: new Date(),
          released: true,
          notes: "Auto release after 48h (smart reconciliation)",
        });
      }

      worker.walletBalance = (worker.walletBalance || 0) + earning;

      await worker.save();
      await job.save();

      // =======================================================
      // ⚡ SOCKET UPDATES
      // =======================================================
      io.to(`worker_${worker._id}`).emit("job:update", {
        jobId: job._id,
        status: "auto_confirmed",
        message: `💰 Payment auto-released ($${adjustedPrice}) after 48 hours.`,
      });

      io.to(`customer_${job.customerId.email}`).emit("job:update", {
        jobId: job._id,
        status: "auto_confirmed",
        message: "✅ Job auto-confirmed after 48 hours.",
      });

      // =======================================================
      // ✉️ EMAILS
      // =======================================================
      await sendEmailSafe({
        to: worker.email,
        subject: "💰 Payment Auto-Released",
        html: `
          <h2>Hi ${worker.name || "Worker"},</h2>
          <p>Your job <strong>${job.jobTitle}</strong> was automatically confirmed after 48 hours.</p>
          <p>You received <strong>$${earning}</strong> from a total of $${adjustedPrice}.</p>
          <br><p>— Book Your Need</p>
        `,
      });

      if (job.customerId?.email) {
        await sendEmailSafe({
          to: job.customerId.email,
          subject: "✅ Job Auto-Confirmed",
          html: `
            <h2>Hi ${job.customerId.name || "Customer"},</h2>
            <p>Your job <strong>${job.jobTitle}</strong> was automatically confirmed after 48 hours.</p>
            <p>The final bid of <strong>$${adjustedPrice}</strong> was released to the worker.</p>
            <br><p>— Book Your Need</p>
          `,
        });
      }

      console.log(`💸 Auto-released $${earning} to ${worker.email}`);
    } catch (err) {
      console.error(`❌ Failed to release funds for job ${job._id}`, err);
    }
  }
}


// ============================================================
// ✅ Auto-refund expired, unassigned jobs (safe + delayed by 1 day)
// ============================================================
async function refundExpiredJobs() {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000); // ⏰ 24-hour delay

  // Find unassigned + past-scheduled jobs (at least 1 day old)
  const expiredJobs = await Job.find({
    status: { $in: ["pending", "reopened"] },
    assignedTo: { $in: [null, undefined] },
    scheduledAt: { $lt: oneDayAgo }, // ✅ refund only after a full day
  }).populate("customerId", "email name");

  const results = [];

  for (const job of expiredJobs) {
    try {
      let refundAmount = 0;
      let refundId = null;

      if (job.stripePaymentIntentId) {
        try {
          // Retrieve PI to confirm payment + amount
          const pi = await stripe.paymentIntents.retrieve(job.stripePaymentIntentId);

          // Skip already refunded/cancelled
          if (pi.status === "canceled" || (pi.charges?.data?.[0]?.refunded ?? false)) {
            console.warn(`⚠️ PaymentIntent already canceled/refunded for job ${job._id}`);
          } else {
            // Full refund
            const refund = await stripe.refunds.create({
              payment_intent: job.stripePaymentIntentId,
            });

            refundId = refund.id;
            const cents =
              typeof pi.amount_received === "number" && pi.amount_received > 0
                ? pi.amount_received
                : pi.amount ?? 0;

            refundAmount = Math.max(0, cents / 100);
            job.paymentStatus = "refunded";
            job.refundAmount = refundAmount;

            console.log(`💸 Refunded job ${job._id} for $${refundAmount.toFixed(2)}`);
          }
        } catch (stripeErr) {
          console.error(`❌ Stripe refund failed for job ${job._id}:`, stripeErr.message);
          job.paymentStatus = "refund_failed";
        }
      } else {
        console.warn(`⚠️ Job ${job._id} has no stripePaymentIntentId`);
        job.paymentStatus = "no_payment";
      }

      // Common cancellation logic
      job.status = "cancelled";
      job.cancelReason = "No worker assigned within 24 hours after scheduled time";
      job.cancelledAt = now;

      job.history = job.history || [];
      job.history.push({
        action: refundId ? "auto_refunded" : "auto_cancelled",
        by: "system",
        at: now,
        notes: refundId
          ? `Refund processed via Stripe (ID: ${refundId})`
          : "No payment detected, job auto-cancelled",
      });

      await job.save();

      // ===========================
      // 📧 Notify customer
      // ===========================
      const customerEmail = job.customerId?.email || job.email;
      const customerName = job.customerId?.name || job.customerName || "Customer";

      if (customerEmail) {
        try {
          await sendEmailSafe(
            customerEmail,
            refundId ? "💸 Job Auto-Refunded" : "⚠️ Job Auto-Cancelled",
            `
            <h2>Hi ${customerName},</h2>
            <p>Your job <strong>${job.jobTitle}</strong> scheduled for 
            ${new Date(job.scheduledAt).toLocaleString()} was not picked by any worker.</p>
            ${
              refundId
                ? `<p>We've refunded <strong>$${refundAmount.toFixed(
                    2
                  )}</strong> to your card (Refund ID: ${refundId}).</p>`
                : `<p>No payment was detected, so your job was simply cancelled.</p>`
            }
            <p>We apologize for the inconvenience and hope you’ll book with us again.</p>
            <p>– Book Your Need</p>
            `
          );
        } catch (mailErr) {
          console.warn(`📧 Failed to send email to ${customerEmail}:`, mailErr.message);
        }
      } else {
        console.warn(`⚠️ No customer email found for job ${job._id}`);
      }

      // ===========================
      // 📧 Notify admin
      // ===========================
      try {
        await sendEmailSafe(
          "admin@bookyourneed.com",
          refundId ? "💸 Auto-Refund Issued" : "⚠️ Auto-Cancelled (No Payment)",
          `
          <p><strong>Job:</strong> ${job.jobTitle} (${job._id})</p>
          <p><strong>Customer:</strong> ${customerEmail || "N/A"}</p>
          <p><strong>Status:</strong> ${job.paymentStatus}</p>
          ${
            refundId
              ? `<p>Refund: $${refundAmount.toFixed(2)} | Refund ID: ${refundId}</p>`
              : "<p>No Stripe PaymentIntent found.</p>"
          }
          `
        );
      } catch (mailErr) {
        console.warn(`📧 Admin email failed for job ${job._id}:`, mailErr.message);
      }

      results.push({ jobId: job._id, refundId, amount: refundAmount });
    } catch (err) {
      console.error(`❌ Failed to process job ${job._id}:`, err.message);
      results.push({ jobId: job._id, error: err.message });
    }
  }

  return results;
}

// ============================================================
// ✅ CUSTOMER CONFIRMS JOB COMPLETION
// Smart commission system + job tracking
// ============================================================
router.post("/jobs/:jobId/confirm", async (req, res) => {
  const { jobId } = req.params;
  const io = getIO();

  try {
    const job = await Job.findById(jobId)
      .populate("assignedTo", "email name walletBalance commissionRate jobsCompleted totalEarnings")
      .populate("customerId", "email name stripeCustomerId");

    if (!job) return res.status(404).json({ error: "Job not found" });
    if (job.status === "dispute")
      return res.status(400).json({ error: "Job is under dispute" });
    if (!job.stripePaymentIntentId)
      return res.status(400).json({ error: "No payment intent found" });

    // ✅ Retrieve existing payment
    const paymentIntent = await stripe.paymentIntents.retrieve(job.stripePaymentIntentId);
    const charge = paymentIntent.latest_charge
      ? await stripe.charges.retrieve(paymentIntent.latest_charge)
      : null;
    const amountPaid = charge ? charge.amount / 100 : job.assignedPrice;

    const currentPrice = job.assignedPrice || 0;
    const difference = parseFloat((currentPrice - amountPaid).toFixed(2));

    // ============================================================
    // 💰 Adjust Payment if Bid Changed
    // ============================================================
    if (Math.abs(difference) >= 0.5) {
      if (difference > 0) {
        console.log(`💳 Charging +$${difference} for updated bid (Job ${job._id})`);

        const previousIntent = await stripe.paymentIntents.retrieve(job.stripePaymentIntentId);
        const defaultPaymentMethod = previousIntent.payment_method;
        if (!defaultPaymentMethod) throw new Error("Customer has no saved payment method.");

        const extraCharge = await stripe.paymentIntents.create({
          amount: Math.round(difference * 100),
          currency: "cad",
          customer: job.customerId.stripeCustomerId,
          payment_method: defaultPaymentMethod,
          off_session: true,
          confirm: true,
          description: `Bid update for ${job.jobTitle}`,
          automatic_payment_methods: { enabled: true, allow_redirects: "never" },
        });

        console.log(`✅ Charged +$${difference} (PaymentIntent: ${extraCharge.id})`);
      } else {
        const refundAmount = Math.abs(difference);
        console.log(`💸 Refunding $${refundAmount} for reduced bid (Job ${job._id})`);
        await stripe.refunds.create({
          payment_intent: job.stripePaymentIntentId,
          amount: Math.round(refundAmount * 100),
        });
        console.log(`✅ Refunded $${refundAmount}`);
      }
    }

    // ============================================================
    // 🧾 Finalize Job + Smart Payout
    // ============================================================
    job.status = "completed";
    job.paymentStatus = "released";
    job.completion = job.completion || {};
    job.completion.customerConfirmedAt = new Date();
    job.paymentInfo = { escrowStatus: "released", releasedAt: new Date() };

    const worker = await Worker.findById(job.assignedTo);
    if (worker) {
      // 🔹 Commission logic based on total earnings
      const previousEarnings = worker.totalEarnings || 0;
      let commission = 0.0445; // 4.45% base rate

      if (previousEarnings >= 100 && previousEarnings < 300) commission = 0.05;
      if (previousEarnings >= 300) commission = 20 / currentPrice; // flat $20 cap for large earners

      const payout = commission >= 1
        ? currentPrice - 20
        : parseFloat((currentPrice * (1 - commission)).toFixed(2));

      worker.walletBalance = (worker.walletBalance || 0) + payout;
      worker.walletHistory.push({
        type: "credit",
        amount: payout,
        jobId: job._id,
        date: new Date(),
        released: true,
        notes: `Automatic payout after customer confirmation. Base: $${currentPrice}, Commission: ${commission >= 1 ? "$20 flat" : (commission * 100).toFixed(2) + "%"}.`,
      });

      // 🔹 Update stats
      worker.jobsCompleted = (worker.jobsCompleted || 0) + 1;
      worker.totalEarnings = (worker.totalEarnings || 0) + payout;

      await worker.save();
      console.log(`💸 Released $${payout} to ${worker.name} (Total Jobs: ${worker.jobsCompleted}, Total Earned: $${worker.totalEarnings.toFixed(2)})`);
    }

    job.history.push({
      action: "customer_confirmed",
      by: "customer",
      at: new Date(),
      notes: `Customer confirmed completion. Final: $${currentPrice}`,
    });
    await job.save();

    // ============================================================
    // 🔔 Socket Updates
    // ============================================================
    io.to(`worker_${worker._id}`).emit("job:update", {
      jobId: job._id,
      status: "completed",
      message: `✅ Customer confirmed job. $${currentPrice} released.`,
    });
    io.to(`customer_${job.customerId.email}`).emit("job:update", {
      jobId: job._id,
      status: "completed",
      message: "🎉 Job confirmed and payout released.",
    });

    // ============================================================
    // ✉️ Email Notifications
    // ============================================================
    if (job.assignedTo?.email) {
      await sendEmailSafe({
        to: job.assignedTo.email,
        subject: "✅ Job Completed – Payment Released",
        html: `
          <h2>Hi ${job.assignedTo.name || "Worker"},</h2>
          <p>Your job <strong>${job.jobTitle}</strong> has been confirmed by the customer.</p>
          <p>Final price: <strong>$${currentPrice}</strong></p>
          <p>You received <strong>$${(worker.walletHistory.at(-1)?.amount).toFixed(2)}</strong> after commission.</p>
          <p>Commission tier: ${
            worker.totalEarnings < 100
              ? "4.45%"
              : worker.totalEarnings < 300
              ? "5%"
              : "$20 flat"
          }</p>
          <br><p>— Book Your Need Team</p>
        `,
      });
    }

    return res.json({
      success: true,
      message: "Job confirmed and payout released.",
    });
  } catch (err) {
    console.error("❌ Confirm job error:", err);
    res.status(500).json({
      error: "Failed to confirm job completion.",
      details: err.message,
    });
  }
});


// ✅ Customer files a dispute (funds frozen in escrow)
router.post("/jobs/:jobId/dispute", async (req, res) => {
  const { jobId } = req.params;
  const { customerId, reason } = req.body;

  try {
    const job = await Job.findById(jobId)
      .populate("assignedTo", "email name")
      .populate("customerId", "email name");

    if (!job) return res.status(404).json({ error: "Job not found" });

    // ✅ Only allow dispute if job is currently holding or completed
    if (
      !["holding", "released", "pending_release"].includes(job.paymentStatus)
    ) {
      return res
        .status(400)
        .json({ error: "Job not eligible for dispute" });
    }

    // ✅ Mark job as disputed & freeze payout
    job.status = "dispute";
    job.paymentStatus = "holding";
    job.completion.disputeAt = new Date();

    // ✅ Save dispute reason directly in job
    job.disputeReason = reason || "No reason provided";

    // ✅ Update payment info block
    job.paymentInfo = job.paymentInfo || {};
    job.paymentInfo.escrowStatus = "dispute";

    // ✅ Log the dispute in job history
    job.history.push({
      action: "dispute_filed",
      by: "customer",
      actorId: customerId,
      at: new Date(),
      notes: `Reason: ${reason || "No reason provided"}`,
    });

    await job.save();

    /* ===================================================
       📡 Real-time socket update
    =================================================== */
    const io = getIO();
    // notify customer socket room
    io.to(`customer_${job.customerId.email}`).emit("job:update", {
      jobId: job._id,
      status: "dispute",
      message: "Your job is now under dispute review.",
      reason: job.disputeReason,
    });

    // notify assigned worker
    if (job.assignedTo?._id) {
      io.to(`worker_${job.assignedTo._id}`).emit("job:update", {
        jobId: job._id,
        status: "dispute",
        message:
          "⚠️ The customer has disputed this job. Payment is on hold.",
        reason: job.disputeReason,
      });
    }

    /* ===================================================
       📧 Email notifications
    =================================================== */
    // 📧 Worker
    if (job.assignedTo?.email) {
      await sendEmailSafe({
        to: job.assignedTo.email,
        subject: "⚠️ Job Disputed – Payout Paused",
        html: `
          <h2>Hi ${job.assignedTo.name || "Worker"},</h2>
          <p>The customer has disputed job <strong>${job.jobTitle}</strong>.</p>
          <p>Reason: <em>${reason || "No reason provided"}</em></p>
          <p>Your payout has been paused until the issue is reviewed.</p>
          <p>Our customer service team will reach out if further information is needed.</p>
          <br><p>— Book Your Need</p>
        `,
      });
    }

    // 📧 Customer
    if (job.customerId?.email) {
      await sendEmailSafe({
        to: job.customerId.email,
        subject: "⚠️ Dispute Submitted Successfully",
        html: `
          <h2>Hi ${job.customerId.name || "Customer"},</h2>
          <p>Your dispute for job <strong>${job.jobTitle}</strong> has been submitted.</p>
          <p>Reason: <em>${reason || "No reason provided"}</em></p>
          <p>Our customer service team will review it within 48 hours.</p>
          <p>We will notify you once a resolution is reached.</p>
          <br><p>— Book Your Need</p>
        `,
      });
    }

    // 📧 Admin
    await sendEmailSafe({
      to: process.env.ADMIN_EMAIL || "admin@bookyourneed.com",
      subject: "🚨 New Job Dispute Filed",
      html: `
        <h2>Dispute Alert</h2>
        <p><strong>Job ID:</strong> ${job._id}</p>
        <p><strong>Title:</strong> ${job.jobTitle}</p>
        <p><strong>Customer:</strong> ${
          job.customerId?.email || "N/A"
        }</p>
        <p><strong>Worker:</strong> ${
          job.assignedTo?.email || "N/A"
        }</p>
        <p><strong>Reason:</strong> ${reason || "No reason provided"}</p>
        <br>
        <p>This job is now marked as <strong>disputed</strong>. Payout is on hold until admin resolution.</p>
      `,
    });

    console.log(`⚠️ Dispute filed for job ${jobId}. Funds frozen.`);

    return res.json({
      success: true,
      message:
        "Dispute filed successfully. Funds frozen until resolution.",
      reason: job.disputeReason,
    });
  } catch (err) {
    console.error("❌ Dispute route error:", err);
    return res.status(500).json({ error: "Failed to file dispute." });
  }
});



// ✅ API endpoint (manual trigger for admin/debugging)
router.post("/refund-expired-jobs", async (req, res) => {
  try {
    const results = await refundExpiredJobs();
    res.json({ message: `Processed ${results.length} expired jobs`, results });
  } catch (err) {
    console.error("❌ Auto-refund error:", err);
    res.status(500).json({ error: "Failed to process expired jobs" });
  }
});

const cron = require("node-cron");

// Run hourly
cron.schedule("0 * * * *", async () => {
  console.log("⏰ Running refund sweep...");
  try {
    await refundExpiredJobs();
  } catch (err) {
    console.error("Refund cron error:", err.message);
  }
});

// Run once at startup
refundExpiredJobs().catch(err =>
  console.error("Startup refund sweep failed:", err.message)
);


module.exports = router;
