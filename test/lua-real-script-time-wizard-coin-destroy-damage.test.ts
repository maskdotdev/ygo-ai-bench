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
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const timeWizardCode = "71625222";
const allyCode = "716252220";
const opponentCode = "716252221";
const hasTimeWizardScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${timeWizardCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const categoryDestroy = 0x1;
const categoryDamage = 0x80000;
const categoryCoin = 0x1000000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasTimeWizardScript)("Lua real script Time Wizard coin destroy damage", () => {
  it("restores tails CallCoin into own-field destruction and half previous-ATK damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${timeWizardCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 1, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [timeWizardCode, allyCode] }, 1: { main: [opponentCode] } });
    startDuel(session);

    const timeWizard = requireCard(session, timeWizardCode);
    const ally = requireCard(session, allyCode);
    const opponent = requireCard(session, opponentCode);
    moveFaceUpAttack(session, timeWizard, 0, 0);
    moveFaceUpAttack(session, ally, 0, 1);
    moveFaceUpAttack(session, opponent, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(timeWizardCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === timeWizard.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      range: effect.range,
    }))).toEqual([
      { category: categoryDestroy | categoryCoin | categoryDamage, code: undefined, countLimit: 1, event: "ignition", range: ["monsterZone"] },
    ]);

    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === timeWizard.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toEqual([]);

    expect(restoredOpen.session.state.lastCoinResults).toEqual([0]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === timeWizard.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: timeWizard.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === ally.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: timeWizard.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === opponent.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restoredOpen.session.state.players[0].lifePoints).toBe(6600);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["coinTossed", "destroyed", "damageDealt"].includes(event.eventName))).toEqual([
      {
        eventName: "coinTossed",
        eventCode: 1151,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: timeWizard.uid,
        eventReasonEffectId: 1,
      },
      destroyedEvent(timeWizard.uid, timeWizard.uid, 0, 0),
      destroyedEvent(ally.uid, timeWizard.uid, 0, 1),
      {
        ...destroyedEvent(timeWizard.uid, timeWizard.uid, 0, 0),
        eventUids: [timeWizard.uid, ally.uid],
      },
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 0,
        eventValue: 1400,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: timeWizard.uid,
        eventReasonEffectId: 1,
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Time Wizard");
  expect(script).toContain("e1:SetCategory(CATEGORY_DESTROY+CATEGORY_COIN+CATEGORY_DAMAGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
  expect(script).toContain("e1:SetCountLimit(1)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COIN,nil,0,tp,1)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,0,0)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_DAMAGE,nil,1,tp,0)");
  expect(script).toContain("if Duel.CallCoin(tp) then");
  expect(script).toContain("Duel.RaiseEvent(e:GetHandler(),EVENT_CUSTOM+id,e,0,0,tp,0)");
  expect(script).toContain("Duel.GetOperatedGroup():Filter(Card.IsPreviousPosition,nil,POS_FACEUP)");
  expect(script).toContain("local sum=dg:GetSum(Card.GetPreviousAttackOnField)");
  expect(script).toContain("Duel.Damage(tp,sum/2,REASON_EFFECT)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const timeWizard = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === timeWizardCode);
  expect(timeWizard).toBeDefined();
  return [
    timeWizard!,
    { code: allyCode, name: "Time Wizard Ally", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2300, defense: 1000 },
    { code: opponentCode, name: "Time Wizard Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1000 },
  ];
}

function destroyedEvent(cardUid: string, sourceUid: string, controller: PlayerId, sequence: number) {
  return {
    eventName: "destroyed",
    eventCode: 1029,
    eventCardUid: cardUid,
    eventReason: duelReason.effect | duelReason.destroy,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
    eventPreviousState: { controller, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence },
    eventCurrentState: { controller, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence },
  };
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
