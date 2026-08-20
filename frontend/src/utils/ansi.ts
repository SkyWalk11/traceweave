// Parses ANSI SGR color/bold codes (`\x1b[31m`, etc.) out of a log line into
// styled segments — the same escape codes a real terminal renders, which is
// what gives tools like vite/pnpm/artisan their colored output. Anything
// else (cursor movement, clear-screen, ...) is just stripped since a static
// log line has nowhere to "move the cursor" to.
export interface AnsiSegment {
  text: string;
  className?: string;
}

const SGR_RE = /\x1b\[([0-9;]*)m/g;
const OTHER_ESCAPE_RE = /\x1b\[[0-9;?]*[a-zA-Z]/g;

const COLOR_CODES: Record<number, string> = {
  30: "ansi-black",
  31: "ansi-red",
  32: "ansi-green",
  33: "ansi-yellow",
  34: "ansi-blue",
  35: "ansi-magenta",
  36: "ansi-cyan",
  37: "ansi-white",
  90: "ansi-bright-black",
  91: "ansi-bright-red",
  92: "ansi-bright-green",
  93: "ansi-bright-yellow",
  94: "ansi-bright-blue",
  95: "ansi-bright-magenta",
  96: "ansi-bright-cyan",
  97: "ansi-bright-white",
};

export function parseAnsiLine(line: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];
  let color = "";
  let bold = false;
  let lastIndex = 0;
  SGR_RE.lastIndex = 0;

  const push = (raw: string) => {
    const text = raw.replace(OTHER_ESCAPE_RE, "");
    if (!text) return;
    const className = [color, bold ? "ansi-bold" : ""].filter(Boolean).join(" ") || undefined;
    segments.push({ text, className });
  };

  let match: RegExpExecArray | null;
  while ((match = SGR_RE.exec(line))) {
    if (match.index > lastIndex) push(line.slice(lastIndex, match.index));
    const params = match[1].split(";").filter(Boolean).map(Number);
    for (const code of params.length ? params : [0]) {
      if (code === 0) {
        color = "";
        bold = false;
      } else if (code === 1) bold = true;
      else if (code === 22) bold = false;
      else if (code === 39) color = "";
      else if (code in COLOR_CODES) color = COLOR_CODES[code];
    }
    lastIndex = SGR_RE.lastIndex;
  }
  push(line.slice(lastIndex));

  return segments.length ? segments : [{ text: line.replace(OTHER_ESCAPE_RE, "") }];
}
