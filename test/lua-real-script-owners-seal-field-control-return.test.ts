import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const ownersSealCode = "9720537";
const stolenOwnCode = "97205370";
const stolenOpponentCode = "97205371";
const ownControlCode = "97205372";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const raceSpellcaster = 0x2;
const attributeEarth = 0x1;
const attributeDark = 0x20;
const effectSetControl = 4;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Owner's Seal field control return", () => {
  it("restores field-wide owner control reset through aux.Next EFFECT_SET_CONTROL handoff", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${ownersSealCode}.lua`);
    expect(script).toContain("--Owner's Seal");
    expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("return c:GetControler()~=c:GetOwner()");
    expect(script).toContain("Duel.GetFieldGroup(tp,LOCATION_MZONE,LOCATION_MZONE)");
    expect(script).toContain("for tc in aux.Next(g) do");
    expect(script).toContain("tc:ResetEffect(EFFECT_SET_CONTROL,RESET_CODE)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_CONTROL)");
    expect(script).toContain("e1:SetValue(tc:GetOwner())");

    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 9720537, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ownersSealCode, stolenOwnCode, ownControlCode] }, 1: { main: [stolenOpponentCode] } });
    startDuel(session);

    const ownersSeal = requireCard(session, ownersSealCode);
    const stolenOwn = requireCard(session, stolenOwnCode);
    const stolenOpponent = requireCard(session, stolenOpponentCode);
    const ownControl = requireCard(session, ownControlCode);
    moveDuelCard(session.state, ownersSeal.uid, "hand", 0);
    moveFaceUpAttack(session, stolenOwn, 1, 0);
    stolenOwn.owner = 0;
    moveFaceUpAttack(session, stolenOpponent, 0, 0);
    stolenOpponent.owner = 1;
    moveFaceUpAttack(session, ownControl, 0, 1);
    ownControl.owner = 0;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(ownersSealCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activate = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === ownersSeal.uid);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activate!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === ownersSeal.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reasonPlayer: 0,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === stolenOwn.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: ownersSeal.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === stolenOpponent.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      previousController: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: ownersSeal.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === ownControl.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
    });
    expect(restoredOpen.session.state.effects.filter((effect) => effect.code === effectSetControl && [stolenOwn.uid, stolenOpponent.uid].includes(effect.sourceUid)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      sourceUid: effect.sourceUid,
      value: effect.value,
    })).sort((a, b) => a.sourceUid.localeCompare(b.sourceUid))).toEqual([
      { code: effectSetControl, event: "continuous", sourceUid: stolenOwn.uid, value: 0 },
      { code: effectSetControl, event: "continuous", sourceUid: stolenOpponent.uid, value: 1 },
    ]);

    const restoredControl = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredControl);
    expectRestoredLegalActions(restoredControl, 0);
    expect(restoredControl.session.state.cards.find((card) => card.uid === stolenOwn.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredControl.session.state.cards.find((card) => card.uid === stolenOpponent.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  return [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === ownersSealCode),
    { code: stolenOwnCode, name: "Owner's Seal Own Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1500, defense: 1000 },
    { code: stolenOpponentCode, name: "Owner's Seal Opponent Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 1700, defense: 1200 },
    { code: ownControlCode, name: "Owner's Seal Already Controlled", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
