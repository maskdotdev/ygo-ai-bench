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
const servicePuppetCode = "36400569";
const ownGimmickXyzCode = "364005690";
const opponentTargetCode = "364005691";
const graveXyzCode = "364005692";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasServicePuppetScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${servicePuppetCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceMachine = 0x20;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const setGimmickPuppet = 0x1083;
const eventFreeChain = 1002;

describe.skipIf(!hasUpstreamScripts || !hasServicePuppetScript)("Lua real script Service Puppet Play control grave summon", () => {
  it("restores activation that targets opponent monsters up to Gimmick Puppet Xyz count and takes control", () => {
    const { workspace, reader, session } = createFixture(36400569);
    expectScriptShape(workspace.readScript(`official/c${servicePuppetCode}.lua`) ?? "");
    const servicePuppet = requireCard(session, servicePuppetCode);
    const ownGimmickXyz = requireCard(session, ownGimmickXyzCode);
    const opponentTarget = requireCard(session, opponentTargetCode);
    const setTrap = moveDuelCard(session.state, servicePuppet.uid, "spellTrapZone", 0);
    setTrap.faceUp = false;
    setTrap.position = "faceDown";
    setTrap.turnId = 0;
    moveFaceUpAttack(session, ownGimmickXyz, 0);
    moveFaceUpAttack(session, opponentTarget, 1);
    prepareMainPhase(session);
    registerServicePuppet(session, workspace);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activate = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === servicePuppet.uid && action.effectId === `lua-1-${eventFreeChain}`);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activate!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === opponentTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: servicePuppet.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "controlChanged" && event.eventCardUid === opponentTarget.uid)).toEqual([
      expect.objectContaining({
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: servicePuppet.uid,
        eventReasonEffectId: 1,
        eventPreviousState: expect.objectContaining({ controller: 1, location: "monsterZone" }),
        eventCurrentState: expect.objectContaining({ controller: 0, location: "monsterZone" }),
      }),
    ]);
  });

  it("restores graveyard SelfBanish Quick Effect into SelectEffect opponent-field Xyz summon", () => {
    const { workspace, reader, session } = createFixture(36400570);
    const servicePuppet = requireCard(session, servicePuppetCode);
    const ownGimmickXyz = requireCard(session, ownGimmickXyzCode);
    const graveXyz = requireCard(session, graveXyzCode);
    const graveTrap = moveDuelCard(session.state, servicePuppet.uid, "graveyard", 0);
    graveTrap.faceUp = true;
    graveTrap.turnId = 0;
    moveFaceUpAttack(session, ownGimmickXyz, 0);
    moveDuelCard(session.state, graveXyz.uid, "graveyard", 1).faceUp = true;
    prepareMainPhase(session);
    registerServicePuppet(session, workspace);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, {
      promptOverrides: [{ api: "SelectEffect", player: 0, returned: 2 }],
    });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const summon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === servicePuppet.uid && action.effectId === `lua-2-${eventFreeChain}`);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, summon!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.host.promptDecisions.filter((prompt) => prompt.api === "SelectEffect").map((prompt) => ({
      api: prompt.api,
      player: prompt.player,
      returned: prompt.returned,
    }))).toEqual([{ api: "SelectEffect", player: 0, returned: 2 }]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === servicePuppet.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: servicePuppet.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === graveXyz.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      faceUp: true,
      position: "faceUpDefense",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: servicePuppet.uid,
      reasonEffectId: 2,
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
  loadDecks(session, {
    0: { main: [servicePuppetCode, ownGimmickXyzCode] },
    1: { main: [opponentTargetCode], extra: [graveXyzCode] },
  });
  startDuel(session);
  return { workspace, reader, session };
}

function cards(): DuelCardData[] {
  return [
    { code: servicePuppetCode, name: "Service Puppet Play", kind: "trap", typeFlags: typeTrap },
    { code: ownGimmickXyzCode, name: "Service Puppet Gimmick Puppet Xyz", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceMachine, attribute: attributeDark, level: 4, attack: 2200, defense: 1000, setcodes: [setGimmickPuppet] },
    { code: opponentTargetCode, name: "Service Puppet Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1700, defense: 1000 },
    { code: graveXyzCode, name: "Service Puppet Grave Xyz", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceMachine, attribute: attributeDark, level: 4, attack: 2000, defense: 1000 },
  ];
}

function expectScriptShape(script: string): void {
  expect(script).toContain("Service Puppet Play");
  expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
  expect(script).toContain("Duel.GetMatchingGroupCount(s.gpxyzfilter,tp,LOCATION_MZONE,0,nil)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsControlerCanBeChanged,tp,0,LOCATION_MZONE,1,ct,nil)");
  expect(script).toContain("Duel.GetControl(tg,tp,PHASE_END,1)");
  expect(script).toContain("e2:SetCondition(function(e,tp) return aux.exccon(e)");
  expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
  expect(script).toContain("Duel.SelectEffect(tp,");
  expect(script).toContain("Duel.SpecialSummon(tc,0,tp,target_player,false,false,POS_FACEUP_DEFENSE)");
}

function prepareMainPhase(session: DuelSession): void {
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
}

function registerServicePuppet(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(servicePuppetCode), workspace).ok).toBe(true);
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
