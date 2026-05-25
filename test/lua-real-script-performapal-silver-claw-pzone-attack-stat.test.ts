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
const silverClawCode = "26270847";
const allyCode = "262708470";
const defenderCode = "262708471";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSilverClawScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${silverClawCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const raceBeast = 0x4000;
const attributeDark = 0x20;
const setPerformapal = 0x9f;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasSilverClawScript)("Lua real script Performapal Silver Claw pzone attack stat", () => {
  it("restores PZONE Performapal field boost plus attack-announcement group ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${silverClawCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createBattleSession({ reader, workspace });
    const [pzoneSilver, attackingSilver] = session.state.cards.filter((card) => card.code === silverClawCode).sort((left, right) => left.sequence - right.sequence);
    expect(pzoneSilver).toBeDefined();
    expect(attackingSilver).toBeDefined();
    const ally = requireCard(session, allyCode);
    const defender = requireCard(session, defenderCode);

    expect(currentAttack(attackingSilver, session.state)).toBe(2100);
    expect(currentAttack(ally, session.state)).toBe(1300);
    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attackingSilver!.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    expect(session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-8-1130",
        sourceUid: attackingSilver!.uid,
        player: 0,
        triggerBucket: "turnMandatory",
        eventName: "attackDeclared",
        eventCode: 1130,
        eventCardUid: attackingSilver!.uid,
        eventPlayer: 0,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredAttack = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredAttack);
    expectRestoredLegalActions(restoredAttack, 0);
    const trigger = getLuaRestoreLegalActions(restoredAttack, 0).find((action) => action.type === "activateTrigger" && action.uid === attackingSilver!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredAttack, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttack, trigger!);
    resolveRestoredChain(restoredAttack);

    expect(currentAttack(findCard(restoredAttack.session, attackingSilver!.uid), restoredAttack.session.state)).toBe(2400);
    expect(currentAttack(findCard(restoredAttack.session, ally.uid), restoredAttack.session.state)).toBe(1600);
    expect(currentAttack(findCard(restoredAttack.session, defender.uid), restoredAttack.session.state)).toBe(1000);
    expect(restoredAttack.session.state.effects.filter((effect) => effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, range: ["spellTrapZone"], reset: undefined, sourceUid: pzoneSilver!.uid, targetRange: [4, 0], value: 300 },
      { code: effectUpdateAttack, range: ["spellTrapZone"], reset: undefined, sourceUid: attackingSilver!.uid, targetRange: [4, 0], value: 300 },
      { code: effectUpdateAttack, range: ["monsterZone"], reset: { flags: 1107169408 }, sourceUid: attackingSilver!.uid, targetRange: undefined, value: 300 },
      { code: effectUpdateAttack, range: ["monsterZone"], reset: { flags: 1107169408 }, sourceUid: ally.uid, targetRange: undefined, value: 300 },
    ]);
    expect(restoredAttack.session.state.pendingTriggers).toEqual([]);

    const restoredStats = restoreDuelWithLuaScripts(serializeDuel(restoredAttack.session), workspace, reader);
    expectCleanRestore(restoredStats);
    expectRestoredLegalActions(restoredStats, 0);
    expect(currentAttack(findCard(restoredStats.session, attackingSilver!.uid), restoredStats.session.state)).toBe(2400);
    expect(currentAttack(findCard(restoredStats.session, ally.uid), restoredStats.session.state)).toBe(1600);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: silverClawCode, name: "Performapal Silver Claw", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: raceBeast, attribute: attributeDark, setcodes: [setPerformapal], level: 4, attack: 1800, defense: 700, leftScale: 5, rightScale: 5 },
    { code: allyCode, name: "Silver Claw Performapal Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeDark, setcodes: [setPerformapal], level: 4, attack: 1000, defense: 1000 },
    { code: defenderCode, name: "Silver Claw Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
  ];
}

function createBattleSession({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): DuelSession {
  const session = createDuel({ seed: 26270847, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [silverClawCode, silverClawCode, allyCode] }, 1: { main: [defenderCode] } });
  startDuel(session);
  const [pzoneSilver, attackingSilver] = session.state.cards.filter((card) => card.code === silverClawCode).sort((left, right) => left.sequence - right.sequence);
  expect(pzoneSilver).toBeDefined();
  expect(attackingSilver).toBeDefined();
  movePzone(session, pzoneSilver!, 0, 0);
  moveFaceUpAttack(session, attackingSilver!, 0, 0);
  moveFaceUpAttack(session, requireCard(session, allyCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, defenderCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(silverClawCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  return session;
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Performapal Silver Claw");
  expect(script).toContain("Pendulum.AddProcedure(c)");
  expect(script).toContain("e2:SetRange(LOCATION_PZONE)");
  expect(script).toContain("e2:SetTargetRange(LOCATION_MZONE,0)");
  expect(script).toContain("return c:IsSetCard(SET_PERFORMAPAL)");
  expect(script).toContain("e3:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsSetCard,SET_PERFORMAPAL),tp,LOCATION_MZONE,0,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
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

function movePzone(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
