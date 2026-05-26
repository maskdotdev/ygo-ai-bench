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
const rasterligerCode = "88000953";
const graveLinkCode = "880009530";
const linkedCostCode = "880009531";
const destroyTargetCode = "880009532";
const decoyCode = "880009533";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasRasterligerScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${rasterligerCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceCyberse = 0x1000000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const markerRight = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasRasterligerScript)("Lua real script Rasterliger Link GY attack release destroy", () => {
  it("restores GY Link-target ATK gain and linked-monster release-cost destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${rasterligerCode}.lua`);
    expectScriptShape(script);

    const reader = createCardReader(cards());
    const restoredAttack = createRestoredAttackWindow({ reader, workspace });
    expectCleanRestore(restoredAttack);
    expectRestoredLegalActions(restoredAttack, 0);
    const attackRasterliger = requireCard(restoredAttack.session, rasterligerCode);
    const graveLink = requireCard(restoredAttack.session, graveLinkCode);
    const attackAction = getLuaRestoreLegalActions(restoredAttack, 0).find((action) => action.type === "activateEffect" && action.uid === attackRasterliger.uid);
    expect(attackAction, JSON.stringify(getLuaRestoreLegalActions(restoredAttack, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttack, attackAction!);
    passRestoredChain(restoredAttack);

    expect(currentAttack(restoredAttack.session.state.cards.find((card) => card.uid === attackRasterliger.uid), restoredAttack.session.state)).toBe(4800);
    expect(restoredAttack.session.state.cards.find((card) => card.uid === graveLink.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      faceUp: true,
    });
    expect(restoredAttack.session.state.effects.filter((effect) => effect.sourceUid === attackRasterliger.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([{ code: 100, reset: { flags: 1107235328 }, value: 2800 }]);
    expect(restoredAttack.session.state.eventHistory.filter((event) => event.eventName === "becameTarget").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: graveLink.uid, eventReason: 0, eventReasonPlayer: 0, relatedEffectId: 2, previousLocation: "deck", currentLocation: "graveyard" },
    ]);

    const restoredDestroy = createRestoredDestroyWindow({ reader, workspace });
    expectCleanRestore(restoredDestroy);
    expectRestoredLegalActions(restoredDestroy, 0);
    const destroyRasterliger = requireCard(restoredDestroy.session, rasterligerCode);
    const linkedCost = requireCard(restoredDestroy.session, linkedCostCode);
    const destroyTarget = requireCard(restoredDestroy.session, destroyTargetCode);
    const destroyAction = getLuaRestoreLegalActions(restoredDestroy, 0).find((action) =>
      action.type === "activateEffect" && action.uid === destroyRasterliger.uid
    );
    expect(destroyAction, JSON.stringify(getLuaRestoreLegalActions(restoredDestroy, 0), null, 2)).toBeDefined();
    expect(destroyAction).toMatchObject({
      type: "activateEffect",
      uid: destroyRasterliger.uid,
      effectId: "lua-3",
    });
    applyRestoredActionAndAssert(restoredDestroy, destroyAction!);
    const operationInfos = restoredDestroy.session.state.chain.flatMap((link) => link.operationInfos ?? []);
    expect(operationInfos).toEqual([]);
    passRestoredChain(restoredDestroy);

    expect(restoredDestroy.session.state.cards.find((card) => card.uid === linkedCost.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: destroyRasterliger.uid,
      reasonEffectId: 3,
    });
    expect(restoredDestroy.session.state.cards.find((card) => card.uid === destroyRasterliger.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: destroyRasterliger.uid,
      reasonEffectId: 3,
    });
    expect(restoredDestroy.session.state.eventHistory.filter((event) => ["released", "destroyed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "released", eventCode: 1017, eventCardUid: linkedCost.uid, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: destroyRasterliger.uid, eventReasonEffectId: 3, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: destroyRasterliger.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: destroyRasterliger.uid, eventReasonEffectId: 3, previousLocation: "monsterZone", currentLocation: "graveyard" },
    ]);
  });
});

function createRestoredAttackWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 88000953, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [rasterligerCode] }, 1: { main: [graveLinkCode] } });
  startDuel(session);

  moveFaceUpAttack(session, requireCard(session, rasterligerCode), 0);
  const graveLink = moveDuelCard(session.state, requireCard(session, graveLinkCode).uid, "graveyard", 1);
  graveLink.faceUp = true;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(rasterligerCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);

  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredDestroyWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 88000954, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [rasterligerCode, linkedCostCode, decoyCode] }, 1: { main: [destroyTargetCode] } });
  startDuel(session);

  const rasterliger = moveFaceUpAttack(session, requireCard(session, rasterligerCode), 0);
  rasterliger.sequence = 2;
  const linkedCost = moveFaceUpAttack(session, requireCard(session, linkedCostCode), 0);
  linkedCost.sequence = 3;
  const decoy = moveFaceUpAttack(session, requireCard(session, decoyCode), 0);
  decoy.sequence = 4;
  moveFaceUpAttack(session, requireCard(session, destroyTargetCode), 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(rasterligerCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);

  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Link.AddProcedure(c,aux.NOT(aux.FilterBoolFunctionEx(Card.IsType,TYPE_TOKEN)),2)");
  expect(script).toContain("Duel.SelectTarget(tp,aux.AND(Card.IsLinkMonster,Card.HasNonZeroAttack),tp,LOCATION_GRAVE,LOCATION_GRAVE,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(tc:GetAttack())");
  expect(script).toContain("local lg=e:GetHandler():GetLinkedGroup()");
  expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.descostfilter,1,false,s.rescon,nil,lg)");
  expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.descostfilter,1,#lg,false,s.rescon,nil,lg)");
  expect(script).toContain("Duel.Release(g,REASON_COST)");
  expect(script).toContain("Duel.GetFieldGroupCount(tp,LOCATION_ONFIELD,LOCATION_ONFIELD)<ct");
  expect(script).toContain("Duel.SelectMatchingCard(tp,nil,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,ct,ct,nil)");
  expect(script).toContain("Duel.Destroy(g,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: rasterligerCode, name: "Rasterliger", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, attribute: attributeDark, level: 4, attack: 2000, defense: 0, linkMarkers: markerRight },
    { code: graveLinkCode, name: "Rasterliger Grave Link Target", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, attribute: attributeDark, level: 3, attack: 2800, defense: 0, linkMarkers: markerRight },
    { code: linkedCostCode, name: "Rasterliger Linked Release Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: destroyTargetCode, name: "Rasterliger Destroy Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: decoyCode, name: "Rasterliger Release Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
