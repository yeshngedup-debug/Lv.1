import { useMemo } from 'react';

/**
 * Audio-reactive equalizer bar field.
 * Idle: slow breathing. Active: dancing bars.
 * Heights/durations are randomized once per mount via CSS custom props.
 */
export function Equalizer({ active = false, bars = 40, className = '' }) {
  const seeds = useMemo(
    () =>
      Array.from({ length: bars }, (_, i) => ({
        h: 18 + Math.round(Math.abs(Math.sin(i * 12.9898) * 43758.5453 % 1) * 82),
        d: (0.55 + Math.abs(Math.sin(i * 78.233) * 9173.498 % 1) * 0.75).toFixed(2),
        delay: (Math.abs(Math.sin(i * 43.71) * 2717.113 % 1) * -1.2).toFixed(2),
      })),
    [bars]
  );

  return (
    <div
      className={`eq ${active ? 'eq--playing' : 'eq--idle'} ${className}`}
      role="img"
      aria-label={active ? 'Audio playing' : 'Audio stopped'}
    >
      {seeds.map((s, i) => (
        <span
          key={i}
          style={{ '--h': `${s.h}%`, '--d': `${s.d}s`, '--delay': `${s.delay}s` }}
        />
      ))}
    </div>
  );
}
