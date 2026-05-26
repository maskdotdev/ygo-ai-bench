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
const zekeCode = "75147529";
const rozeCode = "37351133";
const genericMaterialCode = "751475290";
const opponentTargetCode = "751475291";
const sendTargetCode = "751475292";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasZekeScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${zekeCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const phaseEndCode = 4608;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasZekeScript)("Lua real script Sky Striker Ace Zeke link banish return stat tograve", () => {
  it("restores Link Summon temporary banish return and ignition ATK gain SendtoGrave", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${zekeCode}.lua`));
    const reader = createCardReader(cards(workspace));

    const restoredOpen = createRestoredLinkOpen({ reader, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const zeke = requireCard(restoredOpen.session, zekeCode);
    const roze = requireCard(restoredOpen.session, rozeCode);
    const genericMaterial = requireCard(restoredOpen.session, genericMaterialCode);
    const opponentTarget = requireCard(restoredOpen.session, opponentTargetCode);
    const sendTarget = requireCard(restoredOpen.session, sendTargetCode);
    const linkSummon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "linkSummon" &&
      action.uid === zeke.uid &&
      sameMembers(action.materialUids, [roze.uid, genericMaterial.uid]),
    );
    expect(linkSummon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, linkSummon!);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === zeke.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "link",
      reason: duelReason.summon | duelReason.specialSummon | duelReason.link,
      reasonPlayer: 0,
    });
    for (const material of [roze, genericMaterial]) {
      expect(restoredOpen.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
        location: "graveyard",
        reason: duelReason.material | duelReason.link,
        reasonPlayer: 0,
        reasonCardUid: zeke.uid,
      });
    }
    expect(restoredOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-3-1102", eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon | duelReason.link, player: 0, sourceUid: zeke.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const temporaryBanish = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === zeke.uid);
    expect(temporaryBanish, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, temporaryBanish!);
    resolveRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === zeke.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.effect | duelReason.temporary,
      reasonPlayer: 0,
      reasonCardUid: zeke.uid,
      reasonEffectId: 3,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === opponentTarget.uid)).toMatchObject({ location: "monsterZone" });
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === zeke.uid && effect.code === phaseEndCode).map((effect) => ({
      code: effect.code,
      labelObjectUid: effect.labelObjectUid,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: phaseEndCode, labelObjectUid: zeke.uid, reset: { flags: 1644036608 }, sourceUid: zeke.uid },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["specialSummoned", "becameTarget", "banished"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: zeke.uid, eventPlayer: undefined, eventReason: duelReason.summon | duelReason.specialSummon | duelReason.link, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "extraDeck", current: "monsterZone" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: zeke.uid, eventPlayer: undefined, eventReason: duelReason.summon | duelReason.specialSummon | duelReason.link, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "extraDeck", current: "monsterZone" },
      { eventName: "banished", eventCode: 1011, eventCardUid: zeke.uid, eventPlayer: undefined, eventReason: duelReason.effect | duelReason.temporary, eventReasonPlayer: 0, eventReasonCardUid: zeke.uid, eventReasonEffectId: 3, previous: "monsterZone", current: "banished" },
    ]);

    const restoredReturn = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredReturn);
    restoredReturn.session.state.turnPlayer = 1;
    restoredReturn.session.state.phase = "main2";
    restoredReturn.session.state.waitingFor = 1;
    expectRestoredLegalActions(restoredReturn, 1);
    const endPhase = getLuaRestoreLegalActions(restoredReturn, 1).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(endPhase, JSON.stringify(getLuaRestoreLegalActions(restoredReturn, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredReturn, endPhase!);
    expect(restoredReturn.session.state.cards.find((card) => card.uid === zeke.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: zeke.uid,
      reasonEffectId: 5,
    });

    const restoredIgnition = restoreDuelWithLuaScripts(serializeDuel(restoredReturn.session), workspace, reader);
    expectCleanRestore(restoredIgnition);
    restoredIgnition.session.state.turnPlayer = 0;
    restoredIgnition.session.state.phase = "main1";
    restoredIgnition.session.state.waitingFor = 0;
    const ignitionEventStart = restoredIgnition.session.state.eventHistory.length;
    expectRestoredLegalActions(restoredIgnition, 0);
    const attackBoost = getLuaRestoreLegalActions(restoredIgnition, 0).find((action) => action.type === "activateEffect" && action.uid === zeke.uid);
    expect(attackBoost, JSON.stringify(getLuaRestoreLegalActions(restoredIgnition, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredIgnition, attackBoost!);
    resolveRestoredChain(restoredIgnition);

    expect(currentAttack(restoredIgnition.session.state.cards.find((card) => card.uid === zeke.uid), restoredIgnition.session.state)).toBe(2500);
    expect(restoredIgnition.session.state.cards.find((card) => card.uid === sendTarget.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: zeke.uid,
      reasonEffectId: 4,
    });
    expect(restoredIgnition.session.state.eventHistory.slice(ignitionEventStart).filter((event) => ["breakEffect", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "breakEffect", eventCode: 1050, eventCardUid: undefined, eventPlayer: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: zeke.uid, eventReasonEffectId: 4, previous: undefined, current: undefined },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: sendTarget.uid, eventPlayer: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: zeke.uid, eventReasonEffectId: 4, previous: "spellTrapZone", current: "graveyard" },
    ]);
    expect(restoredIgnition.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredLinkOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 75147529, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [rozeCode, genericMaterialCode, sendTargetCode], extra: [zekeCode] }, 1: { main: [opponentTargetCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, rozeCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, genericMaterialCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, opponentTargetCode), 1, 0);
  moveSpellTrap(session, requireCard(session, sendTargetCode), 0, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(zekeCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Sky Striker Ace - Zeke");
  expect(script).toContain("Link.AddProcedure(c,nil,2,2,s.lcheck)");
  expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_CONDITION)");
  expect(script).toContain("e1:SetValue(aux.lnklimit)");
  expect(script).toContain("e2:SetCategory(CATEGORY_REMOVE)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DELAY+EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e:GetHandler():IsLinkSummoned()");
  expect(script).toContain("Duel.SelectTarget(tp,s.tgfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.Remove(tc,0,REASON_EFFECT|REASON_TEMPORARY)");
  expect(script).toContain("e1:SetCode(EVENT_PHASE+PHASE_END)");
  expect(script).toContain("Duel.RegisterEffect(e1,tp)");
  expect(script).toContain("Duel.ReturnToField(e:GetLabelObject())");
  expect(script).toContain("e3:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_TOGRAVE)");
  expect(script).toContain("e3:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("Duel.SelectTarget(tp,nil,tp,LOCATION_ONFIELD,0,1,1,c)");
  expect(script).toContain("c:UpdateAttack(1000)==1000");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("Duel.SendtoGrave(tc,REASON_EFFECT)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const databaseCards = workspace.readDatabaseCards("cards.cdb");
  const zeke = databaseCards.find((card) => card.code === zekeCode);
  const roze = databaseCards.find((card) => card.code === rozeCode);
  expect(zeke).toBeDefined();
  expect(roze).toBeDefined();
  return [
    zeke!,
    roze!,
    { code: genericMaterialCode, name: "Zeke Generic Link Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: opponentTargetCode, name: "Zeke Opponent Face-Up Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 2000, defense: 1000 },
    { code: sendTargetCode, name: "Zeke Send Target", kind: "spell", typeFlags: typeSpell },
  ];
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function moveSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  return moved;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((uid) => right.includes(uid));
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
