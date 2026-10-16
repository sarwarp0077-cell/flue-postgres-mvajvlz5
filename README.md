# Flue agents on Render — with persistent sessions

A template for deploying [Flue](https://www.flueframework.com/) agents to [Render](https://render.com), with conversation history persisted to [Render PostgreSQL](https://render.com/docs/postgresql-creating-connecting). Flue is the agent harness framework — a runtime-agnostic TypeScript framework for building headless, programmable agents the way you build with Claude Code or Codex.

This template ships two webhook-triggered agents, a Postgres-backed session store, a single `render.yaml` Blueprint, and the Node.js build target — so the entire stack (web service plus database) deploys as one Blueprint. Agent conversations survive restarts and deploys.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://dashboard.render.com/blueprint/new?repo=https://github.com/render-examples/flue-postgres)

## What's included

| Component | Description |
| --- | --- |
| **Translate agent** | Translates text between languages and returns a typed result (translation + confidence) using a [valibot](https://valibot.dev/) schema. |
| **Assistant agent** | A general-purpose conversational agent. Continues the same conversation when you reuse the agent ID in the request URL — message history is loaded from Postgres on every request. |
| **Postgres session store** | A custom `SessionStore` in `.flue/session-store.ts` that persists every agent's message history to a `flue_sessions` table. Sessions survive restarts, deploys, and scale events. |
| **Bundled HTTP server** | `flue build --target node` produces a single self-contained `dist/server.mjs` that exposes every webhook agent as `POST /agents/<name>/<id>`. |
| **One-click deploy** | A `render.yaml` Blueprint that provisions the web service, the PostgreSQL database, and wires the connection string between them. |

## Project structure

```text
.
├── .flue/
│   ├── agents/
│   │   ├── translate.ts      # Webhook agent — structured translation
│   │   └── assistant.ts      # Webhook agent — conversational replies, persistent sessions
│   └── session-store.ts      # Postgres-backed SessionStore
├── AGENTS.md                 # Default system prompt for every agent
├── .env.example              # Provider keys + DATABASE_URL for local development
├── package.json
├── render.yaml               # Render Blueprint (web service + PostgreSQL database)
└── tsconfig.json
```

Flue discovers agents from `.flue/agents/`. Each file exports a default async handler and a `triggers` object — `{ webhook: true }` exposes the agent over HTTP. The assistant agent imports the shared `sessionStore` from `.flue/session-store.ts` and passes it to `init({ persist: sessionStore })`, which is all Flue needs to load and save message history per session ID. See the [Flue README](https://github.com/withastro/flue#readme) for the full agent API.

## Deploy to Render

1. Click the **Deploy to Render** button above (or use [this link](https://dashboard.render.com/blueprint/new?repo=https://github.com/render-examples/flue)).
2. Set the `ANTHROPIC_API_KEY` environment variable to your [Anthropic API key](https://console.anthropic.com/).
3. Click **Apply** to create the web service and the PostgreSQL database.

The Blueprint provisions a `basic-256mb` PostgreSQL database (`flue-db`) and injects its internal connection string into the web service as `DATABASE_URL` via `fromDatabase`. The session store creates the `flue_sessions` table on first use, so there's no migration step.

Render runs `npm ci && npx flue build --target node`, then starts the bundled server with `node dist/server.mjs`. Render injects `PORT` and Flue's Hono server binds to it automatically. The `/health` endpoint backs the health check.

> **Note:** This Blueprint uses the `starter` plan for the web service and `basic-256mb` for the database — roughly $7 + $6/month at the time of writing. For higher traffic, scale the web service plan up or enable [autoscaling](https://render.com/docs/scaling), and bump the database plan if you outgrow 256 MB of RAM or its connection limit.

> **Important:** Webhook agents in this template are **unauthenticated**. Anyone who finds your service URL can invoke the agents and incur LLM provider costs on your account. Flue does not ship built-in auth, and its handler context does not expose request headers. Before you point real traffic at this service, do at least one of the following:
>
> - Add an in-payload shared-secret check inside each agent (read a token from `payload` and compare against an env var set with `generateValue: true`).
> - Front the service with an authenticated reverse proxy or API gateway.
> - Move the Flue service to a Render private service and gate access with another web service that handles auth.
>
> A follow-up template that pairs Flue with a `pserv` and a small auth front door is on the roadmap.

## Run locally

### Prerequisites

- [Node.js](https://nodejs.org/) 22 or later
- An [Anthropic API key](https://console.anthropic.com/)
- A PostgreSQL database the dev server can reach (see [Provision a local database](#provision-a-local-database) below)

### Install and configure

```bash
git clone https://github.com/render-examples/flue.git
cd flue
npm install
cp .env.example .env
```

Edit `.env` and set your `ANTHROPIC_API_KEY` and `DATABASE_URL`:

```bash
ANTHROPIC_API_KEY=sk-ant-...
DATABASE_URL=postgres://postgres:flue@localhost:5432/postgres
```

### Provision a local database

The session store needs a Postgres connection. Pick whichever fits your workflow:

- **Docker (fastest):**

  ```bash
  docker run --name flue-pg -e POSTGRES_PASSWORD=flue -p 5432:5432 -d postgres:17
  ```

  Then use `postgres://postgres:flue@localhost:5432/postgres` as your `DATABASE_URL`.

- **Render database (external connection):** If you've already deployed the Blueprint, copy the **External Database URL** for `flue-db` from the Render dashboard. External connections add latency and count against the database's connection limit, so this is best for one-off testing.

- **Existing local Postgres:** Any reachable Postgres works — the store creates its own `flue_sessions` table on first use.

### Start the dev server

```bash
npm run dev
```

Flue's dev server starts at `http://localhost:3583` and rebuilds on file changes. Edit an agent under `.flue/agents/`, save, and the next request picks up your change. The first request to the assistant agent creates the `flue_sessions` table; subsequent requests with the same session ID load and append to the existing thread.

## API usage

Every webhook agent is exposed at `POST /agents/<agent-name>/<id>`. The `<id>` is the session ID — reuse it to continue a conversation, or generate a new one to start fresh.

### Translate agent

```bash
curl -X POST http://localhost:3583/agents/translate/demo \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello world", "language": "French"}'
```

The response includes the typed result that matches the agent's [valibot](https://valibot.dev/) schema:

```json
{
  "result": {
    "translation": "Bonjour le monde",
    "confidence": "high"
  }
}
```

### Assistant agent

```bash
curl -X POST http://localhost:3583/agents/assistant/session-abc \
  -H "Content-Type: application/json" \
  -d '{"message": "What is the capital of Japan?"}'
```

Send another request to the same `session-abc` ID to continue the same thread:

```bash
curl -X POST http://localhost:3583/agents/assistant/session-abc \
  -H "Content-Type: application/json" \
  -d '{"message": "And how many people live there?"}'
```

Use a different ID (`session-xyz`, `user-42`, a UUID — whatever makes sense for your app) to start a separate conversation.

### Streaming responses

Pass `Accept: text/event-stream` to receive Server-Sent Events with progress updates as the agent runs:

```bash
curl -N -X POST http://localhost:3583/agents/assistant/demo \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"message": "Plan a 3-day trip to Tokyo."}'
```

### Fire-and-forget mode

Pass `X-Webhook: true` to receive an immediate `202 Accepted` response. The agent runs in the background:

```bash
curl -X POST http://localhost:3583/agents/assistant/job-1 \
  -H "Content-Type: application/json" \
  -H "X-Webhook: true" \
  -d '{"message": "Summarize this week's GitHub issues."}'
```

## Configuration

### Switch the model

Both agents read the default model from the `MODEL_ID` environment variable (provider/model-id format). Override it on your Render service or in your local `.env`:

| Provider | Example `MODEL_ID` | Required key |
| --- | --- | --- |
| Anthropic (default) | `anthropic/claude-sonnet-4-6` | `ANTHROPIC_API_KEY` |
| OpenAI | `openai/gpt-5.5` | `OPENAI_API_KEY` |
| OpenRouter | `openrouter/moonshotai/kimi-k2.6` | `OPENROUTER_API_KEY` |

Each agent calls `init({ model: env.MODEL_ID ?? 'anthropic/claude-sonnet-4-6' })`, so the env var wins and the hardcoded default keeps the agent runnable if the var is unset. To override the model for a single call (without changing the agent default), pass `{ model: '...' }` directly to `session.prompt()` or `session.skill()`.

### Add an agent

Drop a new file into `.flue/agents/` with a default export and a `triggers` definition:

```ts
// .flue/agents/summarize.ts
import type { FlueContext } from '@flue/sdk/client';
import * as v from 'valibot';

export const triggers = { webhook: true };

export default async function ({ init, payload }: FlueContext) {
  const agent = await init({ model: 'anthropic/claude-sonnet-4-6' });
  const session = await agent.session();
  return await session.prompt(`Summarize in one sentence:\n\n${payload.text}`);
}
```

Redeploy and the agent is reachable at `POST /agents/summarize/<id>`.

### Customize the system prompt

`AGENTS.md` at the repo root is the default system prompt for every agent. Edit it to set tone, response style, or guardrails that apply across the project. For per-agent overrides, define a role under `.flue/roles/<role>.md` and pass `{ role: '<role>' }` to `session.prompt()`.

### Add tools, skills, or sandboxes

Flue supports custom tool definitions, markdown-defined skills under `.agents/skills/`, MCP servers via `connectMcpServer()`, and full container sandboxes through connectors like Daytona. See the [Flue README](https://github.com/withastro/flue#readme) for examples.

## How the deploy works

| Step | What happens |
| --- | --- |
| **Build** | `npm ci && npx flue build --target node` installs dependencies and runs the Flue build, which discovers agents in `.flue/agents/` and emits a single bundled `dist/server.mjs` plus a `dist/manifest.json`. |
| **Start** | `node dist/server.mjs` starts a [Hono](https://hono.dev/) HTTP server. It registers `/health`, `/agents` (manifest), and `/agents/:name/:id` for every webhook agent. |
| **Port** | The server reads `process.env.PORT` (Render injects this) and binds to all interfaces. |
| **Database** | The Blueprint provisions `flue-db` and injects its internal connection string as `DATABASE_URL`. The session store lazily creates the `flue_sessions` table on first use. |
| **Shutdown** | The server handles `SIGTERM` and `SIGINT` for clean rollouts during Render deploys. |

## Limits

- **No authentication.** Webhook endpoints are publicly invokable. See the **Deploy to Render** section for mitigation options.
- The session store grows unbounded — there's no TTL or cleanup job for old conversations. For long-running deployments, add a cron job that prunes rows from `flue_sessions` where `updated_at` is older than your retention window.
- `flue_sessions.data` stores the full message history per session as JSONB. Very long conversations can grow large; consider summarizing or truncating in your agent before they hit Postgres row size limits.
- The `basic-256mb` Postgres plan caps connections; if you scale the web service horizontally, watch the database's connection count or move to a higher plan.
- `dist/` is rebuilt on every deploy; nothing in `dist/` should be committed to git.

## Learn more

- [Flue framework](https://www.flueframework.com/)
- [Flue on GitHub](https://github.com/withastro/flue)
- [Render web services](https://render.com/docs/web-services)
- [Render Blueprints](https://render.com/docs/blueprint-spec)
- [valibot schema validation](https://valibot.dev/)
