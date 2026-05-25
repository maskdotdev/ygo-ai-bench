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
const recaptureCode = "39373426";
const spyralMonsterCode = "393734260";
const opponentMonsterCode = "393734261";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasRecaptureScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${recaptureCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const typeContinuous = 0x20000;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const setSpyral = 0xee;
const categoryControl = 0x2000;
const eventFreeChain = 1002;
const eventSpecialSummonSuccess = 1102;
const effectDestroyReplace = 50;
const effectCannotDirectAttack = 57;
const effectFlagCardTarget = 0x10;
const effectFlagDelay = 0x10000;

describe.skipIf(!hasUpstreamScripts || !hasRecaptureScript)("Lua real script SPYRAL MISSION - Recapture activate control replace", () => {
  it("restores activation, SPYRAL special-summon control trigger, and grave destroy replacement effect shape", () => {
    const { workspace, reader, session } = createFixture(39373426);
    expectScriptShape(workspace.readScript(`official/c${recaptureCode}.lua`));
    const recapture = requireCard(session, recaptureCode);
    const spyralMonster = requireCard(session, spyralMonsterCode);
    const opponentMonster = requireCard(session, opponentMonsterCode);
    setTrap(session, recapture);
    moveFaceUpAttack(session, spyralMonster, 0, 0);
    moveFaceUpAttack(session, opponentMonster, 1, 0);
    prepareMainPhase(session);
    registerRecapture(session, workspace);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === recapture.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: eventFreeChain, countLimit: undefined, event: "quick", id: `lua-1-${eventFreeChain}`, property: undefined, range: ["spellTrapZone"], triggerEvent: undefined },
      { category: categoryControl, code: eventSpecialSummonSuccess, countLimit: 1, event: "quick", id: `lua-2-${eventSpecialSummonSuccess}`, property: effectFlagCardTarget | effectFlagDelay, range: ["spellTrapZone"], triggerEvent: "specialSummoned" },
      { category: categoryControl, code: eventSpecialSummonSuccess, countLimit: 1, event: "trigger", id: `lua-3-${eventSpecialSummonSuccess}`, property: effectFlagCardTarget | effectFlagDelay, range: ["spellTrapZone"], triggerEvent: "specialSummoned" },
      { category: undefined, code: effectDestroyReplace, countLimit: undefined, event: "continuous", id: `lua-4-${effectDestroyReplace}`, property: undefined, range: ["graveyard"], triggerEvent: undefined },
    ]);
    expectRestoredLegalActions(restored, 0);
    const activate = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === recapture.uid && action.effectId === `lua-1-${eventFreeChain}`
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activate!);
    resolveRestoredChain(restored);

    expect(findCard(restored.session, recapture.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: true,
    });
    expect(restored.session.state.effects.some((effect) =>
      effect.sourceUid === recapture.uid && effect.code === 4608 && effect.event === "continuous" && effect.range?.includes("spellTrapZone")
    )).toBe(true);
    expect(restored.session.state.effects.some((effect) =>
      effect.sourceUid === recapture.uid && effect.code === effectCannotDirectAttack
    )).toBe(false);
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
  loadDecks(session, { 0: { main: [recaptureCode, spyralMonsterCode] }, 1: { main: [opponentMonsterCode] } });
  startDuel(session);
  return { workspace, reader, session };
}

function cards(): DuelCardData[] {
  return [
    { code: recaptureCode, name: "SPYRAL MISSION - Recapture", kind: "trap", typeFlags: typeTrap | typeContinuous, setcodes: [0x20ee] },
    { code: spyralMonsterCode, name: "SPYRAL Recapture Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, setcodes: [setSpyral], level: 4, attack: 1900, defense: 1200 },
    { code: opponentMonsterCode, name: "SPYRAL Recapture Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("SPYRAL MISSION - Recapture");
  expect(script).toContain("e0:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e0:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e2:SetRange(LOCATION_SZONE)");
  expect(script).toContain("return eg:IsExists(s.cncfilter,1,nil,tp)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsControlerCanBeChanged,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.GetControl(tc,tp,PHASE_END,1)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_DIRECT_ATTACK)");
  expect(script).toContain("e3:SetCode(EFFECT_DESTROY_REPLACE)");
  expect(script).toContain("Duel.SelectEffectYesNo(tp,e:GetHandler(),96)");
  expect(script).toContain("Duel.Remove(e:GetHandler(),POS_FACEUP,REASON_EFFECT)");
}

function prepareMainPhase(session: DuelSession): void {
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
}

function registerRecapture(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(recaptureCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function setTrap(session: DuelSession, card: DuelCardInstance): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.faceUp = false;
  moved.position = "faceDown";
  moved.turnId = 0;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
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
