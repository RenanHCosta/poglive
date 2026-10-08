export type IconName =
  | 'home'
  | 'user'
  | 'users'
  | 'help'
  | 'expand'
  | 'collapse'
  | 'copy'
  | 'mic'
  | 'micOff'
  | 'headphones'
  | 'headphonesOff'
  | 'settings'
  | 'hangup'
  | 'screen'
  | 'screenShare'
  | 'screenOff'
  | 'hash'
  | 'speaker'
  | 'speakerOff'
  | 'plus'
  | 'link'
  | 'logout'
  | 'close'
  | 'chevronDown'
  | 'chevronRight'
  | 'pip'
  | 'crown'
  | 'send'
  | 'eye'
  | 'refresh'
  | 'message'
  | 'alert'
  | 'check'
  | 'download'
  | 'signal'
  | 'external'
  | 'keyboard'
  | 'bell'
  | 'info'
  | 'monitor'
  | 'window';

// Original 24×24 stroke icons drawn for Poglive.
const paths: Record<IconName, string> = {
  home: 'M3 10.5 12 3l9 7.5M5.5 9v10h13V9M9 19v-5h6v5',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0',
  users:
    'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9a6 6 0 0 1 12 0M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.5a6 6 0 0 1 3 5.5',
  help: 'M9.7 9a2.5 2.5 0 1 1 4.2 1.8c-1.1.9-1.9 1.3-1.9 2.7M12 17.5h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
  expand:
    'M8 3H3v5M3 3l6 6M16 3h5v5M21 3l-6 6M8 21H3v-5M3 21l6-6M16 21h5v-5M21 21l-6-6',
  collapse:
    'm9 3-6 6m0-6v6h6m6 12 6-6m0 6v-6h-6M3 15l6 6m-6 0v-6h6M21 9l-6-6m6 0v6h-6',
  copy: 'M8 8V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-3M6 8h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7',
  micOff:
    'M15 10V6a3 3 0 0 0-5.7-1.3M9 9v3a3 3 0 0 0 4.6 2.5M5.5 11a6.5 6.5 0 0 0 10.4 5.2M18.5 11a6.4 6.4 0 0 1-.5 2.5M12 17.5V21M8.5 21h7M3.5 3.5l17 17',
  headphones:
    'M4 15v-3a8 8 0 0 1 16 0v3M4 15a2 2 0 0 1 2-2h1.5v7H6a2 2 0 0 1-2-2v-3Zm16 0a2 2 0 0 0-2-2h-1.5v7H18a2 2 0 0 0 2-2v-3Z',
  headphonesOff:
    'M4 15v-3a8 8 0 0 1 12.3-6.7M19.6 9.5c.3.8.4 1.6.4 2.5v3M4 15a2 2 0 0 1 2-2h1.5v7H6a2 2 0 0 1-2-2v-3Zm12.5 1v4H18a2 2 0 0 0 2-2v-3M3.5 3.5l17 17',
  settings:
    'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM10.4 3h3.2l.5 2.4 1.7.9 2.3-.9 1.6 2.8-1.8 1.6v2.4l1.8 1.6-1.6 2.8-2.3-.9-1.7.9-.5 2.4h-3.2l-.5-2.4-1.7-.9-2.3.9-1.6-2.8 1.8-1.6v-2.4L4.3 8.2l1.6-2.8 2.3.9 1.7-.9.5-2.4Z',
  hangup:
    'M3 14.2c4.9-4.4 13.1-4.4 18 0l-1.9 2.9-3.6-1.3-.4-2.6a11 11 0 0 0-6.2 0l-.4 2.6-3.6 1.3L3 14.2Z',
  screen: 'M3 5h18v11H3zM8 20h8M12 16v4',
  screenShare: 'M3 5h18v11H3zM8 20h8M12 16v4M12 13V8.5M9.5 11 12 8.5l2.5 2.5',
  screenOff: 'M3 5h18v11H3zM8 20h8M12 16v4M9.5 8.5l5 5m0-5-5 5',
  hash: 'M9.5 3 7.5 21M16.5 3l-2 18M4.5 8.5h16M3.5 15.5h16',
  speaker:
    'M4 9.5h3.5L12 5.5v13l-4.5-4H4v-5ZM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11',
  speakerOff: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4v-5ZM16 9.5l5 5m0-5-5 5',
  plus: 'M12 5v14M5 12h14',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11',
  close: 'M6 6l12 12M18 6 6 18',
  chevronDown: 'm6 9 6 6 6-6',
  chevronRight: 'm9 6 6 6-6 6',
  pip: 'M3 5h18v14H3zM12 12h6.5v4.5H12z',
  crown: 'M3.5 8 8 12l4-6.5 4 6.5 4.5-4-2 11h-13l-2-11Z',
  send: 'M4 12 20 4l-6.5 16-2.5-7-7-1Z',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  refresh: 'M20 11.5a8 8 0 1 1-2.4-5.7M20 4v5h-5',
  message: 'M4 5h16v11H9.5L4 20V5Z',
  alert: 'M12 3.5 2.5 20h19L12 3.5ZM12 10v4.5M12 17.5h.01',
  check: 'm5 12.5 4.5 4.5L19 7',
  download: 'M12 4v11M7 10.5l5 5 5-5M5 20h14',
  signal: 'M5 19v-3M10 19v-6.5M15 19V9M20 19V5.5',
  external:
    'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  keyboard: 'M3 6.5h18v11H3zM7 10h.01M11 10h.01M15 10h.01M18 10h.01M7 14h10',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16ZM10 20.5a2 2 0 0 0 4 0',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5.5M12 7.5h.01',
  monitor: 'M3 4.5h18v12H3zM8.5 20h7M12 16.5V20',
  window: 'M3 5h18v14H3zM3 9h18M6 7h.01M8.5 7h.01',
};

export function Icon({
  name,
  size = 16,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d={paths[name]} />
    </svg>
  );
}
