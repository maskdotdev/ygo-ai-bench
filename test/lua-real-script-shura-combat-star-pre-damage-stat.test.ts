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
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const shuraCode = "32615065";
const hasShuraScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${shuraCode}.lua`));
const targetCode = "326150650";
const typeMonster = 0x1;
const typeFusion = 0x40;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasShuraScript)("Lua real script Shura the Combat Star pre-damage stat", () => {
  it("restores pre-damage Quick Effect into level-scaled ATK gains for both battlers", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${shuraCode}.lua`);
    expect(script).toContain("Fusion.AddProcMix(c,true,true,96220350,s.ffilter)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
    expect(script).toContain("Duel.IsBattlePhase() and aux.StatChangeDamageStepCondition()");
    expect(script).toContain("e2:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
    expect(script).toContain("local a=Duel.GetAttacker()");
    expect(script).toContain("local d=Duel.GetAttackTarget()");
    expect(script).toContain("c:RegisterFlagEffect(id,RESET_EVENT|RESETS_STANDARD|RESET_PHASE|PHASE_DAMAGE_CAL,0,1)");
    expect(script).toContain("e1:SetValue(a:GetLevel()*200)");
    expect(script).toContain("e2:SetValue(d:GetLevel()*200)");
    expect(script).toContain("e3:SetCode(EVENT_TO_GRAVE)");
    expect(script).toContain("Duel.GetLocationCountFromEx(tp,tp,nil,c)>0");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 32615065, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [], extra: [shuraCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const shura = requireCard(session, shuraCode);
    const target = requireCard(session, targetCode);
    moveFaceUpAttack(session, shura, 0);
    moveFaceUpAttack(session, target, 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(shuraCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const attack = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === shura.uid && action.targetUid === target.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, attack!);
    passBattleUntilWindow(restoredOpen, "beforeDamageCalculation");
    expect(restoredOpen.session.state.pendingBattle).toMatchObject({ attackerUid: shura.uid, targetUid: target.uid });
    expect(restoredOpen.session.state.battleWindow?.kind).toBe("beforeDamageCalculation");

    const restoredPreDamage = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredPreDamage);
    expectRestoredLegalActions(restoredPreDamage, 1);
    expect(restoredPreDamage.session.state.waitingFor).toBe(1);
    const opponentPass = getLuaRestoreLegalActions(restoredPreDamage, 1).find((action) => action.type === "passDamage");
    expect(opponentPass, JSON.stringify(getLuaRestoreLegalActions(restoredPreDamage, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPreDamage, opponentPass!);

    const restoredPreDamageController = restoreDuelWithLuaScripts(serializeDuel(restoredPreDamage.session), workspace, reader);
    expectCleanRestore(restoredPreDamageController);
    expectRestoredLegalActions(restoredPreDamageController, 0);
    expect(restoredPreDamageController.session.state.waitingFor).toBe(0);
    const boost = getLuaRestoreLegalActions(restoredPreDamageController, 0).find((action) => action.type === "activateEffect" && action.uid === shura.uid && action.effectId === "lua-3-1134");
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredPreDamageController, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPreDamageController, boost!);
    resolveRestoredChain(restoredPreDamageController);

    expect(currentAttack(restoredPreDamageController.session.state.cards.find((card) => card.uid === shura.uid), restoredPreDamageController.session.state)).toBe(2400);
    expect(currentAttack(restoredPreDamageController.session.state.cards.find((card) => card.uid === target.uid), restoredPreDamageController.session.state)).toBe(2800);
    expect(restoredPreDamageController.session.state.flagEffects).toContainEqual(
      expect.objectContaining({ ownerType: "card", ownerId: shura.uid, code: Number(shuraCode), reset: 1107169344, resetCount: 1, property: 0, value: 0 }),
    );
    expect(restoredPreDamageController.session.state.effects.filter((effect) => [shura.uid, target.uid].includes(effect.sourceUid) && effect.code === 100).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 100, reset: { flags: 1073741888 }, sourceUid: shura.uid, value: 2400 },
      { code: 100, reset: { flags: 1073741888 }, sourceUid: target.uid, value: 800 },
    ]);
    expect(restoredPreDamageController.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredPreDamageController.session), workspace, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 1);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === shura.uid), restoredStat.session.state)).toBe(2400);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === target.uid), restoredStat.session.state)).toBe(2800);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: shuraCode, name: "Shura the Combat Star", kind: "extra", typeFlags: typeMonster | typeFusion | typeEffect, race: raceWarrior, attribute: attributeDark, level: 12, attack: 0, defense: 0 },
    { code: targetCode, name: "Shura Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2000, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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

function passBattleUntilWindow(restored: ReturnType<typeof restoreDuelWithLuaScripts>, kind: NonNullable<DuelSession["state"]["battleWindow"]>["kind"]): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.battleWindow?.kind !== kind) {
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
