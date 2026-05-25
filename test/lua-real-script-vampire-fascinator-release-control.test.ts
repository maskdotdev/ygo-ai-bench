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
const fascinatorCode = "72860663";
const releaseVampireCode = "728606630";
const opponentTargetCode = "728606631";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasFascinatorScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${fascinatorCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceZombie = 0x8;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const setVampire = 0x8e;
const eventSpecialSummonSuccess = 1102;

describe.skipIf(!hasUpstreamScripts || !hasFascinatorScript)("Lua real script Vampire Fascinator release control", () => {
  it("restores Vampire release cost into targeted opponent monster control", () => {
    const { workspace, reader, session } = createFixture(72860663);
    expectScriptShape(workspace.readScript(`official/c${fascinatorCode}.lua`));
    const fascinator = requireCard(session, fascinatorCode);
    const releaseVampire = requireCard(session, releaseVampireCode);
    const opponentTarget = requireCard(session, opponentTargetCode);
    moveFaceUpAttack(session, fascinator, 0).summonType = "link";
    moveFaceUpAttack(session, releaseVampire, 0);
    moveFaceUpAttack(session, opponentTarget, 1);
    prepareMainPhase(session);
    registerFascinator(session, workspace);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === fascinator.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", id: "lua-1-31", property: 0x40400, range: ["monsterZone"] },
      { category: 0x200, code: eventSpecialSummonSuccess, event: "trigger", id: `lua-2-${eventSpecialSummonSuccess}`, property: 0x10010, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"] },
      { category: 0x2000, code: undefined, event: "ignition", id: "lua-3", property: 0x10, range: ["monsterZone"] },
    ]);

    const control = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === fascinator.uid && action.effectId === "lua-3");
    expect(control, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, control!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === fascinator.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.release | duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: fascinator.uid,
      reasonEffectId: 3,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === releaseVampire.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === opponentTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: fascinator.uid,
      reasonEffectId: 3,
    });
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
  loadDecks(session, { 0: { main: [releaseVampireCode], extra: [fascinatorCode] }, 1: { main: [opponentTargetCode] } });
  startDuel(session);
  return { workspace, reader, session };
}

function cards(): DuelCardData[] {
  return [
    { code: fascinatorCode, name: "Vampire Fascinator", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceZombie, attribute: attributeDark, setcodes: [setVampire], level: 3, attack: 2400, defense: 0, linkMarkers: 0x2a },
    { code: releaseVampireCode, name: "Vampire Fascinator Release Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, attribute: attributeDark, setcodes: [setVampire], level: 4, attack: 1700, defense: 1000 },
    { code: opponentTargetCode, name: "Vampire Fascinator Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1200 },
  ];
}

function expectScriptShape(script: string): void {
  expect(script).toContain("Vampire Fascinator");
  expect(script).toContain("Link.AddProcedure(c,nil,2,3,s.lcheck)");
  expect(script).toContain("return e:GetHandler():IsLinkSummoned()");
  expect(script).toContain("Duel.SelectTarget(tp,s.spfilter,tp,0,LOCATION_GRAVE,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP_DEFENSE)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)");
  expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.ctcostfilter,1,false,nil,nil,tp)");
  expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.ctcostfilter,1,1,false,nil,nil,tp)");
  expect(script).toContain("Duel.Release(g,REASON_COST)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsAbleToChangeControler,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.GetControl(tc,tp,PHASE_END,1)");
}

function prepareMainPhase(session: DuelSession): void {
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
}

function registerFascinator(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(fascinatorCode), workspace).ok).toBe(true);
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
