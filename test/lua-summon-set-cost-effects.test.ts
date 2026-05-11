import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getLegalActions, loadDecks, startDuel } from "#duel/core.js";
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

  it("hides and pays Lua Flip Summon costs", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Cost Source", kind: "monster" },
      { code: "500", name: "Flip Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 93, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "500"] }, 1: { main: [] } });
    startDuel(session);

    const source = session.state.cards.find((card) => card.code === "100");
    const flipTarget = session.state.cards.find((card) => card.code === "500");
    expect(source).toBeDefined();
    expect(flipTarget).toBeDefined();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0);
    source!.faceUp = true;
    source!.position = "faceUpAttack";
    moveDuelCard(session.state, flipTarget!.uid, "monsterZone", 0);
    flipTarget!.faceUp = false;
    flipTarget!.position = "faceDownDefense";

    const host = createLuaScriptHost(session);
    const setup = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_FLIPSUMMON_COST)
        e:SetRange(LOCATION_MZONE)
        e:SetTargetRange(LOCATION_MZONE,0)
        e:SetTarget(function(e,tc) return tc:IsCode(500) end)
        e:SetCost(function(e,c,tp) return Duel.CheckLPCost(tp,1000) end)
        e:SetOperation(function(e,tp) Duel.PayLPCost(tp,1000) end)
        c:RegisterEffect(e)
      end
      `,
      "flip-summon-cost-register.lua",
    );
    expect(setup.ok, setup.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects).toEqual(expect.arrayContaining([expect.objectContaining({ code: 93, sourceUid: source!.uid })]));

    setDuelPlayerLifePoints(session.state, 0, 1000);
    let actions = getLegalActions(session, 0);
    expect(actions).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "flipSummon", uid: flipTarget!.uid })]));

    setDuelPlayerLifePoints(session.state, 0, 1001);
    actions = getLegalActions(session, 0);
    const flip = actions.find((action) => action.type === "flipSummon" && action.uid === flipTarget!.uid);
    expect(flip).toBeDefined();
    const response = applyResponse(session, flip!);
    expect(response.ok, response.error).toBe(true);
    expect(session.state.players[0].lifePoints).toBe(1);
  });
});
