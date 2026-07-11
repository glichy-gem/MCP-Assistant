import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
// Vite proxies /api to the FastAPI backend running on :8000 during dev.
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: { "@": path.resolve(__dirname, "./src") },
    },
    server: {
        port: 5173,
        strictPort: true,
        proxy: {
            "/api": {
                target: "http://127.0.0.1:8000",
                changeOrigin: true,
            },
        },
    },
    build: {
        outDir: "dist",
        sourcemap: true,
    },
});
