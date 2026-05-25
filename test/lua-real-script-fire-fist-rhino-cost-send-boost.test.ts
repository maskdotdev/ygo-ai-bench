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
const rhinoCode = "66084673";
const fireFormationCode = "660846730";
const handFireFistCode = "660846731";
const defenderCode = "660846732";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasRhinoScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${rhinoCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeContinuous = 0x20000;
const typeEffect = 0x20;
const raceBeastWarrior = 0x8000;
const raceWarrior = 0x1;
const attributeFire = 0x4;
const setFireFist = 0x79;
const setFireFormation = 0x7c;
const effectUpdateAttack = 100;
const resetPhaseDamageCalculation = 1073741888;
const reasonCost = duelReason.cost;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasRhinoScript)("Lua real script Fire Fist Rhino cost send boost", () => {
  it("restores pre-damage Fire Formation and hand Fire Fist cost selection into base-ATK boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${rhinoCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restored = createRestoredBattle({ reader, workspace });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const rhino = requireCard(restored.session, rhinoCode);
    const fireFormation = requireCard(restored.session, fireFormationCode);
    const handFireFist = requireCard(restored.session, handFireFistCode);
    const defender = requireCard(restored.session, defenderCode);
    const attack = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === rhino.uid && action.targetUid === defender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, attack!);
    passUntilDamageResponse(restored, 0);

    const activate = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === rhino.uid && action.effectId === "lua-1-1134"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activate!);
    resolveRestoredChain(restored);

    expect(findCard(restored.session, fireFormation.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: reasonCost,
      reasonPlayer: 0,
      reasonCardUid: rhino.uid,
      reasonEffectId: 1,
    });
    expect(findCard(restored.session, handFireFist.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: reasonCost,
      reasonPlayer: 0,
      reasonCardUid: rhino.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(findCard(restored.session, rhino.uid), restored.session.state)).toBe(3200);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === rhino.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: resetPhaseDamageCalculation }, sourceUid: rhino.uid, value: 1500 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => ["attackDeclared", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      current: event.eventCurrentState?.location,
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { current: "monsterZone", eventCardUid: rhino.uid, eventCode: 1130, eventName: "attackDeclared", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "deck", relatedEffectId: undefined },
      { current: "graveyard", eventCardUid: fireFormation.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: reasonCost, eventReasonCardUid: rhino.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, previous: "spellTrapZone", relatedEffectId: undefined },
      { current: "graveyard", eventCardUid: handFireFist.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: reasonCost, eventReasonCardUid: rhino.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, previous: "hand", relatedEffectId: undefined },
      { current: "graveyard", eventCardUid: fireFormation.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: reasonCost, eventReasonCardUid: rhino.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, previous: "spellTrapZone", relatedEffectId: undefined },
    ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const rhino = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === rhinoCode);
  expect(rhino).toBeDefined();
  return [
    rhino!,
    { code: fireFormationCode, name: "Rhino Fire Formation Cost", kind: "spell", typeFlags: typeSpell | typeContinuous, setcodes: [setFireFormation] },
    { code: handFireFistCode, name: "Rhino Hand Fire Fist Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeFire, level: 4, attack: 1500, defense: 1000, setcodes: [setFireFist] },
    { code: defenderCode, name: "Rhino Battle Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeFire, level: 4, attack: 3000, defense: 1000 },
  ];
}

function createRestoredBattle({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 66084673, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [rhinoCode, fireFormationCode, handFireFistCode] }, 1: { main: [defenderCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, rhinoCode), 0, 0);
  moveFaceUpSpellTrap(session, requireCard(session, fireFormationCode), 0, 0);
  moveDuelCard(session.state, requireCard(session, handFireFistCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, defenderCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(rhinoCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Brotherhood of the Fire Fist - Rhino");
  expect(script).toContain("e1:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
  expect(script).toContain("Duel.GetAttacker():IsControler(tp) and Duel.GetAttacker():IsSetCard(SET_FIRE_FIST)");
  expect(script).toContain("return c:IsFaceup() and c:IsSetCard(SET_FIRE_FORMATION) and c:IsAbleToGraveAsCost()");
  expect(script).toContain("return c:IsSetCard(SET_FIRE_FIST) and c:GetBaseAttack()>0 and c:IsAbleToGraveAsCost()");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.filter1,tp,LOCATION_ONFIELD,0,1,1,nil)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.filter2,tp,LOCATION_HAND,0,1,1,nil)");
  expect(script).toContain("e:SetLabel(g2:GetFirst():GetBaseAttack())");
  expect(script).toContain("Duel.SendtoGrave(g1,REASON_COST)");
  expect(script).toContain("e:GetHandler():RegisterFlagEffect(id,RESET_PHASE|PHASE_DAMAGE_CAL,0,1)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetReset(RESET_PHASE|PHASE_DAMAGE_CAL)");
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function moveFaceUpSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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

function passUntilDamageResponse(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  let guard = 0;
  while (restored.session.state.waitingFor !== player || restored.session.state.battleWindow?.kind !== "beforeDamageCalculation") {
    expect(++guard).toBeLessThan(20);
    const actionPlayer = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, actionPlayer).find((action) => action.type === "passChain" || action.type === "passAttack" || action.type === "passDamage");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, actionPlayer), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
