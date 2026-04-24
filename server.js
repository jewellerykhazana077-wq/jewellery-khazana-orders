const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'jewellery-khazana-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

const requireAuth = (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.session.user || req.session.user.role !== 'admin')
    return res.status(403).json({ error: 'Admin access required' });
  next();
};

// Auth
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const user = db.getUserByUsername(username.trim());
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Invalid username or password' });

  req.session.user = { id: user.id, username: user.username, role: user.role };
  res.json({ user: req.session.user });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  res.json({ user: req.session.user });
});

// Orders - export must come before /:id
app.get('/api/orders/export', requireAuth, async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  const user = req.session.user;

  if (user.role === 'employee') {
    const now = new Date();
    if (now.getHours() < 21)
      return res.status(403).json({ error: 'Excel export is available only after 9:00 PM for employees.' });
  }

  const orders = db.getOrdersByDate(date);
  const summary = db.getOrdersSummary(date);

  const statusLabels = {
    unprocessed: 'Unprocessed',
    processing: 'Processing',
    not_colored: 'Not Dispatched – Not In Color',
    raw_material: 'Not Dispatched – Raw Material Not In Stock',
    dispatched: 'Dispatched'
  };

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Jewellery Khazana';
  workbook.created = new Date();

  // Summary sheet
  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [
    { header: 'Category', key: 'category', width: 42 },
    { header: 'Count', key: 'count', width: 10 }
  ];
  summarySheet.getRow(1).font = { bold: true, size: 12 };
  summarySheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD700' } };
  summarySheet.addRow({ category: 'Total Orders', count: summary.total });
  summarySheet.addRow({ category: 'Unprocessed', count: summary.unprocessed });
  summarySheet.addRow({ category: 'Processing', count: summary.processing });
  summarySheet.addRow({ category: 'Not Dispatched – Not In Color', count: summary.not_colored });
  summarySheet.addRow({ category: 'Not Dispatched – Raw Material Not In Stock', count: summary.raw_material });
  summarySheet.addRow({ category: 'Dispatched', count: summary.dispatched });

  // Orders sheet
  const sheet = workbook.addWorksheet('Orders ' + date);
  sheet.columns = [
    { header: '#', key: 'num', width: 6 },
    { header: 'Order Date', key: 'order_date', width: 14 },
    { header: 'Order Number', key: 'order_number', width: 22 },
    { header: 'Product Image URL', key: 'product_image_url', width: 45 },
    { header: 'Status', key: 'status_label', width: 42 },
    { header: 'AWB Number', key: 'awb_number', width: 20 },
    { header: 'Recorded By', key: 'created_by_name', width: 18 },
    { header: 'Last Updated By', key: 'last_updated_by_name', width: 18 },
    { header: 'Created At', key: 'created_at', width: 20 }
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, size: 11, color: { argb: '2D1B2E' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'D4AF37' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.getRow(1).height = 22;

  const statusColors = {
    unprocessed: 'BDBDBD',
    processing: 'BBDEFB',
    not_colored: 'FFE0B2',
    raw_material: 'FFCDD2',
    dispatched: 'C8E6C9'
  };

  orders.forEach((order, i) => {
    const row = sheet.addRow({
      num: i + 1,
      order_date: order.order_date,
      order_number: order.order_number,
      product_image_url: order.product_image_url || '',
      status_label: statusLabels[order.status] || order.status,
      awb_number: order.awb_number || '',
      created_by_name: order.created_by_name || '',
      last_updated_by_name: order.last_updated_by_name || '',
      created_at: order.created_at
    });
    const color = statusColors[order.status] || 'FFFFFF';
    row.getCell('status_label').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
    row.getCell('status_label').font = { bold: true };
    row.alignment = { vertical: 'middle' };
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Jewellery-Khazana-Orders-${date}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
});

app.get('/api/orders/summary', requireAuth, (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  res.json(db.getOrdersSummary(date));
});

app.get('/api/orders', requireAuth, (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  res.json(db.getOrdersByDate(date));
});

app.post('/api/orders', requireAuth, (req, res) => {
  const { order_date, order_number, product_image_url, status, awb_number } = req.body;
  if (!order_date || !order_number || !status)
    return res.status(400).json({ error: 'Order date, order number, and status are required.' });

  if (status === 'dispatched' && !awb_number)
    return res.status(400).json({ error: 'AWB number is required for dispatched orders.' });

  const order = db.createOrder({
    order_date,
    order_number: order_number.trim(),
    product_image_url,
    status,
    awb_number: status === 'dispatched' ? awb_number : null,
    created_by: req.session.user.id,
    created_by_name: req.session.user.username
  });
  res.json(order);
});

app.put('/api/orders/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const user = req.session.user;
  const existing = db.getOrderById(id);
  if (!existing) return res.status(404).json({ error: 'Order not found' });

  const { order_date, order_number, product_image_url, status, awb_number } = req.body;

  if (!status) return res.status(400).json({ error: 'Status is required.' });
  if (status === 'dispatched' && !awb_number)
    return res.status(400).json({ error: 'AWB number is required for dispatched orders.' });

  const awb = status === 'dispatched' ? awb_number : null;

  // Status-only update: no order_date/order_number in body (used by Change Status modal for both roles)
  if (!order_date || !order_number) {
    db.updateOrderStatus(id, status, awb, user.id, user.username);
  } else if (user.role === 'admin') {
    // Full edit: admin only
    db.updateOrder(id, { order_date, order_number, product_image_url, status, awb_number: awb }, user.id, user.username);
  } else {
    // Employee tried to send full edit fields — only allow status update
    db.updateOrderStatus(id, status, awb, user.id, user.username);
  }

  res.json(db.getOrderById(id));
});

// Users (admin only)
app.get('/api/users', requireAdmin, (req, res) => {
  res.json(db.getAllUsers());
});

app.post('/api/users', requireAdmin, (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !role)
    return res.status(400).json({ error: 'Username, password and role are required.' });
  if (!['admin', 'employee'].includes(role))
    return res.status(400).json({ error: 'Role must be admin or employee.' });

  try {
    const hashed = bcrypt.hashSync(password, 10);
    const user = db.createUser({ username: username.trim(), password: hashed, role });
    res.json(user);
  } catch {
    res.status(400).json({ error: 'Username already exists.' });
  }
});

app.delete('/api/users/:id', requireAdmin, (req, res) => {
  if (parseInt(req.params.id) === req.session.user.id)
    return res.status(400).json({ error: 'Cannot delete your own account.' });
  db.deleteUser(req.params.id);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`\n✨ Jewellery Khazana Order Dashboard`);
  console.log(`   Running at: http://localhost:${PORT}`);
  console.log(`   Default login → admin / Admin@123\n`);
});
