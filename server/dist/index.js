import { serve } from "@hono/node-server";
import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Hono } from "hono";
import { Pool } from "pg";
import { createHash } from "node:crypto";
import { z } from "zod";
const env = {
    port: Number.parseInt(process.env.PORT ?? "8000", 10),
    mcpAccessKey: requiredEnv("MCP_ACCESS_KEY"),
    dbHost: process.env.DB_HOST ?? "postgres",
    dbPort: Number.parseInt(process.env.DB_PORT ?? "5432", 10),
    dbName: requiredEnv("DB_NAME"),
    dbUser: requiredEnv("DB_USER"),
    dbPassword: requiredEnv("DB_PASSWORD"),
    modelApiBase: (process.env.MODEL_API_BASE ?? "http://ollama:11434/v1").replace(/\/$/, ""),
    modelApiKey: process.env.MODEL_API_KEY ?? "ollama",
    embeddingModel: process.env.EMBEDDING_MODEL ?? "nomic-embed-text",
    chatModel: process.env.CHAT_MODEL ?? "qwen2.5:3b",
};
const pool = new Pool({
    host: env.dbHost,
    port: env.dbPort,
    database: env.dbName,
    user: env.dbUser,
    password: env.dbPassword,
});
const mcpServer = new McpServer({
    name: "local-brain-local",
    version: "0.1.0",
});
mcpServer.registerTool("search_thoughts", {
    title: "Search Thoughts",
    description: "Search captured thoughts by meaning.",
    inputSchema: {
        query: z.string().min(1).describe("What to search for"),
        limit: z.number().int().positive().max(50).optional().default(10),
        threshold: z.number().min(0).max(1).optional().default(0.5),
    },
}, async ({ query, limit, threshold }) => {
    try {
        const queryEmbedding = await getEmbedding(query);
        const result = await pool.query(`
          SELECT
            content,
            metadata,
            created_at,
            1 - (embedding <=> $1::vector) AS similarity
          FROM thoughts
          WHERE embedding IS NOT NULL
            AND 1 - (embedding <=> $1::vector) >= $2
          ORDER BY embedding <=> $1::vector
          LIMIT $3
        `, [toVectorLiteral(queryEmbedding), threshold, limit]);
        if (result.rows.length === 0) {
            return textResult(`No thoughts found matching "${query}".`);
        }
        const text = result.rows
            .map((row, index) => {
            const parts = [
                `--- Result ${index + 1} (${(row.similarity * 100).toFixed(1)}% match) ---`,
                `Captured: ${row.created_at.toLocaleDateString()}`,
                `Type: ${row.metadata?.type ?? "unknown"}`,
            ];
            if (row.metadata?.topics?.length) {
                parts.push(`Topics: ${row.metadata.topics.join(", ")}`);
            }
            if (row.metadata?.people?.length) {
                parts.push(`People: ${row.metadata.people.join(", ")}`);
            }
            if (row.metadata?.action_items?.length) {
                parts.push(`Actions: ${row.metadata.action_items.join("; ")}`);
            }
            parts.push("", row.content);
            return parts.join("\n");
        })
            .join("\n\n");
        return textResult(`Found ${result.rows.length} thought(s):\n\n${text}`);
    }
    catch (error) {
        return errorResult(error);
    }
});
mcpServer.registerTool("list_thoughts", {
    title: "List Recent Thoughts",
    description: "List recently captured thoughts with optional filters by type, topic, person, or time range.",
    inputSchema: {
        limit: z.number().int().positive().max(50).optional().default(10),
        type: z.string().optional(),
        topic: z.string().optional(),
        person: z.string().optional(),
        days: z.number().int().positive().optional(),
    },
}, async ({ limit, type, topic, person, days }) => {
    try {
        const clauses = [];
        const values = [];
        if (type) {
            values.push(JSON.stringify({ type }));
            clauses.push(`metadata @> $${values.length}::jsonb`);
        }
        if (topic) {
            values.push(JSON.stringify({ topics: [topic] }));
            clauses.push(`metadata @> $${values.length}::jsonb`);
        }
        if (person) {
            values.push(JSON.stringify({ people: [person] }));
            clauses.push(`metadata @> $${values.length}::jsonb`);
        }
        if (days) {
            values.push(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
            clauses.push(`created_at >= $${values.length}`);
        }
        values.push(limit);
        const query = `
        SELECT content, metadata, created_at
        FROM thoughts
        ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
        ORDER BY created_at DESC
        LIMIT $${values.length}
      `;
        const result = await pool.query(query, values);
        if (result.rows.length === 0) {
            return textResult("No thoughts found.");
        }
        const text = result.rows
            .map((row, index) => {
            const tags = row.metadata?.topics?.join(", ");
            const label = row.metadata?.type ?? "unknown";
            const suffix = tags ? ` - ${tags}` : "";
            return `${index + 1}. [${row.created_at.toLocaleDateString()}] (${label}${suffix})\n${row.content}`;
        })
            .join("\n\n");
        return textResult(`${result.rows.length} recent thought(s):\n\n${text}`);
    }
    catch (error) {
        return errorResult(error);
    }
});
mcpServer.registerTool("thought_stats", {
    title: "Thought Statistics",
    description: "Get a summary of all captured thoughts: totals, types, top topics, and people.",
    inputSchema: {},
}, async () => {
    try {
        const countResult = await pool.query("SELECT COUNT(*)::text AS count FROM thoughts");
        const rowsResult = await pool.query("SELECT created_at, metadata FROM thoughts ORDER BY created_at DESC");
        const types = new Map();
        const topics = new Map();
        const people = new Map();
        for (const row of rowsResult.rows) {
            if (row.metadata?.type) {
                increment(types, row.metadata.type);
            }
            for (const topic of row.metadata?.topics ?? []) {
                increment(topics, topic);
            }
            for (const person of row.metadata?.people ?? []) {
                increment(people, person);
            }
        }
        const lines = [];
        lines.push(`Total thoughts: ${countResult.rows[0]?.count ?? "0"}`);
        if (rowsResult.rows.length > 0) {
            const newest = rowsResult.rows[0].created_at.toLocaleDateString();
            const oldest = rowsResult.rows[rowsResult.rows.length - 1].created_at.toLocaleDateString();
            lines.push(`Date range: ${oldest} -> ${newest}`);
        }
        else {
            lines.push("Date range: N/A");
        }
        lines.push("", "Types:");
        for (const [key, value] of topEntries(types)) {
            lines.push(`  ${key}: ${value}`);
        }
        if (topics.size > 0) {
            lines.push("", "Top topics:");
            for (const [key, value] of topEntries(topics)) {
                lines.push(`  ${key}: ${value}`);
            }
        }
        if (people.size > 0) {
            lines.push("", "People mentioned:");
            for (const [key, value] of topEntries(people)) {
                lines.push(`  ${key}: ${value}`);
            }
        }
        return textResult(lines.join("\n"));
    }
    catch (error) {
        return errorResult(error);
    }
});
mcpServer.registerTool("capture_thought", {
    title: "Capture Thought",
    description: "Save a new thought and generate embeddings plus metadata automatically.",
    inputSchema: {
        content: z.string().min(1).describe("The thought to capture"),
    },
}, async ({ content }) => {
    try {
        const [embedding, metadata] = await Promise.all([getEmbedding(content), extractMetadata(content)]);
        const fingerprint = createFingerprint(content);
        const result = await pool.query(`
          INSERT INTO thoughts (content, content_fingerprint, embedding, metadata)
          VALUES ($1, $2, $3::vector, $4::jsonb)
          ON CONFLICT (content_fingerprint)
          DO UPDATE SET
            content = EXCLUDED.content,
            embedding = EXCLUDED.embedding,
            metadata = EXCLUDED.metadata
          RETURNING id
        `, [content, fingerprint, toVectorLiteral(embedding), JSON.stringify({ ...metadata, source: "mcp-local" })]);
        const typeLabel = metadata.type ?? "thought";
        const topics = metadata.topics?.length ? ` - ${metadata.topics.join(", ")}` : "";
        const people = metadata.people?.length ? ` | People: ${metadata.people.join(", ")}` : "";
        const actions = metadata.action_items?.length ? ` | Actions: ${metadata.action_items.join("; ")}` : "";
        const suffix = result.rows[0]?.id ? ` (#${result.rows[0].id})` : "";
        return textResult(`Captured as ${typeLabel}${topics}${people}${actions}${suffix}`);
    }
    catch (error) {
        return errorResult(error);
    }
});
const app = new Hono();
const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-brain-key, accept, mcp-session-id",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
};
app.get("/healthz", async (c) => {
    try {
        await pool.query("SELECT 1");
        return c.json({ ok: true }, 200, corsHeaders);
    }
    catch (error) {
        return c.json({ ok: false, error: toErrorMessage(error) }, 500, corsHeaders);
    }
});
app.options("/mcp", (c) => c.text("ok", 200, corsHeaders));
app.all("/mcp", async (c) => {
    const providedKey = c.req.header("x-brain-key") ?? new URL(c.req.url).searchParams.get("key");
    if (!providedKey || providedKey !== env.mcpAccessKey) {
        return c.json({ error: "Invalid or missing access key" }, 401, corsHeaders);
    }
    if (!c.req.header("accept")?.includes("text/event-stream")) {
        const headers = new Headers(c.req.raw.headers);
        headers.set("accept", "application/json, text/event-stream");
        const patchedRequest = new Request(c.req.raw.url, {
            method: c.req.raw.method,
            headers,
            body: c.req.raw.body,
            duplex: "half",
        });
        Object.defineProperty(c.req, "raw", { value: patchedRequest, writable: true });
    }
    const transport = new StreamableHTTPTransport();
    await mcpServer.connect(transport);
    return transport.handleRequest(c);
});
serve({
    fetch: app.fetch,
    port: env.port,
}, (info) => {
    console.log(`localbrain-local listening on http://0.0.0.0:${info.port}`);
});
async function getEmbedding(text) {
    const response = await fetch(`${env.modelApiBase}/embeddings`, {
        method: "POST",
        headers: modelHeaders(),
        body: JSON.stringify({
            model: env.embeddingModel,
            input: text,
        }),
    });
    if (!response.ok) {
        throw new Error(`Embedding request failed: ${response.status} ${await response.text()}`);
    }
    const payload = (await response.json());
    const embedding = payload.data?.[0]?.embedding;
    if (!embedding || embedding.length === 0) {
        throw new Error("Embedding response did not include a vector.");
    }
    return embedding;
}
async function extractMetadata(text) {
    const response = await fetch(`${env.modelApiBase}/chat/completions`, {
        method: "POST",
        headers: modelHeaders(),
        body: JSON.stringify({
            model: env.chatModel,
            temperature: 0,
            messages: [
                {
                    role: "system",
                    content: [
                        "Extract metadata from the user's captured thought.",
                        'Return only JSON with keys: "people", "action_items", "dates_mentioned", "topics", "type".',
                        'Allowed "type" values: observation, task, idea, reference, person_note.',
                        'Use empty arrays when a field is missing.',
                        'Always include at least one topic.',
                        "Do not add explanations or markdown.",
                    ].join(" "),
                },
                {
                    role: "user",
                    content: text,
                },
            ],
        }),
    });
    if (!response.ok) {
        throw new Error(`Metadata extraction failed: ${response.status} ${await response.text()}`);
    }
    const payload = (await response.json());
    const rawContent = payload.choices?.[0]?.message?.content;
    if (!rawContent) {
        return { topics: ["uncategorized"], type: "observation" };
    }
    const parsed = safeParseJson(rawContent);
    if (!parsed) {
        return { topics: ["uncategorized"], type: "observation" };
    }
    return {
        people: normalizeStringArray(parsed.people),
        action_items: normalizeStringArray(parsed.action_items),
        dates_mentioned: normalizeStringArray(parsed.dates_mentioned),
        topics: normalizeStringArray(parsed.topics).length ? normalizeStringArray(parsed.topics) : ["uncategorized"],
        type: parsed.type ?? "observation",
    };
}
function requiredEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}
function modelHeaders() {
    return {
        Authorization: `Bearer ${env.modelApiKey}`,
        "Content-Type": "application/json",
    };
}
function toVectorLiteral(values) {
    return `[${values.join(",")}]`;
}
function createFingerprint(content) {
    return createHash("sha256").update(content.trim().replace(/\s+/g, " ")).digest("hex");
}
function safeParseJson(value) {
    try {
        return JSON.parse(value);
    }
    catch {
        const match = value.match(/\{[\s\S]*\}/);
        if (!match) {
            return null;
        }
        try {
            return JSON.parse(match[0]);
        }
        catch {
            return null;
        }
    }
}
function normalizeStringArray(values) {
    return (values ?? []).map((value) => value.trim()).filter(Boolean);
}
function increment(map, key) {
    map.set(key, (map.get(key) ?? 0) + 1);
}
function topEntries(map) {
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
}
function textResult(text) {
    return {
        content: [{ type: "text", text }],
    };
}
function errorResult(error) {
    return {
        content: [{ type: "text", text: `Error: ${toErrorMessage(error)}` }],
        isError: true,
    };
}
function toErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
