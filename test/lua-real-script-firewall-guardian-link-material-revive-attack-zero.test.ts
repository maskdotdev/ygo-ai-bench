import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { markProcedureComplete } from "#duel/procedure-status.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const guardianCode = "86605184";
const partnerCode = "866051840";
const linkResultCode = "866051841";
const ownLinkCode = "866051842";
const opposingLinkCode = "866051843";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasGuardianScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${guardianCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceCyberse = 0x1000000;
const attributeDark = 0x20;
const effectLeaveFieldRedirect = 60;
const effectSetBaseAttack = 103;
const effectImmuneEffect = 1;

describe.skipIf(!hasUpstreamScripts || !hasGuardianScript)("Lua real script Firewall Guardian Link material revive attack zero", () => {
  it("restores Cyberse Link material self-summon redirect and grave attack-negate base ATK zeroing", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${guardianCode}.lua`);
    expectScriptShape(script);

    const reader = createCardReader(cards());
    const restoredLink = createRestoredLinkWindow({ reader, workspace });
    const guardian = requireCard(restoredLink.session, guardianCode);
    const partner = requireCard(restoredLink.session, partnerCode);
    const linkResult = requireCard(restoredLink.session, linkResultCode);
    expectCleanRestore(restoredLink);
    expectRestoredLegalActions(restoredLink, 0);
    const linkSummon = getLuaRestoreLegalActions(restoredLink, 0).find(
      (action) => action.type === "linkSummon" && action.uid === linkResult.uid && sameMembers(action.materialUids, [guardian.uid, partner.uid]),
    );
    expect(linkSummon, JSON.stringify(getLuaRestoreLegalActions(restoredLink, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredLink, linkSummon!);

    expect(restoredLink.session.state.cards.find((card) => card.uid === guardian.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.material | duelReason.link,
      reasonCardUid: linkResult.uid,
      reasonPlayer: 0,
    });
    expect(restoredLink.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonCardUid: trigger.eventReasonCardUid,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-1-1108",
        eventCode: 1108,
        eventName: "usedAsMaterial",
        eventReason: duelReason.link,
        eventReasonCardUid: linkResult.uid,
        sourceUid: guardian.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredRevive = restoreDuelWithLuaScripts(serializeDuel(restoredLink.session), workspace, reader);
    expectCleanRestore(restoredRevive);
    expectRestoredLegalActions(restoredRevive, 0);
    const revive = getLuaRestoreLegalActions(restoredRevive, 0).find((action) => action.type === "activateTrigger" && action.uid === guardian.uid);
    expect(revive, JSON.stringify(getLuaRestoreLegalActions(restoredRevive, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredRevive, revive!);
    passRestoredChain(restoredRevive);

    expect(restoredRevive.session.state.cards.find((card) => card.uid === guardian.uid)).toMatchObject({
      location: "monsterZone",
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: guardian.uid,
      reasonEffectId: 1,
    });
    expect(restoredRevive.session.state.effects.filter((effect) => effect.sourceUid === guardian.uid && effect.code === effectLeaveFieldRedirect).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectLeaveFieldRedirect, property: 67109888, reset: { flags: 209326080 }, sourceUid: guardian.uid, value: 32 },
    ]);

    const restoredAttack = createRestoredAttackWindow({ reader, workspace });
    const attackGuardian = requireCard(restoredAttack.session, guardianCode);
    const ownLink = requireCard(restoredAttack.session, ownLinkCode);
    const opposingLink = requireCard(restoredAttack.session, opposingLinkCode);
    expectCleanRestore(restoredAttack);
    expectRestoredLegalActions(restoredAttack, 1);
    const attack = getLuaRestoreLegalActions(restoredAttack, 1).find(
      (action) => action.type === "declareAttack" && action.attackerUid === opposingLink.uid && action.targetUid === ownLink.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredAttack, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttack, attack!);

    const restoredNegate = restoreDuelWithLuaScripts(serializeDuel(restoredAttack.session), workspace, reader);
    expectCleanRestore(restoredNegate);
    expectRestoredLegalActions(restoredNegate, 0);
    const negate = getLuaRestoreLegalActions(restoredNegate, 0).find((action) => action.type === "activateTrigger" && action.uid === attackGuardian.uid);
    expect(negate, JSON.stringify(getLuaRestoreLegalActions(restoredNegate, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredNegate, negate!);
    passRestoredChain(restoredNegate);

    expect(restoredNegate.session.state.pendingBattle).toBeUndefined();
    expect(restoredNegate.session.state.cards.find((card) => card.uid === attackGuardian.uid)).toMatchObject({
      location: "banished",
      faceUp: true,
      reason: duelReason.cost,
      reasonCardUid: attackGuardian.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredNegate.session.state.cards.find((card) => card.uid === opposingLink.uid), restoredNegate.session.state)).toBe(0);
    expect(restoredNegate.session.state.effects.filter((effect) => effect.sourceUid === opposingLink.uid && [effectSetBaseAttack, effectImmuneEffect].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetBaseAttack, property: undefined, reset: { flags: 1107169792 }, sourceUid: opposingLink.uid, value: 0 },
      { code: effectImmuneEffect, property: 67239936, reset: { flags: 1107169792 }, sourceUid: opposingLink.uid, value: undefined },
    ]);
    expect(restoredNegate.session.state.eventHistory.filter((event) => ["attackDeclared", "banished", "attackDisabled", "chainSolved"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "attackDeclared", eventCode: 1130, eventCardUid: opposingLink.uid, eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "banished", eventCode: 1011, eventCardUid: attackGuardian.uid, eventReason: duelReason.cost, eventReasonCardUid: attackGuardian.uid, eventReasonEffectId: 2 },
      { eventName: "attackDisabled", eventCode: 1142, eventCardUid: opposingLink.uid, eventReason: duelReason.effect, eventReasonCardUid: attackGuardian.uid, eventReasonEffectId: 2 },
      { eventName: "chainSolved", eventCode: 1022, eventCardUid: undefined, eventReason: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
    ]);
    expect(restoredNegate.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredLinkWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 86605184, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [guardianCode, partnerCode], extra: [linkResultCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, guardianCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, partnerCode), 0, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(guardianCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredAttackWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 86605185, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [guardianCode], extra: [ownLinkCode] }, 1: { main: [], extra: [opposingLinkCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, guardianCode).uid, "graveyard", 0, duelReason.link, 0);
  const ownLink = moveFaceUpAttack(session, requireCard(session, ownLinkCode), 0, 0);
  const opposingLink = moveFaceUpAttack(session, requireCard(session, opposingLinkCode), 1, 0);
  ownLink.summonType = "link";
  opposingLink.summonType = "link";
  markProcedureComplete(ownLink);
  markProcedureComplete(opposingLink);
  session.state.phase = "battle";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(guardianCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Firewall Guardian");
  expect(script).toContain("e1:SetCode(EVENT_BE_MATERIAL)");
  expect(script).toContain("r==REASON_LINK and c:GetReasonCard():IsRace(RACE_CYBERSE)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)>0");
  expect(script).toContain("e1:SetCode(EFFECT_LEAVE_FIELD_REDIRECT)");
  expect(script).toContain("e2:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("Duel.NegateAttack()");
  expect(script).toContain("e1:SetCode(EFFECT_SET_BASE_ATTACK)");
  expect(script).toContain("e2:SetCode(EFFECT_IMMUNE_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: guardianCode, name: "Firewall Guardian", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeDark, level: 4, attack: 100, defense: 2000 },
    { code: partnerCode, name: "Firewall Guardian Cyberse Partner", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: linkResultCode, name: "Firewall Guardian Link Result", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, attribute: attributeDark, level: 2, attack: 1800, defense: 0, linkMarkers: 0x3, linkMaterialMin: 2, linkMaterialMax: 2 },
    { code: ownLinkCode, name: "Firewall Guardian Own Link", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, attribute: attributeDark, level: 2, attack: 1600, defense: 0, linkMarkers: 0x3 },
    { code: opposingLinkCode, name: "Firewall Guardian Opposing Link", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, attribute: attributeDark, level: 2, attack: 2400, defense: 0, linkMarkers: 0x3 },
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

function sameMembers(actual: readonly string[] | undefined, expected: readonly string[]): boolean {
  return !!actual && actual.length === expected.length && expected.every((uid) => actual.includes(uid));
}
