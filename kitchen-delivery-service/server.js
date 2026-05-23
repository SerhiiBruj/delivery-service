const express = require('express');
const Redis = require('ioredis');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer'); 
const path = require('path');
const fs = require('fs');

const app = express();

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

app.use(express.json());
app.use('/uploads', express.static(UPLOADS_DIR));

const PORT = process.env.PORT || 8003;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/delivery_kitchen';

const mailTransport = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "sandbox.smtp.mailtrap.io",
  port: parseInt(process.env.SMTP_PORT || "2525"),
  auth: {
    user: process.env.SMTP_USER || "serhiispidey07@gmail.com",
    pass: process.env.SMTP_PASS || ""
  }
});

mongoose.connect(MONGO_URI)
  .then(() => log({ message: "Connected to MongoDB successfully" }))
  .catch(err => log({ level: "ERROR", message: "MongoDB connection failed", error: err.message }));

const redisPub = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const log = (msg) => console.log(JSON.stringify({ timestamp: new Date().toISOString(), service: "KITCHEN_DELIVERY", ...msg }));

app.get('/health', (req, res) => res.status(200).json({ status: "UP" }));


const catalogSchema = new mongoose.Schema({
  restaurantId: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  cuisine: { type: String, required: true },
  logoUrl: { type: String, default: null }, 
  menu: [{
    dishId: { type: String, required: true },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    imageUrl: { type: String, default: null }, 
    available: { type: Boolean, default: true }
  }]
}, { timestamps: true });

const kitchenTicketSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true, index: true },
  restaurantId: { type: String, required: true },
  restaurantName: { type: String, required: true },
  restaurantAddress: { type: String, default: null },
  distanceKm: { type: Number, default: null },
  items: [{
    name: { type: String, required: true },
    price: { type: Number, required: true },
    quantity: { type: Number, required: true }
  }],
  status: { 
    type: String, 
    enum: ['PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'DELIVERED'], 
    default: 'PREPARING' 
  },
  deliveryAddress: { type: String, required: true },
  customerEmail: { type: String, default: null },
  courierId: { type: String, default: null, index: true }, 
  estimatedPreparingTime: { type: Number, default: null }, 
  estimatedDeliveryTime: { type: Number, default: null }    
}, { timestamps: true });

const Catalog = mongoose.model('Catalog', catalogSchema);
const KitchenTicket = mongoose.model('KitchenTicket', kitchenTicketSchema);

const STATUS_WORKFLOW = {
  'PREPARING': { next: 'READY_FOR_PICKUP', allowedRoles: ['Restaurant Manager', 'Restaurant'] },
  'READY_FOR_PICKUP': { next: 'PICKED_UP', allowedRoles: ['Courier', 'driver'] },
  'PICKED_UP': { next: 'DELIVERED', allowedRoles: ['Courier', 'driver'] },
  'DELIVERED': { next: null, allowedRoles: [] }
};

async function sendDeliveryEmailAsync(customerEmail, orderId) {
  if (!customerEmail) {
    log({ level: "WARN", message: "Skipping email notification. No customer email registered for this ticket.", orderId });
    return;
  }
  try {
    const mailOptions = {
      from: '"Hyper Feed Delivery" <no-reply@hyperfeed2026.com>',
      to: customerEmail,
      subject: `Замовлення #${orderId} доставлено!`,
      text: `Ваше замовлення ${orderId} успішно доставлено кур'єром! Смачного!`
    };
    const info = await mailTransport.sendMail(mailOptions);
    log({ message: "Notification email dispatched successfully", orderId, recipient: customerEmail, messageId: info.messageId });
  } catch (err) {
    log({ level: "ERROR", message: "Background execution failed to deliver customer notification email", orderId, recipient: customerEmail, error: err.message });
  }
}

// --- API ENDPOINTS ---

app.get(['/', '/api/v1/catalog'], async (req, res) => {
  try {
    const catalog = await Catalog.find();
    res.status(200).json(catalog);
  } catch (err) {
    res.status(500).json({ error: "Internal error while fetching catalog" });
  }
});

app.post(['/menu', '/api/v1/catalog/menu'], async (req, res) => {
  try {
    const userRole = req.headers['x-user-role'];
    if (userRole !== 'Restaurant Manager') {
      return res.status(403).json({ error: "Access denied. Only Restaurant Managers can manage menu items." });
    }

    if (typeof req.body.menuItems === 'string') {
      try {
        req.body.menuItems = JSON.parse(req.body.menuItems);
      } catch (pErr) {
        return res.status(400).json({ error: "Failed to parse menuItems JSON string layout" });
      }
    }

    const { restaurantId, restaurantName, cuisine, menuItems, logoUrl, dishImageUrl } = req.body;
    if (!restaurantId || !menuItems || !Array.isArray(menuItems)) {
      return res.status(400).json({ error: "Invalid request payload layout parameters" });
    }

    const preparedMenuItems = menuItems.map(item => ({
      ...item,
      imageUrl: dishImageUrl || item.imageUrl || null
    }));

    const updatePayload = { 
      name: restaurantName, 
      cuisine 
    };

    if (logoUrl) {
      updatePayload.logoUrl = logoUrl;
    }

    const updatedCatalog = await Catalog.findOneAndUpdate(
      { restaurantId },
      { 
        $set: updatePayload,
        $push: { menu: { $each: preparedMenuItems } }
      },
      { upsert: true, new: true }
    );

    res.status(200).json(updatedCatalog);
  } catch (err) {
    res.status(500).json({ error: "Internal error while managing menu parameters" });
  }
});

