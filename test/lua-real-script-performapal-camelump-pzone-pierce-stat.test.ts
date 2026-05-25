import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const camelumpCode = "44481227";
const pierceTargetCode = "444812270";
const opponentFaceupCode = "444812271";
const opponentFaceupSecondCode = "444812272";
const opponentFacedownCode = "444812273";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCamelumpScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${camelumpCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const raceBeast = 0x4000;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const attributeLight = 0x10;
const effectUpdateDefense = 104;
const effectPierce = 203;

describe.skipIf(!hasUpstreamScripts || !hasCamelumpScript)("Lua real script Performapal Camelump PZONE pierce stat", () => {
  it("restores PZONE ignition into opponent DEF loss and targeted piercing grant", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${camelumpCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 44481227, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [camelumpCode, pierceTargetCode] }, 1: { main: [opponentFaceupCode, opponentFaceupSecondCode, opponentFacedownCode] } });
    startDuel(session);

    const camelump = requireCard(session, camelumpCode);
    const pierceTarget = requireCard(session, pierceTargetCode);
    const opponentFaceup = requireCard(session, opponentFaceupCode);
    const opponentFaceupSecond = requireCard(session, opponentFaceupSecondCode);
    const opponentFacedown = requireCard(session, opponentFacedownCode);
    moveFaceUpPzone(session, camelump, 0, 0);
    moveFaceUpAttack(session, pierceTarget, 0, 0);
    moveFaceUpAttack(session, opponentFaceup, 1, 0);
    moveFaceUpAttack(session, opponentFaceupSecond, 1, 1);
    const facedown = moveDuelCard(session.state, opponentFacedown.uid, "monsterZone", 1);
    facedown.faceUp = false;
    facedown.position = "faceDownDefense";
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(camelumpCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const ignition = getLuaRestoreLegalActions(restored, 0).find(
      (action) => action.type === "activateEffect" && action.uid === camelump.uid && action.effectId === "lua-3",
    );
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, ignition!);
    resolveRestoredChain(restored);

    expect(currentDefense(restored.session.state.cards.find((card) => card.uid === opponentFaceup.uid), restored.session.state)).toBe(1000);
    expect(currentDefense(restored.session.state.cards.find((card) => card.uid === opponentFaceupSecond.uid), restored.session.state)).toBe(1200);
    expect(currentDefense(restored.session.state.cards.find((card) => card.uid === opponentFacedown.uid), restored.session.state)).toBe(2100);
    expect(restored.session.state.effects.filter((effect) => [opponentFaceup.uid, opponentFaceupSecond.uid, pierceTarget.uid].includes(effect.sourceUid) && [effectUpdateDefense, effectPierce].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      description: effect.description,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateDefense, description: undefined, property: undefined, reset: { flags: 1107169792 }, sourceUid: opponentFaceup.uid, value: -800 },
      { code: effectUpdateDefense, description: undefined, property: undefined, reset: { flags: 1107169792 }, sourceUid: opponentFaceupSecond.uid, value: -800 },
      { code: effectPierce, description: 3208, property: 67108864, reset: { flags: 1107169792 }, sourceUid: pierceTarget.uid, value: undefined },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "becameTarget").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: pierceTarget.uid, eventReason: 0, eventReasonPlayer: 0, relatedEffectId: 3 },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentDefense(restoredAfter.session.state.cards.find((card) => card.uid === opponentFaceup.uid), restoredAfter.session.state)).toBe(1000);
    expect(currentDefense(restoredAfter.session.state.cards.find((card) => card.uid === opponentFaceupSecond.uid), restoredAfter.session.state)).toBe(1200);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Performapal Camelump");
  expect(script).toContain("Pendulum.AddProcedure(c)");
  expect(script).toContain("e2:SetRange(LOCATION_PZONE)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("return Duel.IsAbleToEnterBP()");
  expect(script).toContain("return c:IsFaceup() and not c:IsHasEffect(EFFECT_PIERCE)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_DEFENSE)");
  expect(script).toContain("e1:SetValue(-800)");
  expect(script).toContain("e2:SetDescription(3208)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CLIENT_HINT)");
  expect(script).toContain("e2:SetCode(EFFECT_PIERCE)");
}

function cards(): DuelCardData[] {
  return [
    { code: camelumpCode, name: "Performapal Camelump", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: raceBeast, attribute: attributeEarth, level: 4, attack: 800, defense: 1800, leftScale: 2, rightScale: 2 },
    { code: pierceTargetCode, name: "Camelump Pierce Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeEarth, level: 4, attack: 1600, defense: 1200 },
    { code: opponentFaceupCode, name: "Camelump Face-up Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1800, defense: 1800 },
    { code: opponentFaceupSecondCode, name: "Camelump Second Face-up Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1700, defense: 2000 },
    { code: opponentFacedownCode, name: "Camelump Face-down Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1500, defense: 2100 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
}

function moveFaceUpPzone(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
