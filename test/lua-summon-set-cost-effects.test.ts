import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { setDuelPlayerLifePoints } from "#duel/player-life.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua summon and set cost effects", () => {
  it("hides summon and set actions when Lua continuous costs cannot be paid", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Cost Source", kind: "monster" },
      { code: "200", name: "Summon Target", kind: "monster" },
      { code: "300", name: "Set Target", kind: "monster" },
      { code: "400", name: "Spell Target", kind: "spell" },
    ];
    const session = createDuel({ seed: 91, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300", "400"] }, 1: { main: [] } });
    startDuel(session);

    const source = session.state.cards.find((card) => card.code === "100");
    const summonTarget = session.state.cards.find((card) => card.code === "200");
    const setTarget = session.state.cards.find((card) => card.code === "300");
    const spellTarget = session.state.cards.find((card) => card.code === "400");
    expect(source).toBeDefined();
    expect(summonTarget).toBeDefined();
    expect(setTarget).toBeDefined();
    expect(spellTarget).toBeDefined();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0);
    source!.faceUp = true;
    source!.position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const setup = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e1=Effect.CreateEffect(c)
        e1:SetType(EFFECT_TYPE_FIELD)
        e1:SetCode(EFFECT_SUMMON_COST)
        e1:SetRange(LOCATION_MZONE)
        e1:SetTargetRange(LOCATION_HAND,0)
        e1:SetTarget(function(e,tc) return tc:IsCode(200) end)
        e1:SetCost(function(e,c,tp) return Duel.CheckLPCost(tp,1000) end)
        c:RegisterEffect(e1)
        local e2=Effect.CreateEffect(c)
        e2:SetType(EFFECT_TYPE_FIELD)
        e2:SetCode(EFFECT_MSET_COST)
        e2:SetRange(LOCATION_MZONE)
        e2:SetTargetRange(LOCATION_HAND,0)
        e2:SetTarget(function(e,tc) return tc:IsCode(300) end)
        e2:SetCost(function(e,c,tp) return Duel.CheckLPCost(tp,1000) end)
        c:RegisterEffect(e2)
        local e3=Effect.CreateEffect(c)
        e3:SetType(EFFECT_TYPE_FIELD)
        e3:SetCode(EFFECT_SSET_COST)
        e3:SetRange(LOCATION_MZONE)
        e3:SetTargetRange(LOCATION_HAND,0)
        e3:SetTarget(function(e,tc) return tc:IsCode(400) end)
        e3:SetCost(function(e,c,tp) return Duel.CheckLPCost(tp,1000) end)
        c:RegisterEffect(e3)
      end
      `,
      "summon-set-cost-register.lua",
    );
    expect(setup.ok, setup.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 91, sourceUid: source!.uid }),
      expect.objectContaining({ code: 94, sourceUid: source!.uid }),
      expect.objectContaining({ code: 95, sourceUid: source!.uid }),
    ]));

    setDuelPlayerLifePoints(session.state, 0, 1000);
    let actions = getLegalActions(session, 0);
    expect(actions).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "normalSummon", uid: summonTarget!.uid })]));
    expect(actions).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "setMonster", uid: setTarget!.uid })]));
    expect(actions).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "setSpellTrap", uid: spellTarget!.uid })]));

    setDuelPlayerLifePoints(session.state, 0, 1001);
    actions = getLegalActions(session, 0);
    expect(actions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "normalSummon", uid: summonTarget!.uid })]));
    expect(actions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "setMonster", uid: setTarget!.uid })]));
    expect(actions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "setSpellTrap", uid: spellTarget!.uid })]));
  });
});
