import { getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import * as nip04 from 'nostr-tools/nip04';
import { decode, npubEncode } from 'nostr-tools/nip19';
import * as nip19 from 'nostr-tools/nip19';
import { SimplePool } from 'nostr-tools';
import dayjs from 'dayjs';
import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger.mjs';
import WebSocket from 'ws';
import { generatePersonalizedMessage } from '../services/ai.mjs';

// Add WebSocket to global scope for nostr-tools
if (typeof global !== 'undefined' && !global.WebSocket) {
  global.WebSocket = WebSocket;
}

let privateKey;
let publicKey;

// List of reliable Nostr relays that accept direct messages (kind 4)
const RELAYS = [
  // Primary relays - confirmed working with direct messages
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://nostr.mom',
  'wss://nostr.oxtr.dev',
  'wss://nostr-pub.wellorder.net',
];

export async function initialize() {
  // Read private key from environment variable
  privateKey = process.env.NOSTR_PRIVATE_KEY;

  if (!privateKey) {
    logger.error('Nostr private key not found in environment variables');
    throw new Error('Nostr private key is required. Please set NOSTR_PRIVATE_KEY in your .env file');
  }

  // Handle nsec format (NIP-19 encoded private key)
  if (typeof privateKey === 'string' && privateKey.startsWith('nsec')) {
    try {
      const decoded = decode(privateKey);
      if (decoded.type === 'nsec') {
        privateKey = decoded.data;
      }
    } catch (error) {
      logger.error('Error decoding nsec key:', error.message);
    }
  }
  // Convert hex string to Uint8Array if needed
  else if (typeof privateKey === 'string' && privateKey.match(/^[0-9a-fA-F]{64}$/)) {
    privateKey = hexToBytes(privateKey);
  }

  publicKey = getPublicKey(privateKey);
  logger.log('Nostr initialized with public key:', publicKey);
}

// Helper function to convert hex string to Uint8Array
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export async function findPotentialUsers(searchTerms) {
  logger.log('Searching for Nostr users interested in:', searchTerms);

  let browser;
  try {
    // Format search terms for URL
    const searchQuery = Array.isArray(searchTerms) ? searchTerms.join(' ') : searchTerms;
    const encodedQuery = encodeURIComponent(searchQuery);
    const url = `https://primal.net/search/${encodedQuery}`;

    logger.log(`Launching browser to scrape Nostr search results from: ${url}`);

    // Launch a headless browser with more options for compatibility
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    });

    // Open a new page with a viewport large enough
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // Add error handling for page navigation
    page.on('error', err => {
      logger.error(`Page error: ${err.message}`);
    });

    // Set a user agent to appear more like a regular browser
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    logger.log('Navigating to search URL...');
    // Navigate to the search URL with a longer timeout
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // Wait for the page to load content
    logger.log('Waiting for page content to load...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Ensure logs directory exists
    const logsDir = path.resolve(process.cwd(), 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    // Take a screenshot for debugging with timestamp

    // A more direct approach to find profile links on Primal.net
    const timestamp = dayjs().format('YYYY-MM-DD-HH-mm-ss');
    const screenshotPath = path.join(logsDir, `primal-search-${timestamp}.png`);
    await page.screenshot({ path: screenshotPath });
    logger.log(`Screenshot saved to ${screenshotPath}`);

    logger.log('Extracting user profiles...');

    // Get page HTML for debugging
    const pageContent = await page.content();
    logger.log('Page HTML length:', pageContent.length);
    logger.log('Page HTML preview:', pageContent.substring(0, 500) + '...');

    // Save full HTML to log file for debugging
    const htmlLogPath = path.join(logsDir, `primal-search-html-${timestamp}.html`);
    fs.writeFileSync(htmlLogPath, pageContent);
    logger.log(`Full HTML saved to ${htmlLogPath}`);

    // Function to extract profile links from the page with enhanced detection
    const extractProfileLinks = async () => {
      return await page.evaluate(() => {
        // More comprehensive approach to find profile elements
        const results = [];

        // Method 1: Find all links that might be profile links
        const links = Array.from(document.querySelectorAll('a[href]'));
        const profileLinks = links.filter(link => {
          const href = link.getAttribute('href');
          return href && (
            href.includes('/p/') ||
            href.includes('/profile/') ||
            href.includes('/user/')
          );
        });

        // Process profile links
        profileLinks.forEach(link => {
          const href = link.getAttribute('href');
          let profileId = '';

          // Extract profile ID based on URL pattern
          if (href.includes('/p/')) {
            profileId = href.split('/p/')[1].split('/')[0].split('?')[0];
          } else if (href.includes('/profile/')) {
            profileId = href.split('/profile/')[1].split('/')[0].split('?')[0];
          } else if (href.includes('/user/')) {
            profileId = href.split('/user/')[1].split('/')[0].split('?')[0];
          }

          // Get the closest text that might be a name
          let name = '';
          let bio = '';

          // Try to find name in the link or parent elements
          // Look up to 3 levels up to find user card container
          let container = link;
          for (let i = 0; i < 3; i++) {
            if (container.parentElement) {
              container = container.parentElement;

              // Check if this looks like a user card
              if (
                container.className.includes('card') ||
                container.className.includes('user') ||
                container.className.includes('profile') ||
                container.className.includes('author')
              ) {
                break;
              }
            }
          }

          // Look for potential name elements
          const nameElements = container.querySelectorAll('h1, h2, h3, h4, strong, b, [class*="name"], [class*="user"]');
          if (nameElements.length > 0) {
            name = nameElements[0].textContent.trim();
          }

          // Look for potential bio elements
          const bioElements = container.querySelectorAll('p, [class*="bio"], [class*="description"], [class*="content"]');
          if (bioElements.length > 0) {
            bio = bioElements[0].textContent.trim();
            if (bio.length > 300) bio = bio.substring(0, 297) + '...';
          }

          // If we couldn't find a name, use link text as fallback
          if (!name) {
            name = link.textContent.trim();
            if (name.length > 50) name = name.substring(0, 47) + '...';
          }

          // Look for data-user attribute which often contains the hex pubkey
          let hexPubkey = '';
          const userDataElement = container.querySelector('[data-user]') || container.closest('[data-user]');
          if (userDataElement) {
            hexPubkey = userDataElement.getAttribute('data-user');
          }

          results.push({
            profileId,
            name: name || 'Unknown User',
            bio,
            hexPubkey,
            url: href.startsWith('http') ? href : `https://primal.net${href}`
          });
        });

        // Method 2: Find user cards directly
        const userCards = Array.from(document.querySelectorAll('[class*="card"], [class*="user"], [class*="profile"], [class*="author"]'));
        userCards.forEach(card => {
          // Skip if this card doesn't look like a user card
          if (!card.textContent || card.textContent.trim().length < 2) return;

          // Find link in the card
          const link = card.querySelector('a[href]');
          if (!link) return;

          const href = link.getAttribute('href');
          if (!href || (!href.includes('/p/') && !href.includes('/profile/') && !href.includes('/user/'))) return;

          let profileId = '';
          if (href.includes('/p/')) {
            profileId = href.split('/p/')[1].split('/')[0].split('?')[0];
          } else if (href.includes('/profile/')) {
            profileId = href.split('/profile/')[1].split('/')[0].split('?')[0];
          } else if (href.includes('/user/')) {
            profileId = href.split('/user/')[1].split('/')[0].split('?')[0];
          }

          // Find name and bio
          const nameElement = card.querySelector('h1, h2, h3, h4, strong, b, [class*="name"], [class*="user"]');
          const bioElement = card.querySelector('p, [class*="bio"], [class*="description"], [class*="content"]');

          const name = nameElement ? nameElement.textContent.trim() : '';
          let bio = bioElement ? bioElement.textContent.trim() : '';
          if (bio.length > 300) bio = bio.substring(0, 297) + '...';

          // Find pubkey
          let hexPubkey = '';
          const userDataElement = card.querySelector('[data-user]');
          if (userDataElement) {
            hexPubkey = userDataElement.getAttribute('data-user');
          }

          results.push({
            profileId,
            name: name || 'Unknown User',
            bio,
            hexPubkey,
            url: href.startsWith('http') ? href : `https://primal.net${href}`
          });
        });

        return results;
      });
    };

    // Implement continuous scrolling to get more results
    let allProfileLinks = [];
    const targetProfileCount = 50;
    const maxScrollAttempts = 10;
    let scrollAttempts = 0;

    // Create a more robust way to track unique profiles
    const uniqueProfileTracker = new Map();

    // Helper function to add unique profiles
    const addUniqueProfiles = (profiles) => {
      let newCount = 0;

      profiles.forEach(profile => {
        // Create a composite key using multiple fields to better identify unique profiles
        // Use URL as primary identifier, then profileId, then hexPubkey, then name as fallback
        const uniqueKey = profile.url || profile.profileId || profile.hexPubkey || profile.name;

        if (uniqueKey && !uniqueProfileTracker.has(uniqueKey)) {
          uniqueProfileTracker.set(uniqueKey, profile);
          allProfileLinks.push(profile);
          newCount++;
        }
      });

      return newCount;
    };

    // Initial extraction
    let profileLinks = await extractProfileLinks();
    const initialCount = addUniqueProfiles(profileLinks);
    logger.log(`Initially found ${initialCount} unique profile links out of ${profileLinks.length} total`);

    // Continue scrolling until we have enough profiles, reach max attempts, or find 0 new profiles
    while (allProfileLinks.length < targetProfileCount && scrollAttempts < maxScrollAttempts) {
      scrollAttempts++;

      // Scroll down to load more results
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });

      // Wait for new content to load using setTimeout instead of waitForTimeout
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Extract profiles again
      profileLinks = await extractProfileLinks();

      // Add new unique profiles to our collection
      const newCount = addUniqueProfiles(profileLinks);

      // Stop if we found 0 new profiles in this scroll attempt
      if (newCount === 0) {
        logger.log(`Scroll attempt ${scrollAttempts}: No new profiles found. Stopping infinite scroll.`);
        break;
      }

      logger.log(`Scroll attempt ${scrollAttempts}: Found ${newCount} new unique profiles, total: ${allProfileLinks.length}`);

      // Take a screenshot after each scroll for debugging
      const scrollTimestamp = dayjs().format('YYYY-MM-DD-HH-mm-ss');
      const scrollScreenshotPath = path.join(logsDir, `primal-search-scroll${scrollAttempts}-${scrollTimestamp}.png`);
      await page.screenshot({ path: scrollScreenshotPath });
    }

    // Use the combined results from all scrolls - allProfileLinks now contains only unique profiles
    profileLinks = allProfileLinks;
    logger.log(`Found ${profileLinks.length} unique profile links after ${scrollAttempts} scroll attempts`);

    // Log a sample of the profiles found for debugging (limit to 3 to avoid excessive logging)
    const sampleProfiles = profileLinks.slice(0, 3);
    logger.log('Sample profile links found:', JSON.stringify(sampleProfiles, null, 2));

    // Always try the alternative approach to find more profiles
    logger.log('Trying additional search methods to find more profiles...');

    // Try a more aggressive approach with multiple search techniques
    const userElements = await page.evaluate(() => {
      const results = [];

      // Method 1: Look for elements that might be user cards
      const elements = Array.from(document.querySelectorAll('div[class*="card"], div[class*="user"], div[class*="profile"], div[class*="author"], div[class*="result"], div[class*="item"]'));

      elements.forEach(element => {
        // Try to find a link
        const link = element.querySelector('a[href]');
        const href = link ? link.getAttribute('href') : '';

        // Skip if not a profile link
        if (!href || (!href.includes('/p/') && !href.includes('/profile/') && !href.includes('/user/'))) return;

        // Try to find name and bio
        const nameElement = element.querySelector('h1, h2, h3, h4, strong, b, [class*="name"], [class*="user"]');
        const bioElement = element.querySelector('p, [class*="bio"], [class*="description"], [class*="content"]');

        const name = nameElement ? nameElement.textContent.trim() : '';
        let bio = bioElement ? bioElement.textContent.trim() : '';
        if (bio.length > 300) bio = bio.substring(0, 297) + '...';

        // Try to find a pubkey
        let hexPubkey = '';
        const userDataElement = element.querySelector('[data-user]');
        if (userDataElement) {
          hexPubkey = userDataElement.getAttribute('data-user');
        }

        // Extract profile ID from href if available
        let profileId = '';
        if (href) {
          if (href.includes('/p/')) {
            profileId = href.split('/p/')[1].split('/')[0].split('?')[0];
          } else if (href.includes('/profile/')) {
            profileId = href.split('/profile/')[1].split('/')[0].split('?')[0];
          } else if (href.includes('/user/')) {
            profileId = href.split('/user/')[1].split('/')[0].split('?')[0];
          }
        }

        results.push({
          profileId,
          name: name || 'Unknown User',
          bio,
          hexPubkey,
          url: href ? (href.startsWith('http') ? href : `https://primal.net${href}`) : ''
        });
      });

      // Method 2: Look for any elements with data-user attribute (contains pubkey)
      const dataUserElements = Array.from(document.querySelectorAll('[data-user]'));
      dataUserElements.forEach(element => {
        const hexPubkey = element.getAttribute('data-user');
        if (!hexPubkey) return;

        // Try to find a parent that looks like a user card
        let container = element;
        for (let i = 0; i < 5; i++) {
          if (!container.parentElement) break;
          container = container.parentElement;
          if (
            container.className.includes('card') ||
            container.className.includes('user') ||
            container.className.includes('profile') ||
            container.className.includes('author') ||
            container.className.includes('result') ||
            container.className.includes('item')
          ) {
            break;
          }
        }

        // Try to find a link
        const link = container.querySelector('a[href]');
        const href = link ? link.getAttribute('href') : '';

        // Try to find name and bio
        const nameElement = container.querySelector('h1, h2, h3, h4, strong, b, [class*="name"], [class*="user"]');
        const bioElement = container.querySelector('p, [class*="bio"], [class*="description"], [class*="content"]');

        const name = nameElement ? nameElement.textContent.trim() : '';
        let bio = bioElement ? bioElement.textContent.trim() : '';
        if (bio.length > 300) bio = bio.substring(0, 297) + '...';

        // Extract profile ID from href if available
        let profileId = '';
        if (href) {
          if (href.includes('/p/')) {
            profileId = href.split('/p/')[1].split('/')[0].split('?')[0];
          } else if (href.includes('/profile/')) {
            profileId = href.split('/profile/')[1].split('/')[0].split('?')[0];
          } else if (href.includes('/user/')) {
            profileId = href.split('/user/')[1].split('/')[0].split('?')[0];
          }
        }

        results.push({
          profileId,
          name: name || 'Unknown User',
          bio,
          hexPubkey,
          url: href ? (href.startsWith('http') ? href : `https://primal.net${href}`) : `https://primal.net/p/${hexPubkey}`
        });
      });

      return results.filter(item => item.profileId || item.hexPubkey || item.url);
    });

    logger.log(`Found ${userElements.length} potential user elements with alternative methods`);

    // Add unique profiles from the alternative approach
    const newCount = addUniqueProfiles(userElements);
    logger.log(`Found ${newCount} new unique profiles from alternative approach, total: ${allProfileLinks.length}`);

    // Update profileLinks to use our unique profiles collection
    profileLinks = allProfileLinks;

    // Process the extracted profiles
    const processedUsers = [];
    // We don't need processedIds here anymore since we've already de-duplicated using uniqueProfileTracker

    for (const profile of profileLinks) {

      let npub = '';
      let pubkey = '';

      // Process the profileId to get npub or pubkey
      if (profile.profileId && profile.profileId.startsWith('npub')) {
        npub = profile.profileId;
        try {
          // Decode npub to get pubkey
          const decoded = decode(npub);
          if (decoded.type === 'npub') {
            pubkey = decoded.data;
          }
        } catch (error) {
          logger.error(`Error decoding npub ${npub}:`, error.message);
        }
      } else if (profile.profileId && profile.profileId.startsWith('nprofile')) {
        // Handle nprofile format used by Primal.net
        try {
          logger.log(`Attempting to decode nprofile: ${profile.profileId}`);
          const decoded = nip19.decode(profile.profileId);
          logger.log('Decoded nprofile:', JSON.stringify(decoded, null, 2));

          if (decoded.type === 'nprofile' && decoded.data && decoded.data.pubkey) {
            pubkey = decoded.data.pubkey;
            logger.log(`Extracted pubkey from nprofile: ${pubkey}`);
            npub = nip19.npubEncode(pubkey);
            logger.log(`Generated npub: ${npub}`);
          }
        } catch (error) {
          logger.error(`Error decoding nprofile ${profile.profileId}:`, error.message);
        }
      } else if (profile.profileId && profile.profileId.match(/^[0-9a-f]{64}$/i)) {
        // This is a hex pubkey in the profileId field
        pubkey = profile.profileId;
        try {
          npub = nip19.npubEncode(pubkey);
        } catch (error) {
          logger.error(`Error encoding pubkey ${pubkey}:`, error.message);
        }
      } else if (profile.hexPubkey && profile.hexPubkey.length === 64) {
        // This is a hex pubkey
        pubkey = profile.hexPubkey;
        try {
          npub = nip19.npubEncode(pubkey);
        } catch (error) {
          logger.error(`Error encoding pubkey ${pubkey}:`, error.message);
        }
      } else if (profile.profileId && profile.profileId.length === 64) {
        // This might be a hex pubkey
        pubkey = profile.profileId;
        try {
          npub = nip19.npubEncode(pubkey);
        } catch (error) {
          logger.error(`Error encoding pubkey ${pubkey}:`, error.message);
        }
      }

      // For debugging
      logger.log('Processing profile:', {
        name: profile.name,
        profileId: profile.profileId,
        hexPubkey: profile.hexPubkey,
        pubkey,
        npub,
        url: profile.url
      });

      // Only add if we have enough information
      // All profiles from a Primal.net search are considered relevant since the site already filtered them
      if (pubkey || profile.url) {
        processedUsers.push({
          name: profile.name || 'Unknown User',
          bio: profile.bio || '',
          npub: npub || '',
          pubkey: pubkey || '',
          platform: 'nostr',
          url: profile.url || `https://primal.net/p/${profile.profileId || pubkey}`
        });
      }
    }

    logger.log(`Found ${processedUsers.length} Nostr users matching search terms`);
    return processedUsers;
  } catch (error) {
    logger.error(`Error searching for Nostr users: ${error.message}`);
    if (error.stack) {
      logger.debug('Error stack trace:', error.stack);
    }
    return [];
  } finally {
    // Make sure to close the browser
    if (browser) {
      try {
        await browser.close();
        logger.log('Browser closed');
      } catch (closeError) {
        logger.error(`Error closing browser: ${closeError.message}`);
      }
    }
  }
}

