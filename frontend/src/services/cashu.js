// Minimal Cashu client-side storage and helper functions

const STORAGE_KEY = 'cashu_proofs_v2'; // Updated to v2 for mint URL support

export function loadProofs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);

    // Handle legacy format (array of proofs without mint URL)
    if (Array.isArray(data)) {
      return data.map(p => ({
        ...p,
        mintUrl: p.mintUrl || process.env.REACT_APP_MINT_URL || 'https://mint.minibits.cash/Bitcoin'
      }));
    }

    // New format: { proofs: [...], mintUrl: '...' }
    return data.proofs || [];
  } catch {
    return [];
  }
}

export function saveProofs(proofs, mintUrl) {
  // Each proof should have its mint URL
  const proofsWithMint = proofs.map(p => ({
    ...p,
    mintUrl: p.mintUrl || mintUrl || process.env.REACT_APP_MINT_URL || 'https://mint.minibits.cash/Bitcoin'
  }));

  localStorage.setItem(STORAGE_KEY, JSON.stringify(proofsWithMint));
}

function uniqueBySecret(arr) {
  if (!Array.isArray(arr)) return [];
  const map = new Map();
  for (const p of arr) {
    const key = p?.secret || JSON.stringify(p);
    if (!map.has(key)) map.set(key, p);
  }
  return Array.from(map.values());
}

// Check if a proof is valid and usable
function isProofUsable(p) {
  // Exclude disabled proofs
  if (p.disabled) return false;
  // Exclude invalid proofs (missing required fields)
  if (!p.amount || p.amount <= 0) return false;
  if (!p.secret) return false;
  if (!p.id && !p.C) return false;
  return true;
}

export function calculateBalanceFromProofs(proofs) {
  const list = Array.isArray(proofs) ? proofs : [];
  return uniqueBySecret(list)
    .filter(isProofUsable)
    .reduce((sum, p) => sum + Number(p?.amount || 0), 0);
}

export function getBalanceSats() {
  // Only count valid and enabled proofs
  return calculateBalanceFromProofs(loadProofs());
}

// Very naive coin selection: pick largest-first until reaching target
// Only selects valid and enabled proofs
export function selectProofsForAmount(target) {
  const proofs = uniqueBySecret(loadProofs())
    .filter(isProofUsable)
    .slice()
    .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0));
  const picked = [];
  let total = 0;
  for (const p of proofs) {
    picked.push(p);
    total += Number(p.amount || 0);
    if (total >= target) break;
  }
  if (total < target) return { ok: false, picked: [], total: 0 };
  // Ensure picked is unique
  const uniquePicked = uniqueBySecret(picked);
  return { ok: true, picked: uniquePicked, total: uniquePicked.reduce((s, p) => s + Number(p?.amount || 0), 0) };
}

export function removeProofs(toRemove, mintUrl) {
  const current = loadProofs();
  const set = new Set(toRemove.map((p) => p?.secret || JSON.stringify(p)));
  const remain = current.filter((p) => !set.has(p?.secret || JSON.stringify(p)));
  saveProofs(remain, mintUrl);
}

export function addProofs(newProofs, mintUrl) {
  if (!Array.isArray(newProofs)) return;
  const current = loadProofs();

  // Add mint URL and creation timestamp to new proofs
  const timestamp = new Date().toISOString();
  const proofsWithMint = newProofs.map(p => ({
    ...p,
    mintUrl: p.mintUrl || mintUrl || process.env.REACT_APP_MINT_URL || 'https://mint.minibits.cash/Bitcoin',
    createdAt: p.createdAt || timestamp  // Add timestamp if not already present
  }));

  const merged = uniqueBySecret([...current, ...proofsWithMint]);
  saveProofs(merged, mintUrl);
}

// Toggle disabled state of a proof
export function toggleProofDisabled(proofSecret) {
  const proofs = loadProofs();
  const updated = proofs.map(p => {
    if ((p?.secret || JSON.stringify(p)) === proofSecret) {
      if (p?.disabled && p?.disabledReason === 'swap_failed') {
        // Do not allow enabling proofs that were locked due to swap failure
        return p;
      }

      const newDisabled = !p.disabled;

      // If enabling, remove disabled metadata
      if (!newDisabled) {
        const { disabled, disabledReason, disabledMessage, disabledAt, ...rest } = p;
        return rest;
      }

      // If disabling, add metadata (only if not already present)
      const disabledProof = {
        ...p,
        disabled: true,
        disabledReason: p.disabledReason || 'user',
        disabledAt: p.disabledAt || new Date().toISOString()
      };

      if (p.disabledMessage) {
        disabledProof.disabledMessage = p.disabledMessage;
      }

      return disabledProof;
    }
    return p;
  });
  saveProofs(updated);
  return updated;
}

// Export current proofs as JSON string
export function exportProofsJson(pretty = true) {
  const proofs = loadProofs();
  try {
    return JSON.stringify(proofs, null, pretty ? 2 : 0);
  } catch {
    return '[]';
  }
}

