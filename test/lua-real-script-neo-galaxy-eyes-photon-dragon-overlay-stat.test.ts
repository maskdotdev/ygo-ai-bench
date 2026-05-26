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
const neoGalaxyCode = "39272762";
const ownMaterialCode = "392727620";
const opponentXyzCode = "392727621";
const opponentMaterialOneCode = "392727622";
const opponentMaterialTwoCode = "392727623";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasNeoGalaxyScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${neoGalaxyCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceDragon = 0x2000;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const attributeDark = 0x20;
const effectUpdateAttack = 100;
const effectExtraAttack = 194;
const resetStandardDisablePhaseEnd = 1107235328;
const resetStandardPhaseEnd = 1107169792;

describe.skipIf(!hasUpstreamScripts || !hasNeoGalaxyScript)("Lua real script Neo Galaxy-Eyes Photon Dragon overlay stat", () => {
  it("restores detach cost, opponent overlay send, ATK gain, and extra attacks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${neoGalaxyCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 39272762, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [ownMaterialCode], extra: [neoGalaxyCode] },
      1: { main: [opponentMaterialOneCode, opponentMaterialTwoCode], extra: [opponentXyzCode] },
    });
    startDuel(session);

    const neoGalaxy = requireCard(session, neoGalaxyCode);
    const ownMaterial = requireCard(session, ownMaterialCode);
    const opponentXyz = requireCard(session, opponentXyzCode);
    const opponentMaterialOne = requireCard(session, opponentMaterialOneCode);
    const opponentMaterialTwo = requireCard(session, opponentMaterialTwoCode);
    moveFaceUpAttack(session, neoGalaxy, 0, 0);
    moveFaceUpAttack(session, opponentXyz, 1, 0);
    const ownOverlay = moveDuelCard(session.state, ownMaterial.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
    neoGalaxy.overlayUids.push(ownOverlay.uid);
    const opponentOverlayOne = moveDuelCard(session.state, opponentMaterialOne.uid, "overlay", 1, duelReason.material | duelReason.xyz, 1);
    const opponentOverlayTwo = moveDuelCard(session.state, opponentMaterialTwo.uid, "overlay", 1, duelReason.material | duelReason.xyz, 1);
    opponentXyz.overlayUids.push(opponentOverlayOne.uid, opponentOverlayTwo.uid);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(neoGalaxyCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === neoGalaxy.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", property: 263168, range: ["monsterZone"], sourceUid: neoGalaxy.uid },
      { category: undefined, code: 1102, event: "trigger", property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], sourceUid: neoGalaxy.uid },
      { category: undefined, code: 251, event: "continuous", property: undefined, range: ["monsterZone"], sourceUid: neoGalaxy.uid },
      { category: 2097152, code: undefined, event: "ignition", property: undefined, range: ["monsterZone"], sourceUid: neoGalaxy.uid },
    ]);

    const action = getLuaRestoreLegalActions(restored, 0).find(
      (candidate) => candidate.type === "activateEffect" && candidate.uid === neoGalaxy.uid && candidate.effectId === "lua-4",
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === ownMaterial.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: neoGalaxy.uid,
      reasonEffectId: 4,
    });
    for (const uid of [opponentMaterialOne.uid, opponentMaterialTwo.uid]) {
      expect(restored.session.state.cards.find((card) => card.uid === uid)).toMatchObject({
        location: "graveyard",
        controller: 1,
        reason: duelReason.effect,
        reasonPlayer: 0,
        reasonCardUid: neoGalaxy.uid,
        reasonEffectId: 4,
      });
    }
    expect(restored.session.state.cards.find((card) => card.uid === neoGalaxy.uid)?.overlayUids).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === opponentXyz.uid)?.overlayUids).toEqual([]);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === neoGalaxy.uid), restored.session.state)).toBe(5500);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === neoGalaxy.uid && [effectUpdateAttack, effectExtraAttack].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", property: undefined, reset: { flags: resetStandardDisablePhaseEnd }, sourceUid: neoGalaxy.uid, value: 1000 },
      { code: effectExtraAttack, event: "continuous", property: 1024, reset: { flags: resetStandardPhaseEnd }, sourceUid: neoGalaxy.uid, value: 1 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => ["detachedMaterial", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: ownMaterial.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.cost, eventReasonCardUid: neoGalaxy.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, previous: "overlay", current: "graveyard" },
      { eventCardUid: ownMaterial.uid, eventCode: 1202, eventName: "detachedMaterial", eventReason: duelReason.cost, eventReasonCardUid: neoGalaxy.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, previous: "overlay", current: "graveyard" },
      { eventCardUid: opponentMaterialOne.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonCardUid: neoGalaxy.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, previous: "overlay", current: "graveyard" },
      { eventCardUid: opponentMaterialTwo.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonCardUid: neoGalaxy.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, previous: "overlay", current: "graveyard" },
      { eventCardUid: opponentMaterialOne.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonCardUid: neoGalaxy.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, previous: "overlay", current: "graveyard" },
    ]);

    const restoredPersistent = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredPersistent);
    expectRestoredLegalActions(restoredPersistent, 0);
    expect(currentAttack(restoredPersistent.session.state.cards.find((card) => card.uid === neoGalaxy.uid), restoredPersistent.session.state)).toBe(5500);
    expect(restoredPersistent.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Neo Galaxy-Eyes Photon Dragon");
  expect(script).toContain("Xyz.AddProcedure(c,nil,8,3)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("e1:SetCondition(s.negcon)");
  expect(script).toContain("e2:SetCode(EFFECT_MATERIAL_CHECK)");
  expect(script).toContain("g:IsExists(Card.IsCode,1,nil,CARD_GALAXYEYES_P_DRAGON)");
  expect(script).toContain("e3:SetCost(Cost.DetachFromSelf(1))");
  expect(script).toContain("Duel.GetOverlayCount(tp,0,1)~=0");
  expect(script).toContain("local g=Duel.GetOverlayGroup(tp,0,1)");
  expect(script).toContain("Duel.SendtoGrave(g,REASON_EFFECT)");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(#g*500)");
  expect(script).toContain("e2:SetCode(EFFECT_EXTRA_ATTACK)");
  expect(script).toContain("e2:SetValue(#g-1)");
}

function cards(): DuelCardData[] {
  return [
    { code: neoGalaxyCode, name: "Neo Galaxy-Eyes Photon Dragon", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceDragon, attribute: attributeLight, level: 8, attack: 4500, defense: 3000 },
    { code: ownMaterialCode, name: "Neo Galaxy-Eyes Own Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeLight, level: 8, attack: 3000, defense: 2500 },
    { code: opponentXyzCode, name: "Neo Galaxy-Eyes Opponent Xyz", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceDragon, attribute: attributeDark, level: 8, attack: 2500, defense: 2000 },
    { code: opponentMaterialOneCode, name: "Neo Galaxy-Eyes Opponent Material One", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, level: 8, attack: 1800, defense: 1200 },
    { code: opponentMaterialTwoCode, name: "Neo Galaxy-Eyes Opponent Material Two", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 8, attack: 1700, defense: 1600 },
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
