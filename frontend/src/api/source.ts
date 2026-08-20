import { apiFetch } from "./client";
import type { BrowseResult } from "../types";

export function browseFolder(dir?: string): Promise<BrowseResult> {
  const path = dir ? `/api/browse?dir=${encodeURIComponent(dir)}` : "/api/browse";
  return apiFetch<BrowseResult>(path);
}

export async function fetchSource(service: string, file: string): Promise<string | null> {
  try {
    const { text } = await apiFetch<{ text: string }>(
      `/api/source?file=${encodeURIComponent(file)}&service=${encodeURIComponent(service)}`
    );
    return text;
  } catch {
    return null;
  }
}
