import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const powerforceCode = "51779204";
const redDragonCode = "70902743";
const defenderCode = "517792040";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasPowerforceScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${powerforceCode}.lua`));
const typeSpell = 0x2;
const typeMonster = 0x1;
const typeSynchro = 0x2000;
const typeEffect = 0x20;
const raceDragon = 0x2000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const effectCannotActivate = 6;
const effectUpdateAttack = 100;
const effectPierce = 203;
const effectChangeBattleDamage = 208;
const effectFlagPlayerTarget = 0x800;
const effectFlagIgnoreImmune = 0x80;
const effectFlagClientHint = 0x4000000;
const resetStandardPhaseEnd = 1107169792;
const resetPhaseEnd = 1073742336;
const allLocations = ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"];

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasPowerforceScript)("Lua real script Absolute Powerforce battle buffs", () => {
  it("restores targeted Red Dragon Archfiend battle effects and flag label after activation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${powerforceCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 51779204, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [powerforceCode, redDragonCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const powerforce = requireCard(session, powerforceCode);
    const redDragon = requireCard(session, redDragonCode);
    const defender = requireCard(session, defenderCode);
    moveDuelCard(session.state, powerforce.uid, "hand", 0);
    moveFaceUpAttack(session, redDragon, 0, 0);
    moveFaceUpDefense(session, defender, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(powerforceCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activate = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === powerforce.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activate!);
    const operationInfos = restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? []);
    expect(operationInfos).toEqual([]);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.effects.filter((effect) =>
      effect.sourceUid === powerforce.uid && [effectUpdateAttack, effectCannotActivate, effectPierce, effectChangeBattleDamage].includes(effect.code ?? -1)
    ).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    })).sort((left, right) => (left.code ?? 0) - (right.code ?? 0))).toEqual([
      { code: effectCannotActivate, event: "continuous", property: effectFlagPlayerTarget, range: allLocations, reset: { flags: resetPhaseEnd }, sourceUid: powerforce.uid, targetRange: [0, 1], value: 1 },
      { code: effectUpdateAttack, event: "continuous", property: undefined, range: allLocations, reset: { flags: resetPhaseEnd }, sourceUid: powerforce.uid, targetRange: [4, 0], value: 1000 },
      { code: effectPierce, event: "continuous", property: undefined, range: allLocations, reset: { flags: resetPhaseEnd }, sourceUid: powerforce.uid, targetRange: [4, 0], value: 1000 },
      { code: effectChangeBattleDamage, event: "continuous", property: effectFlagIgnoreImmune, range: allLocations, reset: { flags: resetPhaseEnd }, sourceUid: powerforce.uid, targetRange: [4, 0], value: undefined },
    ]);
    expect(restoredOpen.session.state.flagEffects.filter((flag) => flag.ownerType === "card" && flag.ownerId === redDragon.uid).map((flag) => ({
      code: flag.code,
      ownerId: flag.ownerId,
      property: flag.property,
      reset: flag.reset,
      resetCount: flag.resetCount,
      value: flag.value,
    }))).toEqual([
      { code: Number(powerforceCode), ownerId: redDragon.uid, property: effectFlagClientHint, reset: resetStandardPhaseEnd, resetCount: 1, value: redDragon.fieldId },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "becameTarget").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: redDragon.uid, eventCode: 1028, eventName: "becameTarget", relatedEffectId: 1 },
    ]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const powerforce = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === powerforceCode);
  const redDragon = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === redDragonCode);
  expect(powerforce).toBeDefined();
  expect(redDragon).toBeDefined();
  return [
    { ...powerforce!, kind: "spell", typeFlags: typeSpell },
    { ...redDragon!, kind: "monster", typeFlags: typeMonster | typeSynchro | typeEffect, race: raceDragon, attribute: attributeDark, level: 8, attack: 3000, defense: 2000 },
    { code: defenderCode, name: "Absolute Powerforce Fixture Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Absolute Powerforce");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("Duel.IsAbleToEnterBP() or (Duel.IsBattlePhase() and not Duel.IsPhase(PHASE_BATTLE))");
  expect(script).toContain("Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsCode,CARD_RED_DRAGON_ARCHFIEND),tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("tc:RegisterFlagEffect(id,RESETS_STANDARD_PHASE_END,EFFECT_FLAG_CLIENT_HINT,1,fid,aux.Stringid(id,1))");
  expect(script).toContain("return (Duel.GetAttacker()==tc or Duel.GetAttackTarget()==tc) and tc:GetBattleTarget() and tc:GetBattleTarget():IsControler(1-tp)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(1000)");
  expect(script).toContain("e2:SetCode(EFFECT_CANNOT_ACTIVATE)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_PLAYER_TARGET)");
  expect(script).toContain("e3:SetCode(EFFECT_PIERCE)");
  expect(script).toContain("e4:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)");
  expect(script).toContain("e4:SetCode(EFFECT_CHANGE_BATTLE_DAMAGE)");
  expect(script).toContain("e4:SetValue(aux.ChangeBattleDamage(1,DOUBLE_DAMAGE))");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
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

function moveFaceUpDefense(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpDefense";
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
