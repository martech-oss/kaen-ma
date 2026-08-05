# agent

A [Flue](https://flueframework.com) agent project.

## Setup

```sh
pnpm install
```

Then add a model provider API key to `.env` (any [provider Pi supports](https://pi.dev/docs/latest/providers#api-keys)).

## Talk to your agent

```sh
pnpm exec flue run src/agents/hello.ts --message "Say hello!"
```

Conversations are durable — pass `--id <id>` to continue one.

## Develop

```sh
pnpm run dev
```

The private Hello agent is mounted at `/api/agents/hello` and is reached through the Server Worker's authenticated Service Binding gateway. Local Vite diagnostics listen on port `5174`.

## Deploy

Register the model provider key as a Worker secret, then deploy:

```sh
pnpm exec wrangler secret put ANTHROPIC_API_KEY
pnpm run deploy
```

## Learn more

- [Flue docs](https://flueframework.com/docs/) — or `pnpm exec flue docs` from the terminal.
