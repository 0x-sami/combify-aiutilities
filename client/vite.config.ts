import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API = "http://localhost:8788";
// Proxy the free surface + all 21 /x402/* routes to the local backend so the
// tester works with `npm run dev`. Production serves client/dist from
// Express, same origin, so this proxy is not used in the Docker build.
const x402 = [
  "ping", "status", "time", "uuid", "random", "ip", "network",
  "echo", "hash", "keccak", "base64", "slug", "wordcount",
  "payment", "quote",
  "summarize", "rewrite", "sentiment", "keywords", "classify", "outline",
];
const proxy = Object.fromEntries(
  ["/", "/health", "/info", "/llms.txt", "/openapi.json", "/x402", ...x402.map((p) => `/x402/${p}`)].map((p) => [p, API]),
);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5177,
    proxy,
  },
  preview: { port: 4177 },
});
