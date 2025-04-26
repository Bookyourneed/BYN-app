const mongoose = require('mongoose');

const HelpTicketSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
  },
  email: String,
  subject: String,
  message: String,
  userType: {
    type: String,
    enum: ['customer', 'worker'],
    required: true,
  },
  status: {
    type: String,
    enum: ['open', 'in-progress', 'resolved', 'closed'],
    default: 'open',
  },
  resolvedAt: Date,
  adminNotes: String,
}, { timestamps: true });

module.exports = mongoose.models.HelpTicket || mongoose.model('HelpTicket', HelpTicketSchema);
