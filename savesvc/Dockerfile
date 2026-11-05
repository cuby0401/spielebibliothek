# Speicher-Dienst der Spielebibliothek
#
#   docker build --target test -t savesvc-test . && docker run --rm savesvc-test   → pytest
#   docker build .                                                                → Laufzeit-Image (letzte Stufe!)

# ---- Tests ----
FROM python:3.12-slim AS test
ENV PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY requirements.txt requirements-dev.txt ./
RUN pip install -r requirements-dev.txt
COPY savesvc ./savesvc
COPY tests ./tests
CMD ["python", "-m", "pytest", "-q", "tests"]

# ---- Laufzeit (muss die LETZTE Stufe bleiben: compose baut ohne target) ----
FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY savesvc ./savesvc

# Feste UID (ACLs auf /volume1/games/data und spiele, siehe scripts/nas-setup.sh)
USER 10022:10022
EXPOSE 8000
CMD ["uvicorn", "savesvc.app:app_factory", "--factory", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--no-server-header"]
