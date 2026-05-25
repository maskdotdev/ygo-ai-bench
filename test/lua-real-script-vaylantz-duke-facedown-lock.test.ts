import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const dukeCode = "13291886";
const facedownSpellCode = "132918860";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDukeScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${dukeCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const raceMachine = 0x2000;
const attributeFire = 0x4;
const setVaylantz = 0x17e;
const effectCannotTrigger = 7;
const eventFreeChain = 1002;
const eventMove = 1030;
const resetStandardPhaseEnd = 1107169792;

describe.skipIf(!hasUpstreamScripts || !hasDukeScript)("Lua real script Vaylantz Duke facedown lock", () => {
  it("restores MZONE ignition targeting a face-down Spell/Trap into EFFECT_CANNOT_TRIGGER", () => {
    const { workspace, reader, session } = createFixture(13291886);
    expectScriptShape(workspace.readScript(`official/c${dukeCode}.lua`));
    const duke = requireCard(session, dukeCode);
    const facedownSpell = requireCard(session, facedownSpellCode);
    moveFaceUpAttack(session, duke, 0);
    const setSpell = moveDuelCard(session.state, facedownSpell.uid, "spellTrapZone", 1);
    setSpell.faceUp = false;
    setSpell.position = "faceDown";
    prepareMainPhase(session);
    registerDuke(session, workspace);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === duke.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: undefined, code: 320, countLimit: undefined, event: "continuous", id: "lua-1-320", property: 0x40400, range: ["spellTrapZone"] },
      { category: undefined, code: eventFreeChain, countLimit: undefined, event: "ignition", id: `lua-2-${eventFreeChain}`, property: undefined, range: ["hand"] },
      { category: 0x200, code: undefined, countLimit: 1, event: "ignition", id: "lua-3", property: undefined, range: ["spellTrapZone"] },
      { category: undefined, code: undefined, countLimit: 1, event: "ignition", id: "lua-4", property: 0x10, range: ["monsterZone"] },
      { category: 0x2000, code: eventMove, countLimit: 1, event: "trigger", id: `lua-5-${eventMove}`, property: 0x10010, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"] },
    ]);

    const lock = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === duke.uid && action.effectId === "lua-4");
    expect(lock, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, lock!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === facedownSpell.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 1,
      faceUp: false,
      position: "faceDown",
    });
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === facedownSpell.uid && effect.code === effectCannotTrigger).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectCannotTrigger, reset: { flags: resetStandardPhaseEnd }, sourceUid: facedownSpell.uid, value: 1 },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "becameTarget").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: facedownSpell.uid, eventCode: 1028, relatedEffectId: 4 },
    ]);
  });
});

function createFixture(seed: number): {
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  reader: ReturnType<typeof createCardReader>;
  session: DuelSession;
} {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  const reader = createCardReader(cards());
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [dukeCode] }, 1: { main: [facedownSpellCode] } });
  startDuel(session);
  return { workspace, reader, session };
}

function cards(): DuelCardData[] {
  return [
    { code: dukeCode, name: "Vaylantz Dominator Duke", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: raceMachine, attribute: attributeFire, setcodes: [setVaylantz], level: 8, attack: 2000, defense: 2000, leftScale: 1, rightScale: 1 },
    { code: facedownSpellCode, name: "Vaylantz Duke Face-down Spell", kind: "spell", typeFlags: typeSpell },
  ];
}

function expectScriptShape(script: string): void {
  expect(script).toContain("Vaylantz Dominator Duke");
  expect(script).toContain("Pendulum.AddProcedure(c)");
  expect(script).toContain("Duel.IsEnvironment(CARD_VALIANTS_KOENIGWISSEN,PLAYER_ALL,LOCATION_FZONE)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP,zone)");
  expect(script).toContain("Duel.SelectTarget(tp,s.cafilter,tp,LOCATION_SZONE,LOCATION_SZONE,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_TRIGGER)");
  expect(script).toContain("e3:SetCode(EVENT_MOVE)");
  expect(script).toContain("Duel.GetControl(tc,tp)");
  expect(script).toContain("e3:SetCode(EFFECT_ADD_SETCODE)");
}

function prepareMainPhase(session: DuelSession): void {
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
}

function registerDuke(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(dukeCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
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
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
