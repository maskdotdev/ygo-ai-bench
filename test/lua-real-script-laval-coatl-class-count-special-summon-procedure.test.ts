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
const coatlCode = "45439263";
const lavalACode = "454392630";
const lavalBCode = "454392631";
const lavalCCode = "454392632";
const typeMonster = 0x1;
const setLaval = 0x39;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Laval Coatl class-count Special Summon procedure", () => {
  it("restores its Graveyard Laval distinct-code count procedure", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${coatlCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_PROC)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_UNCOPYABLE)");
    expect(script).toContain("Duel.GetLocationCount(c:GetControler(),LOCATION_MZONE)<=0");
    expect(script).toContain("Duel.GetMatchingGroup(Card.IsSetCard,c:GetControler(),LOCATION_GRAVE,0,nil,SET_LAVAL):GetClassCount(Card.GetCode)>=3");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === coatlCode),
      { code: lavalACode, name: "Laval Coatl Grave Laval A", kind: "monster", typeFlags: typeMonster, setcodes: [setLaval], level: 4, attack: 1000, defense: 1000 },
      { code: lavalBCode, name: "Laval Coatl Grave Laval B", kind: "monster", typeFlags: typeMonster, setcodes: [setLaval], level: 4, attack: 1100, defense: 1000 },
      { code: lavalCCode, name: "Laval Coatl Grave Laval C", kind: "monster", typeFlags: typeMonster, setcodes: [setLaval], level: 4, attack: 1200, defense: 1000 },
    ];
    const reader = createCardReader(cards);

    const duplicateCode = createRestoredCoatlWindow({ reader, workspace, graveCodes: [lavalACode, lavalACode, lavalBCode] });
    expectCleanRestore(duplicateCode);
    expectRestoredLegalActions(duplicateCode, 0);
    expect(coatlProcedure(duplicateCode)).toBeUndefined();

    const twoDistinct = createRestoredCoatlWindow({ reader, workspace, graveCodes: [lavalACode, lavalBCode] });
    expectCleanRestore(twoDistinct);
    expectRestoredLegalActions(twoDistinct, 0);
    expect(coatlProcedure(twoDistinct)).toBeUndefined();

    const restored = createRestoredCoatlWindow({ reader, workspace, graveCodes: [lavalACode, lavalBCode, lavalCCode] });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const coatl = requireCard(restored.session, coatlCode);
    const procedure = coatlProcedure(restored);
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, procedure!);

    expect(restored.session.state.cards.find((card) => card.uid === coatl.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
    });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === coatl.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: coatl.uid,
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
          sequence: 0,
        },
      },
    ]);
  });
});

function createRestoredCoatlWindow({
  reader,
  workspace,
  graveCodes,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  graveCodes: string[];
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 45439263 + graveCodes.length, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [coatlCode, ...graveCodes] }, 1: { main: [] } });
  startDuel(session);

  const coatl = requireCard(session, coatlCode);
  moveDuelCard(session.state, coatl.uid, "hand", 0);
  for (const code of graveCodes) {
    const card = session.state.cards.find((candidate) => candidate.code === code && candidate.location === "deck");
    expect(card).toBeDefined();
    moveDuelCard(session.state, card!.uid, "graveyard", 0);
  }
  session.state.phase = "main1";
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(coatlCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);

  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

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
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function coatlProcedure(restored: ReturnType<typeof restoreDuelWithLuaScripts>) {
  const coatl = restored.session.state.cards.find((card) => card.code === coatlCode);
  return getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "specialSummonProcedure" && action.uid === coatl?.uid);
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
