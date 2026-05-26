import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, sendDuelCardToGraveyard, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const duplexCode = "4483598";
const fieldLinkCode = "448359800";
const graveLinkCode = "448359801";
const cyberseTargetCode = "448359802";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDuplexScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${duplexCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceCyberse = 0x1000000;
const attributeLight = 0x10;
const effectExtraAttackMonster = 346;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasDuplexScript)("Lua real script Full Active Duplex link banish summon attack", () => {
  it("restores linked-monster extra attack, Link banish hand summon, and to-Grave Cyberse ATK boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${duplexCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());

    const summon = createRestoredSummonOpen({ reader, workspace });
    expectCleanRestore(summon);
    expectRestoredLegalActions(summon, 0);
    const summonDuplex = requireCard(summon.session, duplexCode);
    expect(summon.session.state.effects.filter((effect) => effect.sourceUid === summonDuplex.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectExtraAttackMonster, event: "continuous", range: ["monsterZone"], targetRange: [4, 0], value: 1 },
      { code: undefined, event: "ignition", range: ["hand"], targetRange: undefined, value: undefined },
      { code: 1014, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], targetRange: undefined, value: undefined },
    ]);

    const grave = createRestoredToGraveOpen({ reader, workspace });
    expectCleanRestore(grave);
    expectRestoredLegalActions(grave, 0);
    const graveDuplex = requireCard(grave.session, duplexCode);
    const cyberseTarget = requireCard(grave.session, cyberseTargetCode);
    sendDuelCardToGraveyard(grave.session.state, graveDuplex.uid, 0, duelReason.effect, 0);
    expect(grave.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-3-1014", eventCardUid: graveDuplex.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect, player: 0, sourceUid: graveDuplex.uid, triggerBucket: "turnOptional" },
    ]);
    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(grave.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const attackAction = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === graveDuplex.uid && action.effectId === "lua-3-1014"
    );
    expect(attackAction, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, attackAction!);
    resolveRestoredChain(restoredTrigger);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === cyberseTarget.uid), restoredTrigger.session.state)).toBe(2600);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === cyberseTarget.uid)).toMatchObject({ attackModifier: 1000 });
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === cyberseTarget.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["sentToGraveyard", "becameTarget", "chainSolved"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: graveDuplex.uid, eventReason: duelReason.effect, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "monsterZone", current: "graveyard" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: cyberseTarget.uid, eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "deck", current: "monsterZone" },
      { eventName: "chainSolved", eventCode: 1022, eventCardUid: undefined, eventReason: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: undefined, current: undefined },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredSummonOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 4483598, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [duplexCode], extra: [fieldLinkCode, graveLinkCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, duplexCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, fieldLinkCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, graveLinkCode), 0, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(duplexCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredToGraveOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 4483599, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [cyberseTargetCode], extra: [duplexCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, duplexCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, cyberseTargetCode), 0, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(duplexCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Full Active Duplex");
  expect(script).toContain("e1:SetCode(EFFECT_EXTRA_ATTACK_MONSTER)");
  expect(script).toContain("e1:SetTarget(aux.TargetBoolFunction(Card.IsLinked))");
  expect(script).toContain("return c:IsLinkMonster() and c:IsAbleToRemoveAsCost() and aux.SpElimFilter(c,true)");
  expect(script).toContain("aux.SelectUnselectGroup(rg,e,tp,2,2,aux.ChkfMMZ(1),0)");
  expect(script).toContain("aux.SelectUnselectGroup(rg,e,tp,2,2,aux.ChkfMMZ(1),1,tp,HINTMSG_REMOVE)");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e3:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsRace,RACE_CYBERSE),tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("tc:UpdateAttack(1000,RESET_EVENT|RESETS_STANDARD,e:GetHandler())");
}

function cards(): DuelCardData[] {
  return [
    { code: duplexCode, name: "Full Active Duplex", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeLight, level: 4, attack: 2800, defense: 2000 },
    { code: fieldLinkCode, name: "Full Active Duplex Field Link", kind: "monster", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, attribute: attributeLight, level: 4, attack: 1500, defense: 0, linkMarkers: 0x3 },
    { code: graveLinkCode, name: "Full Active Duplex Grave Link", kind: "monster", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, attribute: attributeLight, level: 4, attack: 1400, defense: 0, linkMarkers: 0x3 },
    { code: cyberseTargetCode, name: "Full Active Duplex Cyberse Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeLight, level: 4, attack: 1600, defense: 1200 },
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
