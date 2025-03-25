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

let privateKey;
let publicKey;

// List of popular Nostr relays
const RELAYS = [
  'wss://relay.primal.net',  // Added Primal relay
  'wss://relay.damus.io',
  'wss://relay.nostr.info',
  'wss://nostr.fmt.wiz.biz',
  'wss://relay.snort.social'
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
    
    // Function to extract profile links from the page
    const extractProfileLinks = async () => {
      return await page.evaluate(() => {
        // Get all links on the page
        const links = Array.from(document.querySelectorAll('a[href]'));
        
        // Filter for profile links
        return links
          .filter(link => {
            const href = link.getAttribute('href');
            return href && (
              href.includes('/p/') || 
              href.includes('/profile/') || 
              href.includes('/user/')
            );
          })
          .map(link => {
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
            const parentElement = link.parentElement;
            if (parentElement) {
              // Look for potential name elements
              const nameElements = parentElement.querySelectorAll('h1, h2, h3, h4, strong, b, [class*="name"], [class*="user"]');
              if (nameElements.length > 0) {
                name = nameElements[0].textContent.trim();
              }
              
              // Look for potential bio elements
              const bioElements = parentElement.querySelectorAll('p, [class*="bio"], [class*="description"], [class*="content"]');
              if (bioElements.length > 0) {
                bio = bioElements[0].textContent.trim();
                if (bio.length > 300) bio = bio.substring(0, 297) + '...';
              }
            }
            
            // If we couldn't find a name, use link text as fallback
            if (!name) {
              name = link.textContent.trim();
              if (name.length > 50) name = name.substring(0, 47) + '...';
            }
            
            // Look for data-user attribute which often contains the hex pubkey
            let hexPubkey = '';
            const userDataElement = link.querySelector('[data-user]') || link.closest('[data-user]');
            if (userDataElement) {
              hexPubkey = userDataElement.getAttribute('data-user');
            }
            
            return {
              profileId,
              name: name || 'Unknown User',
              bio,
              hexPubkey,
              url: href.startsWith('http') ? href : `https://primal.net${href}`
            };
          });
      });
    };
    
    // Implement continuous scrolling to get more results
    let allProfileLinks = [];
    const targetProfileCount = 50;
    const maxScrollAttempts = 10;
    let scrollAttempts = 0;
    
    // Initial extraction
    let profileLinks = await extractProfileLinks();
    allProfileLinks = [...profileLinks];
    logger.log(`Initially found ${profileLinks.length} potential profile links`);
    
    // Continue scrolling until we have enough profiles or reach max attempts
    while (allProfileLinks.length < targetProfileCount && scrollAttempts < maxScrollAttempts) {
      scrollAttempts++;
      
      // Scroll down to load more results
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      
      // Wait for new content to load
      await page.waitForTimeout(2000);
      
      // Extract profiles again
      profileLinks = await extractProfileLinks();
      
      // Add new unique profiles to our collection
      const existingIds = new Set(allProfileLinks.map(p => p.profileId));
      const newProfiles = profileLinks.filter(p => !existingIds.has(p.profileId));
      
      allProfileLinks = [...allProfileLinks, ...newProfiles];
      
      logger.log(`Scroll attempt ${scrollAttempts}: Found ${newProfiles.length} new profiles, total: ${allProfileLinks.length}`);
      
      // Take a screenshot after each scroll for debugging
      const scrollTimestamp = dayjs().format('YYYY-MM-DD-HH-mm-ss');
      const scrollScreenshotPath = path.join(logsDir, `primal-search-scroll${scrollAttempts}-${scrollTimestamp}.png`);
      await page.screenshot({ path: scrollScreenshotPath });
    }
    
    // Use the combined results from all scrolls
    profileLinks = allProfileLinks;
    logger.log(`Found ${profileLinks.length} potential profile links after ${scrollAttempts} scroll attempts`);
    logger.log('Profile links found:', JSON.stringify(profileLinks, null, 2));
    
    // If we didn't find any profile links, try a more aggressive approach
    if (profileLinks.length === 0) {
      logger.log('No profile links found, trying alternative approach...');
      
      // Try to extract any elements that might be user cards
      const userElements = await page.evaluate(() => {
        // Look for elements that might be user cards
        const elements = Array.from(document.querySelectorAll('div[class*="card"], div[class*="user"], div[class*="profile"], div[class*="author"]'));
        
        return elements.map(element => {
          // Try to find a link
          const link = element.querySelector('a[href]');
          const href = link ? link.getAttribute('href') : '';
          
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
          
          return {
            profileId,
            name: name || 'Unknown User',
            bio,
            hexPubkey,
            url: href ? (href.startsWith('http') ? href : `https://primal.net${href}`) : ''
          };
        }).filter(item => item.name !== 'Unknown User' || item.profileId || item.hexPubkey || item.url);
      });
      
      logger.log(`Found ${userElements.length} potential user elements`);
      
      // Combine the results
      profileLinks.push(...userElements);
    }
    
    // Process the extracted profiles
    const processedUsers = [];
    const processedIds = new Set(); // To avoid duplicates
    
    for (const profile of profileLinks) {
      // Skip if we've already processed this profile
      const uniqueId = profile.hexPubkey || profile.profileId || profile.url;
      if (processedIds.has(uniqueId)) continue;
      processedIds.add(uniqueId);
      
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
      
      // Check if this profile is relevant to the search
      const searchTermsArray = Array.isArray(searchTerms) ? searchTerms : [searchTerms];
      
      // For searches on Primal.net, consider all results relevant since the site already filtered them
      // But still check for exact matches in name/bio for better ranking
      const isExactMatch = searchTermsArray.some(term => {
        if (!term) return false;
        const lowerTerm = term.toLowerCase();
        return (
          (profile.name && profile.name.toLowerCase().includes(lowerTerm)) || 
          (profile.bio && profile.bio.toLowerCase().includes(lowerTerm)) || 
          (profile.profileId && profile.profileId.toLowerCase().includes(lowerTerm)) || 
          (pubkey && pubkey.toLowerCase().includes(lowerTerm)) || 
          (npub && npub.toLowerCase().includes(lowerTerm))
        );
      });
      
      // Consider all results from Primal.net search as relevant
      const isRelevant = true;
      
      // For debugging
      logger.log('Processing profile:', {
        name: profile.name,
        profileId: profile.profileId,
        hexPubkey: profile.hexPubkey,
        pubkey,
        npub,
        url: profile.url
      });
      
      // For debugging - show relevance check results
      logger.log(`Profile relevance check for ${profile.name}: ${isRelevant}`);      
      
      // Only add if we have enough information
      // All profiles from a Primal.net search are considered relevant
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
    return [];
  } finally {
    // Make sure to close the browser
    if (browser) {
      await browser.close();
      logger.log('Browser closed');
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
    // Create encrypted direct message event
    const encryptedContent = await nip04.encrypt(privateKey, pubkey, message);
    
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
      // Publish the event to all relays
      const pubs = pool.publish(RELAYS, event);
      
      // Wait for at least one relay to confirm publication
      const pub = await Promise.any(pubs);
      logger.log(`\u2705 Message published successfully to ${pub}`);
    } catch (error) {
      logger.warn('\u26a0\ufe0f Failed to publish to any relays:', error.message);
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
