import { syncScrypt } from 'scrypt-js';
import { b64ToBytes, hexToBytes, toArrayBuffer } from './encoding';
import type { AegisDb, AegisExport } from './model';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function getSubtle(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error('当前浏览器不支持本地解密所需的 Web Crypto。');
  }
  return globalThis.crypto.subtle;
}

async function aesGcmDecrypt(
  keyBytes: Uint8Array,
  nonceHex: string,
  tagHex: string,
  cipherText: Uint8Array
): Promise<Uint8Array> {
  const subtle = getSubtle();
  const key = await subtle.importKey('raw', toArrayBuffer(keyBytes), { name: 'AES-GCM' }, false, ['decrypt']);
  const tag = hexToBytes(tagHex);
  const payload = new Uint8Array(cipherText.length + tag.length);
  payload.set(cipherText, 0);
  payload.set(tag, cipherText.length);

  const plain = await subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(hexToBytes(nonceHex))
    },
    key,
    toArrayBuffer(payload)
  );

  return new Uint8Array(plain);
}

function deriveScrypt(
  passwordBytes: Uint8Array,
  saltBytes: Uint8Array,
  n: number,
  r: number,
  p: number,
  length: number
): Uint8Array {
  return new Uint8Array(syncScrypt(passwordBytes, saltBytes, n, r, p, length));
}

function parsePlainDb(value: unknown): AegisDb {
  if (typeof value === 'string') {
    return JSON.parse(value) as AegisDb;
  }
  return value as AegisDb;
}

export async function decryptVault(json: AegisExport, password: string): Promise<AegisDb> {
  const slots = json.header?.slots?.filter((slot) => slot.type === 1) || [];

  if (slots.length === 0) {
    return parsePlainDb(json.db);
  }

  if (!password) {
    throw new Error('这是加密导出，请输入密码。');
  }

  const passwordBytes = encoder.encode(password);
  let masterKey: Uint8Array | null = null;

  for (const slot of slots) {
    try {
      const key = deriveScrypt(passwordBytes, hexToBytes(slot.salt), slot.n, slot.r, slot.p, 32);
      masterKey = await aesGcmDecrypt(key, slot.key_params.nonce, slot.key_params.tag, hexToBytes(slot.key));
      break;
    } catch {
      // Try the next password slot. Aegis exports can contain more than one slot.
    }
  }

  if (!masterKey) {
    throw new Error('密码错误，无法解锁备份。');
  }

  if (typeof json.db !== 'string' || !json.header?.params) {
    throw new Error('备份文件格式不完整，无法读取加密内容。');
  }

  const plain = await aesGcmDecrypt(
    masterKey,
    json.header.params.nonce,
    json.header.params.tag,
    b64ToBytes(json.db)
  );

  return JSON.parse(decoder.decode(plain)) as AegisDb;
}
