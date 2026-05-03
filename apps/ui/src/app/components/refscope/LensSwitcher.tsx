export type LensId = 'live' | 'pulse' | 'stream';

const LENSES: Array<{ id: LensId; label: string; labelJa: string }> = [
  { id: 'live',   label: 'Live',   labelJa: 'ライブ' },
  { id: 'pulse',  label: 'Pulse',  labelJa: 'パルス' },
  { id: 'stream', label: 'Stream', labelJa: 'ストリーム' },
];

export function LensSwitcher({
  activeLens,
  onLensChange,
}: {
  activeLens: LensId;
  onLensChange: (lens: LensId) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Lens"
      className="flex items-center gap-1 px-3"
      style={{
        height: 36,
        borderBottom: '1px solid var(--rs-border)',
        background: 'var(--rs-bg-panel)',
      }}
    >
      {LENSES.map((lens) => {
        const isActive = lens.id === activeLens;
        return (
          <button
            key={lens.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`lens-panel-${lens.id}`}
            id={`lens-tab-${lens.id}`}
            onClick={() => onLensChange(lens.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onLensChange(lens.id);
              }
            }}
            style={{
              height: 26,
              padding: '0 10px',
              fontSize: 12,
              fontFamily: 'var(--rs-sans)',
              fontWeight: isActive ? 600 : 400,
              borderRadius: 'var(--rs-radius-sm)',
              border: isActive
                ? '1px solid color-mix(in oklab, var(--rs-border), var(--rs-accent) 50%)'
                : '1px solid transparent',
              background: isActive
                ? 'color-mix(in oklab, var(--rs-bg-elevated), var(--rs-accent) 15%)'
                : 'transparent',
              color: isActive ? 'var(--rs-accent)' : 'var(--rs-text-secondary)',
              cursor: 'pointer',
              transition: 'background 80ms ease-out, color 80ms ease-out',
            }}
          >
            {lens.label}
          </button>
        );
      })}
    </div>
  );
}
