import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const harvesterCode = "66973070";
const insectCostCode = "669730700";
const warriorDecoyCode = "669730701";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasHarvesterScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${harvesterCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceInsect = 0x800;
const raceWarrior = 0x1;
const attributeWind = 0x8;
const attributeEarth = 0x1;
const effectUpdateAttack = 100;
const resetStandardDisablePhaseEnd = 1107235328;

describe.skipIf(!hasUpstreamScripts || !hasHarvesterScript)("Lua real script Dreadscythe Harvester Insect release attack stat", () => {
  it("restores Card.IsRace release cost into self ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${harvesterCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 66973070, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [harvesterCode, insectCostCode, warriorDecoyCode] }, 1: { main: [] } });
    startDuel(session);

    const harvester = requireCard(session, harvesterCode);
    const insectCost = requireCard(session, insectCostCode);
    const warriorDecoy = requireCard(session, warriorDecoyCode);
    moveFaceUpAttack(session, harvester, 0, 0);
    moveFaceUpAttack(session, insectCost, 0, 1);
    moveFaceUpAttack(session, warriorDecoy, 0, 2);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(harvesterCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === harvester.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: 2097152, code: undefined, event: "ignition", property: undefined, range: ["monsterZone"], sourceUid: harvester.uid },
    ]);

    const action = getLuaRestoreLegalActions(restored, 0).find(
      (candidate) => candidate.type === "activateEffect" && candidate.uid === harvester.uid && candidate.effectId === "lua-1",
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === insectCost.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: harvester.uid,
      reasonEffectId: 1,
    });
    expect(restored.session.state.cards.find((card) => card.uid === warriorDecoy.uid)).toMatchObject({ location: "monsterZone" });
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === harvester.uid), restored.session.state)).toBe(2800);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === harvester.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: undefined, reset: { flags: resetStandardDisablePhaseEnd }, sourceUid: harvester.uid, value: 500 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => ["released", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "released", eventCode: 1017, eventCardUid: insectCost.uid, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: harvester.uid, eventReasonEffectId: 1 },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: insectCost.uid, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: harvester.uid, eventReasonEffectId: 1 },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentAttack(restoredAfter.session.state.cards.find((card) => card.uid === harvester.uid), restoredAfter.session.state)).toBe(2800);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Dreadscythe Harvester");
  expect(script).toContain("Duel.CheckReleaseGroupCost(tp,Card.IsRace,1,false,nil,e:GetHandler(),RACE_INSECT)");
  expect(script).toContain("Duel.SelectReleaseGroupCost(tp,Card.IsRace,1,1,false,nil,e:GetHandler(),RACE_INSECT)");
  expect(script).toContain("Duel.Release(sg,REASON_COST)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(500)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_DISABLE_PHASE_END)");
}

function cards(): DuelCardData[] {
  return [
    { code: harvesterCode, name: "Dreadscythe Harvester", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceInsect, attribute: attributeWind, level: 8, attack: 2300, defense: 1600 },
    { code: insectCostCode, name: "Dreadscythe Harvester Insect Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceInsect, attribute: attributeWind, level: 4, attack: 1200, defense: 1000 },
    { code: warriorDecoyCode, name: "Dreadscythe Harvester Warrior Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
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
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
