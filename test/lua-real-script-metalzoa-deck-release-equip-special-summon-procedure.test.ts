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
const metalzoaCode = "50705071";
const zoaCode = "24311372";
const metalmorphCode = "68540058";
const typeMonster = 0x1;
const typeTrap = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Metalzoa Deck release equip Special Summon procedure", () => {
  it("restores its Deck procedure that releases a Metalmorph-equipped Zoa as cost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${metalzoaCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_PROC)");
    expect(script).toContain("e1:SetRange(LOCATION_DECK)");
    expect(script).toContain("return c:IsCode(24311372) and c:GetEquipGroup():IsExists(Card.IsCode,1,nil,68540058)");
    expect(script).toContain("Duel.CheckReleaseGroup(c:GetControler(),s.spfilter,1,false,1,true,c,c:GetControler(),nil,false,nil)");
    expect(script).toContain("Duel.SelectReleaseGroup(tp,s.spfilter,1,1,false,true,true,c,nil,nil,false,nil)");
    expect(script).toContain("Duel.Release(g,REASON_COST)");

    const cards: DuelCardData[] = [
      { code: metalzoaCode, name: "Metalzoa", kind: "monster", typeFlags: typeMonster, level: 8, attack: 3000, defense: 2300 },
      { code: zoaCode, name: "Zoa", kind: "monster", typeFlags: typeMonster, level: 7, attack: 2600, defense: 1900 },
      { code: metalmorphCode, name: "Metalmorph", kind: "trap", typeFlags: typeTrap },
    ];
    const reader = createCardReader(cards);

    const missingEquip = createRestoredMetalzoaWindow({ reader, workspace, withEquip: false });
    expectCleanRestore(missingEquip);
    expectRestoredActionSurfaces(missingEquip, 0);
    expect(metalzoaProcedure(missingEquip, metalzoaCode)).toBeUndefined();

    const restored = createRestoredMetalzoaWindow({ reader, workspace, withEquip: true });
    expectCleanRestore(restored);
    expectRestoredActionSurfaces(restored, 0);
    const metalzoa = requireCard(restored.session, metalzoaCode);
    const zoa = requireCard(restored.session, zoaCode);
    const metalmorph = requireCard(restored.session, metalmorphCode);
    const procedure = metalzoaProcedure(restored, metalzoaCode);
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, procedure!);

    expect(restored.session.state.cards.find((card) => card.uid === metalzoa.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
    });
    expect(restored.session.state.cards.find((card) => card.uid === zoa.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.release | duelReason.cost,
      reasonCardUid: metalzoa.uid,
    });
    expect(restored.session.state.cards.find((card) => card.uid === metalmorph.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      previousEquippedToUid: zoa.uid,
    });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "released" && event.eventCardUid === zoa.uid)).toEqual([
      {
        eventName: "released",
        eventCode: 1017,
        eventCardUid: zoa.uid,
        eventReason: duelReason.release | duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: metalzoa.uid,
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
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === metalzoa.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: metalzoa.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 1,
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

function createRestoredMetalzoaWindow({
  reader,
  workspace,
  withEquip,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  withEquip: boolean;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 50705071 + (withEquip ? 1 : 0), startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [metalzoaCode, zoaCode, metalmorphCode] }, 1: { main: [] } });
  startDuel(session);

  const zoa = requireCard(session, zoaCode);
  const metalmorph = requireCard(session, metalmorphCode);
  moveDuelCard(session.state, zoa.uid, "monsterZone", 0).position = "faceUpAttack";
  zoa.faceUp = true;
  const equipped = moveDuelCard(session.state, metalmorph.uid, "spellTrapZone", 0);
  equipped.position = "faceUpAttack";
  equipped.faceUp = true;
  if (withEquip) equipped.equippedToUid = zoa.uid;
  session.state.phase = "main1";
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(metalzoaCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);

  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredActionSurfaces(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
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

function metalzoaProcedure(restored: ReturnType<typeof restoreDuelWithLuaScripts>, code: string) {
  const metalzoa = restored.session.state.cards.find((card) => card.code === code);
  return getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "specialSummonProcedure" && action.uid === metalzoa?.uid);
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
