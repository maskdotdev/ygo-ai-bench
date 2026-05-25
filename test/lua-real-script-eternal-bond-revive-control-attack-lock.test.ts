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
const eternalBondCode = "45283341";
const photonOneCode = "452833410";
const photonTwoCode = "452833411";
const opponentPhotonCode = "452833412";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasEternalBondScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${eternalBondCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const setPhoton = 0x55;
const eventFreeChain = 1002;
const effectCannotAttack = 85;
const effectSetAttackFinal = 102;

describe.skipIf(!hasUpstreamScripts || !hasEternalBondScript)("Lua real script Eternal Bond revive control attack lock", () => {
  it("restores activation that targets and revives Photon monsters from the graveyard with disabled effects", () => {
    const { workspace, reader, session } = createFixture(45283341);
    expectScriptShape(workspace.readScript(`official/c${eternalBondCode}.lua`));
    const eternalBond = requireCard(session, eternalBondCode);
    const photonOne = requireCard(session, photonOneCode);
    const photonTwo = requireCard(session, photonTwoCode);
    const setBond = moveDuelCard(session.state, eternalBond.uid, "spellTrapZone", 0);
    setBond.position = "faceDown";
    setBond.faceUp = false;
    setBond.turnId = 0;
    moveDuelCard(session.state, photonOne.uid, "graveyard", 0).faceUp = true;
    moveDuelCard(session.state, photonTwo.uid, "graveyard", 0).faceUp = true;
    prepareMainPhase(session);
    registerEternalBond(session, workspace);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === eternalBond.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: 0x200, code: eventFreeChain, event: "quick", id: `lua-1-${eventFreeChain}`, property: 0x10, range: ["spellTrapZone"] },
      { category: 0x2000, code: eventFreeChain, event: "quick", id: `lua-2-${eventFreeChain}`, property: 0x10, range: ["graveyard"] },
    ]);

    const activate = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === eternalBond.uid && action.effectId === `lua-1-${eventFreeChain}`);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activate!);
    resolveRestoredChain(restoredOpen);

    for (const photon of [photonOne, photonTwo]) {
      expect(restoredOpen.session.state.cards.find((card) => card.uid === photon.uid)).toMatchObject({
        location: "monsterZone",
        controller: 0,
        faceUp: true,
        summonType: "special",
        reason: duelReason.summon | duelReason.specialSummon,
        reasonPlayer: 0,
        reasonCardUid: eternalBond.uid,
        reasonEffectId: 1,
      });
    }
  });

  it("restores graveyard SelfBanish Quick Effect into Photon control, attack lock, and final ATK", () => {
    const { workspace, reader, session } = createFixture(45283342);
    const eternalBond = requireCard(session, eternalBondCode);
    const photonOne = requireCard(session, photonOneCode);
    const photonTwo = requireCard(session, photonTwoCode);
    const opponentPhoton = requireCard(session, opponentPhotonCode);
    moveDuelCard(session.state, eternalBond.uid, "graveyard", 0).faceUp = true;
    moveFaceUpAttack(session, photonOne, 0);
    moveFaceUpAttack(session, photonTwo, 0);
    moveFaceUpAttack(session, opponentPhoton, 1);
    prepareMainPhase(session);
    registerEternalBond(session, workspace);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const control = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === eternalBond.uid && action.effectId === `lua-2-${eventFreeChain}`);
    expect(control, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, control!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === eternalBond.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: eternalBond.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === opponentPhoton.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: eternalBond.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === opponentPhoton.uid), restoredOpen.session.state)).toBe(6300);
    expect(restoredOpen.session.state.effects.filter((effect) => [effectCannotAttack, effectSetAttackFinal].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual(expect.arrayContaining([
      { code: effectCannotAttack, sourceUid: eternalBond.uid, targetRange: [4, 0], value: undefined },
      { code: effectSetAttackFinal, sourceUid: opponentPhoton.uid, targetRange: undefined, value: 6300 },
    ]));
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
    0: { main: [eternalBondCode, photonOneCode, photonTwoCode] },
    1: { main: [opponentPhotonCode] },
  });
  startDuel(session);
  return { workspace, reader, session };
}

function cards(): DuelCardData[] {
  return [
    { code: eternalBondCode, name: "Eternal Bond", kind: "trap", typeFlags: typeTrap, setcodes: [setPhoton] },
    { code: photonOneCode, name: "Eternal Bond Photon One", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 2000, defense: 1000, setcodes: [setPhoton] },
    { code: photonTwoCode, name: "Eternal Bond Photon Two", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 2500, defense: 1000, setcodes: [setPhoton] },
    { code: opponentPhotonCode, name: "Eternal Bond Opponent Photon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1800, defense: 1000, setcodes: [setPhoton] },
  ];
}

function expectScriptShape(script: string): void {
  expect(script).toContain("Eternal Bond");
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("Duel.IsPlayerAffectedByEffect(tp,CARD_BLUEEYES_SPIRIT)");
  expect(script).toContain("Duel.GetTargetCards(e)");
  expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e1:SetCode(EFFECT_DISABLE)");
  expect(script).toContain("e2:SetCode(EFFECT_DISABLE_EFFECT)");
  expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
  expect(script).toContain("Duel.GetControl(tc,tp)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_ATTACK)");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsSetCard,tp,LOCATION_MZONE,0,nil,SET_PHOTON):GetSum(Card.GetBaseAttack)");
  expect(script).toContain("e2:SetCode(EFFECT_SET_ATTACK_FINAL)");
}

function prepareMainPhase(session: DuelSession): void {
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
}

function registerEternalBond(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(eternalBondCode), workspace).ok).toBe(true);
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
