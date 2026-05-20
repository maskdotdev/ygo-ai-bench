import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
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
const cubicWaveCode = "35058588";
const cubicMonsterCode = "350585880";
const opponentTargetCode = "350585881";
const graveCostCode = "350585882";
const graveDecoyCode = "350585883";
const cubicCounter = 0x1038;
const setCubic = 0xe3;
const typeMonster = 0x1;
const typeSpell = 0x2;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Cubic Wave target cards counter disable", () => {
  it("restores GetTargetCards target ordering and graveyard counter-cost banish into attack/disable locks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${cubicWaveCode}.lua`);
    expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("e:SetLabelObject(g:GetFirst())");
    expect(script).toContain("local g=Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS)");
    expect(script).toContain("tc==hc");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
    expect(script).toContain("Duel.SetTargetCard(sg)");
    expect(script).toContain("local g=Duel.GetTargetCards(e)");
    expect(script).toContain("tc:AddCounter(0x1038,1)");
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_DISABLE)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === cubicWaveCode),
      { code: cubicMonsterCode, name: "Cubic Wave Cubic Monster", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1000, setcodes: [setCubic] },
      { code: opponentTargetCode, name: "Cubic Wave Opponent Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 2000, defense: 1000 },
      { code: graveCostCode, name: "Cubic Wave Grave Cost", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000, setcodes: [setCubic] },
      { code: graveDecoyCode, name: "Cubic Wave Grave Decoy", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000, setcodes: [setCubic] },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 35058588, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [cubicWaveCode, cubicMonsterCode, graveCostCode, graveDecoyCode] }, 1: { main: [opponentTargetCode] } });
    startDuel(session);

    const cubicWave = requireCard(session, cubicWaveCode);
    const cubicMonster = requireCard(session, cubicMonsterCode);
    const opponentTarget = requireCard(session, opponentTargetCode, 1);
    const graveCost = requireCard(session, graveCostCode);
    const graveDecoy = requireCard(session, graveDecoyCode);
    moveDuelCard(session.state, cubicWave.uid, "hand", 0);
    moveFaceUpAttack(session, cubicMonster, 0);
    moveFaceUpAttack(session, opponentTarget, 1);
    moveDuelCard(session.state, graveCost.uid, "graveyard", 0);
    moveDuelCard(session.state, graveDecoy.uid, "graveyard", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(cubicWaveCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredActivation);
    expectRestoredLegalActions(restoredActivation, 0);
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === cubicWave.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredActivation, activation!);
    expect(restoredActivation.session.state.chain).toEqual([]);
    expect(restoredActivation.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(currentAttack(restoredActivation.session.state.cards.find((card) => card.uid === cubicMonster.uid), restoredActivation.session.state)).toBe(2400);
    expect(currentAttack(restoredActivation.session.state.cards.find((card) => card.uid === opponentTarget.uid), restoredActivation.session.state)).toBe(1000);
    expect(restoredActivation.session.state.effects.filter((effect) => [cubicMonster.uid, opponentTarget.uid].includes(effect.sourceUid) && effect.code === 102).map((effect) => ({
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { sourceUid: cubicMonster.uid, value: 2400 },
      { sourceUid: opponentTarget.uid, value: 1000 },
    ]);

    moveDuelCard(restoredActivation.session.state, cubicWave.uid, "graveyard", 0);
    restoredActivation.session.state.phase = "main1";
    restoredActivation.session.state.waitingFor = 0;
    const restoredCounterWindow = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), workspace, reader);
    expectCleanRestore(restoredCounterWindow);
    expectRestoredLegalActions(restoredCounterWindow, 0);
    const graveIgnition = getLuaRestoreLegalActions(restoredCounterWindow, 0).find((action) => action.type === "activateEffect" && action.uid === cubicWave.uid);
    expect(graveIgnition, JSON.stringify(getLuaRestoreLegalActions(restoredCounterWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredCounterWindow, graveIgnition!);

    expect(restoredCounterWindow.session.state.cards.find((card) => card.uid === cubicWave.uid)).toMatchObject({ location: "banished", reason: duelReason.cost });
    expect(restoredCounterWindow.session.state.cards.find((card) => card.uid === graveCost.uid)).toMatchObject({ location: "banished", reason: duelReason.cost });
    expect(restoredCounterWindow.session.state.cards.find((card) => card.uid === graveDecoy.uid)).toMatchObject({ location: "graveyard" });
    expect(getDuelCardCounter(restoredCounterWindow.session.state.cards.find((card) => card.uid === opponentTarget.uid), cubicCounter)).toBe(1);
    expect(restoredCounterWindow.session.state.eventHistory.filter((event) => event.eventName === "counterAdded" && event.eventCardUid === opponentTarget.uid)).toEqual([
      {
        eventName: "counterAdded",
        eventCode: 0x10000,
        eventCardUid: opponentTarget.uid,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: cubicWave.uid,
        eventReasonEffectId: 2,
      },
    ]);
    expect(restoredCounterWindow.session.state.effects.filter((effect) => effect.sourceUid === opponentTarget.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
    }))).toEqual([
      { code: 102, event: "continuous", reset: { flags: 33427456 } },
      { code: 85, event: "continuous", reset: { flags: 33427456 } },
      { code: 2, event: "continuous", reset: { flags: 33427456 } },
    ]);

    const restoredLocked = restoreDuelWithLuaScripts(serializeDuel(restoredCounterWindow.session), workspace, reader);
    expectCleanRestore(restoredLocked);
    restoredLocked.session.state.phase = "battle";
    restoredLocked.session.state.turnPlayer = 1;
    restoredLocked.session.state.waitingFor = 1;
    expect(getLuaRestoreLegalActions(restoredLocked, 1).some((action) => action.type === "declareAttack" && action.attackerUid === opponentTarget.uid)).toBe(false);
    expect(getDuelCardCounter(restoredLocked.session.state.cards.find((card) => card.uid === opponentTarget.uid), cubicCounter)).toBe(1);
  });
});

function requireCard(session: DuelSession, code: string, owner = 0): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && candidate.owner === owner);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: 0 | 1): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
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
