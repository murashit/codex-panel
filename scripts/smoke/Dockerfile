FROM ubuntu:24.04
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    xvfb xauth libasound2t64 libatk-bridge2.0-0t64 libatspi2.0-0t64 libgtk-3-0t64 \
    libatomic1 libcups2t64 libnss3 libgbm1 libxss1 libdrm2 fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
COPY squashfs-root /opt/obsidian
COPY codex node /usr/local/bin/
COPY main.js manifest.json styles.css /opt/panel/
COPY desktop.mjs /opt/
USER 1000:1000
ENV HOME=/tmp/home XDG_RUNTIME_DIR=/tmp/runtime LANG=C.UTF-8
WORKDIR /tmp
ENTRYPOINT ["xvfb-run", "-a", "node", "/opt/desktop.mjs"]
