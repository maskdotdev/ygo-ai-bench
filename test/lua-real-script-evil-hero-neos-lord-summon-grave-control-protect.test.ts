import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { collectDuelTriggerEffects, createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, sendDuelCardToGraveyard, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const neosLordCode = "13708888";
const summonTargetCode = "137088881";
const graveTriggerCostCode = "137088882";
const graveTriggerTargetCode = "137088883";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasNeosLordScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${neosLordCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const raceFiend = 0x8;
const attributeDark = 0x20;
const categoryControl = 0x2000;
const effectIndestructibleEffect = 41;
const effectIndestructibleBattle = 42;

describe.skipIf(!hasUpstreamScripts || !hasNeosLordScript)("Lua real script Evil HERO Neos Lord summon grave control protect", () => {
  it("restores Special Summon face-up control trigger and permanent destruction protection", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${neosLordCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createSession(reader, workspace);
    const neosLord = requireCard(session, neosLordCode);
    const target = requireCard(session, summonTargetCode);
    moveFaceUpAttack(session, target, 1, 0);
    moveFaceUpAttack(session, neosLord, 0, 0);
    neosLord.reason = duelReason.summon | duelReason.specialSummon;
    neosLord.reasonPlayer = 0;
    neosLord.summonType = "special";
    neosLord.summonPlayer = 0;
    collectDuelTriggerEffects(session.state, "specialSummoned", neosLord);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === neosLord.uid && effect.code !== undefined && [1102, 1014, effectIndestructibleBattle, effectIndestructibleEffect].includes(effect.code)).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { category: categoryControl, code: 1102, event: "trigger", id: "lua-4-1102", property: 0x10010, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], targetRange: undefined, value: undefined },
      { category: categoryControl, code: 1014, event: "trigger", id: "lua-5-1014", property: 0x14010, range: ["monsterZone"], targetRange: undefined, value: undefined },
      { category: undefined, code: effectIndestructibleBattle, event: "continuous", id: "lua-6-42", property: 0x20000, range: ["monsterZone"], targetRange: undefined, value: 1 },
      { category: undefined, code: effectIndestructibleEffect, event: "continuous", id: "lua-7-41", property: 0x20000, range: ["monsterZone"], targetRange: undefined, value: 1 },
    ]);
    expect(destroyDuelCard(restoredTrigger.session.state, neosLord.uid, 0, duelReason.effect | duelReason.destroy, 1)).toMatchObject({
      location: "monsterZone",
      controller: 0,
    });
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === neosLord.uid && action.effectId === "lua-4-1102");
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: neosLord.uid,
      reasonEffectId: 4,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["specialSummoned", "becameTarget", "controlChanged"].includes(event.eventName))).toMatchInlineSnapshot(`
      [
        {
          "eventCardUid": "p0-extraDeck-13708888-0",
          "eventCode": 1102,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "specialSummoned",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "extraDeck",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 2064,
          "eventReasonPlayer": 0,
        },
        {
          "eventCardUid": "p1-deck-137088881-0",
          "eventChainDepth": 1,
          "eventChainLinkId": "chain-3",
          "eventCode": 1028,
          "eventCurrentState": {
            "controller": 1,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "becameTarget",
          "eventPreviousState": {
            "controller": 1,
            "faceUp": false,
            "location": "deck",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 0,
          "eventReasonPlayer": 0,
          "eventValue": 1,
          "relatedEffectId": 4,
        },
        {
          "eventCardUid": "p1-deck-137088881-0",
          "eventCode": 1120,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 1,
          },
          "eventName": "controlChanged",
          "eventPreviousState": {
            "controller": 1,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventReason": 64,
          "eventReasonCardUid": "p0-extraDeck-13708888-0",
          "eventReasonEffectId": 4,
          "eventReasonPlayer": 0,
        },
      ]
    `);
  });

  it("restores simultaneous EVENT_TO_GRAVE opponent monster trigger into a second control take", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const reader = createCardReader(cards());
    const session = createSession(reader, workspace);
    const neosLord = requireCard(session, neosLordCode);
    const graveCost = requireCard(session, graveTriggerCostCode);
    const target = requireCard(session, graveTriggerTargetCode);
    moveFaceUpAttack(session, neosLord, 0, 0);
    moveFaceUpAttack(session, graveCost, 1, 0);
    moveFaceUpAttack(session, target, 1, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;
    sendDuelCardToGraveyard(session.state, graveCost.uid, 1, duelReason.effect, 1);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === neosLord.uid && action.effectId === "lua-5-1014");
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: neosLord.uid,
      reasonEffectId: 5,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["sentToGraveyard", "becameTarget", "controlChanged"].includes(event.eventName))).toMatchInlineSnapshot(`
      [
        {
          "eventCardUid": "p1-deck-137088882-1",
          "eventCode": 1014,
          "eventCurrentState": {
            "controller": 1,
            "faceUp": true,
            "location": "graveyard",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "sentToGraveyard",
          "eventPreviousState": {
            "controller": 1,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventReason": 64,
          "eventReasonPlayer": 1,
        },
        {
          "eventCardUid": "p1-deck-137088883-2",
          "eventChainDepth": 1,
          "eventChainLinkId": "chain-3",
          "eventCode": 1028,
          "eventCurrentState": {
            "controller": 1,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 1,
          },
          "eventName": "becameTarget",
          "eventPreviousState": {
            "controller": 1,
            "faceUp": false,
            "location": "deck",
            "position": "faceDown",
            "sequence": 1,
          },
          "eventReason": 0,
          "eventReasonPlayer": 0,
          "eventValue": 1,
          "relatedEffectId": 5,
        },
        {
          "eventCardUid": "p1-deck-137088883-2",
          "eventCode": 1120,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 1,
          },
          "eventName": "controlChanged",
          "eventPreviousState": {
            "controller": 1,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 1,
          },
          "eventReason": 64,
          "eventReasonCardUid": "p0-extraDeck-13708888-0",
          "eventReasonEffectId": 5,
          "eventReasonPlayer": 0,
        },
      ]
    `);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Evil HERO Neos Lord");
  expect(script).toContain("Fusion.AddProcMix(c,true,true,{CARD_NEOS,s.neosfusionmatfilter},s.effectmatfilter)");
  expect(script).toContain("c:AddMustBeSpecialSummonedByDarkFusion()");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("EFFECT_FLAG2_CHECK_SIMULTANEOUS");
  expect(script).toContain("return eg:IsExists(s.ctrlconfilter,1,nil,tp)");
  expect(script).toContain("Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsControlerCanBeChanged),tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.GetControl(tc,tp)");
  expect(script).toContain("e3:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e4:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: neosLordCode, name: "Evil HERO Neos Lord", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceFiend, attribute: attributeDark, level: 10, attack: 2500, defense: 2500 },
    { code: summonTargetCode, name: "Neos Lord Summon Control Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1700, defense: 1200 },
    { code: graveTriggerCostCode, name: "Neos Lord Grave Trigger Opponent Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: graveTriggerTargetCode, name: "Neos Lord Grave Control Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1800, defense: 1300 },
  ];
}

function createSession(reader: ReturnType<typeof createCardReader>, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelSession {
  const session = createDuel({ seed: 13708888, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [], extra: [neosLordCode] }, 1: { main: [summonTargetCode, graveTriggerCostCode, graveTriggerTargetCode] } });
  startDuel(session);
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(neosLordCode), workspace).ok).toBe(true);
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
  const waitingFor = restored.session.state.waitingFor;
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
