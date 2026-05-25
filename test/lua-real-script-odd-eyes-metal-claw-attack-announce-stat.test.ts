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
const metalClawCode = "65029288";
const allyCode = "650292880";
const defenderCode = "650292881";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMetalClawScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${metalClawCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const raceBeast = 0x4000;
const raceWarrior = 0x1;
const effectCannotBeFusionMaterial = 235;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasMetalClawScript)("Lua real script Performapal Odd-Eyes Metal Claw attack announce stat", () => {
  it("restores attack-announce group ATK boost with summon-immunity script coverage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${metalClawCode}.lua`);
    expect(script).toContain("--Performapal Odd-Eyes Metal Claw");
    expect(script).toContain("Fusion.AddProcMix(c,true,true,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_ODD_EYES),aux.FilterBoolFunctionEx(Card.IsSetCard,SET_PERFORMAPAL))");
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_BE_FUSION_MATERIAL)");
    expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("return re and re:GetHandler():IsCode(CARD_POLYMERIZATION) and e:GetHandler():IsFusionSummoned()");
    expect(script).toContain("e1:SetCode(EFFECT_IMMUNE_EFFECT)");
    expect(script).toContain("return te:GetOwner()~=e:GetOwner()");
    expect(script).toContain("e3:SetCode(EVENT_ATTACK_ANNOUNCE)");
    expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,LOCATION_MZONE,0,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(300)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 65029288, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { extra: [metalClawCode], main: [allyCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const metalClaw = requireCard(session, metalClawCode);
    const ally = requireCard(session, allyCode);
    const defender = requireCard(session, defenderCode);
    moveFaceUpAttack(session, metalClaw, 0, 0);
    metalClaw.summonType = "fusion";
    moveFaceUpAttack(session, ally, 0, 1);
    moveFaceUpAttack(session, defender, 1, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(metalClawCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === metalClaw.uid && [effectCannotBeFusionMaterial, 1102, 1130].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
      value: effect.value,
    }))).toEqual([
      { code: effectCannotBeFusionMaterial, event: "continuous", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: undefined, value: 1 },
      { code: 1102, event: "continuous", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "specialSummoned", value: undefined },
      { code: 1130, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "attackDeclared", value: undefined },
    ]);

    const attack = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "declareAttack" && action.attackerUid === metalClaw.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, attack!);
    const trigger = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateTrigger" && action.uid === metalClaw.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, trigger!);
    resolveRestoredChain(restoredOpen);

    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === metalClaw.uid), restoredOpen.session.state)).toBe(3300);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === ally.uid), restoredOpen.session.state)).toBe(1800);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === defender.uid), restoredOpen.session.state)).toBe(1600);
    expect(restoredOpen.session.state.effects.filter((effect) => [metalClaw.uid, ally.uid].includes(effect.sourceUid) && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", reset: { flags: 1107169408 }, sourceUid: metalClaw.uid, value: 300 },
      { code: effectUpdateAttack, event: "continuous", reset: { flags: 1107169408 }, sourceUid: ally.uid, value: 300 },
    ]);

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 1);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === metalClaw.uid), restoredStat.session.state)).toBe(3300);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === ally.uid), restoredStat.session.state)).toBe(1800);
    expect(restoredStat.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: metalClawCode, name: "Performapal Odd-Eyes Metal Claw", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceBeast, level: 8, attack: 3000, defense: 2000 },
    { code: allyCode, name: "Metal Claw Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, level: 4, attack: 1500, defense: 1000 },
    { code: defenderCode, name: "Metal Claw Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1600, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
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
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
