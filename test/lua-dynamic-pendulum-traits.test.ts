import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelCardData } from "#duel/types.js";

const pendulumCards: DuelCardData[] = [
  { code: "100", name: "Dynamic Low Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 1, rightScale: 1 },
  { code: "200", name: "Dynamic High Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 8, rightScale: 8 },
  { code: "300", name: "Dynamic Level Pendulum", kind: "monster", typeFlags: 0x1000001, level: 9 },
  { code: "301", name: "Scale-Ignoring Pendulum", kind: "monster", typeFlags: 0x1000001, level: 9 },
];

describe("Lua dynamic Pendulum traits", () => {
  it("uses current level for core Pendulum Summon actions and Lua player checks", () => {
    const source = { readScript: dynamicPendulumTraitScript };
    const session = createDuel({ seed: 106, startingHandSize: 3, cardReader: createCardReader(pendulumCards) });
    loadDecks(session, { 0: { main: ["100", "200", "300"] }, 1: { main: [] } });
    startDuel(session);

    const lowScale = session.state.cards.find((card) => card.code === "100");
    const highScale = session.state.cards.find((card) => card.code === "200");
    const candidate = session.state.cards.find((card) => card.code === "300");
    expect(lowScale).toBeDefined();
    expect(highScale).toBeDefined();
    expect(candidate).toBeDefined();
    moveDuelCard(session.state, lowScale!.uid, "spellTrapZone", 0).sequence = 0;
    moveDuelCard(session.state, highScale!.uid, "spellTrapZone", 0).sequence = 1;

    expect(getDuelLegalActions(session, 0).some((action) => action.type === "pendulumSummon" && action.summonUids.includes(candidate!.uid))).toBe(false);

    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const action = getDuelLegalActions(session, 0).find((candidateAction) => candidateAction.type === "pendulumSummon" && candidateAction.summonUids.includes(candidate!.uid));
    expect(action).toBeDefined();

    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("dynamic pendulum can " .. c:GetLevel() .. "/" .. tostring(Duel.IsPlayerCanPendulumSummon(0)))
      `,
      "dynamic-pendulum-check.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("dynamic pendulum can 4/true");

    if (!action || action.type !== "pendulumSummon") throw new Error("Expected Pendulum Summon action");
    const applied = applyResponse(session, { ...action, summonUids: [candidate!.uid] });
    expect(applied.ok, applied.error).toBe(true);
    expect(session.state.cards.find((card) => card.uid === candidate!.uid)).toMatchObject({ location: "monsterZone", summonType: "pendulum" });
  });

  it("uses current level for Lua Duel.PendulumSummon", () => {
    const source = { readScript: dynamicPendulumTraitScript };
    const session = createDuel({ seed: 107, startingHandSize: 3, cardReader: createCardReader(pendulumCards) });
    loadDecks(session, { 0: { main: ["100", "200", "300"] }, 1: { main: [] } });
    startDuel(session);

    const lowScale = session.state.cards.find((card) => card.code === "100");
    const highScale = session.state.cards.find((card) => card.code === "200");
    const candidate = session.state.cards.find((card) => card.code === "300");
    expect(lowScale).toBeDefined();
    expect(highScale).toBeDefined();
    expect(candidate).toBeDefined();
    moveDuelCard(session.state, lowScale!.uid, "spellTrapZone", 0).sequence = 0;
    moveDuelCard(session.state, highScale!.uid, "spellTrapZone", 0).sequence = 1;

    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const result = host.loadScript(
      `
      Debug.Message("dynamic pendulum summoned " .. Duel.PendulumSummon(0))
      `,
      "dynamic-pendulum-summon.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("dynamic pendulum summoned 1");
    expect(session.state.cards.find((card) => card.uid === candidate!.uid)).toMatchObject({ location: "monsterZone", summonType: "pendulum" });
  });

  it("honors the EDOPro Pendulum level-bypass effect for actions and Lua helpers", () => {
    const source = { readScript: dynamicPendulumTraitScript };
    const reader = createCardReader(pendulumCards);
    const session = createDuel({ seed: 108, startingHandSize: 4, cardReader: reader });
    loadDecks(session, { 0: { main: ["100", "200", "300", "301"] }, 1: { main: [] } });
    startDuel(session);

    const lowScale = session.state.cards.find((card) => card.code === "100");
    const highScale = session.state.cards.find((card) => card.code === "200");
    const ordinaryHighLevel = session.state.cards.find((card) => card.code === "300");
    const bypassCandidate = session.state.cards.find((card) => card.code === "301");
    expect(lowScale).toBeDefined();
    expect(highScale).toBeDefined();
    expect(ordinaryHighLevel).toBeDefined();
    expect(bypassCandidate).toBeDefined();
    moveDuelCard(session.state, lowScale!.uid, "spellTrapZone", 0).sequence = 0;
    moveDuelCard(session.state, highScale!.uid, "spellTrapZone", 0).sequence = 1;

    expect(getDuelLegalActions(session, 0).some((action) => action.type === "pendulumSummon")).toBe(false);

    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript(301, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const action = getDuelLegalActions(session, 0).find((candidateAction) => candidateAction.type === "pendulumSummon");
    expect(action).toBeDefined();
    expect(action?.type === "pendulumSummon" ? action.summonUids : []).toEqual([bypassCandidate!.uid]);
    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredAction = getLuaRestoreLegalActions(restored, 0).find((candidateAction) => candidateAction.type === "pendulumSummon");
    expect(restoredAction?.type === "pendulumSummon" ? restoredAction.summonUids : []).toEqual([bypassCandidate!.uid]);

    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 301), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("bypass pendulum can " .. c:GetLevel() .. "/" .. tostring(c:IsHasEffect(511004423)~=nil) .. "/" .. tostring(Duel.IsPlayerCanPendulumSummon(0)))
      `,
      "pendulum-level-bypass-check.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("bypass pendulum can 9/true/true");

    if (!action || action.type !== "pendulumSummon") throw new Error("Expected Pendulum Summon action");
    const applied = applyResponse(session, { ...action, summonUids: [bypassCandidate!.uid] });
    expect(applied.ok, applied.error).toBe(true);
    expect(session.state.cards.find((card) => card.uid === bypassCandidate!.uid)).toMatchObject({ location: "monsterZone", summonType: "pendulum" });
  });

  it("honors the EDOPro Pendulum level-bypass effect for Lua Duel.PendulumSummon", () => {
    const source = { readScript: dynamicPendulumTraitScript };
    const session = createDuel({ seed: 109, startingHandSize: 4, cardReader: createCardReader(pendulumCards) });
    loadDecks(session, { 0: { main: ["100", "200", "300", "301"] }, 1: { main: [] } });
    startDuel(session);

    const lowScale = session.state.cards.find((card) => card.code === "100");
    const highScale = session.state.cards.find((card) => card.code === "200");
    const bypassCandidate = session.state.cards.find((card) => card.code === "301");
    expect(lowScale).toBeDefined();
    expect(highScale).toBeDefined();
    expect(bypassCandidate).toBeDefined();
    moveDuelCard(session.state, lowScale!.uid, "spellTrapZone", 0).sequence = 0;
    moveDuelCard(session.state, highScale!.uid, "spellTrapZone", 0).sequence = 1;

    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript(301, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const result = host.loadScript(
      `
      Debug.Message("bypass pendulum summoned " .. Duel.PendulumSummon(0))
      `,
      "pendulum-level-bypass-summon.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("bypass pendulum summoned 1");
    expect(session.state.cards.find((card) => card.uid === bypassCandidate!.uid)).toMatchObject({ location: "monsterZone", summonType: "pendulum" });
  });
});

function dynamicPendulumTraitScript(name: string): string | undefined {
  if (name === "c300.lua") return `
    c300={}
    function c300.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetCode(EFFECT_UPDATE_LEVEL)
      e:SetValue(-5)
      c:RegisterEffect(e)
    end
  `;
  if (name === "c301.lua") return `
    c301={}
    function c301.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetCode(511004423)
      c:RegisterEffect(e)
    end
  `;
  return undefined;
}
