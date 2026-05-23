const express = require('express');
const cors = require('cors');
const { rateLimit } = require('express-rate-limit');
const RedisStore = require('rate-limit-redis').default;
const Redis = require('ioredis');
const jwt = require('jsonwebtoken');
const { createProxyMiddleware } = require('http-proxy-middleware');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8000;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_delivery_key_2026';
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';

// Налаштування локального файлового сховища для медіа-контенту на шлюзі
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Конфігурація дискового простору зберігання multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

const redisClient = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true
});

app.use(cors());
// Роздача картинок для клієнтської частини
app.use('/uploads', express.static(UPLOADS_DIR));

// Увага: Не застосовуємо express.json() глобально, щоб не ламати потоки файлів Multer!
app.get('/health', express.json(), (req, res) => {
  res.status(200).json({ status: "UP", timestamp: new Date().toISOString() });
});

// Парсимо JSON тільки для тих роутів, де точно немає завантаження файлів (запобігає отриманню пустих реквестів на сервісах)
app.use((req, res, next) => {
  if (req.originalUrl === '/api/v1/catalog/menu') {
    return next(); // Пропускаємо, бо цим займеться multer нижче
  }
  express.json()(req, res, next);
});

app.use((req, res, next) => {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    context: "API_GATEWAY",
    method: req.method,
    url: req.url,
    ip: req.ip
  }));
  next();
});

const limiter = rateLimit({
  windowMs: 60 * 1000, 
  max: 120, 
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.user ? `rate_limit:user:${req.user.id}` : `rate_limit:ip:${req.ip}`;
  },
  store: new RedisStore({
    sendCommand: (...args) => redisClient.call(...args),
    prefix: 'gw:',
  }),
  handler: (req, res) => {
    res.status(429).json({ error: "Too many requests. Please try again later." });
  }
});

const publicRoutes = [
  '/api/v1/users/register', 
  '/api/v1/users/login', 
  '/api/v1/users/refresh', 
  '/api/v1/catalog',
  '/uploads' 
];

const authenticateToken = (req, res, next) => {
  if (publicRoutes.some(route => req.path.startsWith(route))) return next();
  
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: "Access token missing or unprovided" });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: "Invalid or expired token security check failed" });
    req.user = user;
    req.headers['x-user-id'] = user.id;
    req.headers['x-user-role'] = user.role;
    next();
  });
};

app.use(authenticateToken);
app.use(limiter);

// --- МІДЛВАР ПЕРЕХОПЛЕННЯ ФАЙЛІВ ПЕРЕД ПРОКСУВАННЯМ ---
app.post('/api/v1/catalog/menu', upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'dishImage', maxCount: 1 }]), (req, res, next) => {
  if (req.files) {
    if (req.files['logo'] && req.files['logo'][0]) {
      req.body.logoUrl = `/uploads/${req.files['logo'][0].filename}`;
    }
    if (req.files['dishImage'] && req.files['dishImage'][0]) {
      req.body.dishImageUrl = `/uploads/${req.files['dishImage'][0].filename}`;
    }
  }
  next();
});

// МОДЕРНІЗАЦІЯ МАРШРУТІВ: Додано префікс логістики /api/v1/delivery
const proxies = {
  '/api/v1/users': process.env.USER_SERVICE_URL || 'http://user-catalog-service:8001',
  '/api/v1/orders': process.env.ORDER_SERVICE_URL || 'http://order-service:8002',
  '/api/v1/kitchen': process.env.KITCHEN_SERVICE_URL || 'http://kitchen-delivery-service:8003',
  '/api/v1/catalog': process.env.KITCHEN_SERVICE_URL || 'http://kitchen-delivery-service:8003',
  '/api/v1/delivery': process.env.KITCHEN_SERVICE_URL || 'http://kitchen-delivery-service:8003', // Оновлений логістичний міст
};

Object.entries(proxies).forEach(([path, target]) => {
  app.use(path, createProxyMiddleware({
    target,
    changeOrigin: true,
    pathRewrite: async (pathStr, req) => req.originalUrl || pathStr, 
    logger: console,
    on: {
      proxyReq: (proxyReq, req, res) => {
        // Надійно пакуємо JSON тіло назад у потік мікросервісу
        if (req.body && Object.keys(req.body).length) {
          const bodyData = JSON.stringify(req.body);
          proxyReq.setHeader('Content-Type', 'application/json');
          proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
          proxyReq.write(bodyData);
        }
      }
    }
  }));
});

app.listen(PORT, () => {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), context: "API_GATEWAY", message: `Gateway operational on port ${PORT}` }));
});