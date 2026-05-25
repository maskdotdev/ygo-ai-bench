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
const delfiendiumCode = "3792766";
const linkedTrickstarCode = "37927660";
const banishedTrickstarACode = "37927661";
const banishedTrickstarBCode = "37927662";
const opponentLinkACode = "37927663";
const opponentLinkBCode = "37927664";
const attackTargetCode = "37927665";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasDelfiendiumScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${delfiendiumCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceFairy = 0x4;
const raceCyberse = 0x1000000;
const attributeLight = 0x10;
const setTrickstar = 0xfb;
const effectUpdateAttack = 100;
const eventAttackAnnounce = 1130;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasDelfiendiumScript)("Lua real script Trickstar Delfiendium attack announce to-hand stat", () => {
  it("restores linked attack-announcement banished Trickstar recovery and ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${delfiendiumCode}.lua`));
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 3792766, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [linkedTrickstarCode, banishedTrickstarACode, banishedTrickstarBCode], extra: [delfiendiumCode] },
      1: { main: [attackTargetCode], extra: [opponentLinkACode, opponentLinkBCode] },
    });
    startDuel(session);

    const delfiendium = requireCard(session, delfiendiumCode);
    const linkedTrickstar = requireCard(session, linkedTrickstarCode);
    const banishedA = requireCard(session, banishedTrickstarACode);
    const banishedB = requireCard(session, banishedTrickstarBCode);
    const opponentLinkA = requireCard(session, opponentLinkACode);
    const opponentLinkB = requireCard(session, opponentLinkBCode);
    const attackTarget = requireCard(session, attackTargetCode);
    moveFaceUpLink(session, delfiendium, 0, 2);
    moveFaceUpAttack(session, linkedTrickstar, 0, 3);
    moveFaceUpBanished(session, banishedA, 0, 0);
    moveFaceUpBanished(session, banishedB, 0, 1);
    moveFaceUpLink(session, opponentLinkA, 1, 0);
    moveFaceUpLink(session, opponentLinkB, 1, 1);
    moveFaceUpAttack(session, attackTarget, 1, 2);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(delfiendiumCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const attack = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === delfiendium.uid && action.targetUid === attackTarget.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, attack!);
    expect(restoredOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-2-1130", eventCardUid: delfiendium.uid, eventCode: eventAttackAnnounce, eventName: "attackDeclared", player: 0, sourceUid: delfiendium.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredAttack = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredAttack);
    expectRestoredLegalActions(restoredAttack, 0);
    const trigger = getLuaRestoreLegalActions(restoredAttack, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === delfiendium.uid && action.effectId === "lua-2-1130"
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredAttack, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttack, trigger!);
    resolveRestoredChain(restoredAttack);

    expect([banishedA, banishedB].map((card) => findCard(restoredAttack.session, card.uid)).map((card) => ({
      controller: card.controller,
      location: card.location,
      reason: card.reason,
      reasonCardUid: card.reasonCardUid,
      reasonEffectId: card.reasonEffectId,
      reasonPlayer: card.reasonPlayer,
    }))).toEqual([
      { controller: 0, location: "hand", reason: duelReason.effect, reasonCardUid: delfiendium.uid, reasonEffectId: 2, reasonPlayer: 0 },
      { controller: 0, location: "hand", reason: duelReason.effect, reasonCardUid: delfiendium.uid, reasonEffectId: 2, reasonPlayer: 0 },
    ]);
    expect(currentAttack(findCard(restoredAttack.session, delfiendium.uid), restoredAttack.session.state)).toBe(4200);
    expect(restoredAttack.session.state.effects.filter((effect) => effect.sourceUid === delfiendium.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107235328 }, sourceUid: delfiendium.uid, value: 2000 },
    ]);
    expect(restoredAttack.session.state.eventHistory.filter((event) => ["attackDeclared", "becameTarget", "sentToHand"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      eventUids: event.eventUids,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: delfiendium.uid, eventCode: eventAttackAnnounce, eventName: "attackDeclared", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, eventUids: undefined, relatedEffectId: undefined },
      { eventCardUid: banishedA.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, eventUids: undefined, relatedEffectId: 2 },
      { eventCardUid: banishedB.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, eventUids: undefined, relatedEffectId: 2 },
      { eventCardUid: banishedA.uid, eventCode: 1012, eventName: "sentToHand", eventReason: duelReason.effect, eventReasonCardUid: delfiendium.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, eventUids: undefined, relatedEffectId: undefined },
      { eventCardUid: banishedB.uid, eventCode: 1012, eventName: "sentToHand", eventReason: duelReason.effect, eventReasonCardUid: delfiendium.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, eventUids: undefined, relatedEffectId: undefined },
      { eventCardUid: banishedA.uid, eventCode: 1012, eventName: "sentToHand", eventReason: duelReason.effect, eventReasonCardUid: delfiendium.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, eventUids: [banishedA.uid, banishedB.uid], relatedEffectId: undefined },
    ]);
    expect(restoredAttack.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const delfiendium = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === delfiendiumCode);
  expect(delfiendium).toBeDefined();
  return [
    delfiendium!,
    { code: linkedTrickstarCode, name: "Delfiendium Linked Trickstar", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setTrickstar], race: raceFairy, attribute: attributeLight, level: 4, attack: 1200, defense: 1000 },
    { code: banishedTrickstarACode, name: "Delfiendium Banished Trickstar A", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setTrickstar], race: raceFairy, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
    { code: banishedTrickstarBCode, name: "Delfiendium Banished Trickstar B", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setTrickstar], race: raceFairy, attribute: attributeLight, level: 4, attack: 1100, defense: 1000 },
    { code: opponentLinkACode, name: "Delfiendium Opponent Link A", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, attribute: attributeLight, level: 1, attack: 800, defense: 0, linkMarkers: 0x20 },
    { code: opponentLinkBCode, name: "Delfiendium Opponent Link B", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, attribute: attributeLight, level: 1, attack: 900, defense: 0, linkMarkers: 0x20 },
    { code: attackTargetCode, name: "Delfiendium Attack Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Trickstar Delfiendium");
  expect(script).toContain("Link.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_TRICKSTAR),2)");
  expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e1:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("return e:GetHandler():GetLinkedGroup():IsExists(s.thconfilter,1,nil)");
  expect(script).toContain("local ct=Duel.GetMatchingGroupCount(Card.IsLinkMonster,tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("Duel.SelectTarget(tp,s.thfilter,tp,LOCATION_REMOVED,0,1,ct,nil)");
  expect(script).toContain("Duel.GetTargetCards(e)");
  expect(script).toContain("Duel.SendtoHand(tg,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.GetOperatedGroup():FilterCount(Card.IsLocation,nil,LOCATION_HAND)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(ct*1000)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_DISABLE_PHASE_END)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function moveFaceUpBanished(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "banished", player);
  moved.faceUp = true;
  moved.sequence = sequence;
  return moved;
}

function moveFaceUpLink(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveFaceUpAttack(session, card, player, sequence);
  moved.summonType = "link";
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
