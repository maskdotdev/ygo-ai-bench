import { describe, expect, it } from "vitest";
import { applyAction, getLegalActions, runPlaytest, startPlaytest, chooseHighestPriority } from "#playtest/api.js";
import { DARK_MAGICIAN_CARD_IDS as IDS } from "#cards/definitions.js";

describe("Dark Magician scripts", () => {
  it("Magician's Rod searches a Dark Magician spell/trap on summon", () => {
    const session = findSessionWithNormalSummon([IDS.magiciansRod, IDS.eternalSoul], IDS.magiciansRod, 1);
    const summon = getLegalActions(session).find((action) => action.type === "normalSummon");
    expect(summon).toBeTruthy();

    applyAction(session, summon!);

    expect(session.engine.state.zones.hand.map((card) => card.id)).toContain(IDS.eternalSoul);
    expect(session.engine.state.log.some((entry) => entry.detail.includes("Magician's Rod search"))).toBe(true);
  });

  it("Illusion of Chaos searches a Dark Magician monster and returns a hand card", () => {
    const session = findSessionWithAction(
      [IDS.illusionOfChaos, IDS.ashBlossom, IDS.magiciansRod, IDS.darkMagician],
      "illusion-search",
      2,
    );
    const action = getLegalActions(session).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "illusion-search");
    expect(action).toBeTruthy();

    const beforeDeck = session.engine.state.zones.deck.length;
    const result = applyAction(session, action!);

    expect(result.ok).toBe(true);
    expect(session.engine.state.zones.hand.some((card) => card.id === IDS.magiciansRod || card.id === IDS.darkMagician)).toBe(true);
    expect(session.engine.state.zones.deck.length).toBe(beforeDeck);
  });

  it("Magicians' Souls sends a high-level spellcaster and Special Summons itself", () => {
    const session = findSessionWithAction(
      [IDS.magiciansSouls, IDS.ashBlossom, IDS.darkMagician],
      "souls-summon",
      1,
    );
    const action = getLegalActions(session).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "souls-summon");
    expect(action).toBeTruthy();

    const result = applyAction(session, action!);

    expect(result.ok).toBe(true);
    expect(session.engine.state.zones.field.map((card) => card.id)).toContain(IDS.magiciansSouls);
    expect(session.engine.state.zones.graveyard.map((card) => card.id)).toContain(IDS.darkMagician);
  });

  it("Dark Magical Circle adds a Dark Magician card from the top three", () => {
    const session = findSessionWithAction(
      [IDS.darkMagicalCircle, IDS.ashBlossom, IDS.darkMagician, IDS.calledByTheGrave],
      "circle-excavate",
      1,
    );
    const action = getLegalActions(session).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "circle-excavate");
    expect(action).toBeTruthy();

    const result = applyAction(session, action!);

    expect(result.ok).toBe(true);
    expect(session.engine.state.zones.hand.map((card) => card.id)).toContain(IDS.darkMagician);
  });

  it("Secrets of Dark Magic fusion summons The Dark Magicians", () => {
    const session = findSessionWithAction(
      [IDS.secretsOfDarkMagic, IDS.darkMagician, IDS.darkMagicianGirl],
      "secrets-fusion",
      3,
      [IDS.theDarkMagicians],
    );
    const action = getLegalActions(session).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "secrets-fusion");
    expect(action).toBeTruthy();

    const result = applyAction(session, action!);

    expect(result.ok).toBe(true);
    expect(session.engine.state.zones.field.map((card) => card.id)).toContain(IDS.theDarkMagicians);
    expect(session.engine.state.zones.graveyard.map((card) => card.id)).toEqual(expect.arrayContaining([IDS.darkMagician, IDS.darkMagicianGirl]));
  });

  it("can auto-run a short playtest with a structured evaluation", () => {
    const session = startPlaytest({
      deck: [IDS.magiciansRod, IDS.darkMagicalCircle, IDS.illusionOfChaos, IDS.magiciansSouls, IDS.darkMagician, IDS.soulServant],
      extraDeck: [IDS.theDarkMagicians],
      seed: 5,
      handSize: 5,
    });
    const result = runPlaytest(session, chooseHighestPriority, 6);

    expect(result.ok).toBe(true);
    expect(result.state.log).toHaveLength(9);
    expect(["strong", "playable", "thin", "weak"]).toContain(result.evaluation.quality);
  });
});

function findSessionWithAction(deck: string[], effectId: string, handSize: number, extraDeck: string[] = []) {
  for (let seed = 1; seed < 2000; seed += 1) {
    const session = startPlaytest({ deck, extraDeck, seed, handSize });
    if (getLegalActions(session).some((action) => action.type === "activateEffect" && action.effectId === effectId)) {
      return session;
    }
  }
  throw new Error(`Could not find seed for ${effectId}`);
}

function findSessionWithNormalSummon(deck: string[], cardId: string, handSize: number) {
  for (let seed = 1; seed < 2000; seed += 1) {
    const session = startPlaytest({ deck, seed, handSize });
    if (getLegalActions(session).some((action) => action.type === "normalSummon" && action.uid.includes(cardId))) return session;
  }
  throw new Error(`Could not find seed for ${cardId}`);
}
