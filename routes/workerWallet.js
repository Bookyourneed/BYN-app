const express = require("express");
const router = express.Router();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const Worker = require("../models/Worker");
const { sendEmailSafe } = require("../emailService");

// ============================================================
// ✅ GET Worker Wallet + Stats (Final Working Version)
// ============================================================
router.get("/wallet/:workerId", async (req, res) => {
  try {
    const { workerId } = req.params;

    const worker = await Worker.findById(workerId)
      .populate({
        path: "walletHistory.jobId",
        select: "jobTitle",
      })
      .select(
        "walletBalance walletHistory email name jobsCompleted totalEarnings"
      )
      .lean();

    if (!worker) {
      return res.status(404).json({ error: "Worker not found" });
    }

    const jobsCompleted =
      typeof worker.jobsCompleted === "number"
        ? worker.jobsCompleted
        : (worker.walletHistory || []).filter((h) => h.type === "credit").length;

    const totalEarnings =
      typeof worker.totalEarnings === "number"
        ? worker.totalEarnings
        : (worker.walletHistory || [])
            .filter((h) => h.type === "credit")
            .reduce((sum, h) => sum + (h.amount || 0), 0);

    res.json({
      walletBalance: worker.walletBalance || 0,
      walletHistory: worker.walletHistory || [],
      workerEmail: worker.email,
      workerName: worker.name,
      jobsCompleted,
      totalEarnings,
    });
  } catch (err) {
    console.error("❌ Wallet Fetch Error:", err);
    res.status(500).json({ error: "Failed to fetch wallet info" });
  }
});

