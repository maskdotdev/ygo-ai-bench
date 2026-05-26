import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const thrushCode = "19369609";
const materialACode = "193696090";
const materialBCode = "193696091";
const opponentSpellCode = "193696092";
const opponentTrapCode = "193696093";
const allyCode = "193696094";
const opponentMonsterCode = "193696095";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasThrushScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${thrushCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const typeSpell = 0x2;
const typeTrap = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasThrushScript)("Lua real script Lyrilusc Promenade Thrush detach to-Deck battle stat", () => {
  it("restores infinite-material Xyz metadata and detach targeted Spell/Trap shuffle", () => {
    const { workspace, source, reader, session } = createThrushSession(19369609);
    const thrush = requireCard(session, thrushCode);
    const materialA = requireCard(session, materialACode);
    const materialB = requireCard(session, materialBCode);
    const opponentSpell = requireCard(session, opponentSpellCode);
    const opponentTrap = requireCard(session, opponentTrapCode);
    moveFaceUpAttack(session, thrush, 0, 0);
    attachOverlay(session, thrush, [materialA, materialB]);
    moveDuelCard(session.state, opponentSpell.uid, "spellTrapZone", 1).faceUp = true;
    moveDuelCard(session.state, opponentTrap.uid, "spellTrapZone", 1).faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript(Number(thrushCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(thrush.data).toMatchObject({ xyzMaterialCount: 2, xyzMaterialMax: 99 });
    expect(session.state.effects.filter((effect) => effect.sourceUid === thrush.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      range: effect.range,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", id: "lua-1-31", range: ["monsterZone"] },
      { category: undefined, code: 100, event: "continuous", id: "lua-2-100", range: ["monsterZone"] },
      { category: 0x10, code: undefined, event: "ignition", id: "lua-3", range: ["monsterZone"] },
      { category: 0x200000, code: 1132, event: "trigger", id: "lua-4-1132", range: ["monsterZone"] },
    ]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const shuffle = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === thrush.uid && action.effectId === "lua-3");
    expect(shuffle, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, shuffle!);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === materialA.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonCardUid: thrush.uid,
      reasonEffectId: 3,
      reasonPlayer: 0,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === thrush.uid)?.overlayUids).toEqual([materialB.uid]);
    expect(restoredOpen.session.state.chain).toEqual([]);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === opponentSpell.uid)).toMatchObject({
      location: "deck",
      controller: 1,
      reason: duelReason.effect,
      reasonCardUid: thrush.uid,
      reasonEffectId: 3,
      reasonPlayer: 0,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === opponentTrap.uid)).toMatchObject({ location: "spellTrapZone", controller: 1 });
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["detachedMaterial", "sentToDeck"].includes(event.eventName)).map((event) => ({
      current: event.eventCurrentState?.location,
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
    }))).toEqual([
      { current: "graveyard", eventCardUid: materialA.uid, eventCode: 1202, eventName: "detachedMaterial", eventReason: duelReason.cost, eventReasonCardUid: thrush.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, previous: "overlay" },
      { current: "deck", eventCardUid: opponentSpell.uid, eventCode: 1013, eventName: "sentToDeck", eventReason: duelReason.effect, eventReasonCardUid: thrush.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, previous: "spellTrapZone" },
    ]);
  });

  it("restores battle-start detach count into temporary ATK gain on another battling monster", () => {
    const { workspace, source, reader, session } = createThrushSession(19369610);
    const thrush = requireCard(session, thrushCode);
    const materialA = requireCard(session, materialACode);
    const materialB = requireCard(session, materialBCode);
    const ally = requireCard(session, allyCode);
    const opponentMonster = requireCard(session, opponentMonsterCode);
    moveFaceUpAttack(session, thrush, 0, 0);
    moveFaceUpAttack(session, ally, 0, 1);
    moveFaceUpAttack(session, opponentMonster, 1, 0);
    attachOverlay(session, thrush, [materialA, materialB]);
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript(Number(thrushCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 1);
    const attack = getLuaRestoreLegalActions(restoredOpen, 1).find((action) =>
      action.type === "declareAttack" && action.attackerUid === opponentMonster.uid && action.targetUid === ally.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, attack!);
    passUntilBattleStarted(restoredOpen);
    expect(restoredOpen.session.state.pendingTriggers).toEqual([
      {
        effectId: "lua-4-1132",
        eventCardUid: opponentMonster.uid,
        eventCode: 1132,
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventName: "battleStarted",
        eventPlayer: 1,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventReason: 0,
        eventReasonPlayer: 1,
        eventTriggerTiming: "when",
        eventUids: [opponentMonster.uid, ally.uid],
        id: "trigger-3-1",
        player: 0,
        sourceUid: thrush.uid,
        triggerBucket: "opponentOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const statBoost = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === thrush.uid);
    expect(statBoost, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, statBoost!);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === thrush.uid)?.overlayUids).toEqual([materialB.uid]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === materialA.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonCardUid: thrush.uid,
      reasonEffectId: 4,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === materialB.uid)).toMatchObject({ location: "overlay", controller: 0 });
    resolveRestoredChain(restoredTrigger);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === ally.uid), restoredTrigger.session.state)).toBe(1300);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createThrushSession(seed: number) {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  expectScriptShape(workspace.readScript(`official/c${thrushCode}.lua`));
  const reader = createCardReader(cards());
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: [materialACode, materialBCode, allyCode], extra: [thrushCode] },
    1: { main: [opponentSpellCode, opponentTrapCode, opponentMonsterCode] },
  });
  startDuel(session);
  return { workspace, source: workspace, reader, session };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Lyrilusc - Promenade Thrush");
  expect(script).toContain("Xyz.AddProcedure(c,nil,1,2,nil,nil,Xyz.InfiniteMats)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(function(e) return e:GetHandler():GetOverlayCount()*500 end)");
  expect(script).toContain("e2:SetCategory(CATEGORY_TODECK)");
  expect(script).toContain("e2:SetCost(Cost.DetachFromSelf(1))");
  expect(script).toContain("Duel.SelectTarget(tp,aux.AND(Card.IsSpellTrap,Card.IsAbleToDeck),tp,0,LOCATION_ONFIELD,1,1,nil)");
  expect(script).toContain("Duel.SendtoDeck(tc,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)");
  expect(script).toContain("e3:SetCode(EVENT_BATTLE_START)");
  expect(script).toContain("e3:SetCost(Cost.DetachFromSelf(1,function(e) return e:GetHandler():GetOverlayCount() end,function(e,og) e:SetLabel(#og) end))");
  expect(script).toContain("local bc=Duel.GetBattleMonster(tp)");
  expect(script).toContain("bc:UpdateAttack(e:GetLabel()*300,RESETS_STANDARD_PHASE_END,e:GetHandler())");
}

