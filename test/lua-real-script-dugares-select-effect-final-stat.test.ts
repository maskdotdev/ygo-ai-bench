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
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const dugaresCode = "66011101";
const materialACode = "660111010";
const materialBCode = "660111011";
const defenderCode = "660111012";
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Dugares SelectEffect final stat", () => {
  it("restores SelectEffect ATK branch into detach cost, Battle Phase skip effect, and final ATK double", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${dugaresCode}.lua`);
    expectScriptShape(script);

    const databaseCards = workspace.readDatabaseCards("cards.cdb");
    const dugaresData = databaseCards.find((card) => card.code === dugaresCode);
    expect(dugaresData).toBeDefined();
    const reader = createCardReader([
      dugaresData!,
      { code: materialACode, name: "Dugares Material A", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      { code: materialBCode, name: "Dugares Material B", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      { code: defenderCode, name: "Dugares Damage Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2000, defense: 1000 },
    ] satisfies DuelCardData[]);

    const session = createDuel({ seed: 66011101, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialACode, materialBCode], extra: [dugaresCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const dugares = requireCard(session, dugaresCode);
    const materialA = requireCard(session, materialACode);
    const materialB = requireCard(session, materialBCode);
    const defender = requireCard(session, defenderCode);
    moveFaceUpAttack(session, dugares, 0, 0);
    for (const [sequence, material] of [materialA, materialB].entries()) {
      moveDuelCard(session.state, material.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0).sequence = sequence;
      dugares.overlayUids.push(material.uid);
    }
    moveFaceUpAttack(session, defender, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace, { promptOverrides: [{ api: "SelectEffect", player: 0, returned: 3 }] });
    expect(host.loadCardScript(Number(dugaresCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, { promptOverrides: [{ api: "SelectEffect", player: 0, returned: 3 }] });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === dugares.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectEffect", player: 0, options: [2, 3], descriptions: [1056177618, 1056177619], returned: 3 },
    ]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === dugares.uid)?.overlayUids).toEqual([]);
    expect(restoredOpen.session.state.cards.filter((card) => [materialA.uid, materialB.uid].includes(card.uid)).map((card) => ({
      location: card.location,
      reason: card.reason,
      reasonPlayer: card.reasonPlayer,
      reasonCardUid: card.reasonCardUid,
      reasonEffectId: card.reasonEffectId,
    }))).toEqual([
      { location: "graveyard", reason: duelReason.cost, reasonPlayer: 0, reasonCardUid: dugares.uid, reasonEffectId: 2 },
      { location: "graveyard", reason: duelReason.cost, reasonPlayer: 0, reasonCardUid: dugares.uid, reasonEffectId: 2 },
    ]);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === dugares.uid), restoredOpen.session.state)).toBe(2400);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === dugares.uid && [102, 183].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: 183, event: "continuous", property: 67110912, reset: { count: 2, flags: 1342177792 }, targetRange: [1, 0], value: undefined },
      { code: 102, event: "continuous", property: 1024, reset: { flags: 1107169792 }, targetRange: undefined, value: 2400 },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "detachedMaterial").map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "detachedMaterial", eventCardUid: materialA.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: dugares.uid, eventReasonEffectId: 2 },
      { eventName: "detachedMaterial", eventCardUid: materialB.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: dugares.uid, eventReasonEffectId: 2 },
      { eventName: "detachedMaterial", eventCardUid: materialA.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: dugares.uid, eventReasonEffectId: 2 },
    ]);

    restoredOpen.session.state.phase = "battle";
    restoredOpen.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredOpen, 0);
    const attack = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === dugares.uid && action.targetUid === defender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, attack!);
    finishBattle(restoredOpen);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 400 });
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: dugares.uid,
        eventPlayer: 1,
        eventValue: 400,
        eventReason: duelReason.battle,
        eventReasonCardUid: dugares.uid,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Xyz.AddProcedure(c,nil,4,2)");
  expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(2,2,nil))");
  expect(script).toContain("local op=Duel.SelectEffect(tp,");
  expect(script).toContain("e:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("or (op==3 and EFFECT_SKIP_BP)");
  expect(script).toContain("Duel.RegisterEffect(e1,tp)");
  expect(script).toContain("Duel.HintSelection(tc,true)");
  expect(script).toContain("e2:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e2:SetValue(tc:GetAttack()*2)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function finishBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.battleDamage[1] === 0) {
    expect(++guard).toBeLessThan(20);
    resolveRestoredChain(restored);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const actions = getLuaRestoreLegalActions(restored, player);
    const pass = actions.find((action) => action.type === passType);
    if (!pass && actions.every((action) => action.type !== "passAttack" && action.type !== "passDamage")) return;
    expect(pass, JSON.stringify(actions, null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
