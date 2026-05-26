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
const schubertaCode = "57594700";
const firstTargetCode = "575947000";
const secondTargetCode = "575947001";
const thirdTargetCode = "575947002";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasSchubertaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${schubertaCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const raceFairy = 0x4;
const attributeLight = 0x10;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasSchubertaScript)("Lua real script Schuberta grave target banish attack stat", () => {
  it("restores three grave targets into operated-count ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${schubertaCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restored = createRestoredSchubertaField({ reader, workspace });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const schuberta = requireCard(restored.session, schubertaCode);
    const targets = [firstTargetCode, secondTargetCode, thirdTargetCode].map((code) => requireCard(restored.session, code));

    const action = getLuaRestoreLegalActions(restored, 0).find((candidate) =>
      candidate.type === "activateEffect" && candidate.uid === schuberta.uid
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    if (!action || action.type !== "activateEffect") throw new Error("Expected Schuberta activation");
    const effectNumericId = Number(action.effectId.split("-")[1]);
    applyRestoredActionAndAssert(restored, action);
    resolveRestoredChain(restored);

    for (const target of targets) {
      expect(restored.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
        location: "banished",
        faceUp: true,
        reason: duelReason.effect,
        reasonPlayer: 0,
        reasonCardUid: schuberta.uid,
        reasonEffectId: effectNumericId,
      });
    }
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === schuberta.uid), restored.session.state)).toBe(3000);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === schuberta.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 33492992 }, sourceUid: schuberta.uid, value: 600 },
    ]);
    const selectedTargets = [targets[0]!, targets[2]!, targets[1]!] as const;
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "becameTarget" || event.eventName === "banished").map((event) => ({
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
      { eventCardUid: selectedTargets[0].uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, eventUids: undefined, relatedEffectId: effectNumericId },
      { eventCardUid: selectedTargets[1].uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, eventUids: undefined, relatedEffectId: effectNumericId },
      { eventCardUid: selectedTargets[2].uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, eventUids: undefined, relatedEffectId: effectNumericId },
      { eventCardUid: selectedTargets[0].uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.effect, eventReasonCardUid: schuberta.uid, eventReasonEffectId: effectNumericId, eventReasonPlayer: 0, eventUids: undefined, relatedEffectId: undefined },
      { eventCardUid: selectedTargets[1].uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.effect, eventReasonCardUid: schuberta.uid, eventReasonEffectId: effectNumericId, eventReasonPlayer: 0, eventUids: undefined, relatedEffectId: undefined },
      { eventCardUid: selectedTargets[2].uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.effect, eventReasonCardUid: schuberta.uid, eventReasonEffectId: effectNumericId, eventReasonPlayer: 0, eventUids: undefined, relatedEffectId: undefined },
      { eventCardUid: selectedTargets[0].uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.effect, eventReasonCardUid: schuberta.uid, eventReasonEffectId: effectNumericId, eventReasonPlayer: 0, eventUids: selectedTargets.map((target) => target.uid), relatedEffectId: undefined },
    ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredSchubertaField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 57594700, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [firstTargetCode, thirdTargetCode], extra: [schubertaCode] }, 1: { main: [secondTargetCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, schubertaCode), 0, 0);
  moveFaceUpGrave(session, requireCard(session, firstTargetCode), 0, 0);
  moveFaceUpGrave(session, requireCard(session, secondTargetCode), 1, 0);
  moveFaceUpGrave(session, requireCard(session, thirdTargetCode), 0, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(schubertaCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Schuberta the Melodious Maestra");
  expect(script).toContain("Fusion.AddProcMixN(c,true,true,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_MELODIOUS),2)");
  expect(script).toContain("CATEGORY_REMOVE+CATEGORY_ATKCHANGE");
  expect(script).toContain("EFFECT_TYPE_QUICK_O");
  expect(script).toContain("EVENT_FREE_CHAIN");
  expect(script).toContain("EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_NO_TURN_RESET");
  expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsAbleToRemove,tp,LOCATION_GRAVE,LOCATION_GRAVE,1,3,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_REMOVE,g,#g,0,0)");
  expect(script).toContain("Duel.GetTargetCards(e)");
  expect(script).toContain("local ct=Duel.Remove(g,POS_FACEUP,REASON_EFFECT)");
  expect(script).toContain("EFFECT_UPDATE_ATTACK");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD_DISABLE)");
  expect(script).toContain("e1:SetValue(ct*200)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const schuberta = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === schubertaCode);
  expect(schuberta).toBeDefined();
  return [
    { ...schuberta!, kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceFairy, attribute: attributeLight },
    { code: firstTargetCode, name: "Schuberta First Grave Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFairy, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
    { code: secondTargetCode, name: "Schuberta Opponent Grave Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFairy, attribute: attributeLight, level: 4, attack: 1200, defense: 1000 },
    { code: thirdTargetCode, name: "Schuberta Third Grave Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFairy, attribute: attributeLight, level: 4, attack: 1400, defense: 1000 },
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

function moveFaceUpGrave(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "graveyard", player);
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
