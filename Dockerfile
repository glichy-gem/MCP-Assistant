# --- Stage 1: build the frontend ---
FROM node:20-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# --- Stage 2: backend runtime ---
FROM python:3.11-slim
WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
COPY mcp/requirements.txt mcp/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt -r mcp/requirements.txt

COPY backend/ backend/
COPY mcp/ mcp/
COPY --from=frontend-build /app/frontend/dist frontend/dist

EXPOSE 8000
CMD ["sh", "-c", "uvicorn app:app --app-dir backend --host 0.0.0.0 --port ${PORT:-8000}"]
