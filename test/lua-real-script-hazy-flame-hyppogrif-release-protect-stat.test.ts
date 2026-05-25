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
const hyppogrifCode = "31303283";
const fireCostCode = "313032830";
const waterDecoyCode = "313032831";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasHyppogrifScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${hyppogrifCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWingedBeast = 0x80;
const raceWarrior = 0x1;
const attributeFire = 0x4;
const attributeWater = 0x2;
const effectCannotBeEffectTarget = 71;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasHyppogrifScript)("Lua real script Hazy Flame Hyppogrif release protect stat", () => {
  it("restores targeting protection and FIRE release cost into copy-inherit ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${hyppogrifCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 31303283, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [hyppogrifCode, fireCostCode, waterDecoyCode] }, 1: { main: [] } });
    startDuel(session);

    const hyppogrif = requireCard(session, hyppogrifCode);
    const fireCost = requireCard(session, fireCostCode);
    const waterDecoy = requireCard(session, waterDecoyCode);
    moveFaceUpAttack(session, hyppogrif, 0);
    moveFaceUpAttack(session, fireCost, 0);
    moveFaceUpAttack(session, waterDecoy, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(hyppogrifCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === hyppogrif.uid && effect.code === effectCannotBeEffectTarget).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectCannotBeEffectTarget, event: "continuous", property: 0x20000, range: ["monsterZone"], sourceUid: hyppogrif.uid, value: undefined },
    ]);

    const action = getLuaRestoreLegalActions(restored, 0).find(
      (candidate) => candidate.type === "activateEffect" && candidate.uid === hyppogrif.uid && candidate.effectId === "lua-2",
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === fireCost.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: hyppogrif.uid,
      reasonEffectId: 2,
    });
    expect(restored.session.state.cards.find((card) => card.uid === waterDecoy.uid)).toMatchObject({ location: "monsterZone" });
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === hyppogrif.uid), restored.session.state)).toBe(2400);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === hyppogrif.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: 8192, reset: { flags: 33492992 }, sourceUid: hyppogrif.uid, value: 300 },
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
      { eventName: "released", eventCode: 1017, eventCardUid: fireCost.uid, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: hyppogrif.uid, eventReasonEffectId: 2 },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: fireCost.uid, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: hyppogrif.uid, eventReasonEffectId: 2 },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentAttack(restoredAfter.session.state.cards.find((card) => card.uid === hyppogrif.uid), restoredAfter.session.state)).toBe(2400);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Hazy Flame Hyppogrif");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)");
  expect(script).toContain("e1:SetValue(aux.tgoval)");
  expect(script).toContain("Duel.CheckReleaseGroupCost(tp,Card.IsAttribute,1,false,nil,e:GetHandler(),ATTRIBUTE_FIRE)");
  expect(script).toContain("Duel.SelectReleaseGroupCost(tp,Card.IsAttribute,1,1,false,nil,e:GetHandler(),ATTRIBUTE_FIRE)");
  expect(script).toContain("Duel.Release(g,REASON_COST)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(300)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_COPY_INHERIT)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD_DISABLE)");
}

function cards(): DuelCardData[] {
  return [
    { code: hyppogrifCode, name: "Hazy Flame Hyppogrif", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWingedBeast, attribute: attributeFire, level: 6, attack: 2100, defense: 200 },
    { code: fireCostCode, name: "Hyppogrif FIRE Release", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWingedBeast, attribute: attributeFire, level: 4, attack: 1200, defense: 1000 },
    { code: waterDecoyCode, name: "Hyppogrif WATER Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeWater, level: 4, attack: 1400, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
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
