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
const necronizeCode = "38363525";
const highZombieCode = "383635250";
const opponentTargetCode = "383635251";
const banishedZombieCode = "383635252";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasNecronizeScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${necronizeCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const raceZombie = 0x10;
const attributeDark = 0x20;
const categoryControl = 0x2000;
const categoryToDeck = 0x10;
const categoryLeaveGrave = 0x100000000;

describe.skipIf(!hasUpstreamScripts || !hasNecronizeScript)("Lua real script Zombie Necronize control grave set", () => {
  it("restores targeted control while a high-level Zombie is face-up", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${necronizeCode}.lua`));
    const reader = createCardReader(cards());
    const session = createNecronizeSession(reader, workspace);
    const necronize = requireCard(session, necronizeCode);
    const highZombie = requireCard(session, highZombieCode);
    const target = requireCard(session, opponentTargetCode);
    moveDuelCard(session.state, necronize.uid, "hand", 0);
    moveFaceUpAttack(session, highZombie, 0, 0);
    moveFaceUpAttack(session, target, 1, 0);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === necronize.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      countLimitCode: effect.countLimitCode,
      event: effect.event,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: categoryControl, code: 1002, countLimit: 1, countLimitCode: Number(necronizeCode), event: "ignition", property: 0x10, range: ["hand", "spellTrapZone"] },
      { category: categoryToDeck + categoryLeaveGrave, code: undefined, countLimit: 1, countLimitCode: Number(necronizeCode), event: "ignition", property: undefined, range: ["graveyard"] },
    ]);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === necronize.uid && action.effectId === "lua-1-1002"
    );
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      controller: 0,
      previousController: 1,
      location: "monsterZone",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: necronize.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.effects.find((effect) => effect.registryKey === `lua:${opponentTargetCode}:temporary-control-return:${target.uid}`)).toMatchObject({
      code: 4608,
      controller: 1,
      luaValueDescriptor: "temporary-control-return",
    });
  });

  it("restores banished Zombie to Deck into Graveyard self-Set and leave-field redirect", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${necronizeCode}.lua`));
    const reader = createCardReader(cards());
    const session = createNecronizeSession(reader, workspace);
    const necronize = requireCard(session, necronizeCode);
    const banishedZombie = requireCard(session, banishedZombieCode);
    moveDuelCard(session.state, necronize.uid, "graveyard", 0);
    moveDuelCard(session.state, banishedZombie.uid, "banished", 0).faceUp = true;

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const setAction = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === necronize.uid && action.effectId === "lua-2"
    );
    expect(setAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, setAction!);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === banishedZombie.uid)).toMatchObject({
      location: "deck",
      controller: 0,
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: necronize.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === necronize.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: false,
      position: "faceDown",
    });
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === necronize.uid && effect.code === 60).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([{ code: 60, property: 0x400 | 0x4000000, reset: { flags: 209326080 }, value: 0x20 }]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Zombie Necronize");
  expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("return c:IsFaceup() and c:IsLevelAbove(5) and c:IsRace(RACE_ZOMBIE)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsControlerCanBeChanged,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.GetControl(tc,tp,PHASE_END,1)");
  expect(script).toContain("e2:SetCategory(CATEGORY_TODECK+CATEGORY_SET)");
  expect(script).toContain("return c:IsFaceup() and c:IsRace(RACE_ZOMBIE) and c:IsAbleToDeck()");
  expect(script).toContain("Duel.SendtoDeck(g,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)>0");
  expect(script).toContain("Duel.SSet(tp,c)");
  expect(script).toContain("e1:SetCode(EFFECT_LEAVE_FIELD_REDIRECT)");
  expect(script).toContain("e1:SetValue(LOCATION_REMOVED)");
}

function cards(): DuelCardData[] {
  return [
    { code: necronizeCode, name: "Zombie Necronize", kind: "spell", typeFlags: typeSpell },
    { code: highZombieCode, name: "Zombie Necronize High Zombie", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, attribute: attributeDark, level: 6, attack: 2200, defense: 1000 },
    { code: opponentTargetCode, name: "Zombie Necronize Control Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1000 },
    { code: banishedZombieCode, name: "Zombie Necronize Banished Zombie", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
  ];
}

function createNecronizeSession(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): DuelSession {
  const session = createDuel({ seed: 38363525, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [necronizeCode, highZombieCode, banishedZombieCode] }, 1: { main: [opponentTargetCode] } });
  startDuel(session);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(necronizeCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return session;
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