// Import proofs from JSON string or array; merges by unique secret
export function importProofsFrom(any) {
  let arr = any;
  if (typeof any === 'string') {
    try { arr = JSON.parse(any); } catch { arr = []; }
  }
  if (!Array.isArray(arr)) return { added: 0, total: loadProofs().length };
  const existing = loadProofs();
  const bySecret = new Map(existing.map(p => [p?.secret || JSON.stringify(p), p]));
  let added = 0;
  for (const p of arr) {
    const key = p?.secret || JSON.stringify(p);
    if (!bySecret.has(key)) { bySecret.set(key, p); added += 1; }
  }
  saveProofs(Array.from(bySecret.values()));
  return { added, total: bySecret.size };
}

// Verify proofs against Mint server and remove spent ones
export async function syncProofsWithMint(apiBaseUrl, mintUrl) {
  const proofs = loadProofs();
  if (proofs.length === 0) return { removed: 0, remaining: 0 };

  try {
    const url = `${apiBaseUrl}/api/cashu/check`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proofs, mintUrl })
    });

    if (!response.ok) {
      console.error('Proof check failed:', response.status);
      return { removed: 0, remaining: proofs.length };
    }

    const result = await response.json();
    const states = result?.states || [];

    // Build map of Y -> state
    const stateMap = new Map();
    for (const s of states) {
      if (s?.Y && s?.state) {
        stateMap.set(s.Y, s.state);
      }
    }

    // Filter out spent proofs
    const validProofs = [];
    const spentProofs = [];

    for (const p of proofs) {
      const Y = p?.Y || p?.C;
      const state = stateMap.get(Y);

      if (state === 'SPENT') {
        spentProofs.push(p);
      } else {
        validProofs.push(p);
      }
    }

    // Save only valid proofs
    if (spentProofs.length > 0) {
      saveProofs(validProofs, apiBaseUrl);
      console.log(`Removed ${spentProofs.length} spent proofs`);
    }

    return {
      removed: spentProofs.length,
      remaining: validProofs.length
    };
  } catch (error) {
    console.error('Sync error:', error);
    return { removed: 0, remaining: proofs.length };
  }
}

// Normalize proofs for API calls - ensure witness/dleq is a JSON string
function normalizeProofsForApi(proofs) {
  if (!Array.isArray(proofs)) return proofs;
  return proofs.map(proof => {
    if (!proof) return proof;

    const normalized = {
      amount: proof.amount,
      secret: proof.secret,
      C: proof.C
    };

    // Add id if present
    if (proof.id) {
      normalized.id = proof.id;
    }

    // Handle witness field (convert object to JSON string)
    if (proof.witness) {
      normalized.witness = typeof proof.witness === 'object'
        ? JSON.stringify(proof.witness)
        : proof.witness;
    }
    // Handle legacy dleq field (rename to witness and convert to JSON string)
    else if (proof.dleq) {
      normalized.witness = typeof proof.dleq === 'object'
        ? JSON.stringify(proof.dleq)
        : proof.dleq;
    }

    return normalized;
  });
}

// Swap all proofs for fresh ones (refresh proofs)
export async function refreshProofs(apiBaseUrl, createBlindedOutputsFn, signaturesToProofsFn, mintUrl) {
  const proofs = loadProofs();
  if (proofs.length === 0) return { success: false, error: 'No tokens to refresh' };

  try {
    // Get total amount
    const totalAmount = proofs.reduce((sum, p) => sum + Number(p?.amount || 0), 0);

    // Get mint keys
    const keysResp = await fetch(`${apiBaseUrl}/api/cashu/keys?mintUrl=${encodeURIComponent(mintUrl || '')}`);
    if (!keysResp.ok) throw new Error('Failed to fetch mint keys');
    const mintKeys = await keysResp.json();

    // Create new blinded outputs for the same amount
    const { outputs, outputDatas } = await createBlindedOutputsFn(totalAmount, mintKeys);

    // Normalize proofs before swap (ensure witness is JSON string)
    const normalizedProofs = normalizeProofsForApi(proofs);

    // Swap old proofs for new ones
    const swapResp = await fetch(`${apiBaseUrl}/api/cashu/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inputs: normalizedProofs,
        outputs,
        mintUrl
      })
    });

    if (!swapResp.ok) {
      const err = await swapResp.json();
      throw new Error(err?.error || 'Swap failed');
    }

    const swapResult = await swapResp.json();
    const signatures = swapResult?.signatures || swapResult?.promises || [];

    if (!Array.isArray(signatures) || signatures.length === 0) {
      throw new Error('No signatures received from swap response');
    }

    // Convert signatures to proofs
    const newProofs = await signaturesToProofsFn(signatures, mintKeys, outputDatas);

    // Replace old proofs with new ones
    saveProofs(newProofs, apiBaseUrl);

    return {
      success: true,
      oldCount: proofs.length,
      newCount: newProofs.length,
      amount: totalAmount
    };
  } catch (error) {
    console.error('Refresh proofs error:', error);
    return {
      success: false,
      error: error?.message || 'Unknown error'
    };
  }
}
