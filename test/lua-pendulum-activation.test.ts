import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelCardData } from "#duel/types.js";

const pendulumCards: DuelCardData[] = [
  { code: "101", name: "Low Scripted Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 1, rightScale: 1 },
  { code: "102", name: "High Scripted Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 8, rightScale: 8 },
  { code: "201", name: "Scripted Zone Blocker", kind: "spell", typeFlags: 0x2 },
  { code: "301", name: "Pendulum Candidate", kind: "monster", typeFlags: 0x1000001, level: 4 },
];

describe("Lua Pendulum activation", () => {
  it("activates scripted Pendulum monsters from hand as persistent scales before Pendulum Summons", () => {
    const source = pendulumScriptSource();
    const session = createDuel({ seed: 352, startingHandSize: 3, cardReader: createCardReader(pendulumCards) });
    loadDecks(session, {
      0: { main: ["101", "102", "301"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(101, source).ok).toBe(true);
    expect(host.loadCardScript(102, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const lowScale = session.state.cards.find((card) => card.code === "101");
    const highScale = session.state.cards.find((card) => card.code === "102");
    const candidate = session.state.cards.find((card) => card.code === "301");
    expect(lowScale).toBeDefined();
    expect(highScale).toBeDefined();
    expect(candidate).toBeDefined();

    const lowActivation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === lowScale!.uid);
    expect(lowActivation).toBeDefined();
    expect(applyResponse(session, lowActivation!).ok).toBe(true);
    expect(session.state.cards.find((card) => card.uid === lowScale!.uid)).toMatchObject({ location: "spellTrapZone", faceUp: true, sequence: 0 });

    const highActivation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === highScale!.uid);
    expect(highActivation).toBeDefined();
    expect(applyResponse(session, highActivation!).ok).toBe(true);
    expect(session.state.cards.find((card) => card.uid === highScale!.uid)).toMatchObject({ location: "spellTrapZone", faceUp: true, sequence: 1 });

    const pendulumSummon = getLegalActions(session, 0).find((action) => action.type === "pendulumSummon" && action.summonUids.includes(candidate!.uid));
    expect(pendulumSummon).toBeDefined();
    expect(session.state.cards.find((card) => card.uid === lowScale!.uid)?.location).toBe("spellTrapZone");
    expect(session.state.cards.find((card) => card.uid === highScale!.uid)?.location).toBe("spellTrapZone");
  });

  it("restores scripted Pendulum scale activation before the follow-up scale and Pendulum Summon", () => {
    const source = pendulumScriptSource();
    const session = createDuel({ seed: 352, startingHandSize: 3, cardReader: createCardReader(pendulumCards) });
    loadDecks(session, {
      0: { main: ["101", "102", "301"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(101, source).ok).toBe(true);
    expect(host.loadCardScript(102, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const lowScale = session.state.cards.find((card) => card.code === "101");
    const highScale = session.state.cards.find((card) => card.code === "102");
    const candidate = session.state.cards.find((card) => card.code === "301");
    expect(lowScale).toBeDefined();
    expect(highScale).toBeDefined();
    expect(candidate).toBeDefined();

    const lowActivation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === lowScale!.uid);
    expect(lowActivation).toBeDefined();
    expect(applyResponse(session, lowActivation!).ok).toBe(true);

    const restoredAfterLowScale = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(pendulumCards));
    expect(restoredAfterLowScale.restoreComplete).toBe(true);
    expect(restoredAfterLowScale.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredAfterLowScale, 0)).toEqual(getGroupedDuelLegalActions(restoredAfterLowScale.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredAfterLowScale, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredAfterLowScale, 0));
    expect(restoredAfterLowScale.registeredEffects).toBe(2);
    expect(getLuaRestoreLegalActions(restoredAfterLowScale, 0).some((action) => action.type === "activateEffect" && action.uid === lowScale!.uid)).toBe(false);

    const restoredHighActivation = getLuaRestoreLegalActions(restoredAfterLowScale, 0).find((action) => action.type === "activateEffect" && action.uid === highScale!.uid);
    expect(restoredHighActivation).toBeDefined();
    expect(applyLuaRestoreResponse(restoredAfterLowScale, restoredHighActivation!).ok).toBe(true);
    expect(restoredAfterLowScale.session.state.cards.find((card) => card.uid === lowScale!.uid)).toMatchObject({ location: "spellTrapZone", faceUp: true, sequence: 0 });
    expect(restoredAfterLowScale.session.state.cards.find((card) => card.uid === highScale!.uid)).toMatchObject({ location: "spellTrapZone", faceUp: true, sequence: 1 });

    const restoredAfterBothScales = restoreDuelWithLuaScripts(serializeDuel(restoredAfterLowScale.session), source, createCardReader(pendulumCards));
    expect(restoredAfterBothScales.restoreComplete).toBe(true);
    expect(restoredAfterBothScales.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredAfterBothScales, 0)).toEqual(getGroupedDuelLegalActions(restoredAfterBothScales.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredAfterBothScales, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredAfterBothScales, 0));

    const restoredPendulumSummon = getLuaRestoreLegalActions(restoredAfterBothScales, 0).find((action) => action.type === "pendulumSummon" && action.summonUids.includes(candidate!.uid));
    expect(restoredPendulumSummon).toBeDefined();
    expect(applyLuaRestoreResponse(restoredAfterBothScales, restoredPendulumSummon!).ok).toBe(true);
    expect(restoredAfterBothScales.session.state.cards.find((card) => card.uid === candidate!.uid)).toMatchObject({ location: "monsterZone", faceUp: true });
    expect(restoredAfterBothScales.session.state.cards.find((card) => card.uid === lowScale!.uid)?.location).toBe("spellTrapZone");
    expect(restoredAfterBothScales.session.state.cards.find((card) => card.uid === highScale!.uid)?.location).toBe("spellTrapZone");
  });

  it("stops scripted Pendulum activations when the modeled Pendulum zones are occupied", () => {
    const source = pendulumScriptSource();
    const session = createDuel({ seed: 739, startingHandSize: 4, cardReader: createCardReader(pendulumCards) });
    loadDecks(session, {
      0: { main: ["201", "101", "102", "301"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(101, source).ok).toBe(true);
    expect(host.loadCardScript(102, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const blocker = session.state.cards.find((card) => card.code === "201");
    const lowScale = session.state.cards.find((card) => card.code === "101");
    const highScale = session.state.cards.find((card) => card.code === "102");
    expect(blocker).toBeDefined();
    expect(lowScale).toBeDefined();
    expect(highScale).toBeDefined();

    const setBlocker = getLegalActions(session, 0).find((action) => action.type === "setSpellTrap" && action.uid === blocker!.uid);
    expect(setBlocker).toBeDefined();
    expect(applyResponse(session, setBlocker!).ok).toBe(true);
    expect(session.state.cards.find((card) => card.uid === blocker!.uid)).toMatchObject({ location: "spellTrapZone", faceUp: false, sequence: 0 });

    const lowActivation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === lowScale!.uid);
    expect(lowActivation).toBeDefined();
    expect(applyResponse(session, lowActivation!).ok).toBe(true);
    expect(session.state.cards.find((card) => card.uid === lowScale!.uid)).toMatchObject({ location: "spellTrapZone", faceUp: true, sequence: 1 });

    expect(getLegalActions(session, 0).some((action) => action.type === "activateEffect" && action.uid === highScale!.uid)).toBe(false);

    const restoredAfterOneScale = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(pendulumCards));
    expect(restoredAfterOneScale.restoreComplete).toBe(true);
    expect(restoredAfterOneScale.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredAfterOneScale, 0)).toEqual(getGroupedDuelLegalActions(restoredAfterOneScale.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredAfterOneScale, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredAfterOneScale, 0));
    expect(getLuaRestoreLegalActions(restoredAfterOneScale, 0).some((action) => action.type === "activateEffect" && action.uid === highScale!.uid)).toBe(false);
  });
});

function pendulumScriptSource() {
  return {
    readScript(name: string) {
      if (name === "c101.lua") return pendulumActivationScript(101);
      if (name === "c102.lua") return pendulumActivationScript(102);
      return undefined;
    },
  };
}

function pendulumActivationScript(code: number): string {
  return `
    c${code} = {}
    c${code}.initial_effect = function(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      c:RegisterEffect(e)
    end
  `;
}
