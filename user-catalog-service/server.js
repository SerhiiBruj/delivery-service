const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
app.use('/uploads', express.static(UPLOADS_DIR));

const PORT = process.env.PORT || 8001;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/delivery_users';
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_delivery_key_2026';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'super_secret_refresh_key_2026';

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Only image files are allowed!'), false);
    }
};

const upload = multer({ storage, fileFilter });

mongoose.connect(MONGO_URI)
    .then(() => console.log(JSON.stringify({ timestamp: new Date().toISOString(), service: "USER_CATALOG", message: "Connected to MongoDB" })))
    .catch(err => console.error(JSON.stringify({ timestamp: new Date().toISOString(), service: "USER_CATALOG", error: "DB connection failed: " + err.message })));

// --- СХЕМИ ДАНИХ (Mongoose Models) ---

const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    password: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    role: {
        type: String,
        enum: ['Customer', 'Restaurant', 'Restaurant Manager', 'Courier', 'admin'],
        default: 'Customer'
    },
    refreshToken: { type: String, default: null }
}, { timestamps: true });

const menuItemSchema = new mongoose.Schema({
    dishId: { type: String, required: true },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    available: { type: Boolean, default: true },
    imageUrl: { type: String, default: null }
});

const restaurantCatalogSchema = new mongoose.Schema({
    restaurantId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    cuisine: { type: String, required: true },
    address: { type: String, required: true },
    coords: {
        lat: { type: Number, default: 48.9226 },
        lng: { type: Number, default: 24.6393 }
    },
    logoUrl: { type: String, default: null },
    menu: [menuItemSchema]
}, { timestamps: true });

const RestaurantCatalog = mongoose.model('RestaurantCatalog', restaurantCatalogSchema);

const addressSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    street: { type: String, required: true },
    city: { type: String, required: true },
    postalCode: { type: String, required: true },
    isDefault: { type: Boolean, default: false }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
const Address = mongoose.model('Address', addressSchema);

// МОДЕРНІЗАЦІЯ FALLBACK БАЗИ: Додано реалістичні посилання на заглушки медіафайлів
const catalogDb = [
    {
        restaurantId: "r1",
        name: "Pizzeria Paradiso",
        cuisine: "Italian",
        logoUrl: "/uploads/default-logo.png",
        menu: [
            { dishId: "m1", name: "Margherita", price: 12.99, imageUrl: "/uploads/default-dish.png", available: true },
            { dishId: "m2", name: "Pepperoni", price: 14.99, imageUrl: "/uploads/default-dish.png", available: true }
        ]
    },
    {
        restaurantId: "r2",
        name: "Wok Express",
        cuisine: "Asian",
        logoUrl: "/uploads/default-logo.png",
        menu: [
            { dishId: "m3", name: "Pad Thai", price: 11.50, imageUrl: "/uploads/default-dish.png", available: true },
            { dishId: "m4", name: "Spring Rolls", price: 5.99, imageUrl: "/uploads/default-dish.png", available: true }
        ]
    }
];

function sanitizeDataForLog(data) {
    if (!data) return null;
    const sanitized = { ...data };
    const sensitiveKeys = ['password', 'phone', 'telephone', 'mobile', 'accessToken', 'refreshToken', 'token'];

    sensitiveKeys.forEach(key => {
        if (key in sanitized) sanitized[key] = '[REDACTED_FOR_SECURITY]';
    });
    return sanitized;
}

const log = (msg) => {
    const sanitizedMsg = { ...msg };
    if (sanitizedMsg.body) sanitizedMsg.body = sanitizeDataForLog(sanitizedMsg.body);

    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        service: "USER_CATALOG",
        ...sanitizedMsg
    }));
};

app.use((req, res, next) => {
    log({ method: req.method, url: req.url, body: req.body });
    next();
});

function generateTokenPair(user) {
    const accessToken = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '15m' });
    const refreshToken = jwt.sign({ id: user.id }, JWT_REFRESH_SECRET, { expiresIn: '7d' });
    return { accessToken, refreshToken };
}

app.get('/health', (req, res) => res.status(200).json({ status: "UP" }));

// --- API ENDPOINTS ---

