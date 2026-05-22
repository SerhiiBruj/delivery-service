FROM node:20-alpine
WORKDIR /app

# Копіюємо ВИКЛЮЧНО package.json, щоб застарілий lock-файл з хоста не ламав збірку
COPY package.json ./

# Встановлюємо лише необхідні для продакшену залежності
RUN npm install --only=production

COPY . .
EXPOSE ${PORT}
CMD ["npm", "start"]