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
  secret: process.env.SESSION_SECRET || 'jewellery-khazana-secret-key-2024',
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

// ── AUTH ──
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    const user = await db.getUserByUsername(username.trim());
    if (!user || !bcrypt.compareSync(password, user.password))
      return res.status(401).json({ error: 'Invalid username or password' });
    req.session.user = { id: user.id, username: user.username, role: user.role };
    res.json({ user: req.session.user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  res.json({ user: req.session.user });
});

// ── EXPORT (must be before /:id) ──
app.get('/api/orders/export', requireAuth, async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    if (req.session.user.role === 'employee' && new Date().getHours() < 21)
      return res.status(403).json({ error: 'Excel export is available only after 9:00 PM for employees.' });

    const [orders, summary] = await Promise.all([
      db.getOrdersByDate(date),
      db.getOrdersSummary(date)
    ]);

    const statusLabels = {
      unprocessed: 'Unprocessed',
      processing: 'Processing',
      not_colored: 'Not Dispatched – Not In Color',
      raw_material: 'Not Dispatched – Raw Material Not In Stock',
      dispatched: 'Dispatched'
    };

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Jewellery Khazana';

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
    const hRow = sheet.getRow(1);
    hRow.font = { bold: true, size: 11 };
    hRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'D4AF37' } };
    hRow.height = 22;

    const statusColors = { unprocessed: 'BDBDBD', processing: 'BBDEFB', not_colored: 'FFE0B2', raw_material: 'FFCDD2', dispatched: 'C8E6C9' };
    orders.forEach((o, i) => {
      const row = sheet.addRow({
        num: i + 1, order_date: o.order_date, order_number: o.order_number,
        product_image_url: o.product_image_url || '',
        status_label: statusLabels[o.status] || o.status,
        awb_number: o.awb_number || '',
        created_by_name: o.created_by_name || '',
        last_updated_by_name: o.last_updated_by_name || '',
        created_at: o.created_at
      });
      row.getCell('status_label').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: statusColors[o.status] || 'FFFFFF' } };
      row.getCell('status_label').font = { bold: true };
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Jewellery-Khazana-Orders-${date}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/orders/summary', requireAuth, async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    res.json(await db.getOrdersSummary(date));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/orders', requireAuth, async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    res.json(await db.getOrdersByDate(date));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/orders', requireAuth, async (req, res) => {
  try {
    const { order_date, order_number, product_image_url, status, awb_number } = req.body;
    if (!order_date || !order_number || !status)
      return res.status(400).json({ error: 'Order date, order number, and status are required.' });
    if (status === 'dispatched' && !awb_number)
      return res.status(400).json({ error: 'AWB number is required for dispatched orders.' });

    const order = await db.createOrder({
      order_date, order_number: order_number.trim(), product_image_url,
      status, awb_number: status === 'dispatched' ? awb_number : null,
      created_by: req.session.user.id, created_by_name: req.session.user.username
    });
    res.json(order);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/orders/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.session.user;
    const existing = await db.getOrderById(id);
    if (!existing) return res.status(404).json({ error: 'Order not found' });

    const { order_date, order_number, product_image_url, status, awb_number } = req.body;
    if (!status) return res.status(400).json({ error: 'Status is required.' });
    if (status === 'dispatched' && !awb_number)
      return res.status(400).json({ error: 'AWB number is required for dispatched orders.' });

    const awb = status === 'dispatched' ? awb_number : null;
    if (!order_date || !order_number) {
      await db.updateOrderStatus(id, status, awb, user.id, user.username);
    } else if (user.role === 'admin') {
      await db.updateOrder(id, { order_date, order_number, product_image_url, status, awb_number: awb }, user.id, user.username);
    } else {
      await db.updateOrderStatus(id, status, awb, user.id, user.username);
    }
    res.json(await db.getOrderById(id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── USERS ──
app.get('/api/users', requireAdmin, async (req, res) => {
  try { res.json(await db.getAllUsers()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users', requireAdmin, async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password || !role)
      return res.status(400).json({ error: 'Username, password and role are required.' });
    if (!['admin', 'employee'].includes(role))
      return res.status(400).json({ error: 'Role must be admin or employee.' });
    const hashed = bcrypt.hashSync(password, 10);
    const user = await db.createUser({ username: username.trim(), password: hashed, role });
    res.json(user);
  } catch (e) {
    if (e.code === 11000) return res.status(400).json({ error: 'Username already exists.' });
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/users/:id', requireAdmin, async (req, res) => {
  try {
    if (req.params.id === req.session.user.id)
      return res.status(400).json({ error: 'Cannot delete your own account.' });
    await db.deleteUser(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── START ──
db.connect().then(() => {
  app.listen(PORT, () => {
    console.log(`\n✨ Jewellery Khazana Order Dashboard`);
    console.log(`   Running at: http://localhost:${PORT}`);
    console.log(`   Default login → admin / Admin@123\n`);
  });
}).catch(err => {
  console.error('Failed to connect to MongoDB:', err.message);
  process.exit(1);
});
