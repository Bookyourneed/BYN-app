const express = require('express');
const router = express.Router();
const Review = require('../models/Review');
const Worker = require('../models/Worker');

// Submit Review + Update Points/Tier
router.post('/submit', async (req, res) => {
  try {
    const { jobId, workerId, customerId, rating, reviewText } = req.body;

    const newReview = new Review({
      jobId,
      workerId,
      customerId,
      rating,
      reviewText,
    });

    await newReview.save();

    // Update worker points
    const worker = await Worker.findById(workerId);
    if (worker) {
      worker.points += 10;

      // Get all reviews to calculate average rating
      const allReviews = await Review.find({ workerId });
      const avgRating =
        allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length;

      // Recalculate tier based on points + avg rating
      let tier = 'silver';
      let commission = 0.15;

      if (worker.points >= 200 && avgRating >= 4.0) {
        tier = 'gold';
        commission = 0.12;
      }

      if (worker.points >= 500 && avgRating >= 4.7) {
        tier = 'platinum';
        commission = 0.10;
      }

      worker.tier = tier;
      worker.commissionRate = commission;

      await worker.save();
    }

    res.status(200).json({ message: 'Review submitted and tier updated' });
  } catch (err) {
    console.error('Error saving review:', err);
    res.status(500).json({ error: 'Failed to submit review' });
  }
});

// Get all reviews for a specific worker
router.get('/worker/:workerId', async (req, res) => {
  try {
    const reviews = await Review.find({ workerId: req.params.workerId }).sort({ createdAt: -1 });
    res.status(200).json(reviews);
  } catch (err) {
    console.error('Failed to fetch reviews:', err);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

module.exports = router;
