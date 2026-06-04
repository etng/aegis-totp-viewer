import { base32Decode, toArrayBuffer } from './encoding';
import type { VaultEntry } from './model';

const hashByAlgo: Record<string, string> = {
  SHA1: 'SHA-1',
  SHA256: 'SHA-256',
  SHA512: 'SHA-512',
  MD5: 'SHA-1'
};

function counterBuffer(counter: number): ArrayBuffer {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setBigUint64(0, BigInt(counter), false);
  return buffer;
}

async function hmac(secretBytes: Uint8Array, counter: number, algo: string | undefined): Promise<Uint8Array> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('当前浏览器不支持生成验证码所需的 Web Crypto。');
  }

  const hash = hashByAlgo[(algo || 'SHA1').toUpperCase()] || 'SHA-1';
  const key = await globalThis.crypto.subtle.importKey('raw', toArrayBuffer(secretBytes), { name: 'HMAC', hash }, false, ['sign']);
  return new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, counterBuffer(counter)));
}

function truncate(signature: Uint8Array): number {
  const offset = signature[signature.length - 1] & 0x0f;
  return (
    ((signature[offset] & 0x7f) << 24) |
    ((signature[offset + 1] & 0xff) << 16) |
    ((signature[offset + 2] & 0xff) << 8) |
    (signature[offset + 3] & 0xff)
  );
}

export function groupCode(code: string): string {
  if (code.length <= 4) {
    return code;
  }

  const middle = Math.ceil(code.length / 2);
  return `${code.slice(0, middle)} ${code.slice(middle)}`;
}

export async function generateCode(entry: VaultEntry, counter: number): Promise<string> {
  const secret = base32Decode(entry.info.secret);
  const signature = await hmac(secret, counter, entry.info.algo);

  if (entry.type === 'steam') {
    let code = truncate(signature);
    const alphabet = '23456789BCDFGHJKMNPQRTVWXY';
    let output = '';

    for (let i = 0; i < 5; i += 1) {
      output += alphabet[code % alphabet.length];
      code = Math.floor(code / alphabet.length);
    }

    return output;
  }

  const digits = entry.info.digits || 6;
  return (truncate(signature) % 10 ** digits).toString().padStart(digits, '0');
}
