export function basename(file: string): string {
  const slash = file.lastIndexOf("/");
  return slash === -1 ? file : file.slice(slash + 1);
}
