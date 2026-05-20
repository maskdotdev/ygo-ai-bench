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
const photonSlasherCode = "9718968";
const xyzCode = "97189680";
const nonXyzCode = "97189681";
const typeMonster = 0x1;
const typeXyz = 0x800000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Photon Slasher defense Special Summon procedure", () => {
  it("restores its EFFECT_FLAG_SPSUM_PARAM hand procedure as a Defense Position summon when any Xyz is face-up", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${photonSlasherCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_PROC)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_UNCOPYABLE+EFFECT_FLAG_SPSUM_PARAM)");
    expect(script).toContain("e1:SetTargetRange(POS_FACEUP_DEFENSE,0)");
    expect(script).toContain("return c:IsFaceup() and c:IsType(TYPE_XYZ)");
    expect(script).toContain("Duel.IsExistingMatchingCard(s.cfilter,0,LOCATION_MZONE,LOCATION_MZONE,1,nil)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === photonSlasherCode),
      { code: xyzCode, name: "Photon Slasher Xyz Fixture", kind: "extra", typeFlags: typeMonster | typeXyz, level: 4, attack: 2000, defense: 2000 },
      { code: nonXyzCode, name: "Photon Slasher Non-Xyz Fixture", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 9718968, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [photonSlasherCode, nonXyzCode], extra: [xyzCode] }, 1: { main: [] } });
    startDuel(session);

    const slasher = requireCard(session, photonSlasherCode);
    const xyz = requireCard(session, xyzCode);
    const nonXyz = requireCard(session, nonXyzCode);
    moveDuelCard(session.state, slasher.uid, "hand", 0);
    moveDuelCard(session.state, nonXyz.uid, "monsterZone", 0).position = "faceUpAttack";
    nonXyz.faceUp = true;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(photonSlasherCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const blocked = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(blocked);
    expectRestoredLegalActions(blocked, 0);
    expect(photonSlasherProcedure(getLuaRestoreLegalActions(blocked, 0), slasher.uid)).toBeUndefined();

    moveDuelCard(session.state, xyz.uid, "monsterZone", 0).position = "faceUpAttack";
    xyz.faceUp = true;
    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const procedure = photonSlasherProcedure(getLuaRestoreLegalActions(restored, 0), slasher.uid);
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, procedure!);

    expect(restored.session.state.cards.find((card) => card.uid === slasher.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpDefense",
      summonType: "special",
    });
    expect(restored.session.state.cards.find((card) => card.uid === xyz.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
    });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: slasher.uid,
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
          position: "faceUpDefense",
          sequence: 2,
        },
      },
    ]);
  });
});

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
}

function photonSlasherProcedure(actions: ReturnType<typeof getLuaRestoreLegalActions>, uid: string) {
  return actions.find((action) => action.type === "specialSummonProcedure" && action.uid === uid);
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
