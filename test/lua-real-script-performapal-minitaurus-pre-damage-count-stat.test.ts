import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const minitaurusCode = "10731333";
const attackerCode = "107313330";
const allyCode = "107313331";
const defenderCode = "107313332";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMinitaurusScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${minitaurusCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const raceBeast = 0x4000;
const raceDragon = 0x2000;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const attributeDark = 0x20;
const setPerformapal = 0x9f;
const setOddEyes = 0x99;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasMinitaurusScript)("Lua real script Performapal Odd-Eyes Minitaurus pre-damage count stat", () => {
  it("restores pre-damage Performapal/Odd-Eyes count into defender ATK loss", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${minitaurusCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const restoredBattle = createRestoredBattle({ reader, workspace });
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const minitaurus = requireCard(restoredBattle.session, minitaurusCode);
    const attacker = requireCard(restoredBattle.session, attackerCode);
    const defender = requireCard(restoredBattle.session, defenderCode);

    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    passUntilBattleWindow(restoredBattle, "beforeDamageCalculation");
    expect(restoredBattle.session.state.battleWindow).toMatchObject({ kind: "beforeDamageCalculation", step: "damage" });
    expect(restoredBattle.session.state.eventHistory.filter((event) => event.eventName === "beforeDamageCalculation")).toEqual([
      {
        eventName: "beforeDamageCalculation",
        eventCode: 1134,
        eventCardUid: attacker.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventUids: [attacker.uid, defender.uid],
      },
    ]);

    const restoredPreDamage = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredPreDamage);
    expectRestoredLegalActions(restoredPreDamage, 1);
    if (restoredPreDamage.session.state.waitingFor === 1) {
      const opponentPass = getLuaRestoreLegalActions(restoredPreDamage, 1).find((action) => action.type === "passDamage");
      expect(opponentPass, JSON.stringify(getLuaRestoreLegalActions(restoredPreDamage, 1), null, 2)).toBeDefined();
      applyRestoredActionAndAssert(restoredPreDamage, opponentPass!);
    }
    expect(restoredPreDamage.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-4-1134",
        sourceUid: minitaurus.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "beforeDamageCalculation",
        eventCode: 1134,
        eventPlayer: 0,
        eventCardUid: attacker.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventUids: [attacker.uid, defender.uid],
      },
    ]);
    const trigger = getLuaRestoreLegalActions(restoredPreDamage, 0).find((action) => action.type === "activateTrigger" && action.uid === minitaurus.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredPreDamage, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPreDamage, trigger!);
    resolveRestoredChain(restoredPreDamage);

    expect(currentAttack(findCard(restoredPreDamage.session, defender.uid), restoredPreDamage.session.state)).toBe(1600);
    expect(restoredPreDamage.session.state.effects.filter((effect) => effect.sourceUid === defender.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1073741888 }, sourceUid: defender.uid, value: -200 },
    ]);
    expect(restoredPreDamage.session.state.pendingTriggers).toEqual([]);
    expect(restoredPreDamage.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredPreDamage.session), workspace, reader);
    expectCleanRestore(restoredStat);
    expect(currentAttack(findCard(restoredStat.session, defender.uid), restoredStat.session.state)).toBe(1600);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: minitaurusCode, name: "Performapal Odd-Eyes Minitaurus", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: raceBeast, attribute: attributeDark, level: 4, attack: 1200, defense: 1600, leftScale: 6, rightScale: 6, setcodes: [setPerformapal, setOddEyes] },
    { code: attackerCode, name: "Minitaurus Pendulum Attacker", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: raceDragon, attribute: attributeDark, level: 4, attack: 1500, defense: 1000, leftScale: 4, rightScale: 4 },
    { code: allyCode, name: "Minitaurus Odd-Eyes Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, level: 4, attack: 1000, defense: 1000, setcodes: [setOddEyes] },
    { code: defenderCode, name: "Minitaurus Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1200 },
  ];
}

function createRestoredBattle({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 10731333, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [minitaurusCode, attackerCode, allyCode] }, 1: { main: [defenderCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, minitaurusCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, attackerCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, allyCode), 0, 2);
  moveFaceUpAttack(session, requireCard(session, defenderCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(minitaurusCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Performapal Odd-Eyes Minitaurus");
  expect(script).toContain("e1:SetCode(EFFECT_PIERCE)");
  expect(script).toContain("e2:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
  expect(script).toContain("Duel.GetMatchingGroupCount(s.atkfilter,tp,LOCATION_ONFIELD,0,nil)");
  expect(script).toContain("a:IsControler(tp) and a:IsType(TYPE_PENDULUM)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetReset(RESET_PHASE|PHASE_DAMAGE_CAL)");
  expect(script).toContain("e1:SetValue(-gc*100)");
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passUntilBattleWindow(restored: ReturnType<typeof restoreDuelWithLuaScripts>, kind: NonNullable<DuelSession["state"]["battleWindow"]>["kind"]): void {
  let guard = 0;
  while (restored.session.state.battleWindow?.kind !== kind) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
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
