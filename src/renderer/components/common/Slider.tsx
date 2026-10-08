import type { CSSProperties } from 'react';

/** Range input whose filled track reflects the value, like voice app sliders. */
export function Slider({
  value,
  min,
  max,
  step = 1,
  label,
  valueText,
  onChange,
  className,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  label: string;
  valueText?: string;
  onChange: (value: number) => void;
  className?: string;
}) {
  const fill = `${((value - min) / (max - min)) * 100}%`;
  return (
    <input
      type="range"
      className={`slider${className ? ` ${className}` : ''}`}
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={label}
      aria-valuetext={valueText}
      style={{ '--fill': fill } as CSSProperties}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  );
}
