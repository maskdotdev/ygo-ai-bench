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
const gawaynCode = "19680539";
const normalLightCode = "196805390";
const effectLightCode = "196805391";
const typeMonster = 0x1;
const typeNormal = 0x10;
const typeEffect = 0x20;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Noble Knight Gawayn Special Summon procedure", () => {
  it("restores its SPSUM_PARAM Defense procedure gated by an own face-up Normal LIGHT monster", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${gawaynCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_PROC)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_SPSUM_PARAM)");
    expect(script).toContain("e1:SetTargetRange(POS_FACEUP_DEFENSE,0)");
    expect(script).toContain("return c:IsFaceup() and c:IsType(TYPE_NORMAL) and c:IsAttribute(ATTRIBUTE_LIGHT)");
    expect(script).toContain("Duel.IsExistingMatchingCard(s.filter,c:GetControler(),LOCATION_MZONE,0,1,nil)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === gawaynCode),
      { code: normalLightCode, name: "Gawayn Fixture Normal LIGHT", kind: "monster", typeFlags: typeMonster | typeNormal, attribute: attributeLight, level: 4, attack: 1700, defense: 1000 },
      { code: effectLightCode, name: "Gawayn Fixture Effect LIGHT", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 19680539, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [gawaynCode, normalLightCode, effectLightCode] }, 1: { main: [] } });
    startDuel(session);

    const gawayn = requireCard(session, gawaynCode);
    const normalLight = requireCard(session, normalLightCode);
    const effectLight = requireCard(session, effectLightCode);
    moveDuelCard(session.state, gawayn.uid, "hand", 0);
    moveDuelCard(session.state, effectLight.uid, "monsterZone", 0).position = "faceUpAttack";
    effectLight.faceUp = true;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(gawaynCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const blocked = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(blocked);
    expectRestoredLegalActions(blocked, 0);
    expect(gawaynProcedure(getLuaRestoreLegalActions(blocked, 0), gawayn.uid)).toBeUndefined();

    moveDuelCard(session.state, normalLight.uid, "monsterZone", 0).position = "faceDownDefense";
    normalLight.faceUp = false;
    const faceDownBlocked = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(faceDownBlocked);
    expectRestoredLegalActions(faceDownBlocked, 0);
    expect(gawaynProcedure(getLuaRestoreLegalActions(faceDownBlocked, 0), gawayn.uid)).toBeUndefined();

    normalLight.faceUp = true;
    normalLight.position = "faceUpAttack";
    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const procedure = gawaynProcedure(getLuaRestoreLegalActions(restored, 0), gawayn.uid);
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, procedure!);

    expect(restored.session.state.cards.find((card) => card.uid === gawayn.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpDefense",
      summonType: "special",
    });
    expect(restored.session.state.cards.find((card) => card.uid === normalLight.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
    });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: gawayn.uid,
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

function gawaynProcedure(actions: ReturnType<typeof getLuaRestoreLegalActions>, uid: string) {
  return actions.find((action) => action.type === "specialSummonProcedure" && action.uid === uid);
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
