// sourceCache is keyed by service+file (not just file) since two services
// in different repos can share a relative path with different content.
export function sourceKey(service: string | undefined, file: string): string {
  return `${service ?? ""}:${file}`;
}
