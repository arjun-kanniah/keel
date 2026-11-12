export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="var(--accent)" />
      <path d="M8 20h16l-3 5H11z" fill="var(--accent-ink)" />
      <path d="M16 6v12M16 8l6 8h-6" stroke="var(--accent-ink)" strokeWidth="2" fill="none" strokeLinejoin="round" />
    </svg>
  );
}
