import { getPublicKey, getEventHash, signEvent, nip04 } from 'nostr-tools';
import dayjs from 'dayjs';

let privateKey;
let publicKey;

// List of popular Nostr relays
const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.info',
  'wss://nostr.fmt.wiz.biz',
  'wss://relay.snort.social'
];

export async function initialize() {
  privateKey = process.env.NOSTR_PRIVATE_KEY;
  publicKey = getPublicKey(privateKey);
  console.log('Nostr initialized with public key:', publicKey);
}

export async function findPotentialUsers(searchTerms) {
  console.log('Searching for Nostr users interested in:', searchTerms);
  
  // This is a simplified implementation since Nostr doesn't have a centralized search API
  // In a real implementation, you would connect to relays and filter events
  // For demonstration purposes, we'll return an empty array
  
  console.log('Note: Nostr search is limited by relay availability and content');
  return [];
}

export async function messageUser(pubkey, message) {
  console.log(`[${dayjs().format('HH:mm')}] Messaging Nostr user: ${pubkey}`);
  
  try {
    // Create encrypted direct message event
    const encryptedContent = await nip04.encrypt(privateKey, pubkey, message);
    
    const event = {
      kind: 4, // Direct message
      pubkey: publicKey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', pubkey]],
      content: encryptedContent
    };
    
    // Sign the event
    event.id = getEventHash(event);
    event.sig = signEvent(event, privateKey);
    
    // In a real implementation, you would publish this to relays
    console.log(`\u2705 Created Nostr DM for user ${pubkey.substring(0, 8)}...`);
    
    // Note: In a real implementation, you would connect to relays and publish the event
    // For demonstration purposes, we're just logging the event
    console.log('Note: This is a demo implementation. In production, connect to relays to publish the message.');
    
    return event;
  } catch (error) {
    console.error(`Error messaging Nostr user ${pubkey}: ${error.message}`);
    throw error;
  }
}
