/* global BigInt */
// Lightweight Cashu helpers using remote ESM from unpkg (prebuilt)
// - Generates blinded outputs locally
// - Unblinds signatures into spendable proofs
// Ported and aligned with shop implementation

// Prefer esm.sh which serves ESM with proper CORS and dependency resolution
const CASHU_ESM_URL = 'https://esm.sh/@cashu/cashu-ts@2.7.1';

let cashuModPromise = null;
async function loadCashu() {
  if (!cashuModPromise) {
    // Use dynamic import via Function to avoid bundler transforming it
    // eslint-disable-next-line no-new-func
    const dynamicImport = (url) => new Function('u', 'return import(u)')(url);
    cashuModPromise = dynamicImport(CASHU_ESM_URL);
  }
  return cashuModPromise;
}

function normalizeKeyset(mintKeys) {
  const pickFromArray = (arr) => {
    if (!arr.length) return null;
    const byCurrent = mintKeys?.current_keyset
      ? arr.find(key => key?.id === mintKeys.current_keyset || key?.keyset_id === mintKeys.current_keyset)
      : null;
    const active = arr.find(
      key => key?.active === true || key?.state === 'active' || key?.current === true || key?.is_active === true
    );
    return byCurrent || active || arr[0];
  };

  if (Array.isArray(mintKeys?.keysets)) {
    const picked = pickFromArray(mintKeys.keysets);
    if (picked) return picked;
  }
  if (Array.isArray(mintKeys)) {
    const picked = pickFromArray(mintKeys);
    if (picked) return picked;
  }
  if (mintKeys) {
    return mintKeys;
  }
  throw new Error('Mint keys are missing');
}

function resolveKeysetId(keyset) {
  const id = keyset?.id || keyset?.keyset_id || keyset?.keysetId;
  if (!id) {
    throw new Error('Mint keyset id is missing');
  }
  return String(id);
}

function splitAmountIntoDenominations(amount) {
  const denominations = [];
  let remaining = Math.floor(amount);
  while (remaining > 0) {
    const power = Math.floor(Math.log2(remaining));
    const value = 2 ** power;
    denominations.push(value);
    remaining -= value;
  }
  return denominations;
}

function ensureOutputAmounts(outputDatas, amount) {
  const extracted = outputDatas
    .map(data => Number(data?.amount ?? data?.value ?? 0))
    .filter(value => Number.isFinite(value) && value > 0);

  if (extracted.length === outputDatas.length && extracted.every(value => value > 0)) {
    return extracted;
  }

  return splitAmountIntoDenominations(amount);
}

function stringifyBlindedMessage(data) {
  if (!data) return '';

  const toHex = (value) => {
    if (!value) return '';
    // Node Buffer check omitted for browser environment, trusting checks below
    if (value instanceof Uint8Array || Array.isArray(value)) {
      return Array.from(value)
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    }
    return '';
  };

  // Try direct string access
  if (typeof data === 'string') return data;
  if (typeof data?.B_ === 'string') return data.B_;
  if (typeof data?.blindedMessage === 'string') return data.blindedMessage;

  // Check if blindedMessage is an object with B_ property (Cashu v2.7.1 format)
  if (data?.blindedMessage && typeof data.blindedMessage === 'object') {
    if (typeof data.blindedMessage.B_ === 'string') {
      return data.blindedMessage.B_;
    }
  }

  // Try toHex() method (for Point objects)
  if (data?.blindedMessage?.toHex && typeof data.blindedMessage.toHex === 'function') {
    try {
      const result = data.blindedMessage.toHex();
      if (result && typeof result === 'string') return result;
    } catch (e) {
      // Ignore errors
    }
  }

  if (data?.B_?.toHex && typeof data.B_.toHex === 'function') {
    try {
      const result = data.B_.toHex();
      if (result && typeof result === 'string') return result;
    } catch (e) {
      // Ignore errors
    }
  }

  // Try toHex property (might be a getter)
  if (typeof data?.blindedMessage?.toHex === 'string') return data.blindedMessage.toHex;
  if (typeof data?.B_?.toHex === 'string') return data.B_.toHex;

  // Try hex property
  if (typeof data?.blindedMessage?.hex === 'string') return data.blindedMessage.hex;
  if (typeof data?.B_?.hex === 'string') return data.B_.hex;

  // Try toString() but validate the result
  if (data?.blindedMessage?.toString && typeof data.blindedMessage.toString === 'function') {
    try {
      const result = data.blindedMessage.toString();
      if (result && typeof result === 'string' && !result.startsWith('[object') && result.length > 10) {
        return result;
      }
    } catch (e) {
      // Ignore errors
    }
  }

  if (data?.B_?.toString && typeof data.B_.toString === 'function') {
    try {
      const result = data.B_.toString();
      if (result && typeof result === 'string' && !result.startsWith('[object') && result.length > 10) {
        return result;
      }
    } catch (e) {
      // Ignore errors
    }
  }

  // Try array/buffer conversion
  const hexFromArray = toHex(data?.blindedMessage || data?.B_);
  if (hexFromArray) return hexFromArray;

  return '';
}

