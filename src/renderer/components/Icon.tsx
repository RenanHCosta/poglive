export type IconName =
  'home' | 'user' | 'help' | 'expand' | 'collapse' | 'copy';

const paths: Record<IconName, string> = {
  home: 'M3 10.5 12 3l9 7.5M5.5 9v10h13V9M9 19v-5h6v5',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0',
  help: 'M9.7 9a2.5 2.5 0 1 1 4.2 1.8c-1.1.9-1.9 1.3-1.9 2.7M12 17.5h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
  expand:
    'M8 3H3v5M3 3l6 6M16 3h5v5M21 3l-6 6M8 21H3v-5M3 21l6-6M16 21h5v-5M21 21l-6-6',
  collapse:
    'm9 3-6 6m0-6v6h6m6 12 6-6m0 6v-6h-6M3 15l6 6m-6 0v-6h6M21 9l-6-6m6 0v6h-6',
  copy: 'M8 8V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-3M6 8h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z',
};

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
