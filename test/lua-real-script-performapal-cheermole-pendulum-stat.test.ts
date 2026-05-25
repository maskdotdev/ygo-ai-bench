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
const cheermoleCode = "17857780";
const pendulumTargetCode = "178577800";
const regularTargetCode = "178577801";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasCheermoleScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${cheermoleCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasCheermoleScript)("Lua real script Performapal Cheermole Pendulum stat", () => {
  it("restores PZONE Pendulum attack boost into targeted Main Phase ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${cheermoleCode}.lua`);
    expect(script).toContain("--Performapal Cheermole");
    expect(script).toContain("Pendulum.AddProcedure(c)");
    expect(script).toContain("e2:SetRange(LOCATION_PZONE)");
    expect(script).toContain("e2:SetTarget(s.atktg)");
    expect(script).toContain("return c:IsType(TYPE_PENDULUM)");
    expect(script).toContain("return c:IsFaceup() and c:GetAttack()~=c:GetBaseAttack()");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(1000)");

    const cheermoleData = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === cheermoleCode);
    expect(cheermoleData).toBeDefined();
    const cards: DuelCardData[] = [
      cheermoleData!,
      { code: pendulumTargetCode, name: "Cheermole Pendulum Target", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, level: 4, attack: 1000, defense: 1000, leftScale: 1, rightScale: 1 },
      { code: regularTargetCode, name: "Cheermole Regular Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1600, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 17857780, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [cheermoleCode, cheermoleCode, pendulumTargetCode, regularTargetCode] }, 1: { main: [] } });
    startDuel(session);

    const [scaleCheermole, monsterCheermole] = requireCards(session, cheermoleCode, 2);
    const pendulumTarget = requireCard(session, pendulumTargetCode);
    const regularTarget = requireCard(session, regularTargetCode);
    moveFaceUpPzone(session, scaleCheermole, 0, 0);
    moveFaceUpAttack(session, pendulumTarget, 0, 0);
    moveFaceUpAttack(session, monsterCheermole, 0, 1);
    moveFaceUpAttack(session, regularTarget, 0, 2);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(cheermoleCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(currentAttack(pendulumTarget, session.state)).toBe(1300);
    expect(currentAttack(regularTarget, session.state)).toBe(1600);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(currentAttack(find(restoredOpen.session, pendulumTarget.uid), restoredOpen.session.state)).toBe(1300);
    expect(currentAttack(find(restoredOpen.session, regularTarget.uid), restoredOpen.session.state)).toBe(1600);

    const ignition = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === monsterCheermole.uid);
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, ignition!);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(currentAttack(find(restoredResolved.session, pendulumTarget.uid), restoredResolved.session.state)).toBe(2300);
    expect(currentAttack(find(restoredResolved.session, regularTarget.uid), restoredResolved.session.state)).toBe(1600);
    expect(restoredResolved.session.state.effects.filter((effect) => effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", range: ["spellTrapZone"], reset: undefined, sourceUid: scaleCheermole.uid, targetRange: [4, 0], value: 300 },
      { code: effectUpdateAttack, event: "continuous", range: ["spellTrapZone"], reset: undefined, sourceUid: monsterCheermole.uid, targetRange: [4, 0], value: 300 },
      { code: effectUpdateAttack, event: "continuous", range: ["monsterZone"], reset: { flags: 33427456 }, sourceUid: pendulumTarget.uid, targetRange: undefined, value: 1000 },
    ]);
    expect(restoredResolved.session.state.eventHistory.filter((event) => event.eventName === "becameTarget")).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCardUid: pendulumTarget.uid,
        relatedEffectId: 8,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
      },
    ]);
    expect(restoredResolved.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function requireCards(session: DuelSession, code: string, count: number): DuelCardInstance[] {
  const cards = session.state.cards.filter((candidate) => candidate.code === code);
  expect(cards).toHaveLength(count);
  return cards;
}

function find(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
}

function moveFaceUpPzone(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
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
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}
