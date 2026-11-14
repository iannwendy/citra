# =====================================================================
# Dockerfile — FastAPI backend
# Multi-stage build: dependencies → runtime
# =====================================================================

# Stage 1: Dependencies
FROM python:3.11-slim AS deps

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Cài system deps cho PyMuPDF + pdfplumber
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libmupdf-dev \
        mupdf-tools \
        curl \
        libsqlite3-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Cache layer: install deps trước (CPU-only PyTorch để tránh kéo ~2.5GB CUDA wheels)
COPY requirements.txt .
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir "onnxruntime>=1.18,<2.0" "optimum[onnxruntime]>=1.20,<2.0" && \
    mkdir -p /opt/mupdf-libs && \
    cp -a /usr/lib/*-linux-gnu/libmupdf* \
          /usr/lib/*-linux-gnu/libfreetype* \
          /usr/lib/*-linux-gnu/libjpeg* \
          /usr/lib/*-linux-gnu/libopenjp2* \
          /usr/lib/*-linux-gnu/libtiff* \
          /usr/lib/*-linux-gnu/libjbig* \
          /usr/lib/*-linux-gnu/libharfbuzz* \
          /usr/lib/*-linux-gnu/libglib* \
          /opt/mupdf-libs/ 2>/dev/null || true

# Stage 2: Runtime
FROM python:3.11-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Minimal runtime deps + lightweight Tesseract language data (~5.6 MB) for PyMuPDF native OCR
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
        libsqlite3-0 \
        tesseract-ocr-eng \
        tesseract-ocr-vie \
    && for d in /usr/share/tesseract-ocr/5/tessdata /usr/share/tesseract-ocr/4.00/tessdata /usr/share/tesseract-ocr/*/tessdata; do \
         if [ -f "$d/eng.traineddata" ] && [ "$d" != "/usr/share/tesseract-ocr/tessdata" ]; then \
           ln -sfn "$d" /usr/share/tesseract-ocr/tessdata; \
           break; \
         fi; \
       done \
    && test -f /usr/share/tesseract-ocr/tessdata/eng.traineddata \
    && test -f /usr/share/tesseract-ocr/tessdata/vie.traineddata \
    && rm -rf /var/lib/apt/lists/*

ENV TESSDATA_PREFIX=/usr/share/tesseract-ocr/tessdata

# Tạo non-root user cho security
RUN groupadd --gid 1000 appgroup && \
    useradd --uid 1000 --gid 1000 --shell /bin/bash appuser && \
    mkdir -p /home/appuser && chown appuser:appgroup /home/appuser

WORKDIR /app

ENV HOME=/home/appuser
ENV HF_HOME=/home/appuser/.cache/huggingface
ENV TRANSFORMERS_CACHE=/home/appuser/.cache/transformers

# Copy Python deps từ stage 1
COPY --from=deps /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=deps /usr/local/bin /usr/local/bin

# Copy multi-arch system libs (x86_64 / aarch64)
COPY --from=deps /opt/mupdf-libs/ /usr/local/lib/
RUN ldconfig

# Tạo data dirs + HuggingFace cache dirs với quyền appuser
RUN mkdir -p data/essays data/essays/uploads data/avatars data/ground_truth data/cache data/cache/grobid \
             /home/appuser/.cache/huggingface /home/appuser/.cache/transformers && \
    chown -R appuser:appgroup /app data/ /home/appuser/.cache

# Pre-download Sentence-BERT models (all-MiniLM-L6-v2 + quantized ONNX INT8 multilingual encoder)
# Fail loud at docker build time if either model download or ONNX runtime check fails
USER appuser
RUN python -c "import platform; from sentence_transformers import SentenceTransformer; SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2'); arch = platform.machine().lower(); fn = 'onnx/model_qint8_arm64.onnx' if arch in ('arm64', 'aarch64') else 'onnx/model_quint8_avx2.onnx'; SentenceTransformer('sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2', backend='onnx', model_kwargs={'file_name': fn})"

# Copy source (chỉ invalidate layer nhẹ cuối cùng khi code thay đổi)
USER root
COPY --chown=appuser:appgroup pyproject.toml README.md ./
COPY --chown=appuser:appgroup src/ ./src/
COPY --chown=appuser:appgroup scripts/ ./scripts/
COPY --chown=appuser:appgroup configs/ ./configs/

# Install package in editable mode (để import integrity_checker hoạt động)
RUN pip install --no-cache-dir --no-build-isolation --no-deps -e .

# Switch to non-root user
USER appuser

EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=60s \
    CMD curl -fsS http://localhost:8000/api/health || exit 1

# Default command
CMD ["uvicorn", "integrity_checker.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
