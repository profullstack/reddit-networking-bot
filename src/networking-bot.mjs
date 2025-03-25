#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { setTimeout as wait } from 'timers/promises';
import dayjs from 'dayjs';
import dotenv from 'dotenv';
import { logger } from './utils/logger.mjs';

// Import platform modules
import * as reddit from './platforms/reddit.mjs';
import * as bluesky from './platforms/bluesky.mjs';
import * as nostr from './platforms/nostr.mjs';
import * as x from './platforms/x.mjs';

// Import utilities
import { loadMessagedUsers, saveMessagedUsers, migrateMessagedUsers } from './utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '../.env') });

// Load config from config.json
const config = JSON.parse(await fs.readFile(path.join(__dirname, '../config.json')));

// Map platform names to their modules
const platforms = {
  reddit,
  bluesky,
  nostr,
  x
};

/**
 * Initialize all enabled platforms
 */
async function initializePlatforms() {
  logger.log('Initializing platforms...');
  
  for (const [name, platform] of Object.entries(platforms)) {
    if (config.platforms[name]?.enabled) {
      try {
        await platform.initialize();
        logger.log(`✅ ${name} initialized`);
      } catch (error) {
        logger.error(`❌ Failed to initialize ${name}: ${error.message}`);
        // Disable the platform if initialization fails
        config.platforms[name].enabled = false;
      }
    } else {
      logger.log(`⏭️ Skipping disabled platform: ${name}`);
    }
  }
}

/**
 * Run the bot for a specific platform
 * @param {string} platformName - The platform name (reddit, bluesky, nostr, x)
 */
async function runPlatform(platformName) {
  if (!config.platforms[platformName]?.enabled) {
    return;
  }
  
  logger.log(`\n🔄 Running ${platformName} bot...`);
  const platform = platforms[platformName];
  const messaged = await loadMessagedUsers(platformName);
  
  try {
    const candidates = await platform.findPotentialUsers(config.searchTerms[platformName]);
    logger.log(`Found ${candidates.length} potential users on ${platformName}`);
    
    const filtered = candidates.filter(user => !messaged.includes(user));
    logger.log(`${filtered.length} new candidates on ${platformName}`);
    
    if (filtered.length === 0) {
      logger.log(`No new candidates found for ${platformName}.`);
      return;
    }
    
    const nextUser = filtered[0];
    await platform.messageUser(nextUser, config.platforms[platformName].message);
    messaged.push(nextUser);
    await saveMessagedUsers(platformName, messaged);
  } catch (error) {
    logger.error(`Error running ${platformName} bot: ${error.message}`);
  }
}

/**
 * Main function that runs all enabled platforms
 */
async function main() {
  logger.log(`\n🤖 Starting networking bot at ${dayjs().format('YYYY-MM-DD HH:mm')}`);
  
  // Migrate existing messaged.json to platform-specific files
  await migrateMessagedUsers();
  
  // Initialize all enabled platforms
  await initializePlatforms();
  
  // Run each platform sequentially
  for (const platformName of Object.keys(platforms)) {
    if (config.platforms[platformName]?.enabled) {
      await runPlatform(platformName);
    }
  }
  
  logger.log(`\n⏱️ Waiting 1 hour before next run...`);
  await wait(1000 * 60 * 60);
  await main();
}

// Start the bot
main().catch(err => logger.error('Fatal error:', err));
