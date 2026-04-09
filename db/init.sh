#!/bin/sh
set -eu

VECTOR_DIM="${VECTOR_DIM:-768}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS thoughts (
  id BIGSERIAL PRIMARY KEY,
  content TEXT NOT NULL,
  content_fingerprint TEXT NOT NULL UNIQUE,
  embedding vector(${VECTOR_DIM}),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_thoughts_created_at ON thoughts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_thoughts_metadata ON thoughts USING GIN (metadata);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS \$\$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
\$\$;

DROP TRIGGER IF EXISTS thoughts_set_updated_at ON thoughts;
CREATE TRIGGER thoughts_set_updated_at
BEFORE UPDATE ON thoughts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
SQL
