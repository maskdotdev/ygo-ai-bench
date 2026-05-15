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
const positionFaceUp = 0x5;
const locationOnField = 0x0c;
const locationSpellTrapZone = 0x08;

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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script previous position location condition", () => {
  it("restores comma-local previous-position previous-location checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const blueEyesJetDragonCode = "62089826";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === blueEyesJetDragonCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 6209, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [blueEyesJetDragonCode] }, 1: { main: [] } });
    startDuel(session);

    const blueEyesJetDragon = session.state.cards.find((card) => card.code === blueEyesJetDragonCode);
    expect(blueEyesJetDragon).toBeDefined();
    moveDuelCard(session.state, blueEyesJetDragon!.uid, "spellTrapZone", 0);
    blueEyesJetDragon!.faceUp = true;
    blueEyesJetDragon!.position = "faceUpAttack";
    moveDuelCard(session.state, blueEyesJetDragon!.uid, "graveyard", 0);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${blueEyesJetDragonCode}),0,LOCATION_GRAVE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_GRAVE)
      e:SetCondition(function(e)
        local c,tp=e:GetHandler(),e:GetHandlerPlayer()
        return c:IsPreviousPosition(POS_FACEUP) and c:IsPreviousLocation(LOCATION_SZONE)
      end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "blue-eyes-jet-comma-local-previous-position-location-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const descriptor = `condition:source-previous-position-location:${positionFaceUp}:${locationSpellTrapZone}`;
    expect(session.state.effects).toEqual(expect.arrayContaining([expect.objectContaining({ luaConditionDescriptor: descriptor, sourceUid: blueEyesJetDragon!.uid })]));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expectRestoreActionParity(restored, 0);
    const restoredBlueEyesJetDragon = restored.session.state.cards.find((card) => card.code === blueEyesJetDragonCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === blueEyesJetDragon!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredBlueEyesJetDragon!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredBlueEyesJetDragon!.previousLocation = "hand";
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredBlueEyesJetDragon!.previousLocation = "spellTrapZone";
    restoredBlueEyesJetDragon!.previousPosition = "faceDownDefense";
    expect(effect!.canActivate!(ctx)).toBe(false);
  });

  it("restores previous-position previous-location checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const superviseCode = "95750695";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === superviseCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 9575, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [superviseCode] }, 1: { main: [] } });
    startDuel(session);

    const supervise = session.state.cards.find((card) => card.code === superviseCode);
    expect(supervise).toBeDefined();
    moveDuelCard(session.state, supervise!.uid, "spellTrapZone", 0);
    supervise!.faceUp = true;
    supervise!.position = "faceUpAttack";
    moveDuelCard(session.state, supervise!.uid, "graveyard", 0);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(superviseCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const descriptor = `condition:source-previous-position-location:${positionFaceUp}:${locationOnField}`;
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: descriptor,
          sourceUid: supervise!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expectRestoreActionParity(restored, 0);
    const restoredSupervise = restored.session.state.cards.find((card) => card.code === superviseCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === supervise!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredSupervise!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredSupervise!.previousPosition = "faceDownDefense";
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredSupervise!.previousPosition = "faceUpAttack";
    restoredSupervise!.previousLocation = "deck";
    expect(effect!.canActivate!(ctx)).toBe(false);
  });

  it("restores local handler previous-position previous-location checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const blueEyesJetDragonCode = "62089826";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === blueEyesJetDragonCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 6208, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [blueEyesJetDragonCode] }, 1: { main: [] } });
    startDuel(session);

    const blueEyesJetDragon = session.state.cards.find((card) => card.code === blueEyesJetDragonCode);
    expect(blueEyesJetDragon).toBeDefined();
    moveDuelCard(session.state, blueEyesJetDragon!.uid, "spellTrapZone", 0);
    blueEyesJetDragon!.faceUp = true;
    blueEyesJetDragon!.position = "faceUpAttack";
    moveDuelCard(session.state, blueEyesJetDragon!.uid, "graveyard", 0);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(blueEyesJetDragonCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const descriptor = `condition:source-previous-position-location:${positionFaceUp}:${locationSpellTrapZone}`;
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: descriptor,
          sourceUid: blueEyesJetDragon!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expectRestoreActionParity(restored, 0);
    const restoredBlueEyesJetDragon = restored.session.state.cards.find((card) => card.code === blueEyesJetDragonCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === blueEyesJetDragon!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredBlueEyesJetDragon!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredBlueEyesJetDragon!.previousLocation = "hand";
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredBlueEyesJetDragon!.previousLocation = "spellTrapZone";
    restoredBlueEyesJetDragon!.previousPosition = "faceDownDefense";
    expect(effect!.canActivate!(ctx)).toBe(false);
  });
});

function expectRestoreActionParity(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(
    getLuaRestoreLegalActions(restored, player),
  );
}
