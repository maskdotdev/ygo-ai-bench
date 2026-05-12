import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, loadDecks, sendDuelCardToGraveyard, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelCardInstance, DuelEffectContext } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

function targetContext(duel: DuelEffectContext["duel"], source: DuelCardInstance): DuelEffectContext {
  return {
    duel,
    source,
    player: 0,
    targetUids: [],
    log: () => {},
    moveCard: () => source,
    negateChainLink: () => false,
    setTargets: () => {},
    getTargets: () => [],
    setTargetPlayer: () => {},
    setTargetParam: () => {},
  };
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Core of Chaos face-up leave-field redirect", () => {
  it("restores comma-local face-up-only EFFECT_LEAVE_FIELD_REDIRECT", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const coreOfChaosCode = "3806388";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === coreOfChaosCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 382, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [coreOfChaosCode] }, 1: { main: [] } });
    startDuel(session);
    const coreOfChaos = session.state.cards.find((card) => card.code === coreOfChaosCode);
    expect(coreOfChaos).toBeDefined();
    moveDuelCard(session.state, coreOfChaos!.uid, "monsterZone", 0);
    coreOfChaos!.faceUp = true;
    coreOfChaos!.position = "faceUpAttack";

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${coreOfChaosCode}),0,LOCATION_MZONE,0,nil)
      local e2=Effect.CreateEffect(c)
      e2:SetType(EFFECT_TYPE_SINGLE)
      e2:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)
      e2:SetCode(EFFECT_LEAVE_FIELD_REDIRECT)
      e2:SetCondition(function(e)
        local c,tp=e:GetHandler(),e:GetHandlerPlayer()
        return c:IsFaceup()
      end)
      e2:SetValue(LOCATION_REMOVED)
      c:RegisterEffect(e2)
      `,
      "core-of-chaos-official-comma-local-faceup-redirect.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const effect = session.state.effects.find((candidate) => candidate.code === 60);
    expect(effect).toMatchObject({
      event: "continuous",
      code: 60,
      luaConditionDescriptor: "condition:source-faceup",
      range: ["monsterZone"],
      value: 0x20,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredEffect = restored.session.state.effects.find((candidate) => candidate.code === 60);
    const restoredCore = restored.session.state.cards.find((card) => card.code === coreOfChaosCode);
    expect(restoredEffect?.canActivate).toBeDefined();
    expect(restoredCore).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredCore!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredCore!.faceUp = false;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });

  it("restores local-handler face-up-only EFFECT_LEAVE_FIELD_REDIRECT", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const coreOfChaosCode = "3806388";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === coreOfChaosCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 381, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [coreOfChaosCode] }, 1: { main: [] } });
    startDuel(session);
    const coreOfChaos = session.state.cards.find((card) => card.code === coreOfChaosCode);
    expect(coreOfChaos).toBeDefined();
    moveDuelCard(session.state, coreOfChaos!.uid, "monsterZone", 0);
    coreOfChaos!.faceUp = true;
    coreOfChaos!.position = "faceUpAttack";

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${coreOfChaosCode}),0,LOCATION_MZONE,0,nil)
      local e2=Effect.CreateEffect(c)
      e2:SetType(EFFECT_TYPE_SINGLE)
      e2:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)
      e2:SetCode(EFFECT_LEAVE_FIELD_REDIRECT)
      e2:SetCondition(function(e)
        local c=e:GetHandler()
        return c:IsFaceup()
      end)
      e2:SetValue(LOCATION_REMOVED)
      c:RegisterEffect(e2)
      `,
      "core-of-chaos-official-local-faceup-redirect.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const effect = session.state.effects.find((candidate) => candidate.code === 60);
    expect(effect).toMatchObject({
      event: "continuous",
      code: 60,
      luaConditionDescriptor: "condition:source-faceup",
      range: ["monsterZone"],
      value: 0x20,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredEffect = restored.session.state.effects.find((candidate) => candidate.code === 60);
    const restoredCore = restored.session.state.cards.find((card) => card.code === coreOfChaosCode);
    expect(restoredEffect?.canActivate).toBeDefined();
    expect(restoredCore).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredCore!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredCore!.faceUp = false;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });

  it("restores its face-up-only EFFECT_LEAVE_FIELD_REDIRECT", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const coreOfChaosCode = "3806388";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === coreOfChaosCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 380, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [coreOfChaosCode] }, 1: { main: [] } });
    startDuel(session);
    const coreOfChaos = session.state.cards.find((card) => card.code === coreOfChaosCode);
    expect(coreOfChaos).toBeDefined();
    moveDuelCard(session.state, coreOfChaos!.uid, "monsterZone", 0);
    coreOfChaos!.faceUp = true;
    coreOfChaos!.position = "faceUpAttack";

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${coreOfChaosCode}),0,LOCATION_MZONE,0,nil)
      local e2=Effect.CreateEffect(c)
      e2:SetType(EFFECT_TYPE_SINGLE)
      e2:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)
      e2:SetCode(EFFECT_LEAVE_FIELD_REDIRECT)
      e2:SetCondition(function(e) return e:GetHandler():IsFaceup() end)
      e2:SetValue(LOCATION_REMOVED)
      c:RegisterEffect(e2)
      `,
      "core-of-chaos-official-faceup-redirect.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const effect = session.state.effects.find((candidate) => candidate.code === 60);
    expect(effect).toMatchObject({
      event: "continuous",
      code: 60,
      luaConditionDescriptor: "condition:source-faceup",
      range: ["monsterZone"],
      value: 0x20,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredEffect = restored.session.state.effects.find((candidate) => candidate.code === 60);
    const restoredCore = restored.session.state.cards.find((card) => card.code === coreOfChaosCode);
    expect(restoredEffect).toMatchObject({
      event: "continuous",
      code: 60,
      luaConditionDescriptor: "condition:source-faceup",
      range: ["monsterZone"],
      value: 0x20,
    });
    expect(restoredEffect?.canActivate).toBeDefined();
    expect(restoredCore).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredCore!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);

    sendDuelCardToGraveyard(restored.session.state, restoredCore!.uid, 0, duelReason.effect, 0);
    expect(restoredCore).toMatchObject({ location: "banished", reason: duelReason.effect | duelReason.redirect });

    moveDuelCard(restored.session.state, restoredCore!.uid, "monsterZone", 0);
    restoredCore!.faceUp = false;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    sendDuelCardToGraveyard(restored.session.state, restoredCore!.uid, 0, duelReason.effect, 0);
    expect(restoredCore).toMatchObject({ location: "graveyard", reason: duelReason.effect });
  });
});
