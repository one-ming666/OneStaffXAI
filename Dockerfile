FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev --ignore-scripts; else npm install --omit=dev --ignore-scripts; fi
COPY . .
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000
CMD ["node", "--env-file-if-exists=.env", "server/index.js"]
