const express = require('express');
const Redis = require('ioredis');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 8002;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/delivery_orders';
const ORS_API_KEY = process.env.ORS_API_KEY || 'YOUR_OPENROUTESERVICE_API_KEY';

mongoose.connect(MONGO_URI)
  .then(() => log({ message: "Connected to MongoDB successfully" }))
  .catch(err => log({ level: "ERROR", message: "MongoDB connection failed", error: err.message }));

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

const log = (msg) => {
  const sanitized = { ...msg };
  if (sanitized.payload && sanitized.payload.paymentCardMock) {
    sanitized.payload.paymentCardMock = { cardNumber: "[REDACTED]", cvv: "***" };
  }
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), service: "ORDER_SERVICE", ...sanitized }));
};
app.get('/health', (req, res) => res.status(200).json({ status: "UP" }));

// --- СХЕМА ДАНИХ (Модернізована денормалізація під медіа) ---

const orderSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  paymentMethod: { type: String, enum: ['CARD', 'CASH'], default: 'CARD' },
  paymentStatus: { type: String, enum: ['PENDING', 'SUCCESS', 'FAILED'], default: 'PENDING' },
  restaurantId: { type: String, required: true },
  restaurantName: { type: String, required: true },
  logoUrl: { type: String, default: null }, // МОДЕРНІЗАЦІЯ: Збереження логотипу в замовленні
  items: [{
    id: { type: String }, // dishId
    name: { type: String, required: true },
    price: { type: Number, required: true },
    quantity: { type: Number, required: true },
    imageUrl: { type: String, default: null } // МОДЕРНІЗАЦІЯ: Збереження фото страви в замовленні
  }],
  total: { type: Number, required: true },
  deliveryAddress: { type: String, required: true },
  deliveryCoords: {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true }
  },
  distanceKm: { type: Number, required: true },
  status: { type: String, enum: ['PAID', 'ACCEPTED', 'COOKING', 'READY', 'DELIVERING', 'DELIVERED', 'CANCELLED_REFUNDED'], default: 'PAID' },
  estimatedPreparingTime: { type: Number, default: null },
  estimatedDeliveryTime: { type: Number, default: null },
  timestamp: { type: Date, default: Date.now }
}, { timestamps: true });

const Order = mongoose.model('Order', orderSchema);

// --- ГЕО-МАТЕМАТИКА ТА КАРТОГРАФІЯ ---

function calculateHaversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  return parseFloat(distance.toFixed(2));
}

