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
const kayennCode = "51554871";
const firstLavalCode = "515548710";
const secondLavalCode = "515548711";
const nonLavalCode = "515548712";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasKayennScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${kayennCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const racePyro = 0x80;
const raceWarrior = 0x1;
const attributeFire = 0x4;
const attributeEarth = 0x1;
const setLaval = 0x39;
const effectUpdateAttack = 100;
const resetStandard = 33427456;

describe.skipIf(!hasUpstreamScripts || !hasKayennScript)("Lua real script Kayenn grave self banish Laval group stat", () => {
  it("restores grave SelfBanish cost into all face-up Laval ATK gains", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${kayennCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 51554871, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [kayennCode, firstLavalCode, secondLavalCode, nonLavalCode] }, 1: { main: [] } });
    startDuel(session);

    const kayenn = requireCard(session, kayennCode);
    const firstLaval = requireCard(session, firstLavalCode);
    const secondLaval = requireCard(session, secondLavalCode);
    const nonLaval = requireCard(session, nonLavalCode);
    moveDuelCard(session.state, kayenn.uid, "graveyard", 0);
    moveFaceUpAttack(session, firstLaval, 0, 0);
    moveFaceUpAttack(session, secondLaval, 0, 1);
    moveFaceUpAttack(session, nonLaval, 0, 2);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(kayennCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === kayenn.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: 2097152, code: undefined, event: "ignition", property: undefined, range: ["graveyard"], sourceUid: kayenn.uid },
    ]);

    const action = getLuaRestoreLegalActions(restored, 0).find(
      (candidate) => candidate.type === "activateEffect" && candidate.uid === kayenn.uid && candidate.effectId === "lua-1",
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === kayenn.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: kayenn.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === firstLaval.uid), restored.session.state)).toBe(1900);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === secondLaval.uid), restored.session.state)).toBe(2100);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === nonLaval.uid), restored.session.state)).toBe(1800);
    expect(restored.session.state.effects.filter((effect) => [firstLaval.uid, secondLaval.uid, nonLaval.uid].includes(effect.sourceUid) && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: undefined, reset: { flags: resetStandard }, sourceUid: firstLaval.uid, value: 400 },
      { code: effectUpdateAttack, property: undefined, reset: { flags: resetStandard }, sourceUid: secondLaval.uid, value: 400 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "banished").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "banished", eventCode: 1011, eventCardUid: kayenn.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: kayenn.uid, eventReasonEffectId: 1 },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentAttack(restoredAfter.session.state.cards.find((card) => card.uid === firstLaval.uid), restoredAfter.session.state)).toBe(1900);
    expect(currentAttack(restoredAfter.session.state.cards.find((card) => card.uid === secondLaval.uid), restoredAfter.session.state)).toBe(2100);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Kayenn, the Master Magma Blacksmith");
  expect(script).toContain("e1:SetRange(LOCATION_GRAVE)");
  expect(script).toContain("e1:SetCost(Cost.SelfBanish)");
  expect(script).toContain("return c:IsFaceup() and c:IsSetCard(SET_LAVAL)");
  expect(script).toContain("Duel.GetMatchingGroup(s.filter,tp,LOCATION_MZONE,0,nil)");
  expect(script).toContain("for tc in aux.Next(g) do");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(400)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD)");
}

function cards(): DuelCardData[] {
  return [
    { code: kayennCode, name: "Kayenn, the Master Magma Blacksmith", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePyro, attribute: attributeFire, level: 3, attack: 1200, defense: 200, setcodes: [setLaval] },
    { code: firstLavalCode, name: "Kayenn First Laval Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePyro, attribute: attributeFire, level: 4, attack: 1500, defense: 200, setcodes: [setLaval] },
    { code: secondLavalCode, name: "Kayenn Second Laval Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePyro, attribute: attributeFire, level: 4, attack: 1700, defense: 200, setcodes: [setLaval] },
    { code: nonLavalCode, name: "Kayenn Non-Laval Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1000 },
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
