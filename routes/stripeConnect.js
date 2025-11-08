const express = require("express");
const router = express.Router();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const Worker = require("../models/Worker");
const { sendEmailSafe } = require("../emailService");

// =====================================================
// ✅ 1️⃣ Create a Stripe Connected Account (for a worker)
// =====================================================
router.post("/create-connect-account", async (req, res) => {
  const { workerId, email } = req.body;

  try {
    const worker = await Worker.findById(workerId);
    if (!worker) return res.status(404).json({ error: "Worker not found" });

    // 🔹 Create a Stripe Connect Express account
    const account = await stripe.accounts.create({
      type: "express",
      country: "CA",
      email: email || worker.email,
      capabilities: {
        transfers: { requested: true },
      },
      business_type: "individual",
      metadata: { workerId },
    });

    // Save accountId to worker profile
    worker.stripeAccountId = account.id;
    await worker.save();

    console.log(`✅ Stripe Connect account created: ${account.id} for ${worker.email}`);

    // Create onboarding link
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: `${process.env.FRONTEND_URL}/worker/stripe-refresh`,
      return_url: `${process.env.FRONTEND_URL}/worker/stripe-success`,
      type: "account_onboarding",
    });

    // Return onboarding URL to frontend
    res.json({
      url: accountLink.url,
      message: "Stripe Connect onboarding link created successfully.",
    });
  } catch (err) {
    console.error("❌ Error creating Stripe Connect account:", err);
    res.status(500).json({ error: "Failed to create Stripe Connect account" });
  }
});

// =====================================================
// ✅ 2️⃣ Retrieve Stripe Account Status (after onboarding)
// =====================================================
router.get("/account-status/:workerId", async (req, res) => {
  try {
    const { workerId } = req.params;
    const worker = await Worker.findById(workerId);
    if (!worker || !worker.stripeAccountId) {
      return res.status(404).json({ error: "Stripe account not found for worker" });
    }

    const account = await stripe.accounts.retrieve(worker.stripeAccountId);

    res.json({
      stripeAccountId: account.id,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
      chargesEnabled: account.charges_enabled,
      requirements: account.requirements,
    });
  } catch (err) {
    console.error("❌ Stripe account status error:", err);
    res.status(500).json({ error: "Failed to fetch account status" });
  }
});

// =====================================================
// ✅ 3️⃣ Generate a New Onboarding Link (if worker didn’t finish)
// =====================================================
router.post("/refresh-onboarding-link", async (req, res) => {
  const { workerId } = req.body;

  try {
    const worker = await Worker.findById(workerId);
    if (!worker || !worker.stripeAccountId)
      return res.status(404).json({ error: "Stripe account not found" });

    const accountLink = await stripe.accountLinks.create({
      account: worker.stripeAccountId,
      refresh_url: `${process.env.FRONTEND_URL}/worker/stripe-refresh`,
      return_url: `${process.env.FRONTEND_URL}/worker/stripe-success`,
      type: "account_onboarding",
    });

    res.json({ url: accountLink.url });
  } catch (err) {
    console.error("❌ Refresh onboarding link error:", err);
    res.status(500).json({ error: "Failed to refresh onboarding link" });
  }
});

// =====================================================
// ✅ 4️⃣ Admin can view all connected workers & status
// =====================================================
router.get("/connected-workers", async (req, res) => {
  try {
    const workers = await Worker.find(
      { stripeAccountId: { $ne: null } },
      "name email stripeAccountId"
    );

    const accounts = await Promise.all(
      workers.map(async (worker) => {
        const acc = await stripe.accounts.retrieve(worker.stripeAccountId);
        return {
          name: worker.name,
          email: worker.email,
          stripeAccountId: worker.stripeAccountId,
          payoutsEnabled: acc.payouts_enabled,
          detailsSubmitted: acc.details_submitted,
        };
      })
    );

    res.json(accounts);
  } catch (err) {
    console.error("❌ Connected workers fetch error:", err);
    res.status(500).json({ error: "Failed to fetch connected workers" });
  }
});

module.exports = router;
