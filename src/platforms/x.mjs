import { TwitterApi } from 'twitter-api-v2';
import dayjs from 'dayjs';
import { logger } from '../utils/logger.mjs';

let client;

export async function initialize() {
  client = new TwitterApi({
    appKey: process.env.X_API_KEY,
    appSecret: process.env.X_API_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_SECRET
  });
  
  // Verify credentials
  try {
    const me = await client.v2.me();
    logger.log(`X.com initialized as @${me.data.username}`);
  } catch (error) {
    logger.error('Failed to initialize X.com client:', error.message);
    throw error;
  }
}

export async function findPotentialUsers(searchTerms) {
  const users = [];
  
  for (const term of searchTerms) {
    try {
      // Search for tweets with relevant terms
      const results = await client.v2.search(term, {
        'tweet.fields': ['author_id', 'created_at'],
        'user.fields': ['username'],
        'expansions': ['author_id'],
        'max_results': 10
      });
      
      if (results.data && results.data.length > 0) {
        // Get user information from the includes
        const userMap = {};
        if (results.includes && results.includes.users) {
          for (const user of results.includes.users) {
            userMap[user.id] = user.username;
          }
        }
        
        // Add usernames to our list
        for (const tweet of results.data) {
          const username = userMap[tweet.author_id];
          if (username && !username.toLowerCase().includes('bot')) {
            users.push(username);
          }
        }
      }
    } catch (error) {
      logger.error(`Error searching X.com for term "${term}": ${error.message}`);
    }
  }
  
  // Remove duplicates
  return [...new Set(users)];
}

export async function messageUser(username, message) {
  logger.log(`[${dayjs().format('HH:mm')}] Messaging X.com user: ${username}`);
  
  try {
    // Note: Direct messaging requires elevated API access
    // For demonstration purposes, we'll just follow the user and mention them
    
    // First, get the user ID from username
    const user = await client.v2.userByUsername(username);
    
    if (!user.data) {
      throw new Error(`User @${username} not found`);
    }
    
    // Follow the user
    await client.v2.follow(user.data.id);
    logger.log(`Followed X.com user @${username}`);
    
    // Create a tweet mentioning the user
    const tweet = await client.v2.tweet(`@${username} ${message}`);
    logger.log(`\u2705 Messaged X.com user @${username} via mention`);
    
    return tweet;
  } catch (error) {
    logger.error(`Error messaging X.com user ${username}: ${error.message}`);
    throw error;
  }
}
