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
const gigaBrilliantCode = "47805931";
const materialCode = "478059310";
const allyCode = "478059311";
const facedownDecoyCode = "478059312";
const opponentCode = "478059313";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasGigaBrilliantScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${gigaBrilliantCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceInsect = 0x800;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const attributeEarth = 0x1;
const effectUpdateAttack = 100;
const effectFlagCannotDisable = 1024;
const resetEventStandard = 33427456;

describe.skipIf(!hasUpstreamScripts || !hasGigaBrilliantScript)("Lua real script Number 20 Giga-Brilliant detach group attack stat", () => {
  it("restores Xyz metadata and detach cost into controller face-up monster ATK boosts", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${gigaBrilliantCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 47805931, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialCode, allyCode, facedownDecoyCode], extra: [gigaBrilliantCode] }, 1: { main: [opponentCode] } });
    startDuel(session);

    const gigaBrilliant = requireCard(session, gigaBrilliantCode);
    const material = requireCard(session, materialCode);
    const ally = requireCard(session, allyCode);
    const facedownDecoy = requireCard(session, facedownDecoyCode);
    const opponent = requireCard(session, opponentCode);
    moveFaceUpAttack(session, gigaBrilliant, 0, 0);
    moveOverlayMaterial(session, gigaBrilliant, material, 0);
    moveFaceUpAttack(session, ally, 0, 1);
    moveDuelCard(session.state, facedownDecoy.uid, "monsterZone", 0).sequence = 2;
    facedownDecoy.faceUp = false;
    facedownDecoy.position = "faceDownDefense";
    moveFaceUpAttack(session, opponent, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(gigaBrilliantCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === gigaBrilliant.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", property: 263168, range: ["monsterZone"], sourceUid: gigaBrilliant.uid },
      { category: 2097152, code: undefined, event: "ignition", property: undefined, range: ["monsterZone"], sourceUid: gigaBrilliant.uid },
    ]);

    const action = getLuaRestoreLegalActions(restored, 0).find(
      (candidate) => candidate.type === "activateEffect" && candidate.uid === gigaBrilliant.uid && candidate.effectId === "lua-2",
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === gigaBrilliant.uid)?.overlayUids).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: gigaBrilliant.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === gigaBrilliant.uid), restored.session.state)).toBe(2100);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === ally.uid), restored.session.state)).toBe(1800);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === facedownDecoy.uid), restored.session.state)).toBe(1700);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === opponent.uid), restored.session.state)).toBe(1900);
    expect(restored.session.state.effects.filter((effect) => effect.code === effectUpdateAttack && [gigaBrilliant.uid, ally.uid, facedownDecoy.uid, opponent.uid].includes(effect.sourceUid ?? "")).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: effectFlagCannotDisable, reset: { flags: resetEventStandard }, sourceUid: gigaBrilliant.uid, value: 300 },
      { code: effectUpdateAttack, property: effectFlagCannotDisable, reset: { flags: resetEventStandard }, sourceUid: ally.uid, value: 300 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "detachedMaterial").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      eventPreviousState: event.eventPreviousState,
      eventCurrentState: event.eventCurrentState,
    }))).toEqual([
      {
        eventName: "detachedMaterial",
        eventCode: 1202,
        eventCardUid: material.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: gigaBrilliant.uid,
        eventReasonEffectId: 2,
        relatedEffectId: undefined,
        eventPreviousState: { controller: 0, faceUp: false, location: "overlay", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentAttack(restoredAfter.session.state.cards.find((card) => card.uid === ally.uid), restoredAfter.session.state)).toBe(1800);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Number 20: Giga-Brilliant");
  expect(script).toContain("Xyz.AddProcedure(c,nil,3,2)");
  expect(script).toContain("c:EnableReviveLimit()");
  expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1))");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,LOCATION_MZONE,0,nil)");
  expect(script).toContain("for tc in aux.Next(g) do");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
  expect(script).toContain("e1:SetValue(300)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD)");
}

function cards(): DuelCardData[] {
  return [
    { code: gigaBrilliantCode, name: "Number 20: Giga-Brilliant", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceInsect, attribute: attributeLight, level: 3, attack: 1800, defense: 1800 },
    { code: materialCode, name: "Giga-Brilliant Overlay Material", kind: "monster", typeFlags: typeMonster, race: raceInsect, attribute: attributeLight, level: 3, attack: 900, defense: 900 },
    { code: allyCode, name: "Giga-Brilliant Face-Up Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1500, defense: 1000 },
    { code: facedownDecoyCode, name: "Giga-Brilliant Face-Down Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1700, defense: 1000 },
    { code: opponentCode, name: "Giga-Brilliant Opponent Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1900, defense: 1000 },
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

function moveOverlayMaterial(session: DuelSession, holder: DuelCardInstance, material: DuelCardInstance, sequence: number): void {
  const moved = moveDuelCard(session.state, material.uid, "overlay", holder.controller, duelReason.material | duelReason.xyz, holder.controller);
  moved.sequence = sequence;
  holder.overlayUids.push(material.uid);
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
