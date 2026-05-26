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
const currentCode = "20501450";
const targetCode = "205014500";
const otherAttackerCode = "205014501";
const defenderCode = "205014502";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCurrentScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${currentCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeQuickPlay = 0x10000;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const effectCannotAttack = 85;
const effectUpdateAttack = 100;
const eventAttackAnnounce = 1130;

describe.skipIf(!hasUpstreamScripts || !hasCurrentScript)("Lua real script Concentrating Current defense attack oath stat", () => {
  it("restores attacked-monster-only quick activation into DEF-based ATK gain and attack oath", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${currentCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 20501450, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [currentCode, targetCode, otherAttackerCode] },
      1: { main: [defenderCode] },
    });
    startDuel(session);
    const current = requireCard(session, currentCode);
    const target = requireCard(session, targetCode);
    const otherAttacker = requireCard(session, otherAttackerCode);
    const defender = requireCard(session, defenderCode);
    moveDuelCard(session.state, current.uid, "hand", 0);
    moveFaceUpAttack(session, target, 0, 0);
    moveFaceUpAttack(session, otherAttacker, 0, 1);
    moveFaceUpAttack(session, defender, 1, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(currentCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const attack = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === target.uid && action.targetUid === defender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, attack!);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "attackDeclared")).toEqual([
      {
        eventName: "attackDeclared",
        eventCode: eventAttackAnnounce,
        eventCardUid: target.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventUids: [target.uid, defender.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    expectRestoredLegalActions(restoredOpen, 1);
    const passOpponentAttackResponse = getLuaRestoreLegalActions(restoredOpen, 1).find((action) => action.type === "passAttack");
    expect(passOpponentAttackResponse, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, passOpponentAttackResponse!);

    expectRestoredLegalActions(restoredOpen, 0);
    const activate = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === current.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activate!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === current.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === target.uid), restoredOpen.session.state)).toBe(2600);
    expect(restoredOpen.session.state.effects.filter((effect) => [effectCannotAttack, effectUpdateAttack].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      label: effect.label,
      property: effect.property,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      triggerEvent: effect.triggerEvent,
      value: effect.value,
    }))).toEqual([
      { code: effectCannotAttack, event: "continuous", label: target.fieldId, property: 0x80000, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], reset: { flags: 1073742336 }, sourceUid: current.uid, targetRange: [4, 0], triggerEvent: undefined, value: undefined },
      { code: effectUpdateAttack, event: "continuous", label: undefined, property: undefined, range: ["monsterZone"], reset: { flags: 1107169792 }, sourceUid: target.uid, targetRange: undefined, triggerEvent: undefined, value: 1400 },
    ]);

    expectRestoredLegalActions(restoredOpen, 0);
    const otherAttack = getLuaRestoreLegalActions(restoredOpen, 0).filter((action) => action.type === "declareAttack" && action.attackerUid === otherAttacker.uid);
    expect(otherAttack).toEqual([]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Concentrating Current");
  expect(script).toContain("aux.GlobalCheck(s,function()");
  expect(script).toContain("ge1:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("ge2:SetCode(EVENT_ADJUST)");
  expect(script).toContain("s[0]=0");
  expect(script).toContain("aux.StatChangeDamageStepCondition");
  expect(script).toContain("c:HasNonZeroDefense()");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil,tp,costchk)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_ATTACK)");
  expect(script).toContain("aux.RegisterClientHint(e:GetHandler(),nil,tp,0,1,aux.Stringid(id,1),nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(tc:GetDefense())");
}

function cards(): DuelCardData[] {
  return [
    { code: currentCode, name: "Concentrating Current", kind: "spell", typeFlags: typeSpell | typeQuickPlay },
    { code: targetCode, name: "Current Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1200, defense: 1400 },
    { code: otherAttackerCode, name: "Current Other Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1300, defense: 1000 },
    { code: defenderCode, name: "Current Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
  ];
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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
