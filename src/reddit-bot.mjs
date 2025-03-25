#!/usr/bin/env node

import snoowrap from 'snoowrap';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { setTimeout as wait } from 'timers/promises';
import dayjs from 'dayjs';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '../.env') });

// Load message from config.json
const config = JSON.parse(await fs.readFile(path.join(__dirname, '../config.json')));

const r = new snoowrap({
  userAgent: 'networking-bot/1.0',
  clientId: process.env.REDDIT_CLIENT_ID,
  clientSecret: process.env.REDDIT_CLIENT_SECRET,
  username: process.env.REDDIT_USERNAME,
  password: process.env.REDDIT_PASSWORD
});

const messagedFile = path.join(__dirname, '../messaged.json');

async function loadMessagedUsers() {
  try {
    return JSON.parse(await fs.readFile(messagedFile));
  } catch {
    return [];
  }
}

async function saveMessagedUsers(users) {
  await fs.writeFile(messagedFile, JSON.stringify(users, null, 2));
}

async function findPotentialUsers() {
  const searchResults = await r.search({
    query: 'looking for networking OR business networking OR tech founder',
    sort: 'new',
    time: 'day',
    limit: 25
  });

  return searchResults
    .filter(post => !post.author.name.toLowerCase().includes('bot'))
    .map(post => post.author.name);
}

async function messageUser(user, message) {
  console.log(`[${dayjs().format('HH:mm')}] Messaging: ${user}`);
  await r.composeMessage({
    to: user,
    subject: 'Tech Founder Networking Group',
    text: message
  });
  console.log(`✅ Messaged ${user}`);
}

async function main() {
  const messaged = await loadMessagedUsers();
  const candidates = await findPotentialUsers();
  const filtered = candidates.filter(user => !messaged.includes(user));

  if (filtered.length === 0) {
    console.log('No new candidates found.');
    return;
  }

  const nextUser = filtered[0];
  await messageUser(nextUser, config.message);
  messaged.push(nextUser);
  await saveMessagedUsers(messaged);

  console.log('Waiting 1 hour...');
  await wait(1000 * 60 * 60);
  await main(); 
}

main().catch(err => console.error(err));
