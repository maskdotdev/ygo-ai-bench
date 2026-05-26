import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, sendDuelCardToGraveyard, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const ebonCode = "96029570";
const destroyedMonsterCode = "960295700";
const graveSummonCode = "960295701";
const discardedSpellCode = "960295702";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasEbonScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${ebonCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeContinuous = 0x20000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const effectUpdateAttack = 100;
const eventSpecialSummonSuccess = 1102;
const eventRecover = 1112;

describe.skipIf(!hasUpstreamScripts || !hasEbonScript)("Lua real script Ebon Sun custom recover stat to hand", () => {
  it("restores custom destroyed recovery, grave Special Summon ATK gain, and discarded Spell return", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${ebonCode}.lua`);
    expectEbonSunScriptShape(script);
    const reader = createCardReader(cards());

    const restoredOpen = createRestoredOpen({ reader, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const ebon = requireCard(restoredOpen.session, ebonCode);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === ebon.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: 1002, event: "ignition", property: undefined, range: ["hand", "spellTrapZone"], triggerEvent: undefined },
      { category: 1048576, code: 364465026, event: "trigger", property: 65536, range: ["spellTrapZone"], triggerEvent: "customEvent" },
      { category: undefined, code: 1029, event: "continuous", property: 0x400, range: ["spellTrapZone"], triggerEvent: undefined },
      { category: 2097152, code: 364465027, event: "trigger", property: 65552, range: ["spellTrapZone"], triggerEvent: "customEvent" },
      { category: undefined, code: eventSpecialSummonSuccess, event: "continuous", property: 0x400, range: ["spellTrapZone"], triggerEvent: undefined },
      { category: 8, code: 364465028, event: "trigger", property: 65552, range: ["spellTrapZone"], triggerEvent: "customEvent" },
      { category: undefined, code: 1018, event: "continuous", property: 0x400, range: ["spellTrapZone"], triggerEvent: undefined },
    ]);

    const restoredRecover = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredRecover);
    const recoverTarget = requireCard(restoredRecover.session, destroyedMonsterCode);
    destroyDuelCard(restoredRecover.session.state, recoverTarget.uid, 0, duelReason.effect | duelReason.destroy, 1, "graveyard", {
      eventReasonCardUid: ebon.uid,
      eventReasonEffectId: 900,
    });
    const restoredRecoverTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredRecover.session), workspace, reader);
    expectCleanRestore(restoredRecoverTrigger);
    expectRestoredLegalActions(restoredRecoverTrigger, 0);
    const recover = getLuaRestoreLegalActions(restoredRecoverTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === ebon.uid);
    expect(recover, JSON.stringify(getLuaRestoreLegalActions(restoredRecoverTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredRecoverTrigger, recover!);
    resolveRestoredChain(restoredRecoverTrigger);

    expect(restoredRecoverTrigger.session.state.players[0].lifePoints).toBe(9800);
    expect(restoredRecoverTrigger.session.state.eventHistory.filter((event) => ["destroyed", "recoveredLifePoints"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "destroyed", eventCode: 1029, eventCardUid: recoverTarget.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 1, eventReasonCardUid: ebon.uid, eventReasonEffectId: 900, previous: "monsterZone", current: "graveyard" },
      { eventName: "recoveredLifePoints", eventCode: eventRecover, eventCardUid: undefined, eventPlayer: 0, eventValue: 1800, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: ebon.uid, eventReasonEffectId: 2, previous: undefined, current: undefined },
    ]);

    const restoredSummon = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredSummon);
    const graveSummon = requireCard(restoredSummon.session, graveSummonCode);
    specialSummonDuelCard(restoredSummon.session.state, graveSummon.uid, 0, 0, { eventReasonCardUid: ebon.uid, eventReasonEffectId: 901 }, 0, true, true);
    const restoredAttackTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), workspace, reader);
    expectCleanRestore(restoredAttackTrigger);
    expectRestoredLegalActions(restoredAttackTrigger, 0);
    const attackGain = getLuaRestoreLegalActions(restoredAttackTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === ebon.uid);
    expect(attackGain, JSON.stringify(getLuaRestoreLegalActions(restoredAttackTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttackTrigger, attackGain!);
    resolveRestoredChain(restoredAttackTrigger);

    expect(currentAttack(restoredAttackTrigger.session.state.cards.find((card) => card.uid === graveSummon.uid), restoredAttackTrigger.session.state)).toBe(2600);
    expect(restoredAttackTrigger.session.state.effects.filter((effect) => effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 33427456 }, sourceUid: graveSummon.uid, value: 1000 },
    ]);
    expect(restoredAttackTrigger.session.state.eventHistory.filter((event) => ["specialSummoned", "becameTarget"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "specialSummoned", eventCode: eventSpecialSummonSuccess, eventCardUid: graveSummon.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: ebon.uid, eventReasonEffectId: 901, relatedEffectId: undefined, previous: "graveyard", current: "monsterZone" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: graveSummon.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: ebon.uid, eventReasonEffectId: 901, relatedEffectId: 4, previous: "graveyard", current: "monsterZone" },
    ]);

    const restoredDiscard = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredDiscard);
    const discardedSpell = requireCard(restoredDiscard.session, discardedSpellCode);
    sendDuelCardToGraveyard(restoredDiscard.session.state, discardedSpell.uid, 0, duelReason.effect | duelReason.discard, 0, {
      eventReasonCardUid: ebon.uid,
      eventReasonEffectId: 902,
    });
    const restoredDiscardTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredDiscard.session), workspace, reader);
    expectCleanRestore(restoredDiscardTrigger);
    expectRestoredLegalActions(restoredDiscardTrigger, 0);
    const toHand = getLuaRestoreLegalActions(restoredDiscardTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === ebon.uid);
    expect(toHand, JSON.stringify(getLuaRestoreLegalActions(restoredDiscardTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDiscardTrigger, toHand!);
    resolveRestoredChain(restoredDiscardTrigger);

    expect(restoredDiscardTrigger.session.state.cards.find((card) => card.uid === discardedSpell.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: ebon.uid,
      reasonEffectId: 6,
    });
    expect(restoredDiscardTrigger.session.state.eventHistory.filter((event) => ["discarded", "sentToHand"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "discarded", eventCode: 1018, eventCardUid: discardedSpell.uid, eventReason: duelReason.effect | duelReason.discard, eventReasonPlayer: 0, eventReasonCardUid: ebon.uid, eventReasonEffectId: 902, previous: "hand", current: "graveyard" },
      { eventName: "sentToHand", eventCode: 1012, eventCardUid: discardedSpell.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: ebon.uid, eventReasonEffectId: 6, previous: "graveyard", current: "hand" },
    ]);
    expect(restoredDiscardTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 96029570, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [ebonCode, destroyedMonsterCode, graveSummonCode, discardedSpellCode] }, 1: { main: [] } });
  startDuel(session);
  const ebon = requireCard(session, ebonCode);
  const destroyedMonster = requireCard(session, destroyedMonsterCode);
  const graveSummon = requireCard(session, graveSummonCode);
  const discardedSpell = requireCard(session, discardedSpellCode);
  moveDuelCard(session.state, ebon.uid, "spellTrapZone", 0);
  ebon.faceUp = true;
  ebon.sequence = 0;
  moveFaceUpAttack(session, destroyedMonster, 0, 0);
  moveDuelCard(session.state, graveSummon.uid, "graveyard", 0);
  graveSummon.faceUp = true;
  moveDuelCard(session.state, discardedSpell.uid, "hand", 0);
  discardedSpell.sequence = 0;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(ebonCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectEbonSunScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e0:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e1a:SetCode(EVENT_CUSTOM+id)");
  expect(script).toContain("e1b:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("Duel.RaiseSingleEvent(e:GetHandler(),EVENT_CUSTOM+id,e,0,tp,tp,0)");
  expect(script).toContain("Duel.SetTargetParam(value)");
  expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)");
  expect(script).toContain("Duel.Recover(p,d,REASON_EFFECT)");
  expect(script).toContain("e2b:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("c:IsSummonLocation(LOCATION_GRAVE)");
  expect(script).toContain("Duel.RaiseSingleEvent(e:GetHandler(),EVENT_CUSTOM+id+1,e,0,tp,tp,0)");
  expect(script).toContain("Duel.SetTargetCard(tc)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(1000)");
  expect(script).toContain("e3b:SetCode(EVENT_DISCARD)");
  expect(script).toContain("Duel.RaiseSingleEvent(e:GetHandler(),EVENT_CUSTOM+id+2,e,0,tp,tp,0)");
  expect(script).toContain("Duel.SendtoHand(tc,nil,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: ebonCode, name: "Ebon Sun", kind: "spell", typeFlags: typeSpell | typeContinuous },
    { code: destroyedMonsterCode, name: "Ebon Sun Destroyed Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1800, defense: 1200 },
    { code: graveSummonCode, name: "Ebon Sun Grave Summon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1600, defense: 1000 },
    { code: discardedSpellCode, name: "Ebon Sun Discarded Spell", kind: "spell", typeFlags: typeSpell },
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
  const waitingFor = response.state.waitingFor as PlayerId | undefined;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
