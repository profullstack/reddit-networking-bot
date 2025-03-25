# Multi-Platform Networking Bot

A bot that finds users interested in business networking across multiple platforms (Reddit, Bluesky, Nostr, and X.com) and messages them once per hour using your personal accounts.

## Setup
1. Set up API access for each platform you want to use:
   - Reddit: Create a Reddit app at https://www.reddit.com/prefs/apps (type: script)
   - Bluesky: Use your Bluesky account credentials
   - Nostr: Generate a private key for your Nostr account
   - X.com: Create a Twitter developer account and app at https://developer.twitter.com
2. Copy `sample.env` to `.env` and fill in your credentials for each platform
3. Configure messages and search terms in `config.json`
4. Run:
```bash
pnpm install
pnpm start
```

## Notes
- The bot persists messaged users in platform-specific files (e.g., `messaged-reddit.json`, `messaged-bluesky.json`)
- It runs in a loop, sending one message per platform every hour to avoid detection
- You can enable/disable specific platforms in `config.json`
- Each platform has its own message template and search terms

## Platform-Specific Notes

### Bluesky
Since Bluesky doesn't have direct messaging yet, the bot will follow users and then reply to their posts or mention them.

### Nostr
The Nostr implementation requires your private key to sign messages. Keep this secure!

### X.com (Twitter)
Direct messaging on X.com requires elevated API access. The current implementation follows users and mentions them instead.
