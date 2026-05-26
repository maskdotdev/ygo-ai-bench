import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const cradleCode = "7142724";
const icejadeGraveCode = "71427240";
const waterSummonCode = "71427241";
const opponentFaceupCode = "71427242";
const opponentFaceDownCode = "71427243";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasCradleScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${cradleCode}.lua`));
const setIcejade = 0x16e;
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeField = 0x80000;
const typeEffect = 0x20;
const attributeWater = 0x2;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasCradleScript)("Lua real script Icejade Cenote Enion Cradle activate summon stat to-hand", () => {
  it("restores optional Icejade return and summon-trigger WATER target ATK drain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${cradleCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 7142724, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [cradleCode, icejadeGraveCode, waterSummonCode] }, 1: { main: [opponentFaceupCode, opponentFaceDownCode] } });
    startDuel(session);

    const cradle = requireCard(session, cradleCode);
    const icejadeGrave = requireCard(session, icejadeGraveCode);
    const waterSummon = requireCard(session, waterSummonCode);
    const opponentFaceup = requireCard(session, opponentFaceupCode);
    const opponentFaceDown = requireCard(session, opponentFaceDownCode);
    moveDuelCard(session.state, cradle.uid, "hand", 0);
    moveDuelCard(session.state, icejadeGrave.uid, "graveyard", 0);
    moveDuelCard(session.state, waterSummon.uid, "hand", 0);
    moveFaceUpMonster(session, opponentFaceup, 1, 0);
    moveFaceDownMonster(session, opponentFaceDown, 1, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace, { promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }] });
    expect(host.loadCardScript(Number(cradleCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredActivate = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, { promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }] });
    expectCleanRestore(restoredActivate);
    expectRestoredLegalActions(restoredActivate, 0);
    const activate = getLuaRestoreLegalActions(restoredActivate, 0).find((action) =>
      action.type === "activateEffect" && action.uid === cradle.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredActivate, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredActivate, activate!);
    resolveRestoredChain(restoredActivate);

    expect(findCard(restoredActivate.session, cradle.uid)).toMatchObject({ location: "spellTrapZone", controller: 0, faceUp: true });
    expect(findCard(restoredActivate.session, icejadeGrave.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: cradle.uid,
      reasonEffectId: 1,
    });
    expect(restoredActivate.host.messages).toContain(`confirmed 1: ${icejadeGraveCode}`);
    expect(restoredActivate.host.promptDecisions).toContainEqual({ id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 114283584, returned: true });

    specialSummonDuelCard(restoredActivate.session.state, waterSummon.uid, 0);
    expect(restoredActivate.session.state.pendingTriggers.filter((trigger) => trigger.sourceUid === cradle.uid).map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-3-1102", eventCardUid: waterSummon.uid, eventCode: 1102, eventName: "specialSummoned", player: 0, sourceUid: cradle.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredActivate.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === cradle.uid && action.effectId === "lua-3-1102"
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    expect(currentAttack(findCard(restoredTrigger.session, waterSummon.uid), restoredTrigger.session.state)).toBe(0);
    expect(currentAttack(findCard(restoredTrigger.session, opponentFaceup.uid), restoredTrigger.session.state)).toBe(800);
    expect(currentAttack(findCard(restoredTrigger.session, opponentFaceDown.uid), restoredTrigger.session.state)).toBe(2400);
    expect(restoredTrigger.session.state.effects.filter((effect) =>
      [waterSummon.uid, opponentFaceup.uid].includes(effect.sourceUid) && effect.code === effectUpdateAttack
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    })).sort((left, right) => left.sourceUid.localeCompare(right.sourceUid))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: waterSummon.uid, value: -1600 },
      { code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: opponentFaceup.uid, value: -1600 },
    ].sort((left, right) => left.sourceUid.localeCompare(right.sourceUid)));
    expect(restoredTrigger.session.state.eventHistory.filter((event) =>
      ["sentToHand", "confirmed", "becameTarget"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: icejadeGrave.uid, eventCode: 1012, eventName: "sentToHand", eventReason: duelReason.effect, eventReasonCardUid: cradle.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
      { eventCardUid: icejadeGrave.uid, eventCode: 1211, eventName: "confirmed", eventReason: duelReason.effect, eventReasonCardUid: cradle.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
      { eventCardUid: waterSummon.uid, eventCode: 1028, eventName: "becameTarget", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const cradle = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === cradleCode);
  expect(cradle).toBeDefined();
  return [
    { ...cradle!, kind: "spell", typeFlags: typeSpell | typeField, setcodes: [setIcejade] },
    { code: icejadeGraveCode, name: "Icejade Cenote Grave Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setIcejade], attribute: attributeWater, level: 4, attack: 1200, defense: 1000 },
    { code: waterSummonCode, name: "Icejade Cenote WATER Summon", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeWater, level: 4, attack: 1600, defense: 1000 },
    { code: opponentFaceupCode, name: "Icejade Cenote Opponent Face-up", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeWater, level: 4, attack: 2400, defense: 1000 },
    { code: opponentFaceDownCode, name: "Icejade Cenote Opponent Face-down", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeWater, level: 4, attack: 2400, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND)");
  expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_GRAVE|LOCATION_REMOVED)");
  expect(script).toContain("Duel.GetMatchingGroup(aux.NecroValleyFilter(s.thfilter),tp,LOCATION_GRAVE|LOCATION_REMOVED,0,nil)");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,0))");
  expect(script).toContain("Duel.SendtoHand(sg,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,sg)");
  expect(script).toContain("e2:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("local g=Duel.GetMatchingGroup(Card.IsFaceup,tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("g:AddCard(tc)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(atk)");
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

function moveFaceUpMonster(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function moveFaceDownMonster(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = false;
  moved.position = "faceDownDefense";
  moved.sequence = sequence;
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
