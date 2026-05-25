import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const machineAngelCode = "27331568";
const cyberAngelCostCode = "273315680";
const fairyTargetCode = "273315681";
const opponentExtraCode = "273315682";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMachineAngelScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${machineAngelCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeRitual = 0x80;
const typeQuickPlay = 0x10000;
const typeFusion = 0x40;
const raceFairy = 0x4;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const setCyberAngel = 0x2093;
const effectDisable = 2;
const effectDisableEffect = 8;
const effectUpdateAttack = 100;
const effectUpdateDefense = 104;

describe.skipIf(!hasUpstreamScripts || !hasMachineAngelScript)("Lua real script Magnificent Machine Angel release stat disable", () => {
  it("restores release-cost ATK/DEF boost and battle-start Extra Deck monster disable", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${machineAngelCode}.lua`));
    const reader = createCardReader(cards());
    const session = createMachineAngelSession(reader, workspace);
    const machineAngel = requireCard(session, machineAngelCode);
    const cyberAngelCost = requireCard(session, cyberAngelCostCode);
    const fairyTarget = requireCard(session, fairyTargetCode);
    const opponentExtra = requireCard(session, opponentExtraCode);
    moveFaceDownSpell(session, machineAngel);
    moveFaceUpAttack(session, cyberAngelCost, 0);
    moveFaceUpAttack(session, fairyTarget, 0);
    moveFaceUpAttack(session, opponentExtra, 1);
    opponentExtra.summonType = "fusion";
    opponentExtra.summonTypeCode = 0x43000000;
    opponentExtra.previousLocation = "extraDeck";

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === machineAngel.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    passRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === cyberAngelCost.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: machineAngel.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === fairyTarget.uid), restoredOpen.session.state)).toBe(3000);
    expect(currentDefense(restoredOpen.session.state.cards.find((card) => card.uid === fairyTarget.uid), restoredOpen.session.state)).toBe(2200);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === fairyTarget.uid && [effectUpdateAttack, effectUpdateDefense, 1132].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", reset: { flags: 1107169792 }, sourceUid: fairyTarget.uid, value: 1200 },
      { code: effectUpdateDefense, event: "continuous", reset: { flags: 1107169792 }, sourceUid: fairyTarget.uid, value: 1200 },
      { code: 1132, event: "continuous", reset: { flags: 1107169792 }, sourceUid: fairyTarget.uid, value: undefined },
    ]);

    const restoredBoost = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredBoost);
    expectRestoredLegalActions(restoredBoost, 0);
    expect(currentAttack(restoredBoost.session.state.cards.find((card) => card.uid === fairyTarget.uid), restoredBoost.session.state)).toBe(3000);
    expect(currentDefense(restoredBoost.session.state.cards.find((card) => card.uid === fairyTarget.uid), restoredBoost.session.state)).toBe(2200);

    restoredBoost.session.state.phase = "battle";
    restoredBoost.session.state.waitingFor = 0;
    const attack = getLuaRestoreLegalActions(restoredBoost, 0).find((action) => action.type === "declareAttack" && action.attackerUid === fairyTarget.uid && action.targetUid === opponentExtra.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBoost, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBoost, attack!);
    passUntilExtraDisabled(restoredBoost, opponentExtra.uid);
    expect(restoredBoost.session.state.effects.filter((effect) => effect.sourceUid === opponentExtra.uid && [effectDisable, effectDisableEffect].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: effectDisable, reset: { flags: 1107169408 }, sourceUid: opponentExtra.uid },
      { code: effectDisableEffect, reset: { flags: 1107169408 }, sourceUid: opponentExtra.uid },
    ]);
    passBattle(restoredBoost);
    expect(restoredBoost.session.state.battleDamage).toEqual({ 0: 0, 1: 1000 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.costfilter,1,true,nil,nil,tp)");
  expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.costfilter,1,1,true,nil,nil,tp)");
  expect(script).toContain("e:SetLabel(g:GetFirst():GetLevel())");
  expect(script).toContain("Duel.Release(g,REASON_COST)");
  expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(e:GetLabel()*200)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
  expect(script).toContain("e3:SetCode(EVENT_BATTLE_START)");
  expect(script).toContain("bc and bc:IsSummonLocation(LOCATION_EXTRA)");
  expect(script).toContain("e1:SetCode(EFFECT_DISABLE)");
  expect(script).toContain("e2:SetCode(EFFECT_DISABLE_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: machineAngelCode, name: "Magnificent Machine Angel", kind: "spell", typeFlags: typeSpell | typeQuickPlay },
    { code: cyberAngelCostCode, name: "Cyber Angel Ritual Cost", kind: "monster", typeFlags: typeMonster | typeEffect | typeRitual, race: raceFairy, attribute: attributeLight, level: 6, attack: 1600, defense: 1400, setcodes: [setCyberAngel] },
    { code: fairyTargetCode, name: "Machine Angel LIGHT Fairy Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFairy, attribute: attributeLight, level: 4, attack: 1800, defense: 1000 },
    { code: opponentExtraCode, name: "Machine Angel Opponent Extra Target", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceWarrior, attribute: attributeLight, level: 6, attack: 2000, defense: 1600 },
  ];
}

function createMachineAngelSession(reader: ReturnType<typeof createCardReader>, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelSession {
  const session = createDuel({ seed: 27331568, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [machineAngelCode, cyberAngelCostCode, fairyTargetCode], extra: [] }, 1: { main: [], extra: [opponentExtraCode] } });
  startDuel(session);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(machineAngelCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return session;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceDownSpell(session: DuelSession, card: DuelCardInstance): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", card.controller);
  moved.faceUp = false;
  moved.position = "faceDown";
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
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

function passBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0 || restored.session.state.pendingTriggers.length > 0) {
    expect(++guard).toBeLessThan(20);
    if (restored.session.state.chain.length > 0) {
      passRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const trigger = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "activateTrigger");
    if (trigger) {
      applyRestoredActionAndAssert(restored, trigger);
      continue;
    }
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function passUntilExtraDisabled(restored: ReturnType<typeof restoreDuelWithLuaScripts>, targetUid: string): void {
  let guard = 0;
  while (!restored.session.state.effects.some((effect) => effect.sourceUid === targetUid && effect.code === effectDisableEffect)) {
    expect(++guard).toBeLessThan(20);
    if (restored.session.state.chain.length > 0) {
      passRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const trigger = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "activateTrigger");
    if (trigger) {
      applyRestoredActionAndAssert(restored, trigger);
      continue;
    }
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
