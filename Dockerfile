FROM ubuntu:jammy

ARG DEBIAN_FRONTEND=noninteractive
ARG TZ=America/Los_Angeles
ARG NODE_VERSION=24
ARG MOBILEWRIGHT_VERSION=latest

ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

# Install base deps, Node.js, and ADB client in a single layer
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl gpg ca-certificates && \
    mkdir -p /etc/apt/keyrings && \
    curl -sL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_VERSION}.x nodistro main" >> /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends nodejs android-tools-adb && \
    rm -rf /var/lib/apt/lists/*

# Point ADB client at the host's ADB server.
# host.docker.internal resolves natively on macOS/Windows Docker Desktop.
# On Linux, pass --add-host=host.docker.internal:host-gateway to docker run.
ENV ANDROID_ADB_SERVER_HOST=host.docker.internal
ENV ANDROID_ADB_SERVER_PORT=5037

# ADB does not natively read ANDROID_ADB_SERVER_HOST. This wrapper injects
# -H/-P so every adb call (doctor, mobilecli, etc.) reaches the host's server.
RUN printf '#!/bin/sh\nexec /usr/bin/adb -H "${ANDROID_ADB_SERVER_HOST:-127.0.0.1}" -P "${ANDROID_ADB_SERVER_PORT:-5037}" "$@"\n' \
    > /usr/local/bin/adb && chmod +x /usr/local/bin/adb

# Install mobilewright CLI globally (mobilecli binaries for all arches are
# bundled inside the mobilecli npm package — no optionalDependencies needed)
RUN npm install -g mobilewright@${MOBILEWRIGHT_VERSION} && \
    npm cache clean --force

# Non-root user (activated, unlike Playwright which only creates pwuser)
RUN adduser --disabled-password --gecos "" mwuser

USER mwuser
WORKDIR /home/mwuser

ENTRYPOINT ["mobilewright"]
