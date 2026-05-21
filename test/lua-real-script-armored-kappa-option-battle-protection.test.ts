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
const kappaCode = "50789693";
const materialCode = "507896930";
const discardCode = "507896931";
const attackerCode = "507896932";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasKappaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${kappaCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;

describe.skipIf(!hasUpstreamScripts || !hasKappaScript)("Lua real script Armored Kappa option battle protection", () => {
  it("restores detach SelectOption stat gain and battle quick discard protection", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${kappaCode}.lua`);
    expect(script).toContain("Xyz.AddProcedure(c,nil,2,2)");
    expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1))");
    expect(script).toContain("local opt=Duel.SelectOption(tp,aux.Stringid(id,2),aux.Stringid(id,3))");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("local bt=Duel.GetAttacker()");
    expect(script).toContain("bt=Duel.GetAttackTarget()");
    expect(script).toContain("Duel.DiscardHand(tp,Card.IsDiscardable,1,1,REASON_COST|REASON_DISCARD)");
    expect(script).toContain("e1:SetCode(EFFECT_AVOID_BATTLE_DAMAGE)");
    expect(script).toContain("e2:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");

    const cards: DuelCardData[] = [
      { code: kappaCode, name: "Armored Kappa", kind: "extra", typeFlags: typeMonster | typeXyz, level: 2, attack: 400, defense: 1000 },
      { code: materialCode, name: "Armored Kappa Overlay Material", kind: "monster", typeFlags: typeMonster | typeEffect, level: 2, attack: 1000, defense: 1000 },
      { code: discardCode, name: "Armored Kappa Discard Cost", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      { code: attackerCode, name: "Armored Kappa Battle Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2500, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 50789693, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialCode, discardCode], extra: [kappaCode] }, 1: { main: [attackerCode] } });
    startDuel(session);

    const kappa = requireCard(session, kappaCode);
    const material = requireCard(session, materialCode);
    const discard = requireCard(session, discardCode);
    const attacker = requireCard(session, attackerCode);
    moveFaceUpAttack(session, kappa, 0);
    moveDuelCard(session.state, material.uid, "overlay", 0);
    kappa.overlayUids.push(material.uid);
    moveDuelCard(session.state, discard.uid, "hand", 0);
    moveFaceUpAttack(session, attacker, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(kappaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const ignition = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === kappa.uid);
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, ignition!);
    passRestoredChain(restoredOpen);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: kappa.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === kappa.uid)?.overlayUids).toEqual([]);
    expect(restoredOpen.session.state.prompt, JSON.stringify(restoredOpen.session.state.prompt, null, 2)).toBeUndefined();
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === kappa.uid)!, restoredOpen.session.state)).toBe(1400);
    expect(currentDefense(restoredOpen.session.state.cards.find((card) => card.uid === kappa.uid)!, restoredOpen.session.state)).toBe(1000);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === kappa.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([{ code: 100, property: 0x2000, reset: { flags: 33492992 }, value: 1000 }]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "detachedMaterial")).toEqual([
      {
        eventName: "detachedMaterial",
        eventCode: 1202,
        eventCardUid: material.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: kappa.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "overlay", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);

    const restoredBoost = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredBoost);
    expectRestoredLegalActions(restoredBoost, 0);
    restoredBoost.session.state.phase = "battle";
    restoredBoost.session.state.turnPlayer = 1;
    restoredBoost.session.state.waitingFor = 1;
    const attack = getLuaRestoreLegalActions(restoredBoost, 1).find((action) =>
      action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === kappa.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBoost, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBoost, attack!);

    const quick = getLuaRestoreLegalActions(restoredBoost, 0).find((action) => action.type === "activateEffect" && action.uid === kappa.uid);
    expect(quick, JSON.stringify(getLuaRestoreLegalActions(restoredBoost, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBoost, quick!);
    passRestoredChain(restoredBoost);
    expect(restoredBoost.session.state.cards.find((card) => card.uid === discard.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: kappa.uid,
      reasonEffectId: 3,
    });
    expect(restoredBoost.session.state.effects.filter((effect) => [42, 201].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: 201, property: 0x800, reset: { flags: 1073742336 }, sourceUid: kappa.uid, targetRange: [1, 0], value: 1 },
      { code: 42, property: 0x80, reset: { flags: 1073742336 }, sourceUid: kappa.uid, targetRange: [4, 0], value: 1 },
    ]);

    const restoredProtection = restoreDuelWithLuaScripts(serializeDuel(restoredBoost.session), workspace, reader);
    expectCleanRestore(restoredProtection);
    passBattleResponses(restoredProtection);
    expect(restoredProtection.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredProtection.session.state.players[0].lifePoints).toBe(8000);
    expect(restoredProtection.session.state.players[1].lifePoints).toBe(8000);
    expect(restoredProtection.session.state.cards.find((card) => card.uid === kappa.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredProtection.session.state.cards.find((card) => card.uid === attacker.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
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

function passBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
