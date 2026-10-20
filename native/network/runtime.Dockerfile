FROM debian:bookworm-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171 AS runtime
RUN apt-get update && apt-get install --no-install-recommends -y ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY bin/gqrl /usr/local/bin/gqrl
COPY bin/beacon-chain /beacon-chain
COPY bin/validator /validator

FROM runtime AS execution
ENTRYPOINT ["gqrl"]

FROM runtime AS beacon
ENTRYPOINT ["/beacon-chain"]

FROM runtime AS validator
ENTRYPOINT ["/validator"]

FROM runtime AS generator
ENV QUANTAPOOL_PUBLIC_LOCAL_NETWORK=3151916
RUN apt-get update && apt-get install --no-install-recommends -y \
    python3 python3-venv gettext-base jq wget curl openssl \
    && rm -rf /var/lib/apt/lists/*
COPY generator/apps /apps
RUN python3 -m venv /apps/el-gen/.venv \
    && /apps/el-gen/.venv/bin/pip install -r /apps/el-gen/requirements.txt
COPY bin/qrysmctl /usr/local/bin/qrysmctl
COPY bin/deposit /usr/local/bin/deposit
COPY bin/validator /usr/local/bin/validator
COPY generator/config-example /config
COPY generator/defaults /defaults
COPY generator/entrypoint.sh /work/upstream-entrypoint.sh
COPY generator/quantapool-entrypoint.sh /work/entrypoint.sh
COPY generator/redact-fixture-log.py /work/redact-fixture-log.py
COPY generator/qualify-genesis.py /work/qualify-genesis.py
COPY generator/deposit-creation.bin /work/deposit-creation.bin
WORKDIR /work
ENTRYPOINT ["/work/entrypoint.sh"]
