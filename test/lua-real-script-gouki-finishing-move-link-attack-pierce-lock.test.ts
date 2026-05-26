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
const finishingMoveCode = "35870016";
const goukiLinkCode = "358700160";
const nonGoukiCode = "358700161";
const defenderCode = "358700162";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasFinishingMoveScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${finishingMoveCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const setGouki = 0xfc;
const effectCannotAttackAnnounce = 86;
const effectUpdateAttack = 100;
const effectPierce = 203;
const effectFlagCardTarget = 0x10;
const effectFlagClientHint = 0x4000000;
const effectFlagIgnoreImmune = 0x80;
const effectFlagSingleRange = 0x20000;
const resetPhaseEnd = 0x40000200;
const resetStandardPhaseEnd = 1107169792;

describe.skipIf(!hasUpstreamScripts || !hasFinishingMoveScript)("Lua real script Gouki Finishing Move link attack pierce lock", () => {
  it("restores targeted Gouki Link ATK gain, piercing damage, and non-Gouki attack lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${finishingMoveCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 35870016, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [finishingMoveCode, nonGoukiCode], extra: [goukiLinkCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const finishingMove = requireCard(session, finishingMoveCode);
    const goukiLink = requireCard(session, goukiLinkCode);
    const nonGouki = requireCard(session, nonGoukiCode);
    const defender = requireCard(session, defenderCode);
    moveDuelCard(session.state, finishingMove.uid, "hand", 0);
    moveFaceUpAttack(session, goukiLink, 0, 0);
    moveFaceUpAttack(session, nonGouki, 0, 1);
    moveFaceUpAttack(session, defender, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(finishingMoveCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activate = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === finishingMove.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activate!);
    resolveRestoredChain(restoredOpen);

    expect(currentAttack(findCard(restoredOpen.session, goukiLink.uid), restoredOpen.session.state)).toBe(5300);
    expect(currentAttack(findCard(restoredOpen.session, nonGouki.uid), restoredOpen.session.state)).toBe(1600);
    expect(restoredOpen.session.state.effects.filter((effect) =>
      [effectCannotAttackAnnounce, effectUpdateAttack, effectPierce].includes(effect.code ?? -1)
    ).map((effect) => ({
      code: effect.code,
      description: effect.description,
      event: effect.event,
      luaTargetDescriptor: effect.luaTargetDescriptor,
      luaValueDescriptor: effect.luaValueDescriptor,
      property: effect.property,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectCannotAttackAnnounce, description: undefined, event: "continuous", luaTargetDescriptor: "target:not-setcode:252", luaValueDescriptor: undefined, property: effectFlagIgnoreImmune, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], reset: { flags: resetPhaseEnd }, sourceUid: finishingMove.uid, targetRange: [4, 0], value: undefined },
      { code: effectUpdateAttack, description: undefined, event: "continuous", luaTargetDescriptor: undefined, luaValueDescriptor: "stat:self-link:x1000", property: effectFlagSingleRange, range: ["monsterZone"], reset: { flags: resetStandardPhaseEnd }, sourceUid: goukiLink.uid, targetRange: undefined, value: undefined },
      { code: effectPierce, description: 3208, event: "continuous", luaTargetDescriptor: undefined, luaValueDescriptor: undefined, property: effectFlagClientHint, range: ["monsterZone"], reset: { flags: resetStandardPhaseEnd }, sourceUid: goukiLink.uid, targetRange: undefined, value: undefined },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "becameTarget").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([{ eventCardUid: goukiLink.uid, eventCode: 1028, eventName: "becameTarget", relatedEffectId: 1 }]);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.turnPlayer = 0;
    restoredBattle.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredBattle, 0);
    expect(getLuaRestoreLegalActions(restoredBattle, 0).some((action) =>
      action.type === "declareAttack" && action.attackerUid === nonGouki.uid
    )).toBe(false);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === goukiLink.uid && action.targetUid === defender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    passRestoredBattle(restoredBattle);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 0, 1: 4100 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Gouki Finishing Move");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
  expect(script).toContain("return c:IsFaceup() and c:IsLinkMonster()");
  expect(script).toContain("and c:IsSetCard(SET_GOUKI) and c:IsLinkAbove(1)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("ge1:SetCode(EFFECT_CANNOT_ATTACK_ANNOUNCE)");
  expect(script).toContain("ge1:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)");
  expect(script).toContain("return not c:IsSetCard(SET_GOUKI)");
  expect(script).toContain("aux.RegisterClientHint(c,nil,tp,1,0,aux.Stringid(id,1),nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_SINGLE_RANGE)");
  expect(script).toContain("e1:SetValue(function(e,c) return c:GetLink()*1000 end)");
  expect(script).toContain("e2:SetCode(EFFECT_PIERCE)");
}

function cards(): DuelCardData[] {
  return [
    { code: finishingMoveCode, name: "Gouki Finishing Move", kind: "spell", typeFlags: typeSpell },
    { code: goukiLinkCode, name: "Gouki Finishing Move Link Target", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, setcodes: [setGouki], race: raceWarrior, attribute: attributeEarth, level: 3, attack: 2300, defense: 0, linkMarkers: 0x44 },
    { code: nonGoukiCode, name: "Gouki Finishing Move Non-Gouki", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000 },
    { code: defenderCode, name: "Gouki Finishing Move Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1200, defense: 4000 },
  ];
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

function passRestoredBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.currentAttack || restored.session.state.battleWindow || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passAttack" || candidate.type === "passDamage" || candidate.type === "passChain");
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
  }
}
