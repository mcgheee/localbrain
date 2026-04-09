# Local Brain

This is a re-architecture self-hosted of the Open Brain MCP server pattern used in [Nate B Jones's OB1 project](https://github.com/NateBJones-Projects/OB1), adapted for self-hosting. Local Brain uses:

- Podman containers orchestrated with `podman compose`
- PostgreSQL with `pgvector`
- A local OpenAI-compatible model endpoint via Ollama

## DISCLAIMER:

At this point, Local Brain is a proof of concept. It is designed to be run and used **locally only**. This project was made with **HEAVY** assistance from OpenAI's Codex, mostly for me to gain experience with agentic workflows. **Security** isn't even an *afterthought*, it **hasn't been considered at all**. Run this at your **own risk**.

You have been warned. 

## Why Local Brain?

Open Brain is an amazing project that allows you to take ownership over your AI memory. It uses Supabase for the backend and Open Router for embeddings. Local Brain takes it a step further by taking the backend out of the cloud, and onto your own server.

## What Changed From Open Brain?

Open Brain's `server/index.ts` is written as a Supabase Edge Function and expects:

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

The server writes directly to the `thoughts` table and uses a content fingerprint to deduplicate repeated captures. Metadata extraction is done with a local chat model, so output quality depends on the model you choose.

## Prerequisites

- Podman
- Podman Compose
- Enough RAM for Ollama and the chosen models
- Linux

If you are running rootless Podman on an SELinux-enabled host, you may need to add `:Z` to the bind mounts in [compose.yaml](/mnt/data/local_brain/compose.yaml).

## Quick Start

1. Clone the repo and change into the new directory.

```bash
git clone https://github.com/mcgheee/localbrain.git
cd localbrain
```

2. Copy the example environment file.

```bash
cp .env.example .env
```

3. Change at least these values in `.env`:

- `LOCALBRAIN_POSTGRES_PASSWORD`
- `LOCALBRAIN_MCP_ACCESS_KEY`

>[!Note]
> You can generate a suitable value for both by running `openssl rand -hex 32'.
> Don't use the same sequence for both the Postgres password and MCP access key.

4. Start the stack.

```bash
podman compose up --build -d
```

The first run will take longer because the server image is being built.


5. Verify the MCP server is healthy.

```bash
curl http://localhost:8000/healthz
```

6. Verify the MCP endpoint responds.

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

### Pi Agent Extension

I have included an extension for the [Pi Coding Agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) at `./.pi/extensions/localbrain.ts` 

You will need to set a couple of environment variables for it:

```bash
export LOCALBRAIN_MCP_URL=http://127.0.0.1:8000/mcp
export LOCALBRAIN_MCP_ACCESS_KEY='your_localbrain_key'
```

If you start the agent inside the project directory, it should pick it up automatically. You can make it available across your system by copying the extension to the Pi config in your home folder:

```bash
cp ./.pi/extensions/localbrain.ts ~/.pi/agent/extensions/localbrain.ts
```

You can also call it directly:

```bash
pi -e ~/.pi/agent/extensions/localbrain.ts
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

## Troubleshooting

Point Codex or Claude code at the directory where you cloned the repo, and prompt:

```
Why isn't the mcp server working?
```

If it figures something out, submit a PR. ;)