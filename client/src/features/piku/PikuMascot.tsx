/** Piku's face: an original round mascot (a friendly "spark" with a leaf antenna). Pure SVG, no assets. */
export default function PikuMascot({ size = 40, mood = 'happy', className = '' }: { size?: number; mood?: 'happy' | 'thinking' | 'listening'; className?: string }) {
  const eyeY = mood === 'thinking' ? 21 : 22;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={className} aria-hidden="true">
      <defs>
        <radialGradient id="piku-body" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#8B73F0" />
          <stop offset="100%" stopColor="#5B3FD0" />
        </radialGradient>
      </defs>
      {/* leaf antenna */}
      <path d="M24 9 C24 5, 27 3, 31 3 C30 7, 27 9, 24 9 Z" fill="#F4B07F" />
      <path d="M24 9 L24 12" stroke="#F4B07F" strokeWidth="1.6" strokeLinecap="round" />
      {/* body */}
      <circle cx="24" cy="27" r="16" fill="url(#piku-body)" />
      {/* cheeks */}
      <circle cx="15.5" cy="30" r="2.4" fill="#F4B07F" opacity="0.55" />
      <circle cx="32.5" cy="30" r="2.4" fill="#F4B07F" opacity="0.55" />
      {/* eyes */}
      {mood === 'listening' ? (
        <>
          <circle cx="18.5" cy={eyeY} r="2.6" fill="#fff" />
          <circle cx="29.5" cy={eyeY} r="2.6" fill="#fff" />
          <circle cx="18.5" cy={eyeY} r="1.3" fill="#1D1B19" />
          <circle cx="29.5" cy={eyeY} r="1.3" fill="#1D1B19" />
        </>
      ) : (
        <>
          <ellipse cx="18.5" cy={eyeY} rx="2" ry="2.6" fill="#fff" />
          <ellipse cx="29.5" cy={eyeY} rx="2" ry="2.6" fill="#fff" />
          <circle cx={mood === 'thinking' ? 19.3 : 18.9} cy={eyeY - (mood === 'thinking' ? 0.8 : 0)} r="1.1" fill="#1D1B19" />
          <circle cx={mood === 'thinking' ? 30.3 : 29.9} cy={eyeY - (mood === 'thinking' ? 0.8 : 0)} r="1.1" fill="#1D1B19" />
        </>
      )}
      {/* mouth */}
      {mood === 'thinking'
        ? <path d="M21 32 L27 32" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
        : mood === 'listening'
          ? <ellipse cx="24" cy="32.5" rx="2.2" ry="1.8" fill="#fff" />
          : <path d="M19.5 31 Q24 35.5 28.5 31" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" />}
    </svg>
  );
}
