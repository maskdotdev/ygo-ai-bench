import { describe, expect, it } from "vitest";
import { hydrateCardImagesByPasscode } from "../src/playtest-app/card-images.js";
import type { CardImageInfo } from "../src/playtest-app/ui.js";

describe("card image hydration", () => {
  it("derives YGOPRODeck image URLs by passcode and caches successes without the cardinfo API", async () => {
    const cache = new Map<string, CardImageInfo>();

    const result = await hydrateCardImagesByPasscode(["46986414", "7084129", "46986414"], cache);

    expect(result).toEqual({ loaded: ["46986414", "7084129"], failed: [] });
    expect(cache.get("46986414")).toEqual({
      small: "https://images.ygoprodeck.com/images/cards_small/46986414.jpg",
      large: "https://images.ygoprodeck.com/images/cards/46986414.jpg",
    });
    expect(cache.get("7084129")).toEqual({
      small: "https://images.ygoprodeck.com/images/cards_small/7084129.jpg",
      large: "https://images.ygoprodeck.com/images/cards/7084129.jpg",
    });
  });

  it("can probe image URLs and keep later images loading when one passcode fails", async () => {
    const cache = new Map<string, CardImageInfo>();
    const fetchImageData = async (url: string) => {
      const id = url.match(/\/([^/]+)\.jpg$/)?.[1];
      if (id === "bad") return new Response("{}", { status: 500 });
      return new Response("");
    };

    const result = await hydrateCardImagesByPasscode(["bad", "good"], cache, fetchImageData);

    expect(result.loaded).toEqual(["good"]);
    expect(result.failed).toEqual([{ id: "bad", reason: "YGOPRODeck image 500" }]);
    expect(cache.get("good")).toEqual({
      small: "https://images.ygoprodeck.com/images/cards_small/good.jpg",
      large: "https://images.ygoprodeck.com/images/cards/good.jpg",
    });
  });
});
