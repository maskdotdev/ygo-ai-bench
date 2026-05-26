import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const adventCode = "53008933";
const sarcophagusCode = "79791878";
const allyCode = "530089331";
const targetCode = "530089332";
const noSarcTargetCode = "530089333";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasAdventScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${adventCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeContinuous = 0x20000;
const raceFiend = 0x8;
const attributeDark = 0x20;
const categoryControl = 0x2000;
const effectCannotAttack = 85;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasAdventScript)("Lua real script Archfiend's Advent summon control stat", () => {
  it("restores Shining Sarcophagus no-tribute summon into control and turn-player ally ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${adventCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createSession(reader, workspace);
    const advent = requireCard(session, adventCode);
    const sarcophagus = requireCard(session, sarcophagusCode);
    const ally = requireCard(session, allyCode);
    const target = requireCard(session, targetCode);
    moveDuelCard(session.state, advent.uid, "hand", 0);
    moveDuelCard(session.state, sarcophagus.uid, "spellTrapZone", 0);
    sarcophagus.faceUp = true;
    moveFaceUpAttack(session, ally, 0, 0);
    moveFaceUpAttack(session, target, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const restoredSummon = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    expect(currentAttack(requireCard(restoredSummon.session, allyCode), restoredSummon.session.state)).toBe(1300);
    expect(restoredSummon.session.state.effects.filter((effect) => effect.sourceUid === advent.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { category: undefined, code: 32, event: "continuous", id: "lua-1-32", property: undefined, range: ["hand"], targetRange: undefined, value: undefined },
      { category: categoryControl, code: 1100, event: "trigger", id: "lua-2-1100", property: 0x10010, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], targetRange: undefined, value: undefined },
      { category: categoryControl, code: 1102, event: "trigger", id: "lua-3-1102", property: 0x10010, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], targetRange: undefined, value: undefined },
      { category: undefined, code: effectUpdateAttack, event: "continuous", id: "lua-4-100", property: undefined, range: ["monsterZone"], targetRange: [4, 0], value: 500 },
    ]);
    const summon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) => action.type === "tributeSummon" && action.uid === advent.uid && action.effectId === "lua-1-32");
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summon!);
    expect(currentAttack(requireCard(restoredSummon.session, allyCode), restoredSummon.session.state)).toBe(1800);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === advent.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: advent.uid,
      reasonEffectId: 2,
    });
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === target.uid && effect.code === effectCannotAttack)).toEqual([]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["normalSummoned", "becameTarget", "controlChanged"].includes(event.eventName))).toMatchInlineSnapshot(`
      [
        {
          "eventCardUid": "p0-deck-53008933-0",
          "eventCode": 1100,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 1,
          },
          "eventName": "normalSummoned",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "hand",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 16,
          "eventReasonPlayer": 0,
        },
        {
          "eventCardUid": "p1-deck-530089332-0",
          "eventChainDepth": 1,
          "eventChainLinkId": "chain-4",
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
            "sequence": 1,
          },
          "eventReason": 0,
          "eventReasonPlayer": 0,
          "relatedEffectId": 2,
        },
        {
          "eventCardUid": "p1-deck-530089332-0",
          "eventCode": 1120,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 2,
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
          "eventReasonCardUid": "p0-deck-53008933-0",
          "eventReasonEffectId": 2,
          "eventReasonPlayer": 0,
        },
      ]
    `);
  });

  it("restores the no-Sarcophagus control branch that prevents the taken monster from attacking", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const reader = createCardReader(cards());
    const session = createSession(reader, workspace);
    const advent = requireCard(session, adventCode);
    const target = requireCard(session, noSarcTargetCode);
    moveDuelCard(session.state, advent.uid, "hand", 0);
    moveFaceUpAttack(session, target, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;
    specialSummonDuelCard(session.state, advent.uid, 0);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === advent.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: advent.uid,
      reasonEffectId: 3,
    });
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === target.uid && effect.code === effectCannotAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectCannotAttack, event: "continuous", property: 0x4000000, reset: { flags: 66981888 }, sourceUid: target.uid, value: undefined },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["specialSummoned", "becameTarget", "controlChanged"].includes(event.eventName))).toMatchInlineSnapshot(`
      [
        {
          "eventCardUid": "p0-deck-53008933-0",
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
            "location": "hand",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 2064,
          "eventReasonPlayer": 0,
        },
        {
          "eventCardUid": "p1-deck-530089333-1",
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
          "relatedEffectId": 3,
        },
        {
          "eventCardUid": "p1-deck-530089333-1",
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
          "eventReasonCardUid": "p0-deck-53008933-0",
          "eventReasonEffectId": 3,
          "eventReasonPlayer": 0,
        },
      ]
    `);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Archfiend's Advent");
  expect(script).toContain("e1:SetCode(EFFECT_SUMMON_PROC)");
  expect(script).toContain("Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsCode,CARD_SHINING_SARCOPHAGUS),tp,LOCATION_ONFIELD,0,1,nil)");
  expect(script).toContain("e2:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsControlerCanBeChanged,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("e:SetLabel(Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsCode,CARD_SHINING_SARCOPHAGUS),tp,LOCATION_ONFIELD,0,1,nil) and 1 or 0)");
  expect(script).toContain("Duel.GetControl(tc,tp,PHASE_END,1)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_ATTACK)");
  expect(script).toContain("e4:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e4:SetValue(500)");
}

function cards(): DuelCardData[] {
  return [
    { code: adventCode, name: "Archfiend's Advent", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 6, attack: 2500, defense: 1200 },
    { code: sarcophagusCode, name: "Shining Sarcophagus", kind: "spell", typeFlags: typeSpell | typeContinuous },
    { code: allyCode, name: "Archfiend's Advent Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1300, defense: 1000 },
    { code: targetCode, name: "Archfiend's Advent Control Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1700, defense: 1000 },
    { code: noSarcTargetCode, name: "Archfiend's Advent Locked Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1800, defense: 1000 },
  ];
}

function createSession(reader: ReturnType<typeof createCardReader>, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelSession {
  const session = createDuel({ seed: 53008933, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [adventCode, sarcophagusCode, allyCode] }, 1: { main: [targetCode, noSarcTargetCode] } });
  startDuel(session);
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(adventCode), workspace).ok).toBe(true);
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