// =====================================================
// ✅ POST Worker Withdrawal Request (with Stripe $2 Fee)
// =====================================================
router.post("/request-withdrawal", async (req, res) => {
  const { workerId, amount, method } = req.body;

  try {
    const worker = await Worker.findById(workerId);
    if (!worker) return res.status(404).json({ error: "Worker not found" });

    let finalAmount = amount;
    let feeApplied = 0;

    // ⚙️ Apply Stripe Instant Payout Fee
    if (method === "Stripe Instant Payout") {
      feeApplied = 2; // $2 fee
      finalAmount = amount - feeApplied;
      if (finalAmount <= 0) {
        return res.status(400).json({
          error: "Withdrawal amount must be greater than $2 after fee deduction",
        });
      }
    }

    if (finalAmount > worker.walletBalance) {
      return res.status(400).json({ error: "Insufficient funds" });
    }

    // 🔹 Deduct from wallet
    worker.walletBalance -= amount;

    const withdrawalRecord = {
      type: "debit",
      amount,
      jobId: null,
      date: new Date(),
      released: true,
      notes: `Withdrawal via ${method}${feeApplied ? ` (includes $${feeApplied} fee)` : ""}`,
    };

    worker.walletHistory.push(withdrawalRecord);
    await worker.save();

    console.log(`💸 Withdrawal from ${worker.name}: $${amount} (${method})`);

    // =====================================================
    // 🔹 Handle Payout Type
    // =====================================================
    switch (method) {
      case "Stripe Instant Payout":
        try {
          if (!worker.stripeAccountId) {
            throw new Error("Worker not connected to Stripe account");
          }

          const transfer = await stripe.transfers.create({
            amount: Math.round(finalAmount * 100), // after fee
            currency: "cad",
            destination: worker.stripeAccountId,
            description: `BYN Payout to ${worker.name} (after $${feeApplied} fee)`,
          });

          console.log(`✅ Stripe payout completed: ${transfer.id}`);

          await sendEmailSafe({
            to: worker.email,
            subject: "💸 Stripe Instant Payout Sent",
            html: `
              <h2>Hi ${worker.name},</h2>
              <p>Your payout of <strong>$${finalAmount.toFixed(
                2
              )}</strong> has been transferred to your Stripe account.</p>
              <p>A $${feeApplied.toFixed(
                2
              )} instant payout fee was applied.</p>
              <p>Transfer ID: ${transfer.id}</p>
              <br/>
              <p>— Book Your Need</p>
            `,
          });
        } catch (err) {
          console.error("❌ Stripe payout failed:", err.message);
          return res.status(500).json({
            error: "Stripe payout failed",
            details: err.message,
          });
        }
        break;

      case "Interac e-Transfer":
        await sendEmailSafe({
          to: process.env.ADMIN_EMAIL || "admin@bookyourneed.com",
          subject: "📩 New Interac e-Transfer Request",
          html: `
            <h2>New Interac Withdrawal Request</h2>
            <p><strong>Worker:</strong> ${worker.name}</p>
            <p><strong>Email:</strong> ${worker.email}</p>
            <p><strong>Amount:</strong> $${amount.toFixed(2)}</p>
            <p><strong>Requested:</strong> ${new Date().toLocaleString()}</p>
          `,
        });
        await sendEmailSafe({
          to: worker.email,
          subject: "💸 Interac e-Transfer Request Received",
          html: `
            <h2>Hi ${worker.name},</h2>
            <p>Your request for <strong>$${amount.toFixed(
              2
            )}</strong> has been received.</p>
            <p>Expect funds within 1–2 business days.</p>
            <br/>
            <p>— Book Your Need</p>
          `,
        });
        break;

      case "Bank Deposit":
        await sendEmailSafe({
          to: process.env.ADMIN_EMAIL || "admin@bookyourneed.com",
          subject: "🏦 New Bank Deposit Request",
          html: `
            <h2>New Bank Deposit Withdrawal</h2>
            <p><strong>Worker:</strong> ${worker.name}</p>
            <p><strong>Email:</strong> ${worker.email}</p>
            <p><strong>Amount:</strong> $${amount.toFixed(2)}</p>
            <p><strong>Requested:</strong> ${new Date().toLocaleString()}</p>
          `,
        });
        await sendEmailSafe({
          to: worker.email,
          subject: "🏦 Bank Deposit Request Received",
          html: `
            <h2>Hi ${worker.name},</h2>
            <p>Your request for <strong>$${amount.toFixed(
              2
            )}</strong> has been received.</p>
            <p>Funds will arrive within 2–3 business days.</p>
            <br/>
            <p>— Book Your Need</p>
          `,
        });
        break;

      default:
        return res.status(400).json({ error: "Invalid withdrawal method" });
    }

    // ✅ Notify Admin
    await sendEmailSafe({
      to: process.env.ADMIN_EMAIL || "admin@bookyourneed.com",
      subject: "📢 Worker Withdrawal Processed",
      html: `
        <h2>Withdrawal Confirmation</h2>
        <p><strong>Worker:</strong> ${worker.name}</p>
        <p><strong>Email:</strong> ${worker.email}</p>
        <p><strong>Amount:</strong> $${amount.toFixed(2)}</p>
        <p><strong>Method:</strong> ${method}</p>
        ${
          feeApplied
            ? `<p><strong>Stripe Fee:</strong> $${feeApplied.toFixed(2)}</p>`
            : ""
        }
        <p>Processed at ${new Date().toLocaleString()}</p>
      `,
    });

    res.status(200).json({
      success: true,
      message: `Withdrawal via ${method} processed${
        feeApplied ? ` (Fee: $${feeApplied})` : ""
      }`,
    });
  } catch (err) {
    console.error("❌ Withdrawal request error:", err);
    res.status(500).json({ error: "Withdrawal processing failed" });
  }
});

// ✅ GET All Withdrawal Requests (for workers & admin)
// =====================================================
router.get("/withdrawal-logs", async (req, res) => {
  try {
    const workers = await Worker.find().select("name email walletHistory");
    const allWithdrawals = [];

    workers.forEach((w) => {
      const withdrawals = (w.walletHistory || []).filter(
        (h) => h.type === "debit"
      );
      withdrawals.forEach((r) =>
        allWithdrawals.push({
          workerName: w.name,
          email: w.email,
          amount: r.amount,
          method: r.notes,
          date: r.date,
          status: "Sent", // ✅ Add consistent status label
        })
      );
    });

    res.status(200).json(allWithdrawals);
  } catch (err) {
    console.error("❌ Withdrawal log fetch error:", err);
    res.status(500).json({ error: "Failed to load withdrawal logs" });
  }
});

module.exports = router;
