# Jynx

Jynx is a self-hosted, Telegram-native AI character and agent. She behaves like a real, intelligent person in chats rather than a corporate assistant.

## Features

- Natural Telegram conversation flow (private and group)
- Replaceable model-provider layer (OpenAI-compatible)
- PostgreSQL persistence (chats, users, messages, memories, tasks, approvals)
- Owner/admin authorization by numeric Telegram ID
- Conversation context and lightweight memory
- Natural group participation with social judgment (silent to chaotic modes)
- Compact, deduplicated error and approval reporting to configured groups

## Requirements

- Node.js >= 22
- PostgreSQL

## Setup

```bash
npm install
cp .env.example .env
# fill in TELEGRAM_BOT_TOKEN, JYNX_OWNER_ID, MAGICA_* and DATABASE_URL
npm run db:generate
npm run db:migrate
npm run dev
```

## Scripts

- `npm run dev` - run in watch mode
- `npm run build` / `npm start` - build and run
- `npm run typecheck` - TypeScript checks
- `npm run lint` - ESLint
- `npm test` - unit tests
- `npm run db:generate` / `npm run db:migrate` - Drizzle migrations

## Configuration

See `.env.example` for all options. The owner is identified only by the configured numeric `JYNX_OWNER_ID`; ownership can never be claimed through chat text.

## Group participation

Control how active Jynx is in a group with `/mode <silent|mentioned_only|balanced|social|chaotic>` (admins only).

## Security

All external content (user messages, tool results, model output) is treated as untrusted. Trusted backend code decides ownership, permissions, approvals, and secret access. The model can suggest actions but cannot grant itself permissions or expose secrets.
