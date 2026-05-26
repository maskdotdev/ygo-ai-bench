import type { CardImageInfo } from "./ui.js";

export interface CardImageHydrationResult {
  loaded: string[];
  failed: Array<{ id: string; reason: string }>;
}

export type CardImageFetch = (url: string) => Promise<Response>;

export async function hydrateCardImagesByPasscode(
  ids: readonly string[],
  cache: Map<string, CardImageInfo>,
  fetchImageData?: CardImageFetch,
): Promise<CardImageHydrationResult> {
  const missing = [...new Set(ids.map(String).filter((id) => id && !cache.has(id)))];
  const loaded: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];

  for (const id of missing) {
    const small = `https://images.ygoprodeck.com/images/cards_small/${encodeURIComponent(id)}.jpg`;
    const large = `https://images.ygoprodeck.com/images/cards/${encodeURIComponent(id)}.jpg`;
    if (fetchImageData) {
      try {
        const response = await fetchImageData(small);
        if (!response.ok) throw new Error(`YGOPRODeck image ${response.status}`);
      } catch (error) {
        failed.push({ id, reason: error instanceof Error ? error.message : "Fetch failed" });
        continue;
      }
    }
    cache.set(id, { small, large });
    loaded.push(id);
  }

  return { loaded, failed };
}
