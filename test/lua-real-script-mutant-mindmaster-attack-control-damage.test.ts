import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const mindmasterCode = "11508758";
const defenderCode = "115087580";
const attackerCode = "115087581";
const controlTargetCode = "115087582";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMindmasterScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${mindmasterCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const racePsychic = 0x1000000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const categoryControl = 0x2000;
const eventAttackAnnounce = 1130;
const effectCannotDirectAttack = 73;
const effectCannotAttack = 85;
const effectFlagCardTarget = 0x10;
const effectFlagCannotDisable = 0x400;
const allLocations = ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"];

describe.skipIf(!hasUpstreamScripts || !hasMindmasterScript || true)("Lua real script Mutant Mindmaster attack control damage", () => {
  it("restores attack-target announcement control into direct lock, CalculateDamage, and handler attack lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectMindmasterScriptShape(workspace.readScript(`official/c${mindmasterCode}.lua`));
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 11508758, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [mindmasterCode, defenderCode] }, 1: { main: [attackerCode, controlTargetCode] } });
    startDuel(session);

    const mindmaster = requireCard(session, mindmasterCode);
    const defender = requireCard(session, defenderCode);
    const attacker = requireCard(session, attackerCode);
    const controlTarget = requireCard(session, controlTargetCode);
    moveFaceUpAttack(session, mindmaster, 0, 0);
    moveFaceUpAttack(session, defender, 0, 1);
    moveFaceUpAttack(session, attacker, 1, 0);
    moveFaceUpAttack(session, controlTarget, 1, 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(mindmasterCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 1).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === mindmaster.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    if (session.state.waitingFor === 1) {
      const pass = getLegalActions(session, 1).find((action) => action.type === "passAttack");
      expect(pass, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
      applyAndAssert(session, pass!);
    }

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === mindmaster.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: categoryControl, code: eventAttackAnnounce, event: "trigger", id: `lua-1-${eventAttackAnnounce}`, property: effectFlagCardTarget, range: allLocations, triggerEvent: "attackDeclared" },
    ]);
    const activate = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateTrigger" && action.uid === mindmaster.uid && action.effectId === `lua-1-${eventAttackAnnounce}`);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activate!);
    resolveRestoredChain(restored);

    expect(findCard(restored.session, controlTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: mindmaster.uid,
      reasonEffectId: 1,
    });
    expect(restored.session.state.effects.filter((effect) => [effectCannotDirectAttack, effectCannotAttack].includes(effect.code ?? 0)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: effectCannotDirectAttack, event: "continuous", property: effectFlagCannotDisable, reset: { flags: 1107169792 }, sourceUid: controlTarget.uid },
      { code: effectCannotAttack, event: "continuous", property: effectFlagCannotDisable, reset: { flags: 1107169312 }, sourceUid: mindmaster.uid },
    ]);
    expect(restored.session.state.currentAttack).toBeUndefined();
    expect(restored.session.state.pendingBattle).toBeUndefined();
    expect(findCard(restored.session, attacker.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restored.session.state.players[1].lifePoints).toBe(7200);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 800 });
    expect(restored.session.state.eventHistory.filter((event) => ["attackDeclared", "controlChanged", "battleDamageDealt", "destroyed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventUids: event.eventUids,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventName: "attackDeclared", eventCode: eventAttackAnnounce, eventCardUid: attacker.uid, eventUids: [attacker.uid, mindmaster.uid], eventPlayer: undefined, eventValue: undefined, eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 1 },
      { eventName: "controlChanged", eventCode: 1120, eventCardUid: controlTarget.uid, eventUids: undefined, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect, eventReasonCardUid: mindmaster.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
      { eventName: "battleDamageDealt", eventCode: 1143, eventCardUid: controlTarget.uid, eventUids: undefined, eventPlayer: 1, eventValue: 800, eventReason: duelReason.battle, eventReasonCardUid: controlTarget.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: attacker.uid, eventUids: undefined, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.battle | duelReason.destroy, eventReasonCardUid: controlTarget.uid, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
    ]);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  return [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === mindmasterCode),
    { code: defenderCode, name: "Mindmaster Other Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePsychic, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: attackerCode, name: "Mindmaster Original Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000 },
    { code: controlTargetCode, name: "Mindmaster Control Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2000, defense: 1000 },
  ];
}

function expectMindmasterScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Mutant Mindmaster");
  expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e1:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("Duel.GetAttackTarget()~=nil and Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE)>1");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_DIRECT_ATTACK)");
  expect(script).toContain("Duel.AdjustInstantly(tc)");
  expect(script).toContain("Duel.GetControl(tc,tp,PHASE_BATTLE,1)");
  expect(script).toContain("local ats=tc:GetAttackableTarget()");
  expect(script).toContain("Duel.CalculateDamage(tc,g:GetFirst())");
  expect(script).toContain("e2:SetCode(EFFECT_CANNOT_ATTACK)");
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
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
