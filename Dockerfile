FROM node:18-alpine
WORKDIR /app
COPY package.json .
COPY server.js .
COPY index.html .
COPY styles.css .
COPY app.js .
EXPOSE 3000
CMD ["node", "server.js"]