export async function messageUser(user, message) {
  // Extract pubkey from user object if needed
  const pubkey = typeof user === 'object' ? user.pubkey : user;

  if (!pubkey || typeof pubkey !== 'string') {
    throw new Error(`Invalid pubkey: ${JSON.stringify(pubkey)}. Expected a string.`);
  }

  logger.log(`[${dayjs().format('HH:mm')}] Messaging Nostr user: ${pubkey}`);

  try {
    // Create context
    const userContext = {
      platform: 'nostr',
      username: pubkey.substring(0, 8)
    };

    const personalizedMessage = await generatePersonalizedMessage(userContext)
      .catch(() => message); // Fallback to default message if AI fails

    // Create encrypted direct message event
    const encryptedContent = await nip04.encrypt(privateKey, pubkey, personalizedMessage);

    let event = {
      kind: 4, // Direct message
      pubkey: publicKey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', pubkey]],
      content: encryptedContent
    };

    // Sign the event
    event = finalizeEvent(event, privateKey);

    // Publish to relays
    logger.log(`\u2705 Created Nostr DM for user ${pubkey.substring(0, 8)}...`);
    logger.log(`Publishing message to ${RELAYS.length} relays...`);

    // Use SimplePool from nostr-tools to handle relay connections
    const pool = new SimplePool();

    try {
      // Simplified approach to publishing to relays
      logger.log('Connecting to relays...');

      // Use a more straightforward approach with SimplePool
      // The publish method returns an array of promises, one for each relay
      const pub = pool.publish(RELAYS, event);

      // Set up a timeout for the entire operation
      const timeout = 15000; // 15 seconds

      // Create a promise that resolves after all relays have been tried
      // or after the timeout, whichever comes first
      const publishWithTimeout = Promise.race([
        new Promise(resolve => {
          // Track successful relays
          const successfulRelays = [];
          let failedRelays = 0;

          // Set up a listener for each relay result
          RELAYS.forEach((relay, index) => {
            // Check if we have a corresponding promise in the pub array
            if (index < pub.length) {
              // Add a success handler
              pub[index].then(() => {
                successfulRelays.push(relay);
                logger.log(`Published to relay: ${relay}`);

                // If all relays have responded, resolve the main promise
                if (successfulRelays.length + failedRelays === RELAYS.length) {
                  resolve({ successfulRelays });
                }
              }).catch(error => {
                failedRelays++;
                // Provide more detailed error information
                const errorMessage = error.message || 'Unknown error';
                const errorDetails = error.stack ? `
${error.stack}` : '';
                logger.warn(`Failed to publish to relay ${relay}: ${errorMessage}${errorDetails}`);

                // If all relays have responded, resolve the main promise
                if (successfulRelays.length + failedRelays === RELAYS.length) {
                  resolve({ successfulRelays });
                }
              });
            }
          });
        }),
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({ timedOut: true });
          }, timeout);
        })
      ]);

      // Wait for the publish operation to complete or timeout
      const result = await publishWithTimeout;

      if (result.timedOut) {
        logger.warn('\u26a0\ufe0f Publish operation timed out after 15 seconds');
        // Even if timed out, we might have had some successful relays
        if (result.successfulRelays && result.successfulRelays.length > 0) {
          logger.log(`Message was published to ${result.successfulRelays.length} relays before timeout: ${result.successfulRelays.join(', ')}`);
          return { success: true, relays: result.successfulRelays };
        }
      } else if (result.successfulRelays && result.successfulRelays.length > 0) {
        logger.log(`\u2705 Message published successfully to ${result.successfulRelays.length} relays: ${result.successfulRelays.join(', ')}`);
        return { success: true, relays: result.successfulRelays };
      } else {
        logger.warn('\u26a0\ufe0f Failed to publish to any relays');
      }

      // If we reached here with no successful relays, return failure
      if (!result.successfulRelays || result.successfulRelays.length === 0) {
        return { success: false, error: 'Failed to publish to any relays' };
      }
    } catch (error) {
      logger.warn(`\u26a0\ufe0f Failed to publish to any relays: ${error.message}`);
    } finally {
      // Close all connections
      pool.close(RELAYS);
    }

    return event;
  } catch (error) {
    logger.error(`Error messaging Nostr user ${pubkey}: ${error.message}`);
    throw error;
  }
}
