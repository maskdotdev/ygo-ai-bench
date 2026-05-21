import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const megingjordCode = "86827882";
const nordicTargetCode = "868278820";
const offSetTargetCode = "868278821";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMegingjordScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${megingjordCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTrap = 0x4;
const setNordic = 0x42;

describe.skipIf(!hasUpstreamScripts || !hasMegingjordScript)("Lua real script Nordic Relic Megingjord final stat direct lock", () => {
  it("restores targeted Damage Step legal final ATK/DEF doubling and cannot-direct-attack lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${megingjordCode}.lua`);
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
    expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,exc)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetValue(tc:GetBaseAttack()*2)");
    expect(script).toContain("e2:SetCode(EFFECT_SET_DEFENSE_FINAL)");
    expect(script).toContain("e2:SetValue(tc:GetBaseDefense()*2)");
    expect(script).toContain("e3:SetCode(EFFECT_CANNOT_DIRECT_ATTACK)");

    const cards: DuelCardData[] = [
      { code: megingjordCode, name: "Nordic Relic Megingjord", kind: "trap", typeFlags: typeTrap },
      { code: nordicTargetCode, name: "Megingjord Nordic Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setNordic], level: 4, attack: 1200, defense: 900 },
      { code: offSetTargetCode, name: "Megingjord Off-Set Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [0x123], level: 4, attack: 1800, defense: 1600 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 86827882, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [megingjordCode, nordicTargetCode, offSetTargetCode] }, 1: { main: [] } });
    startDuel(session);

    const megingjord = requireCard(session, megingjordCode);
    const nordicTarget = requireCard(session, nordicTargetCode);
    const offSetTarget = requireCard(session, offSetTargetCode);
    moveDuelCard(session.state, megingjord.uid, "spellTrapZone", 0);
    megingjord.position = "faceDown";
    megingjord.faceUp = false;
    moveFaceUpAttack(session, nordicTarget, 0);
    moveFaceUpAttack(session, offSetTarget, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(megingjordCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(getLuaRestoreLegalActions(restoredOpen, 0).some((action) =>
      action.type === "declareAttack" && action.attackerUid === nordicTarget.uid && action.directAttack === true
    )).toBe(true);

    const activate = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === megingjord.uid);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activate!);
    resolveRestoredChain(restoredOpen);

    const state = restoredOpen.session.state;
    expect(currentAttack(state.cards.find((card) => card.uid === nordicTarget.uid)!, state)).toBe(2400);
    expect(currentDefense(state.cards.find((card) => card.uid === nordicTarget.uid)!, state)).toBe(1800);
    expect(currentAttack(state.cards.find((card) => card.uid === offSetTarget.uid)!, state)).toBe(1800);
    expect(currentDefense(state.cards.find((card) => card.uid === offSetTarget.uid)!, state)).toBe(1600);
    expect(state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(state.effects.filter((effect) => [73, 102, 106].includes(effect.code ?? -1)).map((effect) => ({
      sourceUid: effect.sourceUid,
      code: effect.code,
      description: effect.description,
      property: effect.property,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { sourceUid: nordicTarget.uid, code: 102, description: undefined, property: undefined, reset: { flags: 1107169792 }, value: 2400 },
      { sourceUid: nordicTarget.uid, code: 106, description: undefined, property: undefined, reset: { flags: 1107169792 }, value: 1800 },
      { sourceUid: nordicTarget.uid, code: 73, description: 3207, property: 0x4000000, reset: { flags: 1107169792 }, value: undefined },
    ]);
    expect(state.eventHistory.filter((event) => event.eventName === "becameTarget")).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: nordicTarget.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { location: "deck", controller: 0, sequence: 2, position: "faceDown", faceUp: false },
        eventCurrentState: { location: "monsterZone", controller: 0, sequence: 0, position: "faceUpAttack", faceUp: true },
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
      },
    ]);

    const restoredLocked = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredLocked);
    restoredLocked.session.state.phase = "battle";
    restoredLocked.session.state.waitingFor = 0;
    expect(getLuaRestoreLegalActions(restoredLocked, 0).some((action) =>
      action.type === "declareAttack" && action.attackerUid === nordicTarget.uid && action.directAttack === true
    )).toBe(false);
    expect(getLuaRestoreLegalActions(restoredLocked, 0).some((action) =>
      action.type === "declareAttack" && action.attackerUid === offSetTarget.uid && action.directAttack === true
    )).toBe(true);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
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