app.get('/api/v1/kitchen/tickets', async (req, res) => {
  try {
    const tickets = await KitchenTicket.find().sort({ createdAt: -1 });
    res.status(200).json(tickets);
  } catch (err) {
    res.status(500).json({ error: "Internal error while retrieving kitchen tickets" });
  }
});

app.get('/api/v1/delivery/available-tickets', async (req, res) => {
  try {
    const userRole = req.headers['x-user-role'];
    if (userRole !== 'Courier' && userRole !== 'driver') {
      return res.status(403).json({ error: "Access denied. Only couriers can view available tickets." });
    }
    const availableTickets = await KitchenTicket.find({ status: 'READY_FOR_PICKUP', courierId: null }).sort({ updatedAt: 1 });
    res.status(200).json(availableTickets);
  } catch (err) {
    res.status(500).json({ error: "Internal error while fetching available logistics tickets" });
  }
});

app.patch('/api/v1/kitchen/tickets/:orderId/status', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status: targetStatus, estimatedPreparingTime, estimatedDeliveryTime } = req.body;
    const userRole = req.headers['x-user-role'];
    const userId = req.headers['x-user-id'];

    const ticket = await KitchenTicket.findOne({ orderId });
    if (!ticket) return res.status(404).json({ error: "Operational dispatch kitchen entity parameter key error" });

    const currentStatusConfig = STATUS_WORKFLOW[ticket.status];
    if (!currentStatusConfig || !currentStatusConfig.next) {
      return res.status(400).json({ error: `Order lifecycle already reached terminal status: ${ticket.status}` });
    }
    if (currentStatusConfig.next !== targetStatus) {
      return res.status(400).json({ error: `Invalid transition state. Cannot shift from ${ticket.status} directly to ${targetStatus}` });
    }
    if (!currentStatusConfig.allowedRoles.includes(userRole)) {
      return res.status(430).json({ error: `Role '${userRole}' is not authorized to transition order from ${ticket.status}` });
    }

    if (targetStatus === 'READY_FOR_PICKUP' && estimatedPreparingTime !== undefined) {
      ticket.estimatedPreparingTime = estimatedPreparingTime;
    }

    if (targetStatus === 'PICKED_UP') {
      if (!userId) return res.status(400).json({ error: "Missing identity metadata: x-user-id header is required" });
      ticket.courierId = userId;
      if (estimatedDeliveryTime !== undefined) ticket.estimatedDeliveryTime = estimatedDeliveryTime;
    }

    ticket.status = targetStatus;
    await ticket.save();

    log({ message: `Kitchen Ticket status shifted successfully`, orderId, targetStatus });

    await redisPub.publish('order.status_update', JSON.stringify({ 
      orderId, 
      status: targetStatus,
      courierId: ticket.courierId,
      estimatedPreparingTime: ticket.estimatedPreparingTime,
      estimatedDeliveryTime: ticket.estimatedDeliveryTime
    }));

    if (targetStatus === 'DELIVERED') {
      sendDeliveryEmailAsync(ticket.customerEmail, orderId);
    }

    if (targetStatus === 'READY_FOR_PICKUP') {
      await redisPub.publish('delivery.courier_broadcast', JSON.stringify({
        orderId,
        restaurantId: ticket.restaurantId,
        restaurantName: ticket.restaurantName,
        restaurantAddress: ticket.restaurantAddress, // Прокидуємо нове поле
        distanceKm: ticket.distanceKm,               // Прокидуємо відстань
        deliveryAddress: ticket.deliveryAddress,
        estimatedPreparingTime: ticket.estimatedPreparingTime
      }));
    }

    res.status(200).json(ticket);
  } catch (err) {
    res.status(500).json({ error: "Internal error during ticket pipeline status shift execution" });
  }
});

// --- Redis Subscriber ---
const subRedis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
subRedis.subscribe('order.paid');
subRedis.on('message', async (channel, msg) => {
  if (channel === 'order.paid') {
    try {
      const rawOrder = JSON.parse(msg);
      const existingTicket = await KitchenTicket.findOne({ orderId: rawOrder.id });
      if (existingTicket) return;

      // МОДЕРНІЗАЦІЯ: Надійно зберігаємо адресу ресторану та відстань, передані від order-service
      const newTicket = new KitchenTicket({
        orderId: rawOrder.orderId,
        restaurantId: rawOrder.restaurantId,
        restaurantName: rawOrder.restaurantName,
        restaurantAddress: rawOrder.restaurantAddress || rawOrder.deliveryAddress, // Fallback якщо поле пусте
        distanceKm: rawOrder.distanceKm !== undefined ? parseFloat(rawOrder.distanceKm) : null,
        items: rawOrder.items,
        deliveryAddress: rawOrder.deliveryAddress,
        customerEmail: rawOrder.customerEmail || null,
        status: 'PREPARING'
      });
      await newTicket.save();
    } catch (err) {
      log({ level: "ERROR", message: "Error while parsing or saving incoming paid order ticket", error: err.message });
    }
  }
});

app.listen(PORT, () => log({ message: `Kitchen Delivery Orchestrator serving static state on port ${PORT}` }));