app.post('/api/v1/users/register', async (req, res) => {
    let createdUser = null;
    let createdAddress = null;
    let createdCatalog = null;
    let session = null;

    try {
        const { email, password, name, phone, role, restaurantName, cuisine, street, city, postalCode } = req.body;

        if (!email || !password || !name || !phone) {
            return res.status(400).json({ error: "Email, password, name and phone are required" });
        }

        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) return res.status(400).json({ error: "User already registered" });

        let finalRole = role || 'Customer';
        const lowerRole = finalRole.toLowerCase();
        if (lowerRole.includes('manager') || lowerRole === 'restaurant') {
            finalRole = 'Restaurant Manager';
        } else if (lowerRole === 'courier') {
            finalRole = 'Courier';
        } else if (lowerRole === 'customer') {
            finalRole = 'Customer';
        } else if (lowerRole === 'admin') {
            finalRole = 'admin';
        }

        if (finalRole === 'Restaurant Manager') {
            if (!restaurantName || !cuisine || !street || !city || !postalCode) {
                return res.status(400).json({
                    error: "For Restaurant Manager role, restaurant metadata and address fields are strictly required."
                });
            }
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        try {
            session = await mongoose.startSession();
            session.startTransaction();
        } catch (sessionErr) {
            session = null;
            log({ warning: "Mongoose sessions are only supported on Replica Sets. Falling back to sequential creation." });
        }

        const userPayload = { email, password: hashedPassword, name, phone, role: finalRole };
        if (session) {
            [createdUser] = await User.create([userPayload], { session });
        } else {
            createdUser = new User(userPayload);
            await createdUser.save();
        }

        let responseData = {
            id: createdUser._id,
            email: createdUser.email,
            name: createdUser.name,
            phone: createdUser.phone,
            role: createdUser.role
        };

        if (finalRole === 'Restaurant Manager') {
            const userId = createdUser._id;

            const addressPayload = { userId, street, city, postalCode, isDefault: true };
            if (session) {
                [createdAddress] = await Address.create([addressPayload], { session });
            } else {
                createdAddress = new Address(addressPayload);
                await createdAddress.save();
            }

            const catalogPayload = {
                restaurantId: userId.toString(),
                name: restaurantName,
                cuisine,
                address: `${street}, ${city}, ${postalCode}`,
                coords: req.body.coords || { lat: 48.9226, lng: 24.6393 }, // Додати це!
                menu: [],
                logoUrl: null
            };
            if (session) {
                [createdCatalog] = await RestaurantCatalog.create([catalogPayload], { session });
            } else {
                createdCatalog = new RestaurantCatalog(catalogPayload);
                await createdCatalog.save();
            }

            responseData.restaurantProfile = {
                restaurantId: createdCatalog.restaurantId,
                name: createdCatalog.name,
                cuisine: createdCatalog.cuisine,
                logoUrl: createdCatalog.logoUrl,
                menu: createdCatalog.menu
            };
            responseData.address = {
                id: createdAddress._id,
                street: createdAddress.street,
                city: createdAddress.city,
                postalCode: createdAddress.postalCode,
                isDefault: createdAddress.isDefault
            };
        }

        if (session) {
            await session.commitTransaction();
            session.endSession();
        }

        log({ message: "User registered successfully with profile hooks", userId: createdUser._id, normaliseRole: finalRole });
        res.status(201).json(responseData);

    } catch (err) {
        if (session) {
            await session.abortTransaction();
            session.endSession();
        } else {
            log({ error: "Registration transaction failed. Initiating manual rollback sequence.", details: err.message });
            try {
                if (createdCatalog) await RestaurantCatalog.deleteOne({ _id: createdCatalog._id });
                if (createdAddress) await Address.deleteOne({ _id: createdAddress._id });
                if (createdUser) await User.deleteOne({ _id: createdUser._id });
            } catch (rollbackErr) {
                console.error(JSON.stringify({
                    timestamp: new Date().toISOString(),
                    service: "USER_CATALOG",
                    critical: "Manual rollback failed!",
                    error: rollbackErr.message
                }));
            }
        }
        res.status(500).json({ error: "Internal error during registration: " + err.message });
    }
});

app.post('/api/v1/users/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: "Invalid email credentials or verification mismatch" });
        }

        const tokens = generateTokenPair(user);
        user.refreshToken = tokens.refreshToken;
        await user.save();

        // МОДЕРНІЗАЦІЯ: Шукаємо профіль ресторану, якщо користувач — менеджер
        let restaurantProfile = null;
        if (user.role === 'Restaurant Manager') {
            const catalog = await RestaurantCatalog.findOne({ restaurantId: user._id.toString() });
            if (catalog) {
                restaurantProfile = {
                    restaurantId: catalog.restaurantId,
                    name: catalog.name,
                    cuisine: catalog.cuisine,
                    address: catalog.address, 
                    coords: catalog.coords,
                    logoUrl: catalog.logoUrl,
                    menu: catalog.menu
                };
            }
        }

        res.status(200).json({
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            user: {
                id: user._id,
                email: user.email,
                name: user.name,
                phone: user.phone,
                role: user.role,
                restaurantProfile // Передаємо заповнений профіль на фронтенд
            }
        });
    } catch (err) {
        res.status(500).json({ error: "Internal error during authentication: " + err.message });
    }
});

