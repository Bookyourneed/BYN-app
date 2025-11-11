const express = require("express");
const router = express.Router();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const Worker = require("../models/Worker");
const { sendEmailSafe } = require("../emailService");

// =====================================================
// ✅ GET Worker Wallet Balance + History
// =====================================================
router.get("/wallet/:workerId", async (req, res) => {
  try {
    const { workerId } = req.params;
    const worker = await Worker.findById(workerId).select(
      "walletBalance walletHistory name email"
    );

    if (!worker) {
      return res.status(404).json({ error: "Worker not found" });
    }

    res.json({
      walletBalance: worker.walletBalance || 0,
      walletHistory: worker.walletHistory || [],
      workerName: worker.name,
      workerEmail: worker.email,
    });
  } catch (err) {
    console.error("❌ Wallet fetch error:", err);
    res.status(500).json({ error: "Failed to fetch wallet" });
  }
});

// =====================================================
// ✅ POST Worker Withdrawal Request
// =====================================================
router.post("/request-withdrawal", async (req, res) => {
  const { workerId, amount, method } = req.body;

  try {
    const worker = await Worker.findById(workerId);
    if (!worker) return res.status(404).json({ error: "Worker not found" });

    if (amount > worker.walletBalance) {
      return res.status(400).json({ error: "Insufficient funds" });
    }

    // 🔹 Deduct immediately (hold funds)
    worker.walletBalance -= amount;

    const withdrawalRecord = {
      type: "debit",
      amount,
      jobId: null,
      date: new Date(),
      released: true,
      notes: `Withdrawal via ${method}`,
    };

    worker.walletHistory.push(withdrawalRecord);

    await worker.save();

    console.log(`💸 Withdrawal request from ${worker.name}: $${amount} via ${method}`);

    // =====================================================
    // 🔹 Handle Payout Type
    // =====================================================
    switch (method) {
      case "Stripe Instant Payout":
        try {
          // ⚙️ NOTE: Worker must have connected Stripe account set up in onboarding
          if (!worker.stripeAccountId) {
            throw new Error("Worker not connected to Stripe account");
          }

          const transfer = await stripe.transfers.create({
            amount: Math.round(amount * 100),
            currency: "cad",
            destination: worker.stripeAccountId,
            description: `BYN Payout to ${worker.name}`,
          });

          console.log(`✅ Stripe payout completed: ${transfer.id}`);

          // Email confirmation
          await sendEmailSafe({
            to: worker.email,
            subject: "💸 Stripe Instant Payout Processed",
            html: `
              <h2>Hi ${worker.name},</h2>
              <p>Your payout of <strong>$${amount.toFixed(2)}</strong> has been sent to your connected Stripe account.</p>
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
        // ⚙️ For now: log + email admin to handle manually (RBC / Wise API later)
        await sendEmailSafe({
          to: process.env.ADMIN_EMAIL || "admin@bookyourneed.com",
          subject: "📩 New Interac e-Transfer Request",
          html: `
            <h2>New Interac Withdrawal Request</h2>
            <p><strong>Worker:</strong> ${worker.name}</p>
            <p><strong>Email:</strong> ${worker.email}</p>
            <p><strong>Amount:</strong> $${amount.toFixed(2)}</p>
            <p><strong>Requested:</strong> ${new Date().toLocaleString()}</p>
            <br/>
            <p>Process manually via Interac / RBC / Wise API.</p>
          `,
        });

        await sendEmailSafe({
          to: worker.email,
          subject: "💸 Interac e-Transfer Request Received",
          html: `
            <h2>Hi ${worker.name},</h2>
            <p>Your request for an Interac e-Transfer payout of <strong>$${amount.toFixed(
              2
            )}</strong> has been received.</p>
            <p>Our finance team will send your payment within 1–2 business days.</p>
            <br/>
            <p>— Book Your Need</p>
          `,
        });
        break;

      case "Bank Deposit":
        // ⚙️ Future integration (Plaid / Stripe payouts)
        await sendEmailSafe({
          to: process.env.ADMIN_EMAIL || "admin@bookyourneed.com",
          subject: "🏦 New Bank Deposit Request",
          html: `
            <h2>New Bank Deposit Withdrawal</h2>
            <p><strong>Worker:</strong> ${worker.name}</p>
            <p><strong>Email:</strong> ${worker.email}</p>
            <p><strong>Amount:</strong> $${amount.toFixed(2)}</p>
            <p><strong>Requested:</strong> ${new Date().toLocaleString()}</p>
            <br/>
            <p>Process manually via Stripe or RBC ACH deposit.</p>
          `,
        });

        await sendEmailSafe({
          to: worker.email,
          subject: "🏦 Bank Deposit Request Received",
          html: `
            <h2>Hi ${worker.name},</h2>
            <p>Your request for a bank deposit of <strong>$${amount.toFixed(
              2
            )}</strong> has been received.</p>
            <p>Funds will be deposited into your account within 2–3 business days.</p>
            <br/>
            <p>— Book Your Need</p>
          `,
        });
        break;

      default:
        console.warn("⚠️ Unknown withdrawal method:", method);
        return res.status(400).json({ error: "Invalid withdrawal method" });
    }

    // ✅ Notify admin globally
    await sendEmailSafe({
      to: process.env.ADMIN_EMAIL || "admin@bookyourneed.com",
      subject: "📢 Worker Withdrawal Processed",
      html: `
        <h2>Withdrawal Confirmation</h2>
        <p><strong>Worker:</strong> ${worker.name}</p>
        <p><strong>Email:</strong> ${worker.email}</p>
        <p><strong>Amount:</strong> $${amount.toFixed(2)}</p>
        <p><strong>Method:</strong> ${method}</p>
        <p>Processed at ${new Date().toLocaleString()}</p>
      `,
    });

    res.status(200).json({
      success: true,
      message: `Withdrawal request processed via ${method}`,
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
