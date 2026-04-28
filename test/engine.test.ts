import { describe, expect, it } from "vitest";
import { applyAction, getLegalActions, startPlaytest } from "../src/playtest/index.js";
import { DARK_MAGICIAN_CARD_IDS as IDS } from "../src/cards/index.js";

describe("engine primitives", () => {
  it("draws deterministic opening hands from a seed", () => {
    const deck = [
      IDS.darkMagician,
      IDS.magiciansRod,
      IDS.illusionOfChaos,
      IDS.darkMagicalCircle,
      IDS.soulServant,
      IDS.magiciansSouls,
    ];
    const first = startPlaytest({ deck, seed: 42, handSize: 5 });
    const second = startPlaytest({ deck, seed: 42, handSize: 5 });

    expect(first.engine.state.zones.hand.map((card) => card.id)).toEqual(second.engine.state.zones.hand.map((card) => card.id));
    expect(first.engine.state.zones.deck).toHaveLength(1);
  });

  it("moves searched cards between zones without duplication", () => {
    const session = findSessionWithNormalSummon([IDS.magiciansRod, IDS.darkMagicalCircle], IDS.magiciansRod, 1);
    const summon = getLegalActions(session).find((action) => action.type === "normalSummon");
    expect(summon).toBeTruthy();
    const result = applyAction(session, summon!);

    expect(result.ok).toBe(true);
    expect(session.engine.state.zones.field.map((card) => card.id)).toContain(IDS.magiciansRod);
    expect(session.engine.state.zones.hand.map((card) => card.id)).toContain(IDS.darkMagicalCircle);
    expect(allUids(session)).toHaveLength(new Set(allUids(session)).size);
  });

  it("rejects a second normal summon", () => {
    const session = startPlaytest({
      deck: [IDS.magiciansRod, IDS.darkMagician, IDS.darkMagicianGirl],
      seed: 2,
      handSize: 2,
    });
    const firstSummon = getLegalActions(session).find((action) => action.type === "normalSummon");
    expect(firstSummon).toBeTruthy();
    expect(applyAction(session, firstSummon!).ok).toBe(true);

    const secondSummon = {
      type: "normalSummon" as const,
      uid: session.engine.state.zones.hand.find((card) => card.type === "monster")?.uid ?? "missing",
      label: "Illegal second summon",
    };
    const result = applyAction(session, secondSummon);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Normal Summon already used/);
  });
});

function allUids(session: ReturnType<typeof startPlaytest>): string[] {
  return Object.values(session.engine.state.zones).flat().map((card) => card.uid);
}

function findSessionWithNormalSummon(deck: string[], cardId: string, handSize: number) {
  for (let seed = 1; seed < 1000; seed += 1) {
    const session = startPlaytest({ deck, seed, handSize });
    if (getLegalActions(session).some((action) => action.type === "normalSummon" && action.uid.includes(cardId))) return session;
  }
  throw new Error(`Could not find seed for ${cardId}`);
}
