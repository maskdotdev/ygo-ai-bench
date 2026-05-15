import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelCardInstance, DuelEffectContext, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const positionFaceUp = 0x5;
const locationOnField = 0x0c;
const locationMonsterZone = 0x04;

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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script previous controller previous position location reason condition", () => {
  it("restores comma-local previous-controller previous-position previous-location reason bitmask checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const gigastoneCode = "79080761";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === gigastoneCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7093, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [gigastoneCode] }, 1: { main: [] } });
    startDuel(session);

    const gigastone = session.state.cards.find((card) => card.code === gigastoneCode);
    expect(gigastone).toBeDefined();
    moveDuelCard(session.state, gigastone!.uid, "monsterZone", 0);
    gigastone!.faceUp = true;
    gigastone!.position = "faceUpAttack";
    moveDuelCard(session.state, gigastone!.uid, "graveyard", 0, duelReason.destroy);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${gigastoneCode}),0,LOCATION_GRAVE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_GRAVE)
      e:SetCondition(function(e,tp)
        local c,p=e:GetHandler(),e:GetHandlerPlayer()
        return c:IsReason(REASON_DESTROY) and c:IsPreviousControler(tp) and (c:GetPreviousPosition()&POS_FACEUP)~=0 and (c:GetPreviousLocation()&LOCATION_MZONE)~=0
      end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "gigastone-comma-local-previous-controller-position-location-reason-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const descriptor = `condition:source-previous-controller-previous-position-location-reason:${positionFaceUp}:${locationMonsterZone}:${duelReason.destroy}`;
    expect(session.state.effects).toEqual(expect.arrayContaining([expect.objectContaining({ code: 71, luaConditionDescriptor: descriptor, sourceUid: gigastone!.uid })]));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored, 0);
    const restoredGigastone = restored.session.state.cards.find((card) => card.code === gigastoneCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === gigastone!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredGigastone!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredGigastone!.previousController = 1;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredGigastone!.previousController = 0;
    restoredGigastone!.previousPosition = "faceDownDefense";
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredGigastone!.previousPosition = "faceUpAttack";
    restoredGigastone!.previousLocation = "spellTrapZone";
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredGigastone!.previousLocation = "monsterZone";
    restoredGigastone!.reason = duelReason.battle;
    expect(effect!.canActivate!(ctx)).toBe(false);
    expect(effect!.canActivate!({ ...ctx, eventReason: duelReason.destroy })).toBe(true);
  });

  it("restores previous-controller previous-position previous-location reason checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const gigastoneCode = "79080761";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === gigastoneCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7908, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [gigastoneCode] }, 1: { main: [] } });
    startDuel(session);

    const gigastone = session.state.cards.find((card) => card.code === gigastoneCode);
    expect(gigastone).toBeDefined();
    moveDuelCard(session.state, gigastone!.uid, "monsterZone", 0);
    gigastone!.faceUp = true;
    gigastone!.position = "faceUpAttack";
    moveDuelCard(session.state, gigastone!.uid, "graveyard", 0, duelReason.effect);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(gigastoneCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const descriptor = `condition:source-previous-controller-previous-position-location-reason:${positionFaceUp}:${locationOnField}:${duelReason.effect}`;
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: descriptor,
          sourceUid: gigastone!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored, 0);
    const restoredGigastone = restored.session.state.cards.find((card) => card.code === gigastoneCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === gigastone!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredGigastone!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredGigastone!.previousController = 1;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredGigastone!.previousController = 0;
    restoredGigastone!.previousPosition = "faceDownDefense";
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredGigastone!.previousPosition = "faceUpAttack";
    restoredGigastone!.previousLocation = "deck";
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredGigastone!.previousLocation = "monsterZone";
    restoredGigastone!.reason = duelReason.battle;
    expect(effect!.canActivate!(ctx)).toBe(false);
  });

  it("restores card-filter previous-controller previous-position previous-location reason checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const gigastoneCode = "79080761";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === gigastoneCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7092, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [gigastoneCode] }, 1: { main: [] } });
    startDuel(session);

    const gigastone = session.state.cards.find((card) => card.code === gigastoneCode);
    expect(gigastone).toBeDefined();
    moveDuelCard(session.state, gigastone!.uid, "monsterZone", 0);
    gigastone!.faceUp = true;
    gigastone!.position = "faceUpAttack";
    moveDuelCard(session.state, gigastone!.uid, "graveyard", 0, duelReason.destroy);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${gigastoneCode}),0,LOCATION_GRAVE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_GRAVE)
      e:SetCondition(function(e,tp)
        local c=e:GetHandler()
        return c:IsReason(REASON_DESTROY) and c:IsPreviousLocation(LOCATION_MZONE) and c:IsPreviousControler(tp) and c:IsPreviousPosition(POS_FACEUP)
      end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "gigastone-card-filter-previous-controller-position-location-reason-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const descriptor = `condition:source-previous-controller-previous-position-location-reason:${positionFaceUp}:${locationMonsterZone}:${duelReason.destroy}`;
    expect(session.state.effects).toEqual(expect.arrayContaining([expect.objectContaining({ code: 71, luaConditionDescriptor: descriptor, sourceUid: gigastone!.uid })]));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored, 0);
    const restoredGigastone = restored.session.state.cards.find((card) => card.code === gigastoneCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === gigastone!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredGigastone!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredGigastone!.previousLocation = "spellTrapZone";
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredGigastone!.previousLocation = "monsterZone";
    restoredGigastone!.previousPosition = "faceDownDefense";
    expect(effect!.canActivate!(ctx)).toBe(false);
  });
});

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(
    getLuaRestoreLegalActions(restored, player),
  );
}
