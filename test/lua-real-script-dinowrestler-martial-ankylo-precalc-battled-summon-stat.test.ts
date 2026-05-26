import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const ankyloCode = "35770983";
const dinowrestlerCode = "357709830";
const defenderCode = "357709831";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasAnkyloScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${ankyloCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceDinosaur = 0x10000;
const attributeEarth = 0x1;
const setDinowrestler = 0x11a;
const effectIndestructableBattle = 42;
const effectSetAttackFinal = 101;
const effectLeaveFieldRedirect = 60;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasAnkyloScript)("Lua real script Dinowrestler Martial Ankylo precalc battled summon stat", () => {
  it("restores SelfToGrave battle protection into battled ATK halving and End Phase self-summon redirect", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${ankyloCode}.lua`);
    expectAnkyloScriptShape(script);
    const ankyloData = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === ankyloCode);
    expect(ankyloData).toBeDefined();
    const reader = createCardReader([ankyloData!, ...cards()]);

    const restoredPrecalc = createRestoredAnkyloField({ reader, workspace, scenario: "precalc" });
    expectCleanRestore(restoredPrecalc);
    expectRestoredLegalActions(restoredPrecalc, 0);
    const handAnkylo = requireCard(restoredPrecalc.session, ankyloCode);
    const attacker = requireCard(restoredPrecalc.session, dinowrestlerCode);
    const defender = requireCard(restoredPrecalc.session, defenderCode);
    const attack = getLuaRestoreLegalActions(restoredPrecalc, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === defender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredPrecalc, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPrecalc, attack!);
    passUntilRestoredBattleWindow(restoredPrecalc, "beforeDamageCalculation");
    passUntilRestoredAction(restoredPrecalc, 0, handAnkylo.uid);

    const protection = getLuaRestoreLegalActions(restoredPrecalc, 0).find((action) =>
      action.type === "activateEffect" && action.uid === handAnkylo.uid && action.effectId === "lua-1-1134"
    );
    expect(protection, JSON.stringify(getLuaRestoreLegalActions(restoredPrecalc, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPrecalc, protection!);
    resolveRestoredChain(restoredPrecalc);
    expect(restoredPrecalc.session.state.cards.find((card) => card.uid === handAnkylo.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: handAnkylo.uid,
      reasonEffectId: 1,
    });
    expect(restoredPrecalc.session.state.effects.filter((effect) =>
      [attacker.uid, defender.uid].includes(effect.sourceUid ?? "") && [effectIndestructableBattle, 1138].includes(effect.code ?? 0)
    ).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectIndestructableBattle, event: "continuous", property: undefined, range: ["monsterZone"], reset: { flags: 1107169312 }, sourceUid: attacker.uid, value: 1 },
      { code: 1138, event: "continuous", property: 0x400, range: ["monsterZone"], reset: { flags: 1107169312 }, sourceUid: defender.uid, value: undefined },
    ]);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredPrecalc.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    passRestoredBattle(restoredBattle);
    expect(restoredBattle.session.state.cards.find((card) => card.uid === attacker.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(currentAttack(restoredBattle.session.state.cards.find((card) => card.uid === defender.uid), restoredBattle.session.state)).toBe(1500);
    expect(restoredBattle.session.state.effects.filter((effect) => effect.sourceUid === defender.uid && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, event: "continuous", reset: { flags: 33427456 }, sourceUid: defender.uid, value: 1500 },
    ]);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 1000, 1: 0 });

    const restoredGrave = createRestoredAnkyloField({ reader, workspace, scenario: "grave" });
    expectCleanRestore(restoredGrave);
    expectRestoredLegalActions(restoredGrave, 0);
    const fieldAnkylo = requireCard(restoredGrave.session, ankyloCode);
    destroyDuelCard(restoredGrave.session.state, fieldAnkylo.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(restoredGrave.session.state.effects.filter((effect) => effect.sourceUid === fieldAnkylo.uid && effect.triggerEvent === "phaseEnd").map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      range: effect.range,
      reset: effect.reset,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: 0x200, code: 4608, event: "trigger", range: ["graveyard"], reset: { flags: 1107169792 }, triggerEvent: "phaseEnd" },
    ]);
    const endPhase = getLuaRestoreLegalActions(restoredGrave, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(endPhase, JSON.stringify(getLuaRestoreLegalActions(restoredGrave, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredGrave, endPhase!);

    const restoredEnd = restoreDuelWithLuaScripts(serializeDuel(restoredGrave.session), workspace, reader);
    expectCleanRestore(restoredEnd);
    expectRestoredLegalActions(restoredEnd, 0);
    const summon = getLuaRestoreLegalActions(restoredEnd, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === fieldAnkylo.uid && action.effectId === "lua-3-4608"
    );
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredEnd, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEnd, summon!);
    resolveRestoredChain(restoredEnd);
    expect(restoredEnd.session.state.cards.find((card) => card.uid === fieldAnkylo.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: fieldAnkylo.uid,
      reasonEffectId: 3,
    });
    expect(restoredEnd.session.state.effects.filter((effect) => effect.sourceUid === fieldAnkylo.uid && effect.code === effectLeaveFieldRedirect).map((effect) => ({
      code: effect.code,
      property: effect.property,
      range: effect.range,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: effectLeaveFieldRedirect, property: 0x400, range: ["monsterZone"], reset: { flags: 13078528 }, value: 0x20 },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: dinowrestlerCode, name: "Ankylo Dinowrestler Battler", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setDinowrestler], race: raceDinosaur, attribute: attributeEarth, level: 4, attack: 2000, defense: 1000 },
    { code: defenderCode, name: "Ankylo Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDinosaur, attribute: attributeEarth, level: 4, attack: 3000, defense: 1000 },
  ];
}

function createRestoredAnkyloField({
  reader,
  workspace,
  scenario,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  scenario: "precalc" | "grave";
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: scenario === "precalc" ? 35770983 : 35770984, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [ankyloCode, dinowrestlerCode] }, 1: { main: [defenderCode] } });
  startDuel(session);
  if (scenario === "precalc") {
    moveDuelCard(session.state, requireCard(session, ankyloCode).uid, "hand", 0);
    moveFaceUpAttack(session, requireCard(session, dinowrestlerCode), 0, 0);
    moveFaceUpAttack(session, requireCard(session, defenderCode), 1, 0);
    session.state.phase = "battle";
  } else {
    moveFaceUpAttack(session, requireCard(session, ankyloCode), 0, 0);
    session.state.phase = "main2";
  }
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(ankyloCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectAnkyloScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Dinowrestler Martial Ankylo");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
  expect(script).toContain("e1:SetRange(LOCATION_HAND|LOCATION_MZONE)");
  expect(script).toContain("e1:SetCost(Cost.SelfToGrave)");
  expect(script).toContain("Duel.GetAttacker()");
  expect(script).toContain("Duel.GetAttackTarget()");
  expect(script).toContain("tc:IsSetCard(SET_DINOWRESTLER) and tc:IsRelateToBattle()");
  expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e2:SetCode(EVENT_BATTLED)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(b:GetAttack()/2)");
  expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("c:IsPreviousLocation(LOCATION_ONFIELD)");
  expect(script).toContain("e1:SetCode(EVENT_PHASE+PHASE_END)");
  expect(script).toContain("Duel.SpecialSummon(e:GetHandler(),0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e1:SetCode(EFFECT_LEAVE_FIELD_REDIRECT)");
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

function passUntilRestoredBattleWindow(restored: ReturnType<typeof restoreDuelWithLuaScripts>, kind: NonNullable<DuelSession["state"]["battleWindow"]>["kind"]): void {
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

function passUntilRestoredAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, uid: string): void {
  let guard = 0;
  while (!getLuaRestoreLegalActions(restored, player).some((action) => action.type === "activateEffect" && action.uid === uid)) {
    expect(++guard).toBeLessThan(10);
    const responsePlayer = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, responsePlayer).find((action) => action.type === "passDamage" || action.type === "passAttack");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, responsePlayer), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function passRestoredBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.currentAttack || restored.session.state.battleWindow || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(30);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.chain.length > 0 ? "passChain" : restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
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
