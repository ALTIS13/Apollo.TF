ARG TF_PROOF_POSTGRES_IMAGE
FROM ${TF_PROOF_POSTGRES_IMAGE}
ARG TF_PROOF_POSTGRES_IMAGE
RUN printf '%s' "$TF_PROOF_POSTGRES_IMAGE" | grep -Eq '^(docker.io/library/)?postgres:17(\.[0-9]+)?-bookworm@sha256:[0-9a-f]{64}$'
COPY artifacts/api-server/proofs/coolify/postgres-entry.sh /usr/local/bin/tf-proof-entry.sh
COPY artifacts/api-server/proofs/coolify/init-proof.sh /docker-entrypoint-initdb.d/10-tf-proof.sh
RUN sed -i 's/\r$//' /usr/local/bin/tf-proof-entry.sh /docker-entrypoint-initdb.d/10-tf-proof.sh && chmod 0555 /usr/local/bin/tf-proof-entry.sh /docker-entrypoint-initdb.d/10-tf-proof.sh
ENTRYPOINT ["bash", "/usr/local/bin/tf-proof-entry.sh"]
