# Localbrain on Podman

This is a local, self-hosted build of the Open Brain MCP server pattern used in the upstream OB1 project, adapted for:

- Podman containers orchestrated with `podman compose`
- PostgreSQL with `pgvector`
- A local OpenAI-compatible model endpoint via Ollama
- Direct PostgreSQL access instead of Supabase

## What Changed From Upstream

The upstream `server/index.ts` is written as a Supabase Edge Function and expects:

- Supabase auth and RPCs
- Supabase-hosted Postgres
- OpenRouter for embeddings and metadata extraction

For a local deployment, this project replaces those pieces with:

- `postgres`: stores thoughts and vectors directly
- `ollama`: serves embeddings and chat locally
- `mcp-server`: exposes the same four MCP tools over HTTP

The MCP tools exposed here are:

- `search_thoughts`
- `list_thoughts`
- `thought_stats`
- `capture_thought`

## Prerequisites

- Podman
- Podman Compose
- Enough RAM for Ollama and the chosen models

If you are running rootless Podman on an SELinux-enabled host, you may need to add `:Z` to the bind mounts in [compose.yaml](/mnt/data/local_brain/compose.yaml).

## Quick Start

1. Copy the environment file.

```bash
cp .env.example .env
```

2. Change at least these values in `.env`:

- `LOCALBRAIN_POSTGRES_PASSWORD`
- `LOCALBRAIN_MCP_ACCESS_KEY`

3. Start the stack.

```bash
podman compose up --build
```

The first run will take longer because:

- the server image is built
- Ollama starts
- `ollama-init` pulls the embedding model and chat model
- Postgres initializes the schema

4. Verify the MCP server is healthy.

```bash
curl http://localhost:8000/healthz
```

5. Verify the MCP endpoint responds.

```bash
curl -X POST http://localhost:8000/mcp \
  -H "x-brain-key: YOUR_LOCALBRAIN_MCP_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

## Connect an MCP Client

Use a remote HTTP MCP configuration that points at your local server:

```json
{
  "mcpServers": {
    "localbrain-local": {
      "url": "http://127.0.0.1:8000/mcp",
      "transport": "http",
      "headers": {
        "x-brain-key": "YOUR_LOCALBRAIN_MCP_ACCESS_KEY"
      }
    }
  }
}
```

## Model Choices

The default `.env.example` uses:

- `LOCALBRAIN_EMBEDDING_MODEL=nomic-embed-text`
- `LOCALBRAIN_CHAT_MODEL=qwen2.5:3b`
- `LOCALBRAIN_VECTOR_DIM=768`

If you change the embedding model, make sure `LOCALBRAIN_VECTOR_DIM` matches that model's output dimension. The schema is created only once on the first database boot, so if you change dimensions later you should remove the Postgres volume and recreate the stack.

## Common Operations

Start in the background:

```bash
podman compose up -d --build
```

Stop the stack:

```bash
podman compose down
```

Reset the database and downloaded models:

```bash
podman compose down -v
```

View logs:

```bash
podman compose logs -f mcp-server
podman compose logs -f ollama
podman compose logs -f postgres
```

## Notes

- This version intentionally does not depend on Supabase.
- The server writes directly to the `thoughts` table and uses a content fingerprint to deduplicate repeated captures.
- Metadata extraction is done with a local chat model, so output quality depends on the model you choose.
