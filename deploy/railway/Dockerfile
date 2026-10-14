FROM mcr.microsoft.com/playwright:v1.64.0-noble
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      git python3 python3-pil python3-requests curl ca-certificates gosu procps tini \
    && rm -rf /var/lib/apt/lists/*
RUN npm install -g @anthropic-ai/claude-code@2.1.299 @railway/cli@5.68.0
# Same user/paths as the dev machine so absolute paths in state, sessions and transcripts stay valid.
RUN (userdel -r ubuntu 2>/dev/null || true) && useradd -m -u 1000 -s /bin/bash blort
COPY entrypoint.sh planner-loop.sh planner-prompt.md /opt/simgame/
RUN chmod +x /opt/simgame/*.sh
ENV HOME=/home/blort CLAUDE_CONFIG_DIR=/home/blort/.claude-ltr \
    CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000 PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENTRYPOINT ["/usr/bin/tini", "--", "/opt/simgame/entrypoint.sh"]
