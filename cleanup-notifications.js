const mongoose = require('mongoose');
require('dotenv').config();

const uri = process.env.MONGO_URI || process.env.MONGODB_URL;

mongoose.connect(uri).then(async () => {
  console.log("Connected to MongoDB for cleanup");
  const db = mongoose.connection.db;
  
  // Clean up corrupted notification messages
  const notifications = await db.collection('notifications').find({ msg: /ðŸŽ‰/ }).toArray();
  console.log(`Found ${notifications.length} corrupted notifications.`);
  
  for (const notif of notifications) {
    const fixedMsg = notif.msg.replace(' ðŸŽ‰', '').replace('ðŸŽ‰', '');
    await db.collection('notifications').updateOne(
      { _id: notif._id },
      { $set: { msg: fixedMsg } }
    );
  }
  
  console.log("Cleanup complete!");
  mongoose.disconnect();
}).catch(console.error);
