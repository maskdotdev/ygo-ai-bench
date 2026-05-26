import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const buzzkingCode = "10666000";
const materialCode = "106660000";
const destroyTargetCode = "106660001";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasBuzzkingScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${buzzkingCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceFiend = 0x8;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasBuzzkingScript)("Lua real script Infection Buzzking detach destroy damage", () => {
  it("restores Xyz material detach cost into target destruction and half-ATK damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${buzzkingCode}.lua`));
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 10666000, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialCode], extra: [buzzkingCode] }, 1: { main: [destroyTargetCode] } });
    startDuel(session);

    const buzzking = requireCard(session, buzzkingCode);
    const material = requireCard(session, materialCode);
    const destroyTarget = requireCard(session, destroyTargetCode, 1);
    moveFaceUpAttack(session, buzzking, 0);
    buzzking.summonType = "xyz";
    moveDuelCard(session.state, material.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0).sequence = 0;
    buzzking.overlayUids.push(material.uid);
    moveFaceUpAttack(session, destroyTarget, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(buzzkingCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    applyRestoredActionAndAssert(restoredOpen, requireAction(restoredOpen, buzzking.uid, "activateEffect"));
    expect(restoredOpen.session.state.chain).toEqual([]);

    expect(findCard(restoredOpen.session, material.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: buzzking.uid,
      reasonEffectId: 4,
    });
    expect(findCard(restoredOpen.session, buzzking.uid)?.overlayUids).toEqual([]);
    expect(findCard(restoredOpen.session, destroyTarget.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: buzzking.uid,
      reasonEffectId: 4,
    });
    expect(restoredOpen.session.state.players[1].lifePoints).toBe(6900);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["detachedMaterial", "becameTarget", "destroyed", "sentToGraveyard", "breakEffect", "damageDealt"].includes(event.eventName)).map(slimEvent)).toEqual([
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: material.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: buzzking.uid, eventReasonEffectId: 4, relatedEffectId: undefined, previous: "overlay", current: "graveyard" },
      { eventName: "detachedMaterial", eventCode: 1202, eventCardUid: material.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: buzzking.uid, eventReasonEffectId: 4, relatedEffectId: undefined, previous: "overlay", current: "graveyard" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: destroyTarget.uid, eventPlayer: undefined, eventValue: undefined, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 4, previous: "deck", current: "monsterZone" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: destroyTarget.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: buzzking.uid, eventReasonEffectId: 4, relatedEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: destroyTarget.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: buzzking.uid, eventReasonEffectId: 4, relatedEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "breakEffect", eventCode: 1050, eventCardUid: undefined, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: buzzking.uid, eventReasonEffectId: 4, relatedEffectId: undefined, previous: undefined, current: undefined },
      { eventName: "damageDealt", eventCode: 1111, eventCardUid: undefined, eventPlayer: 1, eventValue: 1100, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: buzzking.uid, eventReasonEffectId: 4, relatedEffectId: undefined, previous: undefined, current: undefined },
    ]);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const buzzking = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === buzzkingCode);
  expect(buzzking).toBeDefined();
  return [
    buzzking!,
    monster(materialCode, "Infection Buzzking Material", 800),
    monster(destroyTargetCode, "Infection Buzzking Damage Target", 2200),
  ];
}

function monster(code: string, name: string, attack: number): DuelCardData {
  return { code, name, kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 8, attack, defense: 1000 };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Number 1: Infection Buzzking");
  expect(script).toContain("Xyz.AddProcedure(c,nil,8,2,nil,nil,Xyz.InfiniteMats)");
  expect(script).toContain("e3:SetCategory(CATEGORY_DESTROY+CATEGORY_DAMAGE)");
  expect(script).toContain("e3:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("e3:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e3:SetCost(Cost.DetachFromSelf(1,1,nil))");
  expect(script).toContain("Duel.SelectTarget(tp,nil,tp,0,LOCATION_ONFIELD,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,tc:GetAttack()/2)");
  expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)>0");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("Duel.Damage(1-tp,dam,REASON_EFFECT)");
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function requireCard(session: DuelSession, code: string, owner = 0): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && candidate.owner === owner);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function requireAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, uid: string, type: DuelAction["type"]): DuelAction {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === type && (candidate as { uid?: string }).uid === uid);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  return action!;
}

function slimEvent(event: {
  eventName: string;
  eventCode?: number;
  eventCardUid?: string;
  eventPlayer?: PlayerId;
  eventValue?: number;
  eventReason?: number;
  eventReasonPlayer?: PlayerId;
  eventReasonCardUid?: string;
  eventReasonEffectId?: number;
  relatedEffectId?: number;
  eventPreviousState?: { location?: string };
  eventCurrentState?: { location?: string };
}) {
  return {
    eventName: event.eventName,
    eventCode: event.eventCode,
    eventCardUid: event.eventCardUid,
    eventPlayer: event.eventPlayer,
    eventValue: event.eventValue,
    eventReason: event.eventReason,
    eventReasonPlayer: event.eventReasonPlayer,
    eventReasonCardUid: event.eventReasonCardUid,
    eventReasonEffectId: event.eventReasonEffectId,
    relatedEffectId: event.relatedEffectId,
    previous: event.eventPreviousState?.location,
    current: event.eventCurrentState?.location,
  };
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
