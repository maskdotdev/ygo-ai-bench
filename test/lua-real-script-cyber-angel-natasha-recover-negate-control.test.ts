import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
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
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const natashaCode = "99427357";
const allyCode = "994273570";
const ritualDefenderCode = "994273571";
const attackerCode = "994273572";
const costCode = "994273573";
const controlTargetCode = "994273574";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeRitual = 0x80;
const raceFairy = 0x4;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const attributeEarth = 0x1;
const setCyberAngel = 0x2093;
const effectCannotSpecialSummon = 31;
const effectFlagCannotDisable = 0x400;
const effectFlagUncopyable = 0x40000;
const categoryRecover = 0x100000;
const categorySpecialSummon = 0x200;
const categoryControl = 0x2000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Cyber Angel Natasha recover negate control", () => {
  it("restores LP recovery, Ritual battle-target negation, and grave summon control steal", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${natashaCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());

    const restoredRecover = createRestoredRecoverWindow({ reader, workspace });
    const recoverNatasha = requireCard(restoredRecover.session, natashaCode);
    expectCleanRestore(restoredRecover);
    expect(restoredRecover.session.state.effects.filter((effect) => effect.sourceUid === recoverNatasha.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: effectCannotSpecialSummon, event: "continuous", property: effectFlagCannotDisable | effectFlagUncopyable, range: ["monsterZone"], triggerEvent: undefined },
      { category: categoryRecover, code: undefined, event: "ignition", property: 16, range: ["monsterZone"], triggerEvent: undefined },
      { category: undefined, code: 1131, event: "trigger", property: undefined, range: ["monsterZone"], triggerEvent: "battleTargeted" },
      { category: categorySpecialSummon | categoryControl, code: undefined, event: "ignition", property: 16, range: ["graveyard"], triggerEvent: undefined },
    ]);
    expectRestoredLegalActions(restoredRecover, 0);
    const recover = getLuaRestoreLegalActions(restoredRecover, 0).find((action) =>
      action.type === "activateEffect" && action.uid === recoverNatasha.uid && action.effectId === "lua-2"
    );
    expect(recover, JSON.stringify(getLuaRestoreLegalActions(restoredRecover, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredRecover, recover!);
    resolveRestoredChain(restoredRecover);
    expect(restoredRecover.session.state.players[0].lifePoints).toBe(8500);
    expect(restoredRecover.session.state.eventHistory.map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      relatedEffectId: event.relatedEffectId,
    }))).toContainEqual({
      eventName: "becameTarget",
      eventCardUid: recoverNatasha.uid,
      relatedEffectId: 2,
    });
    expect(restoredRecover.session.state.eventHistory.map((event) => ({
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toContainEqual({
      eventName: "recoveredLifePoints",
      eventPlayer: 0,
      eventValue: 500,
      eventReason: duelReason.effect,
      eventReasonCardUid: recoverNatasha.uid,
      eventReasonEffectId: 2,
    });

    const restoredNegate = createRestoredBattleTargetWindow({ reader, workspace });
    const negateNatasha = requireCard(restoredNegate.session, natashaCode);
    const attacker = requireCard(restoredNegate.session, attackerCode);
    const ritualDefender = requireCard(restoredNegate.session, ritualDefenderCode);
    expectCleanRestore(restoredNegate);
    const attack = getLuaRestoreLegalActions(restoredNegate, 1).find((action) =>
      action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === ritualDefender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredNegate, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredNegate, attack!);
    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredNegate.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    const negate = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === negateNatasha.uid && action.effectId === "lua-3-1131"
    );
    expect(negate, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, negate!);
    resolveRestoredChain(restoredTrigger);
    expect(restoredTrigger.session.state.pendingBattle).toBeUndefined();
    expect(restoredTrigger.session.state.eventHistory.map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toContainEqual({
      eventName: "attackDisabled",
      eventCardUid: attacker.uid,
      eventReason: duelReason.effect,
      eventReasonCardUid: negateNatasha.uid,
      eventReasonEffectId: 3,
    });

    const restoredControl = createRestoredGraveControlWindow({ reader, workspace });
    const graveNatasha = requireCard(restoredControl.session, natashaCode);
    const cost = requireCard(restoredControl.session, costCode);
    const controlTarget = requireCard(restoredControl.session, controlTargetCode);
    expectCleanRestore(restoredControl);
    expectRestoredLegalActions(restoredControl, 0);
    const control = getLuaRestoreLegalActions(restoredControl, 0).find((action) =>
      action.type === "activateEffect" && action.uid === graveNatasha.uid && action.effectId === "lua-4"
    );
    expect(control, JSON.stringify(getLuaRestoreLegalActions(restoredControl, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredControl, control!);
    resolveRestoredChain(restoredControl);
    expect(restoredControl.session.state.cards.find((card) => card.uid === cost.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: graveNatasha.uid,
      reasonEffectId: 4,
    });
    expect(restoredControl.session.state.cards.find((card) => card.uid === graveNatasha.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: graveNatasha.uid,
      reasonEffectId: 4,
    });
    expect(restoredControl.session.state.cards.find((card) => card.uid === controlTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: graveNatasha.uid,
      reasonEffectId: 4,
    });
    expect(restoredControl.session.state.eventHistory.map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toContainEqual({
      eventName: "controlChanged",
      eventCardUid: controlTarget.uid,
      eventReason: duelReason.effect,
      eventReasonCardUid: graveNatasha.uid,
      eventReasonEffectId: 4,
    });
  });
});

function createRestoredRecoverWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = baseSession(reader, 99427357, { 0: { main: [natashaCode, allyCode] }, 1: { main: [] } });
  moveFaceUpAttack(session, requireCard(session, natashaCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, allyCode), 0, 1);
  return registerAndRestore(session, workspace, reader);
}

function createRestoredBattleTargetWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = baseSession(reader, 99427358, { 0: { main: [natashaCode, ritualDefenderCode] }, 1: { main: [attackerCode] } });
  moveFaceUpAttack(session, requireCard(session, natashaCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, ritualDefenderCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, attackerCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  return registerAndRestore(session, workspace, reader);
}

function createRestoredGraveControlWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = baseSession(reader, 99427359, { 0: { main: [natashaCode, costCode] }, 1: { main: [controlTargetCode] } });
  const natasha = requireCard(session, natashaCode);
  natasha.summonType = "ritual";
  markProcedureComplete(natasha);
  moveDuelCard(session.state, natasha.uid, "graveyard", 0, duelReason.effect, 0);
  moveDuelCard(session.state, requireCard(session, costCode).uid, "graveyard", 0, duelReason.effect, 0);
  moveFaceUpAttack(session, requireCard(session, controlTargetCode), 1, 0);
  return registerAndRestore(session, workspace, reader);
}

function baseSession(
  reader: ReturnType<typeof createCardReader>,
  seed: number,
  decks: Parameters<typeof loadDecks>[1],
): DuelSession {
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, decks);
  startDuel(session);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return session;
}

function registerAndRestore(
  session: DuelSession,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  reader: ReturnType<typeof createCardReader>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(natashaCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBeGreaterThan(0);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Cyber Angel Natasha");
  expect(script).toContain("e1:SetCategory(CATEGORY_RECOVER)");
  expect(script).toContain("Duel.Recover(tp,tc:GetAttack()/2,REASON_EFFECT)");
  expect(script).toContain("e2:SetCode(EVENT_BE_BATTLE_TARGET)");
  expect(script).toContain("Duel.NegateAttack()");
  expect(script).toContain("e3:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_CONTROL)");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)>0");
  expect(script).toContain("Duel.GetControl(tc,tp)");
}

function cards(): DuelCardData[] {
  return [
    { code: natashaCode, name: "Cyber Angel Natasha", kind: "monster", typeFlags: typeMonster | typeEffect | typeRitual, race: raceFairy, attribute: attributeLight, level: 5, attack: 1000, defense: 1000, setcodes: [setCyberAngel] },
    { code: allyCode, name: "Natasha Recovery Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFairy, attribute: attributeLight, level: 4, attack: 2000, defense: 1000 },
    { code: ritualDefenderCode, name: "Natasha Ritual Defender", kind: "monster", typeFlags: typeMonster | typeEffect | typeRitual, race: raceFairy, attribute: attributeLight, level: 6, attack: 1800, defense: 1500 },
    { code: attackerCode, name: "Natasha Battle Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2400, defense: 1000 },
    { code: costCode, name: "Natasha Cyber Angel Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFairy, attribute: attributeLight, level: 4, attack: 1200, defense: 1000, setcodes: [setCyberAngel] },
    { code: controlTargetCode, name: "Natasha Control Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1900, defense: 1000 },
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
