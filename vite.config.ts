import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "server/dist/public"),
    emptyOutDir: true,
  },
  server: {
    // The allocated port IS the Caddy route; drifting to port+1 serves nothing.
    strictPort: true,
    // Caddy and the Go dev proxy speak IPv4; bare `localhost` can bind [::1] only.
    host: "127.0.0.1",
    // mage dev derives VITE_PORT = PORT + 1000 (internal-only, never routed).
    port: Number(process.env.VITE_PORT),
    // Proxied requests carry the project's Host header; without this vite 403s.
    allowedHosts: [".rtalur.net"],
    // The HMR websocket rides Caddy's TLS listener, not the vite port.
    hmr: { clientPort: 443 },
  },
});
