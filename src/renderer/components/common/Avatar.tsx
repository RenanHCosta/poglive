const COLORS = [
  '#5865f2',
  '#3ba55c',
  '#e8a23a',
  '#ed4245',
  '#eb459e',
  '#00a8fc',
  '#9b59b6',
  '#6d7684',
];

export function avatarColor(peerId: string): string {
  let hash = 0;
  for (const character of peerId)
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length] ?? '#5865f2';
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0] ?? '?';
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  return [first, last]
    .filter((word): word is string => !!word)
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toUpperCase();
}

export type AvatarStatus = 'online' | 'voice' | 'live';

export function Avatar({
  peerId,
  name,
  size = 32,
  speaking = false,
  status = null,
}: {
  peerId: string;
  name: string;
  size?: number;
  speaking?: boolean;
  status?: AvatarStatus | null;
}) {
  return (
    <span
      className={`avatar${speaking ? ' speaking' : ''}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, Math.round(size * 0.38)),
        background: avatarColor(peerId),
      }}
      aria-hidden="true"
    >
      {initials(name)}
      {status && <span className={`avatar-status ${status}`} />}
    </span>
  );
}
