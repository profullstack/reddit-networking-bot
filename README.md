# Reddit Networking Bot

A simple bot that finds Reddit users interested in business networking and PMs them once per hour using your personal account.

## Setup
1. Create a Reddit app: https://www.reddit.com/prefs/apps (type: script)
2. Fill in `config.json` with your credentials and message.
3. Run:
```bash
pnpm install
pnpm start
```

## Notes
- The bot persists messaged users in `messaged.json`.
- It runs in a loop, sending one message every hour to avoid detection.
