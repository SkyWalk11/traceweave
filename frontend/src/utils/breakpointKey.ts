export function breakpointKey(service: string, file: string, line: number): string {
  return `${service}:${file}:${line}`;
}
