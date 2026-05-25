import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const spartanCode = "50491121";
const allyCode = "504911210";
const attackerCode = "504911211";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSpartanScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${spartanCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const setHeroic = 0x6f;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasSpartanScript)("Lua real script Heroic Challenger Spartan attack announce target stat", () => {
  it("restores opponent-turn attack-announcement targeting into self ATK gain from target base ATK", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${spartanCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createBattleSession({ reader, workspace });
    const spartan = requireCard(session, spartanCode);
    const ally = requireCard(session, allyCode);
    const attacker = requireCard(session, attackerCode);

    const attack = getLegalActions(session, 1).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === spartan.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    expect(session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-1-1130",
        sourceUid: spartan.uid,
        player: 0,
        triggerBucket: "opponentOptional",
        eventName: "attackDeclared",
        eventCode: 1130,
        eventCardUid: attacker.uid,
        eventPlayer: 1,
        eventReason: 0,
        eventReasonPlayer: 1,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredAttack = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredAttack);
    expectRestoredLegalActions(restoredAttack, 0);
    const trigger = getLuaRestoreLegalActions(restoredAttack, 0).find((action) => action.type === "activateTrigger" && action.uid === spartan.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredAttack, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttack, trigger!);
    resolveRestoredChain(restoredAttack);

    expect(currentAttack(findCard(restoredAttack.session, spartan.uid), restoredAttack.session.state)).toBe(2800);
    expect(currentAttack(findCard(restoredAttack.session, ally.uid), restoredAttack.session.state)).toBe(1200);
    expect(currentAttack(findCard(restoredAttack.session, attacker.uid), restoredAttack.session.state)).toBe(1000);
    expect(restoredAttack.session.state.effects.filter((effect) => effect.sourceUid === spartan.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107169408 }, sourceUid: spartan.uid, value: 1200 },
    ]);
    expect(restoredAttack.session.state.eventHistory.filter((event) => event.eventName === "attackDeclared")).toEqual([
      {
        eventName: "attackDeclared",
        eventCode: 1130,
        eventCardUid: attacker.uid,
        eventReason: 0,
        eventReasonPlayer: 1,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(restoredAttack.session.state.pendingTriggers).toEqual([]);

    const restoredStats = restoreDuelWithLuaScripts(serializeDuel(restoredAttack.session), workspace, reader);
    expectCleanRestore(restoredStats);
    expectRestoredLegalActions(restoredStats, 1);
    expect(currentAttack(findCard(restoredStats.session, spartan.uid), restoredStats.session.state)).toBe(2800);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: spartanCode, name: "Heroic Challenger - Spartan", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, setcodes: [setHeroic], level: 4, attack: 1600, defense: 1000 },
    { code: allyCode, name: "Heroic Spartan Target Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, setcodes: [setHeroic], level: 4, attack: 1200, defense: 1000 },
    { code: attackerCode, name: "Spartan Attack Announcer", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
  ];
}

function createBattleSession({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): DuelSession {
  const session = createDuel({ seed: 50491121, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [spartanCode, allyCode] }, 1: { main: [attackerCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, spartanCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, allyCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, attackerCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(spartanCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return session;
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Heroic Challenger - Spartan");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e1:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("return Duel.IsTurnPlayer(1-tp)");
  expect(script).toContain("return c:IsFaceup() and c:IsSetCard(SET_HEROIC)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,e:GetHandler())");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(tc:GetBaseAttack())");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD|RESET_PHASE|PHASE_BATTLE)");
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

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