async function getRoadDistance(restaurantCoords, deliveryCoords) {
  try {
    const queryUrl = `https://api.openrouteservice.org/v2/directions/driving-car`;

    const response = await fetch(queryUrl, {
      method: 'POST',
      headers: {
        'Authorization': ORS_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        coordinates: [
          [restaurantCoords.lng, restaurantCoords.lat],
          [deliveryCoords.lng, deliveryCoords.lat]
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`ORS API returned status ${response.status}`);
    }

    const data = await response.json();
    const distanceMeters = data.routes[0].summary.distance;
    const distanceKm = distanceMeters / 1000;

    log({ message: "Distance calculated via OpenRouteService successfully", distanceKm });
    return parseFloat(distanceKm.toFixed(2));

  } catch (error) {
    const straightLineDistance = calculateHaversineDistance(
      restaurantCoords.lat, restaurantCoords.lng,
      deliveryCoords.lat, deliveryCoords.lng
    );
    const estimatedRoadDistance = parseFloat((straightLineDistance * 1.3).toFixed(2));

    log({
      level: "WARN",
      message: "OpenRouteService failed. Applied Haversine fallback with road multiplier.",
      error: error.message,
      estimatedRoadDistance
    });

    return estimatedRoadDistance;
  }
}

async function publishWithRetry(channel, payload, retries = 5, delay = 100) {
  try {
    await redis.publish(channel, JSON.stringify(payload));
  } catch (err) {
    if (retries === 0) {
      log({ level: "ERROR", message: `Failed to publish to channel ${channel} after max retries`, error: err.message, payload });
      return;
    }
    log({ level: "WARN", message: `Redis publish failed, retrying in ${delay}ms...`, error: err.message, retriesLeft: retries });
    await new Promise(resolve => setTimeout(resolve, delay));
    return publishWithRetry(channel, payload, retries - 1, delay * 2);
  }
}

const idempotencyGuard = async (req, res, next) => {
  if (req.method !== 'POST') return next();
  const idempotencyKey = req.headers['x-idempotency-key'];
  if (!idempotencyKey) return next();

  const cacheKey = `idempotency:${idempotencyKey}`;

  try {
    const locked = await redis.set(cacheKey, "PROCESSING", "NX", "EX", 60);

    if (!locked) {
      const value = await redis.get(cacheKey);
      if (value === "PROCESSING") {
        return res.status(409).json({ error: "Concurrent transaction processing ongoing. Retry shortly." });
      }
      if (value) {
        return res.status(200).json(JSON.parse(value));
      }
      return res.status(409).json({ error: "Transaction conflict. Please try again." });
    }

    req.idempotencyCacheKey = cacheKey;

    const originalJson = res.json;
    res.json = function (data) {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        redis.set(req.idempotencyCacheKey, JSON.stringify(data), "EX", 86400);
      } else {
        redis.del(req.idempotencyCacheKey);
      }
      return originalJson.call(this, data);
    };
    next();
  } catch (err) {
    log({ level: "ERROR", message: "Idempotency guard internal error", error: err.message });
    next();
  }
};

// --- API ENDPOINTS ДЛЯ КОШИКА ---

app.post('/api/v1/cart', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: "Unauthorized: Missing x-user-id identity context header" });

    const { items } = req.body;
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: "Invalid payload layout. 'items' array field is strictly required" });
    }

    const totalPrice = items.reduce((sum, item) => sum + (parseFloat(item.price || 0) * parseInt(item.quantity || 0)), 0);

    const cartData = {
      userId,
      items, // Сюди автоматично входять imageUrl страв, збережені фронтендом
      totalPrice: parseFloat(totalPrice.toFixed(2)),
      updatedAt: new Date().toISOString()
    };

    const cartKey = `cart:${userId}`;
    await redis.set(cartKey, JSON.stringify(cartData), "EX", 86400);

    res.status(200).json(cartData);
  } catch (err) {
    log({ level: "ERROR", message: "Cache write state failure within shopping cart component", error: err.message });
    res.status(500).json({ error: "Internal error during cart state storage modification" });
  }
});

app.get('/api/v1/cart', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: "Unauthorized: Missing identity metadata" });

    const cartKey = `cart:${userId}`;
    const rawCart = await redis.get(cartKey);

    if (!rawCart) {
      return res.status(200).json({ userId, items: [], totalPrice: 0, status: "EMPTY" });
    }

    res.status(200).json(JSON.parse(rawCart));
  } catch (err) {
    log({ level: "ERROR", message: "Failed to fetch cart state from core Redis cache layer", error: err.message });
    res.status(500).json({ error: "Internal error during cart payload extraction" });
  }
});

app.delete('/api/v1/cart', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: "Unauthorized context execution path" });

    const cartKey = `cart:${userId}`;
    await redis.del(cartKey);

    res.status(200).json({ status: "SUCCESS", message: "Shopping cart state purged entirely" });
  } catch (err) {
    log({ level: "ERROR", message: "Purge transactional command execution failed in Redis engine", error: err.message });
    res.status(500).json({ error: "Internal error during cart pipeline reset execution" });
  }
});

// --- API ENDPOINTS ДЛЯ ЗАМОВЛЕНЬ ---

