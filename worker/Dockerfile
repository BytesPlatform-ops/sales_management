# Transcription worker image — needs ffmpeg (system) + torch/pyannote/faster-whisper (pip).
# Render's native Python runtime can't install ffmpeg, so we use Docker.
FROM python:3.12-slim

# System deps: ffmpeg for audio conversion; git for some pip source installs.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first for better layer caching.
# CPU-only torch wheels keep the image far smaller than the default CUDA build.
COPY requirements.txt .
RUN pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu \
        -r requirements.txt

COPY . .

# Long-running polling loop. Reads config from env (DATABASE_URL, HUGGINGFACE_TOKEN, ...).
CMD ["python", "transcription_worker.py"]