export function buildSwapOutputsFromOutputDatas(outputDatas, amountHint, mintKeys) {
  if (!Array.isArray(outputDatas) || outputDatas.length === 0) {
    return [];
  }

  const keyset = normalizeKeyset(mintKeys);
  const keysetId = resolveKeysetId(keyset);
  const outputAmounts = ensureOutputAmounts(outputDatas, Number(amountHint));

  if (outputAmounts.length !== outputDatas.length) {
    throw new Error('Failed to build blinded outputs for requested amount');
  }

  return outputDatas.map((data, index) => {
    const blindedMessage = stringifyBlindedMessage(data);
    if (!blindedMessage) {
      throw new Error('Missing blinded message in output data');
    }
    const resolvedId = data?.id || data?.keyset_id || data?.keysetId || keysetId;
    return {
      amount: Number(outputAmounts[index]),
      B_: String(blindedMessage),
      id: String(resolvedId)
    };
  });
}

// Create blinded outputs for a given amount using provided mint keys
export async function createBlindedOutputs(amount, mintKeys) {
  if (!amount || amount <= 0) throw new Error('Amount is required');
  
  const mod = await loadCashu();
  const { OutputData } = mod;
  
  const keyset = normalizeKeyset(mintKeys);
  
  if (typeof OutputData.createRandomData !== 'function') {
    throw new Error('OutputData.createRandomData is not a function. Cashu library version mismatch?');
  }
  
  const outputDatas = OutputData.createRandomData(Number(amount), keyset);
  
  if (!Array.isArray(outputDatas) || outputDatas.length === 0) {
    throw new Error('OutputData.createRandomData returned invalid data');
  }

  const outputs = buildSwapOutputsFromOutputDatas(outputDatas, Number(amount), mintKeys);
  
  return { outputDatas, outputs };
}

// Turn signatures (promises) into spendable proofs using previously created output data
export async function signaturesToProofs(signatures, mintKeys, outputDatas) {
  if (!Array.isArray(signatures) || signatures.length === 0) {
    return [];
  }

  await loadCashu();
  const keyset = normalizeKeyset(mintKeys);
  
  const proofs = signatures.map((sig, i) => outputDatas[i].toProof(sig, keyset));
  return proofs;
}

// Serialize OutputData instances so they can be persisted between sessions
export function serializeOutputDatas(outputDatas) {
  if (!Array.isArray(outputDatas)) return [];
  return outputDatas.map((od) => {
    if (!od) return null;
    const secretArray = od.secret instanceof Uint8Array ? Array.from(od.secret) : (Array.isArray(od.secret) ? od.secret : []);
    const blindingFactor = typeof od.blindingFactor === 'bigint' ? od.blindingFactor.toString() : (od.blindingFactor ?? '').toString();
    
    const serialized = {
      blindedMessage: od.blindedMessage,
      blindingFactor,
      secret: secretArray,
    };
    
    if (od?.amount) {
      serialized.amount = Number(od.amount);
    }
    if (od?.id || od?.keyset_id || od?.keysetId) {
      serialized.keysetId = String(od.id || od.keyset_id || od.keysetId);
    }
    
    return serialized;
  }).filter(Boolean);
}

const decodeSecretArray = (value) => {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return new Uint8Array(value);
  if (typeof value === 'string') {
    try {
      if (typeof atob === 'function') {
        const binary = atob(value);
        const arr = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
          arr[i] = binary.charCodeAt(i);
        }
        return arr;
      }
    } catch (e) {
      console.warn('Failed to decode secret string', e);
    }
  }
  return new Uint8Array();
};

const ensureBigInt = (value) => {
  if (typeof value === 'bigint') return value;
  if (typeof BigInt !== 'function') {
    throw new Error('BigInt not supported in this environment');
  }
  return BigInt(value);
};

export async function deserializeOutputDatas(serialized) {
  if (!Array.isArray(serialized) || serialized.length === 0) return [];
  const mod = await loadCashu();
  const { OutputData } = mod;
  return serialized.map((item) => {
    try {
      if (!item?.blindedMessage || item?.blindingFactor === undefined || item?.secret === undefined) {
        return null;
      }
      const factor = ensureBigInt(item.blindingFactor);
      const secret = decodeSecretArray(item.secret);
      const output = new OutputData(item.blindedMessage, factor, secret);
      
      if (item.amount && output) {
        output.amount = Number(item.amount);
      }
      if (item.keysetId && output) {
        output.id = item.keysetId;
        output.keysetId = item.keysetId;
      }
      
      return output;
    } catch (e) {
      console.warn('Failed to deserialize OutputData', e);
      return null;
    }
  }).filter(Boolean);
}