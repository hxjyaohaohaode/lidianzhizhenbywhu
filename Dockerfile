FROM node:22-bookworm-slim AS frontend
WORKDIR /build
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --ignore-scripts
COPY web ./web
RUN npm run build
FROM python:3.13-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DATA_DIR=/data APP_ENV=production
COPY requirements.txt ./
RUN python -m pip install --no-cache-dir -r requirements.txt && useradd --system --uid 10001 app && mkdir /data && chown app /data
COPY server ./server
COPY scripts/start.py ./scripts/start.py
COPY examples ./examples
COPY web ./web
COPY --from=frontend /build/web/dist ./web/dist
USER app
EXPOSE 8000
CMD ["python", "scripts/start.py", "--host", "0.0.0.0", "--port", "8000"]