function cards(): DuelCardData[] {
  return [
    { code: thrushCode, name: "Lyrilusc - Promenade Thrush", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, level: 1, attack: 500, defense: 0 },
    { code: materialACode, name: "Promenade Thrush Material A", kind: "monster", typeFlags: typeMonster, level: 1, attack: 100, defense: 100 },
    { code: materialBCode, name: "Promenade Thrush Material B", kind: "monster", typeFlags: typeMonster, level: 1, attack: 100, defense: 100 },
    { code: opponentSpellCode, name: "Promenade Thrush Opponent Spell", kind: "spell", typeFlags: typeSpell },
    { code: opponentTrapCode, name: "Promenade Thrush Opponent Trap", kind: "trap", typeFlags: typeTrap },
    { code: allyCode, name: "Promenade Thrush Battle Ally", kind: "monster", typeFlags: typeMonster, level: 1, attack: 1000, defense: 1000 },
    { code: opponentMonsterCode, name: "Promenade Thrush Opponent Monster", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1200 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function attachOverlay(session: DuelSession, host: DuelCardInstance, materials: DuelCardInstance[]): void {
  for (const [index, material] of materials.entries()) {
    moveDuelCard(session.state, material.uid, "overlay", host.controller).sequence = index;
    host.overlayUids.push(material.uid);
  }
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function passUntilBattleStarted(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.battleWindow?.kind !== "startDamageStep") {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passAttack" || action.type === "passDamage");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