app.post('/api/v1/orders', idempotencyGuard, async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || 'anonymous';
    const { items, restaurantId, restaurantName, restaurantAddress, deliveryAddress, deliveryCoords, paymentMethod, paymentCardMock, restaurantCoords } = req.body;
    if (!items || items.length === 0) return res.status(400).json({ error: "Basket is empty" });
    const finalRestaurantAddress = restaurantAddress || "Адреса не вказана";

    // Бізнес-валідація оплати (FR6.01)
    let paymentStatus = 'PENDING';
    if (paymentMethod === 'CARD') {
      if (!paymentCardMock || !paymentCardMock.cardNumber || !paymentCardMock.cvv) {
        return res.status(400).json({ error: "Card details required" });
      }
      if (paymentCardMock.cardNumber.startsWith('4000')) {
        paymentStatus = 'SUCCESS';
      } else {
        return res.status(400).json({ error: "Payment Verification Failed" });
      }
    } else {
      paymentStatus = 'SUCCESS'; // CASH
    }

    const total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const distanceKm = await getRoadDistance(restaurantCoords, deliveryCoords);

    const newOrder = new Order({
      userId, restaurantId, restaurantName, items, total,
      deliveryAddress, deliveryCoords, distanceKm,
      paymentMethod,
      paymentStatus,
      status: paymentStatus === 'SUCCESS' ? 'PAID' : 'PENDING'
    });

    await newOrder.save();

    // Лог з маскуванням (NFR-S3)
    log({ message: "Order processed", orderId: newOrder._id, payload: { paymentCardMock } });

    await publishWithRetry('order.paid', {
      orderId: newOrder._id.toString(), 
      restaurantId: newOrder.restaurantId,
      restaurantName: newOrder.restaurantName,
      restaurantAddress:finalRestaurantAddress,
      items: newOrder.items,
      deliveryAddress: newOrder.deliveryAddress,
      distanceKm: newOrder.distanceKm,
      // Додай customerEmail, якщо він є, бо кухня його очікує
      customerEmail: req.body.customerEmail || null
    });
    res.status(201).json(newOrder);
  } catch (err) {
    log({ level: "ERROR", message: "Order error", error: err.message });
    res.status(500).json({ error: "Internal error" });
  }
});

app.get('/api/v1/orders/track/:orderId', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.orderId)) {
      return res.status(400).json({ error: "Invalid tracking order ID formatting" });
    }

    const order = await Order.findById(req.params.orderId);
    if (!order) return res.status(404).json({ error: "Target payload order tracking parameters not found" });

    res.status(200).json(order);
  } catch (err) {
    res.status(500).json({ error: "Internal error during tracking query" });
  }
});

app.get('/api/v1/orders/customer', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: "Unauthorized downstream context missing" });

    const customerOrders = await Order.find({ userId }).sort({ timestamp: -1 });
    res.status(200).json(customerOrders);
  } catch (err) {
    res.status(500).json({ error: "Internal error while fetching customer history" });
  }
});

// --- Redis Subscriber ---
const subRedis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
subRedis.subscribe('order.status_update', (err) => {
  if (err) log({ level: "ERROR", message: "Failed to subscribe to order.status_update", error: err.message });
});

subRedis.on('message', async (channel, message) => {
  if (channel === 'order.status_update') {
    try {
      const { orderId, status, estimatedPreparingTime, estimatedDeliveryTime } = JSON.parse(message);
      if (!mongoose.Types.ObjectId.isValid(orderId)) return;

      const updateFields = { status: status };

      if (estimatedPreparingTime !== undefined && estimatedPreparingTime !== null) {
        updateFields.estimatedPreparingTime = estimatedPreparingTime;
      }
      if (estimatedDeliveryTime !== undefined && estimatedDeliveryTime !== null) {
        updateFields.estimatedDeliveryTime = estimatedDeliveryTime;
      }

      const updatedOrder = await Order.findByIdAndUpdate(
        orderId,
        { $set: updateFields },
        { new: true }
      );

      if (updatedOrder) {
        log({
          message: `Internal localized state machine updated status and timings sync successful for ${orderId}`,
          updatedStatus: status,
          estimatedPreparingTime: updatedOrder.estimatedPreparingTime,
          estimatedDeliveryTime: updatedOrder.estimatedDeliveryTime
        });
      }
    } catch (parseErr) {
      log({ level: "ERROR", message: "Failed to process incoming subscriber status update event", error: parseErr.message });
    }
  }
});

app.listen(PORT, () => log({ message: `Order Management service active on ${PORT}` }));