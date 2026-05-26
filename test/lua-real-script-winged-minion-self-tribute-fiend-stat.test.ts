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
const wingedMinionCode = "89258225";
const fiendTargetCode = "892582250";
const warriorDecoyCode = "892582251";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasWingedMinionScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${wingedMinionCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const raceFiend = 0x8;

describe.skipIf(!hasUpstreamScripts || !hasWingedMinionScript)("Lua real script Winged Minion self-tribute Fiend stat", () => {
  it("restores SelfTribute cost into targeted Fiend ATK/DEF boost after the source leaves field", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${wingedMinionCode}.lua`);
    expect(script).toContain("e1:SetCost(Cost.SelfTribute)");
    expect(script).toContain("return c:IsFaceup() and c:IsRace(RACE_FIEND)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(700)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD)");

    const cards: DuelCardData[] = [
      { code: wingedMinionCode, name: "Winged Minion", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, level: 2, attack: 700, defense: 700 },
      { code: fiendTargetCode, name: "Winged Minion Fiend Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, level: 4, attack: 1500, defense: 1200 },
      { code: warriorDecoyCode, name: "Winged Minion Warrior Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1800, defense: 1600 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 89258225, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [wingedMinionCode, fiendTargetCode, warriorDecoyCode] }, 1: { main: [] } });
    startDuel(session);

    const wingedMinion = requireCard(session, wingedMinionCode);
    const fiendTarget = requireCard(session, fiendTargetCode);
    const warriorDecoy = requireCard(session, warriorDecoyCode);
    moveFaceUpAttack(session, wingedMinion, 0);
    moveFaceUpAttack(session, fiendTarget, 0);
    moveFaceUpAttack(session, warriorDecoy, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(wingedMinionCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === wingedMinion.uid
    );
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === wingedMinion.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: wingedMinion.uid,
      reasonEffectId: 1,
    });

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer);
    resolveRestoredChain(restoredChain);

    const state = restoredChain.session.state;
    expect(currentAttack(state.cards.find((card) => card.uid === fiendTarget.uid)!, state)).toBe(2200);
    expect(currentDefense(state.cards.find((card) => card.uid === fiendTarget.uid)!, state)).toBe(1900);
    expect(currentAttack(state.cards.find((card) => card.uid === warriorDecoy.uid)!, state)).toBe(1800);
    expect(currentDefense(state.cards.find((card) => card.uid === warriorDecoy.uid)!, state)).toBe(1600);
    expect(state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(state.effects.filter((effect) => effect.sourceUid === fiendTarget.uid && [100, 104].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 100, reset: { flags: 33427456 }, value: 700 },
      { code: 104, reset: { flags: 33427456 }, value: 700 },
    ]);
    expect(state.eventHistory.filter((event) => event.eventName === "released" && event.eventCardUid === wingedMinion.uid)).toEqual([
      {
        eventName: "released",
        eventCode: 1017,
        eventCardUid: wingedMinion.uid,
        eventReason: duelReason.cost | duelReason.release,
        eventReasonPlayer: 0,
        eventReasonCardUid: wingedMinion.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(state.eventHistory.filter((event) => event.eventName === "becameTarget")).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: fiendTarget.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
      },
    ]);
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
