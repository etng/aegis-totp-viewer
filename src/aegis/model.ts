export type SupportedOtpType = 'totp' | 'hotp' | 'steam' | 'motp' | 'yandex';

export interface AegisAesParams {
  nonce: string;
  tag: string;
}

export interface AegisSlot {
  type: number;
  salt: string;
  n: number;
  r: number;
  p: number;
  key: string;
  key_params: AegisAesParams;
}

export interface AegisHeader {
  slots?: AegisSlot[];
  params?: AegisAesParams;
}

export interface AegisExport {
  version?: number;
  header?: AegisHeader;
  db?: unknown;
}

export interface AegisEntryInfo {
  secret?: string;
  algo?: string;
  digits?: number;
  period?: number;
  counter?: number;
}

export interface AegisEntry {
  type: string;
  uuid?: string;
  issuer?: string;
  name?: string;
  note?: string | null;
  favorite?: boolean;
  group?: string | null;
  groups?: string[];
  info?: AegisEntryInfo;
}

export interface AegisDb {
  entries?: AegisEntry[];
  groups?: AegisGroup[];
}

export interface AegisGroup {
  uuid?: string;
  name?: string;
}

export interface VaultEntry extends AegisEntry {
  id: string;
  type: SupportedOtpType;
  info: Required<Pick<AegisEntryInfo, 'secret'>> & AegisEntryInfo;
  displayIssuer: string;
  displayAccount: string;
  displayNote: string;
  groupNames: string[];
  favorite: boolean;
  period: number;
  searchable: string;
  colorSeed: string;
}

const supportedTypes = new Set<string>(['totp', 'hotp', 'steam', 'motp', 'yandex']);

export function isEncryptedExport(json: AegisExport): boolean {
  return Boolean(json.header?.slots?.length);
}

export function normalizeEntries(db: AegisDb): VaultEntry[] {
  const entries = Array.isArray(db.entries) ? db.entries : [];
  const groupNamesByUuid = new Map<string, string>();

  if (Array.isArray(db.groups)) {
    for (const group of db.groups) {
      if (group.uuid && group.name) {
        groupNamesByUuid.set(group.uuid, group.name);
      }
    }
  }

  return entries
    .filter((entry): entry is AegisEntry & { info: AegisEntryInfo & { secret: string } } => {
      return supportedTypes.has(entry.type) && Boolean(entry.info?.secret);
    })
    .sort((left, right) => {
      const leftLabel = left.issuer || left.name || '';
      const rightLabel = right.issuer || right.name || '';
      return leftLabel.localeCompare(rightLabel);
    })
    .map((entry, index) => {
      const issuer = entry.issuer || '未命名';
      const account = entry.name || '';
      const note = typeof entry.note === 'string' ? entry.note.trim() : '';
      const groupNames = getGroupNames(entry, groupNamesByUuid);
      const period = entry.type === 'hotp' ? 0 : entry.info.period || 30;

      return {
        ...entry,
        id: `${index}:${entry.type}:${issuer}:${account}`,
        type: entry.type as SupportedOtpType,
        info: entry.info,
        displayIssuer: issuer,
        displayAccount: account,
        displayNote: note,
        groupNames,
        favorite: Boolean(entry.favorite),
        period,
        searchable: `${issuer} ${account} ${note} ${groupNames.join(' ')}`.toLowerCase(),
        colorSeed: issuer || account || '?'
      };
    });
}

function getGroupNames(entry: AegisEntry, groupNamesByUuid: Map<string, string>): string[] {
  const names = new Set<string>();

  if (Array.isArray(entry.groups)) {
    for (const groupUuid of entry.groups) {
      if (!groupUuid) {
        continue;
      }
      names.add(groupNamesByUuid.get(groupUuid) || groupUuid);
    }
  }

  if (typeof entry.group === 'string' && entry.group.trim()) {
    names.add(entry.group.trim());
  }

  return [...names];
}
