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
const uniteCode = "36045450";
const targetSpellcasterCode = "360454500";
const lockedSpellcasterCode = "360454501";
const nonSpellcasterCode = "360454502";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasUniteScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${uniteCode}.lua`));
const typeSpell = 0x2;
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceSpellcaster = 0x2;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const effectCannotAttack = 85;
const effectSetAttackFinal = 102;
const effectFlagIgnoreImmune = 0x80;
const effectFlagOath = 0x80000;
const resetStandardPhaseEnd = 1107169792;
const resetPhaseEnd = 1073742336;
const allLocations = ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"];

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasUniteScript)("Lua real script Magicians Unite target attack lock final stat", () => {
  it("restores targeted Spellcaster final ATK and same-turn OATH attack lock for the other Spellcasters", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${uniteCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 36045450, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [uniteCode, targetSpellcasterCode, lockedSpellcasterCode, nonSpellcasterCode] }, 1: { main: [] } });
    startDuel(session);

    const unite = requireCard(session, uniteCode);
    const targetSpellcaster = requireCard(session, targetSpellcasterCode);
    const lockedSpellcaster = requireCard(session, lockedSpellcasterCode);
    const nonSpellcaster = requireCard(session, nonSpellcasterCode);
    moveDuelCard(session.state, unite.uid, "hand", 0);
    moveFaceUpAttack(session, targetSpellcaster, 0, 0);
    moveFaceUpAttack(session, lockedSpellcaster, 0, 1);
    moveFaceUpAttack(session, nonSpellcaster, 0, 2);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(uniteCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activate = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === unite.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activate!);
    const operationInfos = restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? []);
    expect(operationInfos).toEqual([]);
    resolveRestoredChain(restoredOpen);

    expect(currentAttack(findCard(restoredOpen.session, targetSpellcaster.uid), restoredOpen.session.state)).toBe(3000);
    expect(currentAttack(findCard(restoredOpen.session, lockedSpellcaster.uid), restoredOpen.session.state)).toBe(1600);
    expect(currentAttack(findCard(restoredOpen.session, nonSpellcaster.uid), restoredOpen.session.state)).toBe(1700);
    expect(restoredOpen.session.state.effects.filter((effect) =>
      effect.sourceUid === targetSpellcaster.uid && effect.code === effectSetAttackFinal
    ).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, event: "continuous", range: ["monsterZone"], reset: { flags: resetStandardPhaseEnd }, sourceUid: targetSpellcaster.uid, value: 3000 },
    ]);
    expect(restoredOpen.session.state.effects.filter((effect) =>
      effect.sourceUid === unite.uid && effect.code === effectCannotAttack
    ).map((effect) => ({
      code: effect.code,
      event: effect.event,
      label: effect.label,
      property: effect.property,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
    }))).toEqual([
      { code: effectCannotAttack, event: "continuous", label: targetSpellcaster.fieldId, property: effectFlagOath | effectFlagIgnoreImmune, range: allLocations, reset: { flags: resetPhaseEnd }, sourceUid: unite.uid, targetRange: [4, 0] },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "becameTarget").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: targetSpellcaster.uid, eventCode: 1028, eventName: "becameTarget", relatedEffectId: 1 },
    ]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const unite = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === uniteCode);
  expect(unite).toBeDefined();
  return [
    { ...unite!, kind: "spell", typeFlags: typeSpell },
    { code: targetSpellcasterCode, name: "Magicians Unite Fixture Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 1500, defense: 1000 },
    { code: lockedSpellcasterCode, name: "Magicians Unite Fixture Locked Spellcaster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 1600, defense: 1000 },
    { code: nonSpellcasterCode, name: "Magicians Unite Fixture Warrior", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1700, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Magicians Unite");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("return c:IsPosition(POS_FACEUP_ATTACK) and c:IsRace(RACE_SPELLCASTER)");
  expect(script).toContain("return Duel.IsExistingMatchingCard(s.filter,tp,LOCATION_MZONE,0,2,nil)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_ATTACK)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_OATH+EFFECT_FLAG_IGNORE_IMMUNE)");
  expect(script).toContain("e1:SetLabel(g:GetFirst():GetFieldID())");
  expect(script).toContain("Duel.RegisterEffect(e1,tp)");
  expect(script).toContain("local tc=Duel.GetFirstTarget()");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(3000)");
  expect(script).toContain("return e:GetLabel()~=c:GetFieldID() and c:IsRace(RACE_SPELLCASTER)");
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
