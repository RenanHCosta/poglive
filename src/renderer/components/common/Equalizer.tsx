/** Poglive's speaking signal: three bouncing bars, like a live meter. */
export function Equalizer({ active }: { active: boolean }) {
  return (
    <span className={`eq${active ? ' active' : ''}`} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}
