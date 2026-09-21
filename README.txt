# Botrix System — Fresh Project

This is a brand-new project. It does not modify or depend on your old bot code.

## Folder
- index.js — fresh Discord bot + dashboard API
- public/index.html — Botrix.dashboard
- package.json
- .env.example

## Setup
1. Install Node.js.
2. Open this folder in PowerShell.
3. Run:
   npm install
4. Copy `.env.example` to `.env`.
5. Put your Discord bot token in `DISCORD_TOKEN`.
6. Put your Discord Application ID in `CLIENT_ID`.
7. Run:
   npm start
8. Open:
   http://localhost:3000

The dashboard reads the real guild list directly from the running Discord bot.
