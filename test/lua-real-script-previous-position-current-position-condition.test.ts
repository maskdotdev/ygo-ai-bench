import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelCardInstance, DuelEffectContext, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const positionFaceUpAttack = 0x1;
const positionFaceUpDefense = 0x4;
const positionAttack = 0x3;
const positionDefense = 0x0c;

function targetContext(duel: DuelEffectContext["duel"], source: DuelCardInstance): DuelEffectContext {
  return {
    duel,
    source,
    player: source.controller,
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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script previous position current position condition", () => {
  it("restores comma-local previous-position current-position checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const samuraiCode = "64926005";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === samuraiCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 6493, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [samuraiCode] }, 1: { main: [] } });
    startDuel(session);

    const samurai = session.state.cards.find((card) => card.code === samuraiCode);
    expect(samurai).toBeDefined();
    moveDuelCard(session.state, samurai!.uid, "monsterZone", 0);
    samurai!.faceUp = true;
    samurai!.position = "faceUpAttack";
    samurai!.previousPosition = "faceUpAttack";
    samurai!.position = "faceUpDefense";

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${samuraiCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_MZONE)
      e:SetCondition(function(e)
        local c,tp=e:GetHandler(),e:GetHandlerPlayer()
        return c:IsPreviousPosition(POS_FACEUP_ATTACK) and c:IsPosition(POS_FACEUP_DEFENSE)
      end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "samurai-comma-local-previous-current-position-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const descriptor = `condition:source-previous-position-position:${positionFaceUpAttack}:${positionFaceUpDefense}`;
    expect(session.state.effects).toEqual(expect.arrayContaining([expect.objectContaining({ luaConditionDescriptor: descriptor, sourceUid: samurai!.uid })]));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expectRestoreActionParity(restored, 0);
    const restoredSamurai = restored.session.state.cards.find((card) => card.code === samuraiCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === samurai!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredSamurai!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredSamurai!.position = "faceUpAttack";
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredSamurai!.position = "faceUpDefense";
    restoredSamurai!.previousPosition = "faceUpDefense";
    expect(effect!.canActivate!(ctx)).toBe(false);
  });

  it("restores previous-position current-position checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const taintedWisdomCode = "28725004";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === taintedWisdomCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 2872, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [taintedWisdomCode] }, 1: { main: [] } });
    startDuel(session);

    const taintedWisdom = session.state.cards.find((card) => card.code === taintedWisdomCode);
    expect(taintedWisdom).toBeDefined();
    moveDuelCard(session.state, taintedWisdom!.uid, "monsterZone", 0);
    taintedWisdom!.faceUp = true;
    taintedWisdom!.position = "faceUpAttack";
    taintedWisdom!.previousPosition = "faceUpAttack";
    taintedWisdom!.position = "faceUpDefense";

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(taintedWisdomCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const descriptor = `condition:source-previous-position-position:${positionAttack}:${positionDefense}`;
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: descriptor,
          sourceUid: taintedWisdom!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expectRestoreActionParity(restored, 0);
    const restoredTaintedWisdom = restored.session.state.cards.find((card) => card.code === taintedWisdomCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === taintedWisdom!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredTaintedWisdom!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredTaintedWisdom!.position = "faceUpAttack";
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredTaintedWisdom!.position = "faceUpDefense";
    restoredTaintedWisdom!.previousPosition = "faceUpDefense";
    expect(effect!.canActivate!(ctx)).toBe(false);
  });

  it("restores local previous-position current-position checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const samuraiCode = "64926005";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === samuraiCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 6492, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [samuraiCode] }, 1: { main: [] } });
    startDuel(session);

    const samurai = session.state.cards.find((card) => card.code === samuraiCode);
    expect(samurai).toBeDefined();
    moveDuelCard(session.state, samurai!.uid, "monsterZone", 0);
    samurai!.faceUp = true;
    samurai!.position = "faceUpAttack";
    samurai!.previousPosition = "faceUpAttack";
    samurai!.position = "faceUpDefense";

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(samuraiCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const descriptor = `condition:source-previous-position-position:${positionFaceUpAttack}:${positionFaceUpDefense}`;
    expect(session.state.effects).toEqual(expect.arrayContaining([expect.objectContaining({ luaConditionDescriptor: descriptor, sourceUid: samurai!.uid })]));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expectRestoreActionParity(restored, 0);
    const restoredSamurai = restored.session.state.cards.find((card) => card.code === samuraiCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === samurai!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredSamurai!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredSamurai!.position = "faceUpAttack";
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredSamurai!.position = "faceUpDefense";
    restoredSamurai!.previousPosition = "faceUpDefense";
    expect(effect!.canActivate!(ctx)).toBe(false);
  });
});

function expectRestoreActionParity(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(
    getLuaRestoreLegalActions(restored, player),
  );
}
