import { describe, expect, it } from "vitest";
import type { DuelAction, PublicDuelCard } from "#duel/types.js";
import { duelActionPresentation, duelPromptChoicePresentation } from "../src/playtest-app/duel-action-presenter.js";
import type { DuelPromptChoice } from "../src/playtest-app/duel-prompt-view.js";

function publicCard(card: Partial<PublicDuelCard> & Pick<PublicDuelCard, "code" | "name">): PublicDuelCard {
  return {
    uid: `${card.code}-uid`,
    kind: "spell",
    owner: 0,
    controller: 0,
    location: "spellTrapZone",
    sequence: 0,
    position: "faceUpAttack",
    faceUp: true,
    overlayCount: 0,
    ...card,
  };
}

describe("duel action presenter", () => {
  it("uses CDB effect text instead of raw Lua effect ids", () => {
    const card = publicCard({
      code: "48680970",
      name: "Eternal Soul",
      kind: "trap",
      effectTexts: ["Activate Effect?", "Special Summon \"Dark Magician\""],
    });
    const action: DuelAction = {
      type: "activateEffect",
      player: 0,
      uid: card.uid,
      effectId: "lua-51-1002",
      effectDescription: Number(card.code) * 16 + 1,
      label: "Eternal Soul: lua-51-1002",
    };

    const presentation = duelActionPresentation(action, { card, cardVisible: true });

    expect(presentation.title).toBe("Eternal Soul: Special Summon \"Dark Magician\"");
    expect(presentation.detail).toContain("Special Summon \"Dark Magician\"");
    expect(presentation.title).not.toContain("lua-");
  });

  it("does not repeat the card name when an effect description is only the card code", () => {
    const card = publicCard({
      code: "47222536",
      name: "Dark Magical Circle",
      description: "When this card is activated: Look at the top 3 cards of your Deck, then you can reveal 1 \"Dark Magician\" or 1 Spell/Trap that mentions it.",
    });
    const action: DuelAction = {
      type: "activateEffect",
      player: 0,
      uid: card.uid,
      effectId: "lua-52-1001",
      effectDescription: Number(card.code),
      label: "Dark Magical Circle: lua-52-1001",
    };
    const cardsByCode = new Map([[card.code, card]]);

    const presentation = duelActionPresentation(action, { card, cardVisible: true, cardsByCode });

    expect(presentation.title).toContain("Look at the top 3 cards");
    expect(presentation.title).not.toBe("Dark Magical Circle: Dark Magical Circle");
    expect(presentation.detail).toContain("Look at the top 3 cards");
  });

  it("decodes SelectEffect prompt choices into readable button labels", () => {
    const card = publicCard({
      code: "97631303",
      name: "Magicians' Souls",
      kind: "monster",
      effectTexts: ["Activate 1 of these effects", "Draw", "Special Summon this card"],
    });
    const cardsByCode = new Map([[card.code, card]]);
    const choice: DuelPromptChoice = {
      type: "selectOption",
      option: 1,
      description: Number(card.code) * 16 + 1,
      action: { type: "selectOption", player: 0, promptId: "prompt-1", option: 1, label: "Select option 1 (1562101250)" },
    };

    const presentation = duelPromptChoicePresentation(choice, { cardsByCode, luaPromptApi: "SelectEffect" });

    expect(presentation.title).toBe("Draw");
    expect(presentation.detail).toBe("Apply this effect: Draw");
  });
});
