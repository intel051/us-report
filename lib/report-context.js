// Signed public-data snapshots let any Edge instance write without refetching prices/news.
const encoder = new TextEncoder();
const bytes = value => encoder.encode(value);
const message = context => `${context.expiresAt}\n${context.payload}`;
const keyFor = secret => crypto.subtle.importKey('raw', bytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
export async function sealContext(data, secret) {
  if (!secret) return null;
  const context = { payload: JSON.stringify(data), expiresAt: Date.now() + 30 * 60000 };
  const signature = await crypto.subtle.sign('HMAC', await keyFor(secret), bytes(message(context)));
  return { ...context, signature: [...new Uint8Array(signature)].map(b => b.toString(16).padStart(2, '0')).join('') };
}
export async function openContext(context, secret) {
  if (!secret || !context || typeof context.payload !== 'string' || bytes(context.payload).length > 24000 || !Number.isFinite(context.expiresAt) || context.expiresAt <= Date.now() || context.expiresAt > Date.now() + 31 * 60000 || typeof context.signature !== 'string' || !/^[0-9a-f]{64}$/.test(context.signature)) return null;
  try {
    const signature = new Uint8Array(context.signature.match(/../g).map(b => parseInt(b, 16)));
    if (!await crypto.subtle.verify('HMAC', await keyFor(secret), signature, bytes(message(context)))) return null;
    const data = JSON.parse(context.payload);
    return data && Array.isArray(data.indices) && Array.isArray(data.headlines) ? data : null;
  } catch { return null; }
}
