// Minimal Nostr transport helper used for NUT-18 payment requests over NIP-17 DMs.
// Loads nostr-tools dynamically from esm.sh to avoid bundler issues.

const NOSTR_TOOLS_URL = 'https://esm.sh/nostr-tools@2.7.2?bundle';
export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://relay.snort.social'
];
const IDENTITY_STORAGE_KEY = 'nostr_identity_v1';

let nostrToolsPromise = null;

const dynamicImport = (url) => new Function('u', 'return import(u)')(url);

async function loadNostrTools() {
  if (!nostrToolsPromise) {
    nostrToolsPromise = dynamicImport(NOSTR_TOOLS_URL);
  }
  return nostrToolsPromise;
}

export async function ensureNostrIdentity() {
  if (typeof window === 'undefined') {
    throw new Error('Nostr is only available in browser environments');
  }

  try {
    const cached = JSON.parse(localStorage.getItem(IDENTITY_STORAGE_KEY) || 'null');
    if (cached?.secretKey && cached?.pubkey && cached?.nprofile) {
      return cached;
    }
  } catch (err) {
    console.warn('Failed to read cached nostr identity:', err);
  }

  const tools = await loadNostrTools();
  const { generateSecretKey, getPublicKey, nip19 } = tools;
  const secretKey = generateSecretKey();
  const pubkey = getPublicKey(secretKey);
  const nprofile = nip19.nprofileEncode({ pubkey, relays: DEFAULT_RELAYS });
  const identity = { secretKey, pubkey, nprofile, relays: DEFAULT_RELAYS };
  try {
    localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identity));
  } catch (err) {
    console.warn('Failed to persist nostr identity:', err);
  }
  return identity;
}

function uniqueRelays(relays = []) {
  return Array.from(new Set((relays || []).filter(Boolean)));
}

export async function decodeNprofile(nprofile) {
  const tools = await loadNostrTools();
  const { nip19 } = tools;
  const decoded = nip19.decode(nprofile);
  if (!decoded || decoded.type !== 'nprofile' || !decoded.data?.pubkey) {
    throw new Error('Invalid nprofile');
  }
  return {
    pubkey: decoded.data.pubkey,
    relays: uniqueRelays(decoded.data.relays || [])
  };
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

  const { nprofile, payload, relays = [], publishTimeoutMs = 8000 } = options || {};
  if (!nprofile) {
    throw new Error('Missing nprofile for Nostr transport');
  }
  if (!payload || typeof payload !== 'object') {
    throw new Error('Missing payload for Nostr transport');
  }

  const tools = await loadNostrTools();
  const { nip04, finalizeEvent } = tools;

  const sender = await ensureNostrIdentity();
  const { pubkey: targetPubkey, relays: targetRelays } = await decodeNprofile(nprofile);
  const relayCandidates = uniqueRelays([...(targetRelays || []), ...(relays || []), ...(sender.relays || DEFAULT_RELAYS)]);

  if (!relayCandidates.length) {
    throw new Error('No relays available for Nostr transport');
  }

  const plaintext = JSON.stringify(payload);
  const encrypted = await nip04.encrypt(sender.secretKey, targetPubkey, plaintext);

  const eventTemplate = {
    kind: 14,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', targetPubkey]],
    content: encrypted,
  };

  const event = finalizeEvent(eventTemplate, sender.secretKey);

  const pool = new (await loadNostrTools()).SimplePool();
  try {
    await publishWithAck(pool, relayCandidates, event, publishTimeoutMs);
    pool.close(relayCandidates);
    return { relay: relayCandidates[0], eventId: event.id };
  } catch (error) {
    try { pool.close(relayCandidates); } catch {}
    throw error instanceof Error ? error : new Error('Failed to send via Nostr transport');
  }
}

export async function subscribeToNostrDms({ relays = DEFAULT_RELAYS, onMessage, onError } = {}) {
  const identity = await ensureNostrIdentity();
  const relayList = uniqueRelays([...relays, ...(identity.relays || [])]);
  if (!relayList.length) {
    throw new Error('No relays available for subscription');
  }

  const tools = await loadNostrTools();
  const { nip04, SimplePool } = tools;
  const pool = new SimplePool();
  let closed = false;

  const sub = pool.subscribeMany(relayList, [{ kinds: [14], '#p': [identity.pubkey] }], {
    onevent: async (event) => {
      try {
        const plaintext = await nip04.decrypt(identity.secretKey, event.pubkey, event.content);
        const payload = JSON.parse(plaintext);
        onMessage?.({ event, payload });
      } catch (err) {
        const wrapped = err instanceof Error ? err : new Error(String(err));
        if (onError) {
          onError(wrapped, event);
        } else {
          console.warn('Failed to handle DM event', wrapped);
        }
      }
    },
    onerror: (err) => {
      const wrapped = err instanceof Error ? err : new Error(String(err));
      if (onError) {
        onError(wrapped);
      } else {
        console.warn('Nostr subscription error', wrapped);
      }
    }
  });

  console.info('[Nostr] DM subscription ready', { relays: relayList });

  return () => {
    if (closed) return;
    closed = true;
    try { sub.close(); } catch {}
    try { pool.close(relayList); } catch {}
  };
}
