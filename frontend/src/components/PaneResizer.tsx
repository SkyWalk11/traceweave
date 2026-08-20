export const PANE_MIN_WIDTH = 240;
export const PANE_MAX_WIDTH = 900;
export const PANE_DEFAULT_WIDTH = 340;

interface Props {
  width: number;
  onWidthChange: (width: number) => void;
  minWidth?: number;
  maxWidth?: number;
}

// Thin draggable handle between panes. Reads the starting width from a prop
// at mousedown time so each drag's math is self-contained and correct even
// as the parent re-renders mid-drag.
export function PaneResizer({ width, onWidthChange, minWidth = PANE_MIN_WIDTH, maxWidth = PANE_MAX_WIDTH }: Props) {
  function onMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;

    function onMove(ev: MouseEvent) {
      const next = Math.min(maxWidth, Math.max(minWidth, startWidth + (ev.clientX - startX)));
      onWidthChange(next);
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  return <div className="pane-resizer" onMouseDown={onMouseDown} />;
}
