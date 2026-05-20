import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Panther Shark summon procedures", () => {
  it("restores Panther Shark's opponent-count no-tribute Normal Summon procedure", () => {
    const { reader, session, workspace, panther, opponentA, opponentB } = setupPantherFixture("normal");
    moveDuelCard(session.state, panther.uid, "hand", 0);
    moveDuelCard(session.state, opponentA.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, opponentB.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    expectPantherScriptShape();
    registerPantherScript(session, workspace);

    moveDuelCard(session.state, opponentB.uid, "graveyard", 1);
    const blocked = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectRestoredActionSurfaces(blocked);
    expect(pantherNoTributeSummon(blocked.session, getLuaRestoreLegalActions(blocked, 0), panther.uid)).toBeUndefined();

    moveDuelCard(session.state, opponentB.uid, "monsterZone", 1).position = "faceUpAttack";
    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectRestoredActionSurfaces(restored);

    const summon = pantherNoTributeSummon(restored.session, getLuaRestoreLegalActions(restored, 0), panther.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toEqual(expect.objectContaining({
      type: "tributeSummon",
      effectId: expect.stringMatching(/^lua-/),
      tributeUids: [],
    }));
    applyRestoredActionAndAssert(restored, summon!);

    expect(restored.session.state.cards.find((card) => card.uid === panther.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      summonType: "normal",
      summonMaterialUids: [],
    });
    expect(restored.session.state.players[0].normalSummonAvailable).toBe(false);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "normalSummoned")).toEqual([
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: panther.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
  });

  it("restores Panther Shark's paired face-up Eagle Shark Special Summon procedure", () => {
    const { reader, session, workspace, panther, eagle } = setupPantherFixture("special");
    moveDuelCard(session.state, panther.uid, "hand", 0);
    const setEagle = moveDuelCard(session.state, eagle.uid, "monsterZone", 0);
    setEagle.faceUp = false;
    setEagle.position = "faceDownDefense";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    expectPantherScriptShape();
    registerPantherScript(session, workspace);

    const blocked = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectRestoredActionSurfaces(blocked);
    expect(pantherSpecialSummon(getLuaRestoreLegalActions(blocked, 0), panther.uid)).toBeUndefined();

    eagle.faceUp = true;
    eagle.position = "faceUpAttack";
    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectRestoredActionSurfaces(restored);

    const procedure = pantherSpecialSummon(getLuaRestoreLegalActions(restored, 0), panther.uid);
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, procedure!);

    expect(restored.session.state.cards.find((card) => card.uid === panther.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
    });
    expect(restored.session.state.cards.find((card) => card.uid === eagle.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
    });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: panther.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 1,
        },
      },
    ]);
  });
});

function setupPantherFixture(seedKind: "normal" | "special") {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  const pantherCode = "70101178";
  const eagleCode = "7500772";
  const opponentACode = "701011780";
  const opponentBCode = "701011781";
  const cards: DuelCardData[] = [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === pantherCode || card.code === eagleCode),
    { code: opponentACode, name: "Panther Shark Fixture Opponent A", kind: "monster", typeFlags: 0x1, level: 4, attack: 1200, defense: 1200 },
    { code: opponentBCode, name: "Panther Shark Fixture Opponent B", kind: "monster", typeFlags: 0x1, level: 4, attack: 1300, defense: 1300 },
  ];
  const reader = createCardReader(cards);
  const session = createDuel({ seed: seedKind === "normal" ? 70101178 : 70101179, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [pantherCode, eagleCode] }, 1: { main: [opponentACode, opponentBCode] } });
  startDuel(session);

  return {
    reader,
    session,
    workspace,
    panther: requireCard(session, pantherCode),
    eagle: requireCard(session, eagleCode),
    opponentA: requireCard(session, opponentACode),
    opponentB: requireCard(session, opponentBCode),
  };
}

function expectPantherScriptShape(): void {
  const script = fs.readFileSync(path.join(upstreamRoot, "script", "official", "c70101178.lua"), "utf8");
  expect(script).toContain("e1:SetCode(EFFECT_SUMMON_PROC)");
  expect(script).toContain("Duel.GetFieldGroupCount(c:GetControler(),0,LOCATION_MZONE)>1");
  expect(script).toContain("e2:SetCode(EFFECT_SPSUMMON_PROC)");
  expect(script).toContain("Duel.IsExistingMatchingCard(s.filter,c:GetControler(),LOCATION_MZONE,0,1,nil)");
  expect(script).toContain("return c:IsFaceup() and c:IsCode(7500772)");
}

function registerPantherScript(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(70101178, workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectRestoredActionSurfaces(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
  expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
  expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
}

function pantherNoTributeSummon(session: DuelSession, actions: ReturnType<typeof getLuaRestoreLegalActions>, uid: string) {
  return actions.find((action) => {
    if (action.type !== "tributeSummon" || action.uid !== uid || !action.effectId?.startsWith("lua-")) return false;
    const card = session.state.cards.find((candidate) => candidate.uid === uid);
    return card?.location === "hand" && action.tributeUids.length === 0;
  });
}

function pantherSpecialSummon(actions: ReturnType<typeof getLuaRestoreLegalActions>, uid: string) {
  return actions.find((action) => action.type === "specialSummonProcedure" && action.uid === uid);
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
