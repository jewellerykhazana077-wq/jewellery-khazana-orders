const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const DB_NAME = 'jewellery_khazana';

let db;
let client;

async function connect() {
  if (db) return db;
  client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db(DB_NAME);

  // Ensure indexes
  await db.collection('users').createIndex({ username: 1 }, { unique: true });
  await db.collection('orders').createIndex({ order_date: 1 });

  // Create default admin if not exists
  const admin = await db.collection('users').findOne({ username: 'admin' });
  if (!admin) {
    await db.collection('users').insertOne({
      username: 'admin',
      password: bcrypt.hashSync('Admin@123', 10),
      role: 'admin',
      created_at: nowLocal()
    });
    console.log('Default admin created → username: admin  password: Admin@123');
  }

  return db;
}

function nowLocal() {
  return new Date().toLocaleString('en-IN', { hour12: false }).replace(',', '');
}

function toPlain(doc) {
  if (!doc) return null;
  const { _id, password, ...rest } = doc;
  return { id: _id.toString(), ...rest };
}

function toPlainWithPassword(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return { id: _id.toString(), ...rest };
}

module.exports = {
  connect,

  async getUserByUsername(username) {
    const doc = await db.collection('users').findOne({ username });
    return doc ? toPlainWithPassword(doc) : null;
  },

  async getAllUsers() {
    const docs = await db.collection('users')
      .find({}, { projection: { password: 0 } })
      .sort({ role: -1, username: 1 })
      .toArray();
    return docs.map(toPlain);
  },

  async createUser({ username, password, role }) {
    const result = await db.collection('users').insertOne({
      username, password, role, created_at: nowLocal()
    });
    return { id: result.insertedId.toString(), username, role };
  },

  async deleteUser(id) {
    await db.collection('users').deleteOne({
      _id: new ObjectId(id),
      role: { $ne: 'admin' }
    });
  },

  async getOrdersByDate(date) {
    const docs = await db.collection('orders')
      .find({ order_date: date })
      .sort({ _id: -1 })
      .toArray();
    return docs.map(toPlain);
  },

  async getOrderById(id) {
    try {
      const doc = await db.collection('orders').findOne({ _id: new ObjectId(id) });
      return toPlain(doc);
    } catch { return null; }
  },

  async createOrder({ order_date, order_number, product_image_url, status, awb_number, created_by, created_by_name }) {
    const doc = {
      order_date, order_number,
      product_image_url: product_image_url || null,
      status,
      awb_number: awb_number || null,
      created_by, created_by_name,
      last_updated_by: null, last_updated_by_name: null,
      created_at: nowLocal(), updated_at: nowLocal()
    };
    const result = await db.collection('orders').insertOne(doc);
    return { id: result.insertedId.toString(), ...doc };
  },

  async updateOrderStatus(id, status, awb_number, userId, userName) {
    await db.collection('orders').updateOne(
      { _id: new ObjectId(id) },
      { $set: { status, awb_number: awb_number || null, last_updated_by: userId, last_updated_by_name: userName, updated_at: nowLocal() } }
    );
  },

  async updateOrder(id, { order_date, order_number, product_image_url, status, awb_number }, userId, userName) {
    await db.collection('orders').updateOne(
      { _id: new ObjectId(id) },
      { $set: { order_date, order_number, product_image_url: product_image_url || null, status, awb_number: awb_number || null, last_updated_by: userId, last_updated_by_name: userName, updated_at: nowLocal() } }
    );
  },

  async getOrdersSummary(date) {
    const pipeline = [
      { $match: { order_date: date } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ];
    const rows = await db.collection('orders').aggregate(pipeline).toArray();
    const summary = { total: 0, unprocessed: 0, processing: 0, not_colored: 0, raw_material: 0, dispatched: 0 };
    rows.forEach(r => {
      if (r._id in summary) summary[r._id] = r.count;
      summary.total += r.count;
    });
    return summary;
  }
};
