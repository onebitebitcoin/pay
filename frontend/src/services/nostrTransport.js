// Minimal Nostr transport helper used for NUT-18 payment requests.
// Loads nostr-tools dynamically from esm.sh to avoid bundler issues.

const NOSTR_TOOLS_URL = 'https://esm.sh/nostr-tools@2.7.2?bundle';
const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://relay.snort.social'
];

let nostrToolsPromise = null;

const dynamicImport = (url) => new Function('u', 'return import(u)')(url);

async function loadNostrTools() {
  if (!nostrToolsPromise) {
    nostrToolsPromise = dynamicImport(NOSTR_TOOLS_URL);
  }
  return nostrToolsPromise;
}

const publishWithAck = (pool, relays, event, timeoutMs = 6000) => new Promise((resolve, reject) => {
  try {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('Relay publish timeout'));
    }, timeoutMs);

    const publishPromises = pool.publish(relays, event);

    Promise.race([
      publishPromises,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Relay publish timeout')), timeoutMs))
    ]).then(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    }).catch((error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  } catch (error) {
    reject(error instanceof Error ? error : new Error(String(error)));
  }
});

export async function sendPaymentViaNostr(options) {
  if (typeof window === 'undefined') {
    throw new Error('Nostr transport is only available in browser environments');
  }

  const { nprofile, payload, relays = [], connectTimeoutMs = 5000, publishTimeoutMs = 6000 } = options || {};
  if (!nprofile) {
    throw new Error('Missing nprofile for Nostr transport');
  }
  if (!payload || typeof payload !== 'object') {
    throw new Error('Missing payload for Nostr transport');
  }

  const tools = await loadNostrTools();
  const { nip19, SimplePool, nip04, generateSecretKey, finalizeEvent } = tools;

  const decoded = nip19.decode(nprofile);
  if (!decoded || decoded.type !== 'nprofile' || !decoded.data?.pubkey) {
    throw new Error('Invalid nprofile');
  }

  const targetPubkey = decoded.data.pubkey;
  const relayCandidates = Array.isArray(decoded.data.relays) && decoded.data.relays.length
    ? decoded.data.relays
    : (Array.isArray(relays) && relays.length ? relays : DEFAULT_RELAYS);

  if (!relayCandidates.length) {
    throw new Error('No relays available for Nostr transport');
  }

  const senderPrivKey = generateSecretKey();
  const plaintext = JSON.stringify(payload);
  const encrypted = await nip04.encrypt(senderPrivKey, targetPubkey, plaintext);

  const eventTemplate = {
    kind: 4,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', targetPubkey]],
    content: encrypted,
  };

  const event = finalizeEvent(eventTemplate, senderPrivKey);

  const pool = new SimplePool();
  try {
    await publishWithAck(pool, relayCandidates, event, publishTimeoutMs);
    pool.close(relayCandidates);
    return { relay: relayCandidates[0] };
  } catch (error) {
    try { pool.close(relayCandidates); } catch {}
    throw error instanceof Error ? error : new Error('Failed to send via Nostr transport');
  }
}