app.post('/api/v1/users/refresh', async (req, res) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) return res.status(400).json({ error: "Refresh token is missing" });

        jwt.verify(refreshToken, JWT_REFRESH_SECRET, async (err, decoded) => {
            if (err) return res.status(403).json({ error: "Invalid or expired refresh token" });

            const user = await User.findById(decoded.id);
            if (!user || user.refreshToken !== refreshToken) {
                return res.status(403).json({ error: "Refresh token session mismatch or revoked" });
            }

            const tokens = generateTokenPair(user);
            user.refreshToken = tokens.refreshToken;
            await user.save();

            res.status(200).json({
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken
            });
        });
    } catch (err) {
        res.status(500).json({ error: "Internal error during token refresh" });
    }
});

app.post('/api/v1/users/address', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        if (!userId) return res.status(401).json({ error: "Unauthorized endpoint access" });

        const { street, city, postalCode, isDefault } = req.body;

        if (isDefault === true) {
            await Address.updateMany({ userId }, { isDefault: false });
        }

        const addressRecord = new Address({ userId, street, city, postalCode, isDefault: isDefault || false });
        await addressRecord.save();

        res.status(201).json(addressRecord);
    } catch (err) {
        res.status(500).json({ error: "Internal error while saving address" });
    }
});

app.get('/api/v1/users/address', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        if (!userId) return res.status(401).json({ error: "Unauthorized endpoint access" });

        const userAddresses = await Address.find({ userId });
        res.status(200).json(userAddresses);
    } catch (err) {
        res.status(500).json({ error: "Internal error while fetching addresses" });
    }
});

app.delete('/api/v1/users/profile', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        if (!userId) return res.status(401).json({ error: "Unauthorized endpoint access" });

        await Address.deleteMany({ userId });
        const userDeleted = await User.findByIdAndDelete(userId);

        if (!userDeleted) return res.status(404).json({ error: "User account not found" });

        log({ message: "Account and personal data completely purged", userId });
        res.status(200).json({ message: "Account and all associated records permanently deleted (GDPR compliant)" });
    } catch (err) {
        res.status(500).json({ error: "Internal error during account purging" });
    }
});

app.post('/api/v1/catalog/menu', upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'dishImage', maxCount: 1 }]), async (req, res) => {
    try {
        const userRole = req.headers['x-user-role'];
        log({ message: "Evaluating authorization metadata for menu creation", receivedRole: userRole });

        let { restaurantId, restaurantName, cuisine, menuItems, logoUrl, imageUrl } = req.body;

        if (typeof menuItems === 'string') {
            try { menuItems = JSON.parse(menuItems); } catch (e) { menuItems = []; }
        }

        // Обробка відносних шляхів для збереження сумісності проксі-шлюзу
        if (req.files) {
            if (req.files['logo'] && req.files['logo'][0]) {
                logoUrl = `/uploads/${req.files['logo'][0].filename}`;
            }
            if (req.files['dishImage'] && req.files['dishImage'][0]) {
                imageUrl = `/uploads/${req.files['dishImage'][0].filename}`;
            }
        }

        let restaurant = await RestaurantCatalog.findOne({ restaurantId });

        if (Array.isArray(menuItems) && menuItems.length > 0) {
            menuItems = menuItems.map(item => ({
                ...item,
                imageUrl: item.imageUrl || imageUrl || null
            }));
        }

        if (!restaurant) {
            restaurant = new RestaurantCatalog({
                restaurantId,
                name: restaurantName,
                cuisine,
                logoUrl: logoUrl || null,
                menu: menuItems || []
            });
        } else {
            if (logoUrl) restaurant.logoUrl = logoUrl;
            if (restaurantName) restaurant.name = restaurantName;
            if (cuisine) restaurant.cuisine = cuisine;
            if (Array.isArray(menuItems) && menuItems.length > 0) {
                restaurant.menu.push(...menuItems);
            }
        }

        await restaurant.save();
        log({ message: "Menu structure updated successfully in MongoDB", restaurantId });
        res.status(200).json(restaurant);
    } catch (err) {
        res.status(500).json({ error: "Internal error during menu processing: " + err.message });
    }
});

app.get('/api/v1/catalog', async (req, res) => {
    try {
        const { cuisine } = req.query;
        let query = {};

        if (cuisine) {
            query.cuisine = { $regex: new RegExp(cuisine, 'i') };
        }

        const catalog = await RestaurantCatalog.find(query);

        if (catalog && catalog.length > 0) {
            return res.status(200).json(catalog);
        }

        return res.status(200).json(catalogDb);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch catalog from DB" });
    }
});

app.listen(PORT, () => log({ message: `Microservice running on port ${PORT}` }));