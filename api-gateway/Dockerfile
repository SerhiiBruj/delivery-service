FROM node:20-alpine
WORKDIR /app

# Копіюємо package.json для ізоляції кешу шарів Docker
COPY package.json ./

# Встановлюємо лише production-залежності, очищаємо кеш npm для зменшення ваги образу
RUN npm install --only=production && npm cache clean --force

COPY . .
EXPOSE ${PORT}
CMD ["npm", "start"]