import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData } from "#duel/types.js";

const pendulumCards: DuelCardData[] = [
  { code: "101", name: "Low Scripted Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 1, rightScale: 1 },
  { code: "102", name: "High Scripted Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 8, rightScale: 8 },
  { code: "301", name: "Pendulum Candidate", kind: "monster", typeFlags: 0x1000001, level: 4 },
];

describe("Lua Pendulum activation", () => {
  it("activates scripted Pendulum monsters from hand as persistent scales before Pendulum Summons", () => {
    const source = {
      readScript(name: string) {
        if (name === "c101.lua") return pendulumActivationScript(101);
        if (name === "c102.lua") return pendulumActivationScript(102);
        return undefined;
      },
    };
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
});

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
