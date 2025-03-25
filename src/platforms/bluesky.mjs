import { BskyAgent } from '@atproto/api';
import dayjs from 'dayjs';
import { logger } from '../utils/logger.mjs';

let agent;

export async function initialize() {
  agent = new BskyAgent({ service: 'https://bsky.social' });
  await agent.login({
    identifier: process.env.BLUESKY_IDENTIFIER,
    password: process.env.BLUESKY_PASSWORD
  });
  logger.log('Bluesky initialized');
}

export async function findPotentialUsers(searchTerms) {
  const users = [];
  
  for (const term of searchTerms) {
    try {
      // Search for posts with relevant terms
      const results = await agent.app.bsky.feed.searchPosts({ q: term, limit: 10 });
      
      for (const post of results.data.posts) {
        if (!post.author.handle.toLowerCase().includes('bot')) {
          users.push(post.author.handle);
        }
      }
    } catch (error) {
      logger.error(`Error searching Bluesky for term "${term}": ${error.message}`);
    }
  }
  
  // Remove duplicates
  return [...new Set(users)];
}

export async function messageUser(user, message) {
  logger.log(`[${dayjs().format('HH:mm')}] Messaging Bluesky user: ${user}`);
  
  try {
    // Bluesky doesn't have direct messages yet, so we'll follow the user
    // and then post a reply to their most recent post
    
    // First, resolve the user's DID
    const profile = await agent.getProfile({ actor: user });
    
    // Follow the user
    await agent.follow(profile.data.did);
    logger.log(`Followed Bluesky user ${user}`);
    
    // Find their most recent post
    const posts = await agent.getAuthorFeed({ actor: profile.data.did, limit: 1 });
    
    if (posts.data.feed.length > 0) {
      const replyTo = posts.data.feed[0];
      
      // Reply to their post
      await agent.post({
        text: `@${user} ${message}`,
        reply: {
          root: {
            uri: replyTo.post.uri,
            cid: replyTo.post.cid
          },
          parent: {
            uri: replyTo.post.uri,
            cid: replyTo.post.cid
          }
        }
      });
      
      logger.log(`\u2705 Messaged Bluesky user ${user} via reply`);
    } else {
      // If they have no posts, just make a new post mentioning them
      await agent.post({
        text: `@${user} ${message}`
      });
      
      logger.log(`\u2705 Messaged Bluesky user ${user} via mention`);
    }
  } catch (error) {
    logger.error(`Error messaging Bluesky user ${user}: ${error.message}`);
    throw error;
  }
}
