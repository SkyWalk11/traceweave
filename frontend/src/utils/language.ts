const LANGUAGE_BY_EXT: Record<string, string> = {
  go: "go",
  php: "php",
  js: "javascript",
  ts: "typescript",
  py: "python",
};

export function languageFor(file: string | undefined): string {
  const ext = file?.split(".").pop();
  return (ext && LANGUAGE_BY_EXT[ext]) ?? "plaintext";
}
