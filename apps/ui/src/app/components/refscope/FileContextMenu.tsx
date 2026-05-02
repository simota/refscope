// FileContextMenu — 右クリックでファイル履歴を開くシンプルなメニュー
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type FileContextMenuProps = {
  open: boolean;
  x: number;
  y: number;
  path: string | null;
  onClose: () => void;
  onOpenHistory: (path: string) => void;
};

export function FileContextMenu({
  open,
  x,
  y,
  path,
  onClose,
  onOpenHistory,
}: FileContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjustedPos, setAdjustedPos] = useState({ x, y });

  // Reset adjusted pos whenever open or anchor coords change
  useLayoutEffect(() => {
    setAdjustedPos({ x, y });
  }, [open, x, y]);

  // Keep menu inside the viewport
  useLayoutEffect(() => {
    if (!open || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const margin = 8;
    let nx = x;
    let ny = y;
    if (x + rect.width > window.innerWidth - margin) {
      nx = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    if (y + rect.height > window.innerHeight - margin) {
      ny = Math.max(margin, window.innerHeight - rect.height - margin);
    }
    if (nx !== adjustedPos.x || ny !== adjustedPos.y) {
      setAdjustedPos({ x: nx, y: ny });
    }
  }, [open, x, y, adjustedPos.x, adjustedPos.y]);

  // Close on outside interaction
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
      onClose();
    };
    const onDocContextMenu = (e: MouseEvent) => {
      // Allow opening another context menu by closing this one first.
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onScroll = () => onClose();
    window.addEventListener('mousedown', onDocMouseDown, true);
    window.addEventListener('contextmenu', onDocContextMenu, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('mousedown', onDocMouseDown, true);
      window.removeEventListener('contextmenu', onDocContextMenu, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, onClose]);

  if (!open || !path) return null;

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="File context menu"
      style={{
        position: 'fixed',
        top: adjustedPos.y,
        left: adjustedPos.x,
        zIndex: 9999,
        minWidth: 220,
        maxWidth: 360,
        background: 'var(--rs-bg-elevated)',
        border: '1px solid var(--rs-border)',
        borderRadius: 8,
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.28)',
        padding: 4,
        fontFamily: 'var(--rs-sans)',
        fontSize: 12,
        color: 'var(--rs-text-primary)',
      }}
      onContextMenu={(e) => {
        // Prevent native menu when right-clicking inside our menu
        e.preventDefault();
      }}
    >
      <div
        style={{
          padding: '6px 10px 4px',
          fontSize: 10,
          color: 'var(--rs-text-secondary)',
          fontFamily: 'var(--rs-mono)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={path}
      >
        {path}
      </div>
      <div
        style={{
          height: 1,
          background: 'var(--rs-border)',
          margin: '2px 0 4px',
        }}
        aria-hidden="true"
      />
      <MenuButton
        onClick={() => {
          onOpenHistory(path);
          onClose();
        }}
        label="ファイル履歴を開く"
        sublabel="Open file history"
      />
    </div>
  );
}

function MenuButton({
  onClick,
  label,
  sublabel,
}: {
  onClick: () => void;
  label: string;
  sublabel?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      onMouseEnter={(e) => {
        e.currentTarget.style.background =
          'color-mix(in oklab, transparent, var(--rs-accent) 14%)';
        e.currentTarget.style.color = 'var(--rs-accent)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--rs-text-primary)';
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        textAlign: 'left',
        padding: '7px 10px',
        background: 'transparent',
        border: 'none',
        color: 'var(--rs-text-primary)',
        fontFamily: 'inherit',
        fontSize: 12,
        cursor: 'pointer',
        borderRadius: 4,
        outline: 'none',
        transition: 'background 80ms ease-out, color 80ms ease-out',
      }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        style={{ flexShrink: 0 }}
      >
        <circle cx="12" cy="12" r="9" />
        <polyline points="12 7 12 12 15 14" />
      </svg>
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span style={{ fontWeight: 500 }}>{label}</span>
        {sublabel && (
          <span
            style={{
              fontSize: 10,
              color: 'var(--rs-text-secondary)',
              opacity: 0.85,
            }}
          >
            {sublabel}
          </span>
        )}
      </span>
    </button>
  );
}
