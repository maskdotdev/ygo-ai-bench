import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
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
const timaeusCode = "53315891";
const hasTimaeusScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${timaeusCode}.lua`));
const typeMonster = 0x1;
const typeFusion = 0x40;
const typeEffect = 0x20;
const setLegendaryKnight = 0xa9;
const legendaryKnightTimaeusCode = "80019195";
const legendaryKnightCritiasCode = "85800949";
const legendaryKnightHermosCode = "84565800";

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasTimaeusScript)("Lua real script Timaeus contact Grave Fusion", () => {
  it("restores contact Fusion metadata and sends on-field Legendary Knights to Graveyard as cost materials", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${timaeusCode}.lua`);
    expect(script).toContain("Fusion.AddProcMix(c,true,true,80019195,85800949,84565800)");
    expect(script).toContain("Fusion.AddContactProc(c,s.contactfil,s.contactop,true)");
    expect(script).toContain("return Duel.GetMatchingGroup(Card.IsAbleToGraveAsCost,tp,LOCATION_ONFIELD,0,nil)");
    expect(script).toContain("Duel.SendtoGrave(g,REASON_COST|REASON_MATERIAL)");
    expect(script).toContain("e3:SetCode(EFFECT_IMMUNE_EFFECT)");
    expect(script).toContain("e4:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
    expect(script).toContain("e5:SetCode(EVENT_BATTLE_DESTROYED)");

    const realTimaeus = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === timaeusCode);
    expect(realTimaeus).toBeDefined();
    const cards: DuelCardData[] = [
      { ...realTimaeus!, kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, fusionMaterials: [legendaryKnightTimaeusCode, legendaryKnightCritiasCode, legendaryKnightHermosCode] },
      { code: legendaryKnightTimaeusCode, name: "Legendary Knight Timaeus Fixture", kind: "monster", typeFlags: typeMonster | typeEffect, level: 8, attack: 2800, defense: 1800, setcodes: [setLegendaryKnight] },
      { code: legendaryKnightCritiasCode, name: "Legendary Knight Critias Fixture", kind: "monster", typeFlags: typeMonster | typeEffect, level: 8, attack: 2800, defense: 1800, setcodes: [setLegendaryKnight] },
      { code: legendaryKnightHermosCode, name: "Legendary Knight Hermos Fixture", kind: "monster", typeFlags: typeMonster | typeEffect, level: 8, attack: 2800, defense: 1800, setcodes: [setLegendaryKnight] },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 53315891, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [legendaryKnightTimaeusCode, legendaryKnightCritiasCode, legendaryKnightHermosCode], extra: [timaeusCode] }, 1: { main: [] } });
    startDuel(session);

    const timaeus = requireCard(session, timaeusCode);
    const materialA = requireCard(session, legendaryKnightTimaeusCode);
    const materialB = requireCard(session, legendaryKnightCritiasCode);
    const materialC = requireCard(session, legendaryKnightHermosCode);
    for (const material of [materialA, materialB, materialC]) {
      const moved = moveDuelCard(session.state, material.uid, "monsterZone", 0);
      moved.faceUp = true;
      moved.position = "faceUpAttack";
    }
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(timaeusCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(timaeus.data.fusionMaterials).toEqual([legendaryKnightTimaeusCode, legendaryKnightCritiasCode, legendaryKnightHermosCode]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.cards.find((card) => card.uid === timaeus.uid)?.data.fusionMaterials).toEqual([
      legendaryKnightTimaeusCode,
      legendaryKnightCritiasCode,
      legendaryKnightHermosCode,
    ]);

    const contact = getLuaRestoreLegalActions(restored, 0).find(
      (action): action is Extract<DuelAction, { type: "specialSummonProcedure" }> => action.type === "specialSummonProcedure" && action.uid === timaeus.uid,
    );
    expect(contact, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, contact!);

    expect(restored.session.state.cards.find((card) => card.uid === timaeus.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "fusion",
      summonMaterialUids: [materialA.uid, materialB.uid, materialC.uid],
    });
    for (const material of [materialA, materialB, materialC]) {
      expect(restored.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
        location: "graveyard",
        controller: 0,
        reason: duelReason.cost | duelReason.material,
        reasonPlayer: 0,
        reasonCardUid: timaeus.uid,
      });
    }
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: timaeus.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "extraDeck",
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
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard").map((event) => ({
      cardUid: event.eventCardUid,
      reason: event.eventReason,
      reasonCardUid: event.eventReasonCardUid,
    }))).toEqual([
      { cardUid: materialA.uid, reason: duelReason.cost | duelReason.material, reasonCardUid: timaeus.uid },
      { cardUid: materialB.uid, reason: duelReason.cost | duelReason.material, reasonCardUid: timaeus.uid },
      { cardUid: materialC.uid, reason: duelReason.cost | duelReason.material, reasonCardUid: timaeus.uid },
      { cardUid: materialA.uid, reason: duelReason.cost | duelReason.material, reasonCardUid: timaeus.uid },
    ]);

    const restoredAfterSummon = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredAfterSummon);
    expectRestoredLegalActions(restoredAfterSummon, 0);
    expect(getLuaRestoreLegalActions(restoredAfterSummon, 0).some((action) => action.type === "specialSummonProcedure" && action.uid === timaeus.uid)).toBe(false);
  });
});

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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}
