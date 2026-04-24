const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function nowLocal() {
  return new Date().toLocaleString('en-IN', { hour12: false }).replace(',', '');
}

// Bootstrap default admin
let users = readJSON(USERS_FILE);
if (!users.find(u => u.username === 'admin')) {
  users.push({
    id: 1,
    username: 'admin',
    password: bcrypt.hashSync('Admin@123', 10),
    role: 'admin',
    created_at: nowLocal()
  });
  writeJSON(USERS_FILE, users);
  console.log('Default admin created → username: admin  password: Admin@123');
}

function nextId(arr) {
  return arr.length ? Math.max(...arr.map(x => x.id)) + 1 : 1;
}

module.exports = {
  getUserByUsername(username) {
    return readJSON(USERS_FILE).find(u => u.username === username) || null;
  },

  getAllUsers() {
    return readJSON(USERS_FILE).map(({ password, ...u }) => u)
      .sort((a, b) => (b.role === 'admin' ? 1 : -1) || a.username.localeCompare(b.username));
  },

  createUser({ username, password, role }) {
    const users = readJSON(USERS_FILE);
    if (users.find(u => u.username === username)) throw new Error('Username exists');
    const user = { id: nextId(users), username, password, role, created_at: nowLocal() };
    users.push(user);
    writeJSON(USERS_FILE, users);
    return { id: user.id, username, role };
  },

  deleteUser(id) {
    const users = readJSON(USERS_FILE);
    const filtered = users.filter(u => u.id !== parseInt(id) || u.role === 'admin');
    writeJSON(USERS_FILE, filtered);
  },

  getOrdersByDate(date) {
    const users = readJSON(USERS_FILE);
    return readJSON(ORDERS_FILE)
      .filter(o => o.order_date === date)
      .sort((a, b) => b.id - a.id)
      .map(o => ({
        ...o,
        created_by_name: users.find(u => u.id === o.created_by)?.username || o.created_by_name || '—'
      }));
  },

  getOrderById(id) {
    return readJSON(ORDERS_FILE).find(o => o.id === parseInt(id)) || null;
  },

  createOrder({ order_date, order_number, product_image_url, status, awb_number, created_by, created_by_name }) {
    const orders = readJSON(ORDERS_FILE);
    const order = {
      id: nextId(orders),
      order_date,
      order_number,
      product_image_url: product_image_url || null,
      status,
      awb_number: awb_number || null,
      created_by,
      created_by_name,
      last_updated_by: null,
      last_updated_by_name: null,
      created_at: nowLocal(),
      updated_at: nowLocal()
    };
    orders.push(order);
    writeJSON(ORDERS_FILE, orders);
    return order;
  },

  updateOrderStatus(id, status, awb_number, userId, userName) {
    const orders = readJSON(ORDERS_FILE);
    const idx = orders.findIndex(o => o.id === parseInt(id));
    if (idx === -1) return;
    orders[idx] = { ...orders[idx], status, awb_number: awb_number || null, last_updated_by: userId, last_updated_by_name: userName, updated_at: nowLocal() };
    writeJSON(ORDERS_FILE, orders);
  },

  updateOrder(id, { order_date, order_number, product_image_url, status, awb_number }, userId, userName) {
    const orders = readJSON(ORDERS_FILE);
    const idx = orders.findIndex(o => o.id === parseInt(id));
    if (idx === -1) return;
    orders[idx] = { ...orders[idx], order_date, order_number, product_image_url: product_image_url || null, status, awb_number: awb_number || null, last_updated_by: userId, last_updated_by_name: userName, updated_at: nowLocal() };
    writeJSON(ORDERS_FILE, orders);
  },

  getOrdersSummary(date) {
    const orders = readJSON(ORDERS_FILE).filter(o => o.order_date === date);
    const summary = { total: orders.length, unprocessed: 0, processing: 0, not_colored: 0, raw_material: 0, dispatched: 0 };
    orders.forEach(o => { if (summary[o.status] !== undefined) summary[o.status]++; });
    return summary;
  }
};
