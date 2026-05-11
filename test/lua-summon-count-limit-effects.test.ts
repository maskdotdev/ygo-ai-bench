import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua summon count limit effects", () => {
  it("uses EFFECT_SET_SUMMON_COUNT_LIMIT as an absolute Normal Summon limit", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Summon Limit Source", kind: "monster", level: 4 },
      { code: "200", name: "First Summon", kind: "monster", level: 4 },
      { code: "300", name: "Second Summon", kind: "monster", level: 4 },
    ];
    const session = createDuel({ seed: 28, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300"] }, 1: { main: [] } });
    startDuel(session);

    const source = session.state.cards.find((card) => card.code === "100");
    const first = session.state.cards.find((card) => card.code === "200");
    const second = session.state.cards.find((card) => card.code === "300");
    expect(source).toBeDefined();
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0);
    source!.faceUp = true;
    source!.position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const setup = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_SET_SUMMON_COUNT_LIMIT)
        e:SetRange(LOCATION_MZONE)
        e:SetTargetRange(1,0)
        e:SetValue(3)
        c:RegisterEffect(e)
      end
      `,
      "summon-count-limit-register.lua",
    );
    expect(setup.ok, setup.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects).toEqual(expect.arrayContaining([expect.objectContaining({ code: 28, sourceUid: source!.uid, value: 3 })]));

    let actions = getLegalActions(session, 0);
    const firstSummon = actions.find((action) => action.type === "normalSummon" && action.uid === first!.uid);
    expect(firstSummon).toBeDefined();
    expect(applyResponse(session, firstSummon!).ok).toBe(true);
    expect(session.state.activityCounts[0].normalSummon).toBe(1);

    actions = getLegalActions(session, 0);
    const secondSummon = actions.find((action) => action.type === "normalSummon" && action.uid === second!.uid);
    expect(secondSummon).toBeDefined();
    expect(applyResponse(session, secondSummon!).ok).toBe(true);
    expect(session.state.activityCounts[0].normalSummon).toBe(2);
  });
});
