import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeToon = 0x400000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Toon Summoned Skull release procedure and attack cost", () => {
  it("restores its Toon World-gated release Special Summon procedure and same-turn attack lock", () => {
    const fixture = setupToonSummonedSkullProcedureFixture({ withToonWorld: true, withRelease: true });
    expect(fixture.script).toContain("Duel.CheckReleaseGroup(c:GetControler(),aux.TRUE,1,false,1,true,c,c:GetControler(),nil,false,nil)");
    expect(fixture.script).toContain("Duel.SelectReleaseGroup(tp,aux.TRUE,1,1,false,true,true,c,nil,nil,false,nil)");
    expect(fixture.script).toContain("Duel.Release(g,REASON_COST)");
    expect(fixture.script).toContain("Duel.CheckLPCost(tp,500)");
    expect(fixture.script).toContain("Duel.AttackCostPaid()");
    expectCleanRestore(fixture.restored);
    assertRestoredLegalActions(fixture.restored, 0);

    const blocked = setupToonSummonedSkullProcedureFixture({ withToonWorld: false, withRelease: true });
    expectCleanRestore(blocked.restored);
    expect(getLuaRestoreLegalActions(blocked.restored, 0).some((action) => action.type === "specialSummonProcedure" && action.uid === blocked.toon.uid)).toBe(false);

    const releaseBlocked = setupToonSummonedSkullProcedureFixture({ withToonWorld: true, withRelease: false });
    expectCleanRestore(releaseBlocked.restored);
    expect(getLuaRestoreLegalActions(releaseBlocked.restored, 0).some((action) => action.type === "specialSummonProcedure" && action.uid === releaseBlocked.toon.uid)).toBe(false);

    const procedure = getLuaRestoreLegalActions(fixture.restored, 0).find((action) => action.type === "specialSummonProcedure" && action.uid === fixture.toon.uid);
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(fixture.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(fixture.restored, procedure!);

    expect(fixture.restored.session.state.cards.find((card) => card.uid === fixture.toon.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
    });
    expect(fixture.restored.session.state.cards.find((card) => card.uid === fixture.release!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(fixture.restored.session.state.eventHistory.filter((event) => event.eventName === "released" && event.eventCardUid === fixture.release!.uid)).toEqual([
      {
        eventName: "released",
        eventCode: 1017,
        eventCardUid: fixture.release!.uid,
        eventReason: duelReason.release | duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: fixture.toon.uid,
        eventReasonEffectId: 2,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);

    fixture.restored.session.state.phase = "battle";
    fixture.restored.session.state.waitingFor = 0;
    expect(getLuaRestoreLegalActions(fixture.restored, 0).some((action) => action.type === "declareAttack" && action.attackerUid === fixture.toon.uid)).toBe(false);
  });

  it("restores its opposing-Toon battle target restriction and LP attack cost", () => {
    const fixture = setupToonSummonedSkullBattleFixture({ opponentToon: true });
    expectCleanRestore(fixture.restored);
    assertRestoredLegalActions(fixture.restored, 0);

    const actions = getLuaRestoreLegalActions(fixture.restored, 0);
    expect(actions.some((action) => action.type === "declareAttack" && action.attackerUid === fixture.toon.uid && action.targetUid === fixture.nonToonTarget.uid)).toBe(false);
    expect(actions.some((action) => action.type === "declareAttack" && action.attackerUid === fixture.toon.uid && action.targetUid === undefined)).toBe(false);
    const toonAttack = actions.find((action) => action.type === "declareAttack" && action.attackerUid === fixture.toon.uid && action.targetUid === fixture.toonTarget!.uid);
    expect(toonAttack, JSON.stringify(actions, null, 2)).toBeDefined();
    applyRestoredActionAndAssert(fixture.restored, toonAttack!);

    expect(fixture.restored.session.state.attackCostPaid).toBe(1);
    expect(fixture.restored.session.state.players[0].lifePoints).toBe(7500);
    expect(fixture.restored.session.state.eventHistory.filter((event) => event.eventName === "lifePointCostPaid")).toEqual([
      {
        eventName: "lifePointCostPaid",
        eventCode: 1201,
        eventPlayer: 0,
        eventValue: 500,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: fixture.toon.uid,
        eventReasonEffectId: 8,
      },
    ]);

    const restoredAttack = restoreDuelWithLuaScripts(serializeDuel(fixture.restored.session), fixture.workspace, fixture.reader);
    expectCleanRestore(restoredAttack);
    assertRestoredLegalActions(restoredAttack, 0);
    expect(restoredAttack.session.state.attackCostPaid).toBe(1);
    expect(restoredAttack.session.state.players[0].lifePoints).toBe(7500);

    passBattleResponses(restoredAttack.session);
    expect(restoredAttack.session.state.players[1].lifePoints).toBe(6500);
    expect(restoredAttack.session.state.cards.find((card) => card.uid === fixture.toonTarget!.uid)).toMatchObject({ location: "graveyard", controller: 1 });
  });

  it("restores its direct attack path and pays the same LP attack cost when no opposing Toon exists", () => {
    const fixture = setupToonSummonedSkullBattleFixture({ opponentToon: false });
    expectCleanRestore(fixture.restored);
    assertRestoredLegalActions(fixture.restored, 0);

    const directAttack = getLuaRestoreLegalActions(fixture.restored, 0).find((action) => action.type === "declareAttack" && action.attackerUid === fixture.toon.uid && action.targetUid === undefined);
    expect(directAttack, JSON.stringify(getLuaRestoreLegalActions(fixture.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(fixture.restored, directAttack!);
    expect(fixture.restored.session.state.attackCostPaid).toBe(1);
    expect(fixture.restored.session.state.players[0].lifePoints).toBe(7500);

    passBattleResponses(fixture.restored.session);
    expect(fixture.restored.session.state.players[1].lifePoints).toBe(5500);
    expect(fixture.restored.session.state.cards.find((card) => card.uid === fixture.toon.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
  });
});

function setupToonSummonedSkullProcedureFixture({ withToonWorld, withRelease }: { withToonWorld: boolean; withRelease: boolean }) {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  const toonCode = "91842653";
  const toonWorldCode = "15259703";
  const releaseCode = "9184";
  const cards: DuelCardData[] = [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === toonCode || card.code === toonWorldCode),
    { code: releaseCode, name: "Toon Summoned Skull Release", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
  ];
  const reader = createCardReader(cards);
  const session = createDuel({ seed: withToonWorld ? (withRelease ? 918 : 919) : 920, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [toonCode, toonWorldCode, releaseCode] }, 1: { main: [] } });
  startDuel(session);

  const toon = session.state.cards.find((card) => card.code === toonCode);
  const toonWorld = session.state.cards.find((card) => card.code === toonWorldCode);
  const release = session.state.cards.find((card) => card.code === releaseCode);
  expect(toon).toBeDefined();
  expect(toonWorld).toBeDefined();
  expect(release).toBeDefined();
  moveDuelCard(session.state, toon!.uid, "hand", 0);
  if (withToonWorld) moveFaceUpSpell(session, toonWorld!.uid, 0);
  if (withRelease) moveDuelCard(session.state, release!.uid, "monsterZone", 0).position = "faceUpAttack";
  session.state.phase = "main1";
  session.state.waitingFor = 0;

  const script = fs.readFileSync(path.join(upstreamRoot, "script", "official", `c${toonCode}.lua`), "utf8");
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(toonCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);

  return { session, reader, workspace, script, toon: toon!, toonWorld: toonWorld!, release: release!, restored: restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader) };
}

function setupToonSummonedSkullBattleFixture({ opponentToon }: { opponentToon: boolean }) {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  const toonCode = "91842653";
  const toonWorldCode = "15259703";
  const nonToonTargetCode = "9185";
  const toonTargetCode = "9186";
  const cards: DuelCardData[] = [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === toonCode || card.code === toonWorldCode),
    { code: nonToonTargetCode, name: "Toon Summoned Skull Non-Toon Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    { code: toonTargetCode, name: "Toon Summoned Skull Toon Target", kind: "monster", typeFlags: typeMonster | typeToon, level: 4, attack: 1000, defense: 1000 },
  ];
  const reader = createCardReader(cards);
  const session = createDuel({ seed: opponentToon ? 921 : 922, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [toonCode, toonWorldCode] }, 1: { main: opponentToon ? [nonToonTargetCode, toonTargetCode] : [] } });
  startDuel(session);

  const toon = session.state.cards.find((card) => card.code === toonCode);
  const toonWorld = session.state.cards.find((card) => card.code === toonWorldCode);
  const nonToonTarget = session.state.cards.find((card) => card.code === nonToonTargetCode);
  const toonTarget = session.state.cards.find((card) => card.code === toonTargetCode);
  expect(toon).toBeDefined();
  expect(toonWorld).toBeDefined();
  moveDuelCard(session.state, toon!.uid, "monsterZone", 0).position = "faceUpAttack";
  moveFaceUpSpell(session, toonWorld!.uid, 0);
  if (opponentToon) {
    expect(nonToonTarget).toBeDefined();
    expect(toonTarget).toBeDefined();
    moveDuelCard(session.state, nonToonTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, toonTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
  }
  session.state.phase = "battle";
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(toonCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);

  return {
    session,
    reader,
    workspace,
    toon: toon!,
    toonWorld: toonWorld!,
    nonToonTarget: nonToonTarget!,
    toonTarget,
    restored: restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader),
  };
}

function moveFaceUpSpell(session: DuelSession, uid: string, player: 0 | 1): void {
  const card = moveDuelCard(session.state, uid, "spellTrapZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function assertRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
}

function passBattleResponses(session: DuelSession): void {
  while (session.state.pendingBattle) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass).toBeDefined();
    const response = applyResponse(session, pass!);
    expect(response.ok, response.error).toBe(true);
  }
}
