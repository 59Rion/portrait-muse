FROM python:3.12-bookworm AS builder
RUN apt-get update && apt-get install -y --no-install-recommends git build-essential && rm -rf /var/lib/apt/lists/*
WORKDIR /upstream
# Pin the exact upstream source. No tokens, Cookie or private source are build arguments.
RUN git init && git remote add origin https://github.com/JoeanAmier/XHS-Downloader.git && git fetch --depth 1 origin 3261312721f0b37c705ba6515885bc7f34349f2f && git checkout --detach FETCH_HEAD
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

FROM python:3.12-slim-bookworm
WORKDIR /opt/xhs
COPY --from=builder /install /usr/local
COPY --from=builder /upstream/source ./source
COPY --from=builder /upstream/locale ./locale
COPY --from=builder /upstream/static ./static
COPY --from=builder /upstream/LICENSE ./UPSTREAM-LICENSE
COPY core.py main.py /gateway/
ENV PYTHONPATH=/opt/xhs PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
RUN python -c "from source import XHS; import fastapi, uvicorn"
RUN useradd --uid 10001 --create-home muse && mkdir -p /opt/xhs/Volume && chown -R muse:muse /opt/xhs /gateway
USER muse
EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','10000')+'/health',timeout=4)"
CMD ["python", "/gateway/main.py"]
