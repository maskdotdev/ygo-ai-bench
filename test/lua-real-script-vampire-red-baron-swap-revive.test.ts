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
const redBaronCode = "6917479";
const ownVampireCode = "69174790";
const opponentTargetCode = "69174791";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasRedBaronScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${redBaronCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceZombie = 0x8;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const setVampire = 0x8e;
const eventBattleDestroying = 1139;
const eventPhaseBattle = 4224;

describe.skipIf(!hasUpstreamScripts || !hasRedBaronScript)("Lua real script Vampire Red Baron swap revive", () => {
  it("restores LP-cost targeted SwapControl between a Vampire and opponent monster", () => {
    const { workspace, reader, session } = createFixture(6917479);
    expectScriptShape(workspace.readScript(`official/c${redBaronCode}.lua`) ?? "");
    const redBaron = requireCard(session, redBaronCode);
    const ownVampire = requireCard(session, ownVampireCode);
    const opponentTarget = requireCard(session, opponentTargetCode);
    moveFaceUpAttack(session, redBaron, 0);
    moveFaceUpAttack(session, ownVampire, 0);
    moveFaceUpAttack(session, opponentTarget, 1);
    prepareMainPhase(session);
    registerRedBaron(session, workspace);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === redBaron.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: 0x2000, code: undefined, event: "ignition", id: "lua-1", property: 0x10, range: ["monsterZone"] },
      { category: undefined, code: eventBattleDestroying, event: "continuous", id: `lua-2-${eventBattleDestroying}`, property: 0x400, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"] },
      { category: 0x200, code: eventPhaseBattle, event: "trigger", id: `lua-3-${eventPhaseBattle}`, property: undefined, range: ["monsterZone"] },
    ]);

    const swap = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === redBaron.uid && action.effectId === "lua-1");
    expect(swap, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, swap!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.players[0].lifePoints).toBe(7000);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === ownVampire.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      previousController: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: redBaron.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === opponentTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: redBaron.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.eventHistory.some((event) => event.eventName === "lifePointCostPaid" && event.eventPlayer === 0 && event.eventValue === 1000)).toBe(true);
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
  loadDecks(session, { 0: { main: [redBaronCode, ownVampireCode] }, 1: { main: [opponentTargetCode] } });
  startDuel(session);
  return { workspace, reader, session };
}

function cards(): DuelCardData[] {
  return [
    { code: redBaronCode, name: "Vampire Red Baron", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, attribute: attributeDark, setcodes: [setVampire], level: 6, attack: 2400, defense: 1000 },
    { code: ownVampireCode, name: "Vampire Red Baron Own Vampire", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, attribute: attributeDark, setcodes: [setVampire], level: 4, attack: 1800, defense: 1000 },
    { code: opponentTargetCode, name: "Vampire Red Baron Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1200 },
  ];
}

function expectScriptShape(script: string): void {
  expect(script).toContain("Vampire Red Baron");
  expect(script).toContain("e1:SetCost(Cost.PayLP(1000))");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsAbleToChangeControler,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.SelectTarget(tp,s.ctfilter2,tp,LOCATION_MZONE,0,1,1,e:GetHandler())");
  expect(script).toContain("Duel.SwapControl(a,b)");
  expect(script).toContain("e2:SetCode(EVENT_BATTLE_DESTROYING)");
  expect(script).toContain("e:GetHandler():RegisterFlagEffect(id,RESET_EVENT|RESETS_STANDARD|RESET_PHASE|PHASE_BATTLE,0,1)");
  expect(script).toContain("e3:SetCode(EVENT_PHASE|PHASE_BATTLE)");
  expect(script).toContain("aux.NecroValleyFilter(s.spfilter)");
  expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");
}

function prepareMainPhase(session: DuelSession): void {
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
}

function registerRedBaron(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(redBaronCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
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
