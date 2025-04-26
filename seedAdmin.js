const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Admin = require('./models/Admin');

// 🔒 Your MongoDB URI here
mongoose.connect('mongodb+srv://bynadmin:LetsFuckingo%4069@byn-cluster.mb2op.mongodb.net/?appName=BYN-Cluster', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(async () => {
  const existing = await Admin.findOne({ email: 'admin@byn.com' });
  if (existing) {
    console.log('Admin already exists!');
    process.exit();
  }

  const hashedPassword = await bcrypt.hash('LetsFuckingo@69', 10); // You can change this password
  await Admin.create({
    name: 'Daman Bhatt',
    email: 'admin@byn.com',
    password: hashedPassword,
    role: 'superadmin',
  });

  console.log('✅ Admin account created!');
  process.exit();
})
.catch(err => {
  console.error('❌ MongoDB connection error:', err);
  process.exit(1);
});
