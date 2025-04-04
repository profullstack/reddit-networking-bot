import axios from 'axios';
import { logger } from '../utils/logger.mjs';
import { makeAICall } from './llm.mjs';

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
    const system_prompt = `You are doing biz dev outreach on behalf of our company, use a professional but friendly tone to do a cold outreach to someone who think might be interested in our product.`;

    const prompt = `Please rewrite this promotional outreach message to be less spammy and more targetted towards to user: ${userContext.seedPrompt}, ${userContext.username} ${userContext.subFound} Please generate a personalized networking invitation for a user on ${userContext.platform}. Their username is ${userContext.username}`

    const response = await makeAICall(system_prompt, prompt)

    const message = response.message.content.trim();
    logger.log(`Generated personalized message for ${userContext.username} on ${userContext.platform}`);

    return message;
  } catch (error) {
    logger.error(`Error generating personalized message: ${error.message}`);
    throw error;
  }
}