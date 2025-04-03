import axios from 'axios';
import { logger } from '../utils/logger.mjs';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

/**
 * Generate a personalized message for a user based on their context
 * @param {Object} userContext - Information about the user and their interests
 * @param {string} userContext.platform - The platform (reddit, bluesky, nostr, x)
 * @param {string} userContext.username - The user's username
 * @param {Object} userContext.content - The user's post/content that triggered the bot
 * @param {string} userContext.content.text - The text content of the user's post
 * @param {string[]} userContext.content.keywords - Keywords found in the user's content
 * @returns {Promise<string>} The generated message
 */
export async function generatePersonalizedMessage(userContext) {
  try {
    const prompt = {
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a friendly networking assistant helping to connect tech founders. Generate a personalized message to invite someone to join a tech founder networking group. Keep the message concise, friendly, and relevant to their interests.'
        },
        {
          role: 'user',
          content: `Please generate a personalized networking invitation for a user on ${userContext.platform}. Their username is ${userContext.username}.`
        }
      ],
      temperature: 0.7,
      max_tokens: 150
    };

    const response = await axios.post(OPENAI_API_URL, prompt, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const message = response.data.choices[0].message.content.trim();
    logger.log(`Generated personalized message for ${userContext.username} on ${userContext.platform}`);
    return message;
  } catch (error) {
    logger.error(`Error generating personalized message: ${error.message}`);
    throw error;
  }
}