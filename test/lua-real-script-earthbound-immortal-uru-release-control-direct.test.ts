import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelEventRecord, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const uruCode = "15187079";
const releaseCostCode = "151870790";
const opponentTargetCode = "151870791";
const fieldSpellCode = "151870792";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUruScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${uruCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeField = 0x80000;
const raceInsect = 0x800;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const setEarthboundImmortal = 0x21;
const categoryControl = 0x2000;
const effectCannotBeBattleTarget = 70;
const effectDirectAttack = 74;
const effectSelfDestroy = 141;

describe.skipIf(!hasUpstreamScripts || !hasUruScript)("Lua real script Earthbound Immortal Uru release control direct", () => {
  it("restores Field Spell-gated static effects and ReleaseCheckTarget control take", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${uruCode}.lua`);
    expectScriptShape(script ?? "");
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 15187079, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [uruCode, releaseCostCode, fieldSpellCode] }, 1: { main: [opponentTargetCode] } });
    startDuel(session);
    const uru = requireCard(session, uruCode);
    const releaseCost = requireCard(session, releaseCostCode);
    const opponent = requireCard(session, opponentTargetCode);
    const fieldSpell = requireCard(session, fieldSpellCode);
    moveFaceUpAttack(session, uru, 0, 0);
    moveFaceUpAttack(session, releaseCost, 0, 1);
    const field = moveDuelCard(session.state, fieldSpell.uid, "spellTrapZone", 0);
    field.sequence = 5;
    field.faceUp = true;
    moveFaceUpAttack(session, opponent, 1, 0);
    prepareMainPhase(session);
    registerUru(session, workspace);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === uru.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      value: effect.value,
    }))).toEqual([
      { category: undefined, code: effectSelfDestroy, countLimit: undefined, event: "continuous", id: "lua-1-141", property: 0x20000, range: ["monsterZone"], value: undefined },
      { category: undefined, code: effectCannotBeBattleTarget, countLimit: undefined, event: "continuous", id: "lua-2-70", property: 0x20000, range: ["monsterZone"], value: undefined },
      { category: undefined, code: effectDirectAttack, countLimit: undefined, event: "continuous", id: "lua-3-74", property: undefined, range: ["monsterZone"], value: undefined },
      { category: categoryControl, code: undefined, countLimit: 1, event: "ignition", id: "lua-4", property: 0x10, range: ["monsterZone"], value: undefined },
    ]);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === uru.uid && action.effectId === "lua-4");
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === releaseCost.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: uru.uid,
      reasonEffectId: 4,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === opponent.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: uru.uid,
      reasonEffectId: 4,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["released", "sentToGraveyard", "becameTarget", "controlChanged"].includes(event.eventName)).map(eventSummary)).toMatchInlineSnapshot(`
      [
        {
          "current": "graveyard",
          "currentController": 0,
          "eventCardUid": "p0-deck-151870790-1",
          "eventCode": 1017,
          "eventName": "released",
          "eventReason": 130,
          "eventReasonCardUid": "p0-deck-15187079-0",
          "eventReasonEffectId": 4,
          "eventReasonPlayer": 0,
          "previous": "monsterZone",
          "previousController": 0,
        },
        {
          "current": "graveyard",
          "currentController": 0,
          "eventCardUid": "p0-deck-151870790-1",
          "eventCode": 1014,
          "eventName": "sentToGraveyard",
          "eventReason": 130,
          "eventReasonCardUid": "p0-deck-15187079-0",
          "eventReasonEffectId": 4,
          "eventReasonPlayer": 0,
          "previous": "monsterZone",
          "previousController": 0,
        },
        {
          "current": "monsterZone",
          "currentController": 1,
          "eventCardUid": "p1-deck-151870791-0",
          "eventCode": 1028,
          "eventName": "becameTarget",
          "eventReason": 0,
          "eventReasonCardUid": undefined,
          "eventReasonEffectId": undefined,
          "eventReasonPlayer": 0,
          "previous": "deck",
          "previousController": 1,
        },
        {
          "current": "monsterZone",
          "currentController": 0,
          "eventCardUid": "p1-deck-151870791-0",
          "eventCode": 1120,
          "eventName": "controlChanged",
          "eventReason": 64,
          "eventReasonCardUid": "p0-deck-15187079-0",
          "eventReasonEffectId": 4,
          "eventReasonPlayer": 0,
          "previous": "monsterZone",
          "previousController": 1,
        },
      ]
    `);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: uruCode, name: "Earthbound Immortal Uru", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceInsect, attribute: attributeDark, setcodes: [setEarthboundImmortal], level: 10, attack: 3000, defense: 3000 },
    { code: releaseCostCode, name: "Earthbound Immortal Uru Release Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceInsect, attribute: attributeDark, level: 4, attack: 1200, defense: 1200 },
    { code: opponentTargetCode, name: "Earthbound Immortal Uru Control Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1800, defense: 1000 },
    { code: fieldSpellCode, name: "Earthbound Immortal Uru Field Spell", kind: "spell", typeFlags: typeSpell | typeField },
  ];
}

function expectScriptShape(script: string): void {
  expect(script).toContain("--Earthbound Immortal Uru");
  expect(script).toContain("c:SetUniqueOnField(1,1,aux.FilterBoolFunction(Card.IsSetCard,SET_EARTHBOUND_IMMORTAL),LOCATION_MZONE)");
  expect(script).toContain("e1:SetCode(EFFECT_SELF_DESTROY)");
  expect(script).toContain("return not Duel.IsExistingMatchingCard(Card.IsFaceup,0,LOCATION_FZONE,LOCATION_FZONE,1,nil)");
  expect(script).toContain("e2:SetCode(EFFECT_CANNOT_BE_BATTLE_TARGET)");
  expect(script).toContain("e2:SetValue(aux.imval2)");
  expect(script).toContain("e3:SetCode(EFFECT_DIRECT_ATTACK)");
  expect(script).toContain("Duel.CheckReleaseGroupCost(tp,nil,1,false,aux.ReleaseCheckTarget,e:GetHandler(),dg)");
  expect(script).toContain("Duel.SelectReleaseGroupCost(tp,nil,1,1,false,aux.ReleaseCheckTarget,e:GetHandler(),dg)");
  expect(script).toContain("Duel.Release(g,REASON_COST)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.GetControl(tc,tp,PHASE_END,1)");
}

function registerUru(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(uruCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function prepareMainPhase(session: DuelSession): void {
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
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

function eventSummary(event: DuelEventRecord) {
  return {
    eventName: event.eventName,
    eventCode: event.eventCode,
    eventCardUid: event.eventCardUid,
    eventReason: event.eventReason,
    eventReasonPlayer: event.eventReasonPlayer,
    eventReasonCardUid: event.eventReasonCardUid,
    eventReasonEffectId: event.eventReasonEffectId,
    previous: event.eventPreviousState?.location,
    current: event.eventCurrentState?.location,
    previousController: event.eventPreviousState?.controller,
    currentController: event.eventCurrentState?.controller,
  };
}
