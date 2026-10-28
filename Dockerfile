# ---- build ----
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- client build ----
FROM node:22-slim AS client-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json* ./
RUN npm install
COPY client .
RUN npm run build

# ---- runtime ----
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=client-build /app/dist ./client/dist
EXPOSE 8788
CMD ["node", "dist/server.js"]
