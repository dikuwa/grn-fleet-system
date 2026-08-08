/**
 * Quiet technical linework used behind public hero surfaces.
 *
 * The pattern deliberately stays low contrast and uses the current text color
 * so it remains theme-safe without introducing gradients, new fonts or a
 * second visual language.
 */

export function TechnicalBackdrop({ className = '' }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 1400 420"
      preserveAspectRatio="none"
      className={`pointer-events-none absolute inset-0 h-full w-full text-white opacity-[0.045] ${className}`}
    >
      <g fill="none" stroke="currentColor" strokeWidth="1">
        <path d="M22 78h198l42 42h210l52-52h260l44 44h286l52-52h214" />
        <path d="M90 310h180l54-54h216l64 64h286l48-48h330" />
        <path d="M830 16v58l38 38v92l46 46v96" />
        <path d="M408 8v62l-36 36v88l-50 50v112" />
        <path d="M1120 40v46l-32 32v68l40 40v78" />
      </g>
      <g fill="currentColor">
        <circle cx="220" cy="78" r="3" />
        <circle cx="472" cy="120" r="3" />
        <circle cx="784" cy="68" r="3" />
        <circle cx="324" cy="256" r="3" />
        <circle cx="604" cy="320" r="3" />
        <circle cx="938" cy="272" r="3" />
        <circle cx="1166" cy="60" r="3" />
      </g>
      <g fill="none" stroke="currentColor" strokeWidth="0.7" opacity="0.65">
        <rect x="1010" y="126" width="170" height="94" rx="8" />
        <path d="M1036 194l32-30 30 18 30-38 28 18" />
        <circle cx="1098" cy="182" r="7" />
      </g>
    </svg>
  );
}
