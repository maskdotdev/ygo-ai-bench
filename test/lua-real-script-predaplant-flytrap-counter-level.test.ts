import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentLevel } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const flytrapCode = "96622984";
const targetCode = "966229840";
const predatorCounter = 0x1041;
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Predaplant Flytrap counter level", () => {
  it("restores Predator Counter targeting into counter placement and conditional level change", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${flytrapCode}.lua`);
    expect(script).toContain("s.counter_place_list={COUNTER_PREDATOR}");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsCanAddCounter,tp,0,LOCATION_MZONE,1,1,nil,COUNTER_PREDATOR,1)");
    expect(script).toContain("tc:AddCounter(COUNTER_PREDATOR,1)");
    expect(script).toContain("tc:GetLevel()>1");
    expect(script).toContain("e1:SetCode(EFFECT_CHANGE_LEVEL)");
    expect(script).toContain("return e:GetHandler():GetCounter(COUNTER_PREDATOR)>0");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === flytrapCode),
      { code: targetCode, name: "Flytrap Counter Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1600, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 96622984, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [flytrapCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const flytrap = requireCard(session, flytrapCode);
    const target = requireCard(session, targetCode);
    moveFaceUpAttack(session, flytrap.uid, 0);
    moveFaceUpAttack(session, target.uid, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(flytrapCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(currentLevel(target, session.state)).toBe(4);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const ignition = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === flytrap.uid);
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, ignition!);

    expect(restored.session.state.chain).toEqual([]);
    expect(restored.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(getDuelCardCounter(restored.session.state.cards.find((card) => card.uid === target.uid), predatorCounter)).toBe(1);
    expect(currentLevel(restored.session.state.cards.find((card) => card.uid === target.uid), restored.session.state)).toBe(1);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "counterAdded")).toEqual([
      {
        eventName: "counterAdded",
        eventCode: 0x10000,
        eventCardUid: target.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: flytrap.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === target.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 131, event: "continuous", reset: { flags: 33427456 }, value: 1 },
    ]);
    expect(restored.host.messages).not.toContain("attempt to call a nil value");
  });
});

function moveFaceUpAttack(session: DuelSession, uid: string, controller: 0 | 1): void {
  const card = moveDuelCard(session.state, uid, "monsterZone", controller);
  card.faceUp = true;
  card.position = "faceUpAttack";
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const raw = getLuaRestoreLegalActions(restored, player);
  const grouped = getLuaRestoreLegalActionGroups(restored, player);
  expect(grouped.flatMap((group) => group.actions)).toEqual(raw);
  expect(result.legalActions).toEqual(raw);
  expect(result.legalActionGroups).toEqual(grouped);
}
