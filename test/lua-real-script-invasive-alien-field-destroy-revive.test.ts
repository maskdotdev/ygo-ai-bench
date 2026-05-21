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
const invasiveCode = "71768839";
const opponentFieldCode = "717688390";
const opponentTargetCode = "717688391";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasInvasiveScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${invasiveCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeField = 0x80000;

describe.skipIf(!hasUpstreamScripts || !hasInvasiveScript)("Lua real script I.A.S. field destroy revive", () => {
  it("restores opponent Field Zone gated indestructibility, targeted destroy ATK gain, and grave self-summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${invasiveCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
    expect(script).toContain("e2:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
    expect(script).toContain("return Duel.IsExistingMatchingCard(Card.IsFaceup,e:GetHandlerPlayer(),0,LOCATION_FZONE,1,nil)");
    expect(script).toContain("e3:SetCategory(CATEGORY_DESTROY+CATEGORY_ATKCHANGE)");
    expect(script).toContain("e3:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("Duel.SelectTarget(tp,nil,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,0,0)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,e:GetHandler(),1,tp,1000)");
    expect(script).toContain("local tc=Duel.GetFirstTarget()");
    expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)>0");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e4:SetRange(LOCATION_GRAVE)");
    expect(script).toContain("Duel.GetLocationCount(tp,LOCATION_MZONE)>0");
    expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");

    const reader = createCardReader(cards());
    const destroySession = createDuel({ seed: 71768839, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(destroySession, { 0: { main: [invasiveCode] }, 1: { main: [opponentFieldCode, opponentTargetCode] } });
    startDuel(destroySession);
    const fieldInvasive = requireCard(destroySession, invasiveCode);
    const fieldSpell = requireCard(destroySession, opponentFieldCode, 1);
    const target = requireCard(destroySession, opponentTargetCode, 1);
    moveFaceUpAttack(destroySession, fieldInvasive, 0);
    moveFaceUpAttack(destroySession, target, 1);
    moveFaceUpFieldSpell(destroySession, fieldSpell, 1);
    destroySession.state.phase = "main1";
    destroySession.state.turnPlayer = 0;
    destroySession.state.waitingFor = 0;

    const destroyHost = createLuaScriptHost(destroySession, workspace);
    expect(destroyHost.loadCardScript(Number(invasiveCode), workspace).ok).toBe(true);
    expect(destroyHost.registerInitialEffects()).toBe(1);
    expect(destroySession.state.effects.filter((effect) => effect.sourceUid === fieldInvasive.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      value: effect.value,
    }))).toEqual([
      { code: 42, event: "continuous", range: ["monsterZone"], value: 1 },
      { code: 41, event: "continuous", range: ["monsterZone"], value: 1 },
      { code: undefined, event: "ignition", range: ["monsterZone"], value: undefined },
      { code: undefined, event: "ignition", range: ["graveyard"], value: undefined },
    ]);

    const restoredDestroy = restoreDuelWithLuaScripts(serializeDuel(destroySession), workspace, reader);
    expectCleanRestore(restoredDestroy);
    expectRestoredLegalActions(restoredDestroy, 0);
    const destroyAction = getLuaRestoreLegalActions(restoredDestroy, 0).find((action) =>
      action.type === "activateEffect" && action.uid === fieldInvasive.uid && action.effectId === "lua-3"
    );
    expect(destroyAction, JSON.stringify(getLuaRestoreLegalActions(restoredDestroy, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroy, destroyAction!);

    expect(restoredDestroy.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredDestroy.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: fieldInvasive.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(restoredDestroy.session.state.cards.find((card) => card.uid === fieldInvasive.uid)!, restoredDestroy.session.state)).toBe(2600);
    expect(restoredDestroy.session.state.effects.filter((effect) => effect.sourceUid === fieldInvasive.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      range: effect.range,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 100, range: ["monsterZone"], reset: { flags: 33492992 }, value: 1000 },
    ]);
    expect(restoredDestroy.session.state.eventHistory.filter((event) => ["becameTarget", "destroyed", "sentToGraveyard", "chainSolved"].includes(event.eventName))).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: target.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 3,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: target.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: fieldInvasive.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: target.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: fieldInvasive.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "chainSolved",
        eventCode: 1022,
        eventValue: 1,
        eventReasonPlayer: 0,
        eventPlayer: 0,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 3,
      },
    ]);

    const reviveSession = createDuel({ seed: 71768840, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(reviveSession, { 0: { main: [invasiveCode] }, 1: { main: [opponentFieldCode] } });
    startDuel(reviveSession);
    const graveInvasive = requireCard(reviveSession, invasiveCode);
    const reviveFieldSpell = requireCard(reviveSession, opponentFieldCode, 1);
    moveDuelCard(reviveSession.state, graveInvasive.uid, "graveyard", 0);
    moveFaceUpFieldSpell(reviveSession, reviveFieldSpell, 1);
    reviveSession.state.phase = "main1";
    reviveSession.state.turnPlayer = 0;
    reviveSession.state.waitingFor = 0;

    const reviveHost = createLuaScriptHost(reviveSession, workspace);
    expect(reviveHost.loadCardScript(Number(invasiveCode), workspace).ok).toBe(true);
    expect(reviveHost.registerInitialEffects()).toBe(1);
    const restoredRevive = restoreDuelWithLuaScripts(serializeDuel(reviveSession), workspace, reader);
    expectCleanRestore(restoredRevive);
    expectRestoredLegalActions(restoredRevive, 0);
    const reviveAction = getLuaRestoreLegalActions(restoredRevive, 0).find((action) =>
      action.type === "activateEffect" && action.uid === graveInvasive.uid && action.effectId === "lua-4"
    );
    expect(reviveAction, JSON.stringify(getLuaRestoreLegalActions(restoredRevive, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredRevive, reviveAction!);

    expect(restoredRevive.session.state.cards.find((card) => card.uid === graveInvasive.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: graveInvasive.uid,
      reasonEffectId: 4,
    });
    expect(restoredRevive.session.state.eventHistory.filter((event) => ["specialSummoned", "chainSolved"].includes(event.eventName))).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: graveInvasive.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: graveInvasive.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventUids: [graveInvasive.uid],
      },
      {
        eventName: "chainSolved",
        eventCode: 1022,
        eventValue: 1,
        eventReasonPlayer: 0,
        eventPlayer: 0,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 4,
      },
    ]);

    const restoredAfterRevive = restoreDuelWithLuaScripts(serializeDuel(restoredRevive.session), workspace, reader);
    expectCleanRestore(restoredAfterRevive);
    expectRestoredLegalActions(restoredAfterRevive, 0);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: invasiveCode, name: "I.A.S. -Invasive Alien Species-", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1600, defense: 0 },
    { code: opponentFieldCode, name: "Invasive Opponent Field", kind: "spell", typeFlags: typeSpell | typeField },
    { code: opponentTargetCode, name: "Invasive Opponent Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1800, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string, owner?: PlayerId): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && (owner === undefined || candidate.owner === owner));
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function moveFaceUpFieldSpell(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = 5;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
