import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const bottomlessCode = "29401950";
const hasBottomlessScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${bottomlessCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasBottomlessScript)("Lua real script Bottomless Trap Hole summon-success window", () => {
  it("restores Bottomless Trap Hole's summon-success event target and banishes the destroyed monster", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const starterCode = "870";
    const responderCode = "871";
    const summonedCode = "872";
    assertBottomlessScript(workspace);
    const cards: DuelCardData[] = [
      bottomlessTrapCard(),
      { code: starterCode, name: "Bottomless Chain Starter", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: responderCode, name: "Bottomless Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: summonedCode, name: "Bottomless Summoned Monster", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1500, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 462, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [summonedCode, starterCode, responderCode] }, 1: { main: [bottomlessCode] } });
    startDuel(session);

    const summoned = session.state.cards.find((card) => card.code === summonedCode);
    const starter = session.state.cards.find((card) => card.code === starterCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    const bottomless = session.state.cards.find((card) => card.code === bottomlessCode);
    expect(summoned).toBeDefined();
    expect(starter).toBeDefined();
    expect(responder).toBeDefined();
    expect(bottomless).toBeDefined();
    moveDuelCard(session.state, summoned!.uid, "hand", 0);
    moveDuelCard(session.state, starter!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 0);
    moveDuelCard(session.state, bottomless!.uid, "spellTrapZone", 1);
    bottomless!.position = "faceDown";
    bottomless!.faceUp = false;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return chainStarterScript();
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(bottomlessCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const summon = getLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeDefined();
    applyAndAssert(session, summon!);
    expect(session.state.cards.find((card) => card.uid === summoned!.uid)).toMatchObject({ location: "monsterZone", faceUp: true, position: "faceUpAttack" });

    const starterAction = getLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.uid === starter!.uid);
    expect(starterAction).toBeDefined();
    applyAndAssert(session, starterAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 1,
        "chainIndex": 1,
        "effectId": "lua-1-1100",
        "eventCardUid": "p0-deck-872-0",
        "eventCode": 1100,
        "eventCurrentState": {
          "controller": 0,
          "faceUp": true,
          "location": "monsterZone",
          "position": "faceUpAttack",
          "sequence": 0,
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
        "eventTriggerTiming": "when",
        "id": "chain-3",
        "player": 0,
        "sourceUid": "p0-deck-870-1",
      }
    `);

    const bottomlessAction = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === bottomless!.uid);
    expect(bottomlessAction).toBeDefined();
    applyAndAssert(session, bottomlessAction!);
    expect(session.state.chain).toHaveLength(2);
    expect(session.state.chain[1]).toMatchInlineSnapshot(`
      {
        "activationLocation": "spellTrapZone",
        "activationSequence": 0,
        "chainIndex": 2,
        "effectId": "lua-3-1100",
        "eventCardUid": "p0-deck-872-0",
        "eventCode": 1100,
        "eventCurrentState": {
          "controller": 0,
          "faceUp": true,
          "location": "monsterZone",
          "position": "faceUpAttack",
          "sequence": 0,
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
        "eventTriggerTiming": "when",
        "id": "chain-4",
        "operationInfos": [
          {
            "category": 1,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-872-0",
            ],
          },
          {
            "category": 4,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-872-0",
            ],
          },
        ],
        "player": 1,
        "sourceUid": "p1-deck-29401950-0",
        "targetUids": [
          "p0-deck-872-0",
        ],
      }
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.chain).toHaveLength(2);
    expect(restored.session.state.chain[1]).toMatchInlineSnapshot(`
      {
        "activationLocation": "spellTrapZone",
        "activationSequence": 0,
        "chainIndex": 2,
        "effectId": "lua-3-1100",
        "eventCardUid": "p0-deck-872-0",
        "eventCode": 1100,
        "eventCurrentState": {
          "controller": 0,
          "faceUp": true,
          "location": "monsterZone",
          "position": "faceUpAttack",
          "sequence": 0,
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
        "eventTriggerTiming": "when",
        "id": "chain-4",
        "operationInfos": [
          {
            "category": 1,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-872-0",
            ],
          },
          {
            "category": 4,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-872-0",
            ],
          },
        ],
        "player": 1,
        "sourceUid": "p1-deck-29401950-0",
        "targetUids": [
          "p0-deck-872-0",
        ],
      }
    `);

    const pass = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === summoned!.uid)).toMatchObject({ location: "banished" });
    expect(restored.session.state.cards.find((card) => card.uid === bottomless!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.host.messages).toContain("bottomless chain starter resolved");
    expect(restored.host.messages).not.toContain("bottomless chain responder resolved");
  });

  it("restores Bottomless Trap Hole's Flip Summon success chain response and banishes the destroyed monster", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const starterCode = "29401951";
    const flipTargetCode = "29401952";
    assertBottomlessScript(workspace);
    const cards: DuelCardData[] = [
      bottomlessTrapCard(),
      { code: starterCode, name: "Bottomless Flip Chain Starter", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: flipTargetCode, name: "Bottomless Flip Summoned Monster", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1500, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 464, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [flipTargetCode, starterCode] }, 1: { main: [bottomlessCode] } });
    startDuel(session);

    const flipTarget = session.state.cards.find((card) => card.code === flipTargetCode);
    const starter = session.state.cards.find((card) => card.code === starterCode);
    const bottomless = session.state.cards.find((card) => card.code === bottomlessCode);
    expect(flipTarget).toBeDefined();
    expect(starter).toBeDefined();
    expect(bottomless).toBeDefined();
    moveDuelCard(session.state, flipTarget!.uid, "monsterZone", 0).position = "faceDownDefense";
    flipTarget!.faceUp = false;
    moveDuelCard(session.state, starter!.uid, "hand", 0);
    moveDuelCard(session.state, bottomless!.uid, "spellTrapZone", 1);
    bottomless!.position = "faceDown";
    bottomless!.faceUp = false;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return flipSummonChainStarterScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(bottomlessCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const flip = getLegalActions(session, 0).find((action) => action.type === "flipSummon" && action.uid === flipTarget!.uid);
    expect(flip, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, flip!);

    const starterAction = getLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.uid === starter!.uid);
    expect(starterAction).toBeDefined();
    applyAndAssert(session, starterAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1101",
        "eventCardUid": "p0-deck-29401952-0",
        "eventCode": 1101,
        "eventCurrentState": {
          "controller": 0,
          "faceUp": true,
          "location": "monsterZone",
          "position": "faceUpAttack",
          "sequence": 0,
        },
        "eventName": "flipSummoned",
        "eventPreviousState": {
          "controller": 0,
          "faceUp": false,
          "location": "deck",
          "position": "faceDown",
          "sequence": 1,
        },
        "eventReason": 0,
        "eventReasonPlayer": 0,
        "eventTriggerTiming": "when",
        "id": "chain-3",
        "player": 0,
        "sourceUid": "p0-deck-29401951-1",
      }
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const bottomlessAction = getLuaRestoreLegalActions(restored, 1).find(
      (action): action is Extract<DuelAction, { type: "activateEffect" }> => action.type === "activateEffect" && action.uid === bottomless!.uid,
    );
    expect(bottomlessAction, JSON.stringify(getLuaRestoreLegalActions(restored, 1), null, 2)).toBeDefined();
    expect(bottomlessAction?.type).toBe("activateEffect");
    expect(bottomlessAction?.uid).toBe(bottomless!.uid);
    expect(bottomlessAction?.effectId).toContain("-1101");
    expect(bottomlessAction?.windowKind).toBe("chainResponse");
    const activated = applyLuaRestoreResponse(restored, bottomlessAction!);
    expect(activated.ok, activated.error).toBe(true);

    expect(restored.session.state.chain).toHaveLength(0);
    expect(restored.session.state.cards.find((card) => card.uid === flipTarget!.uid)).toMatchObject({ location: "banished" });
    expect(restored.session.state.cards.find((card) => card.uid === bottomless!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "flipSummoned")).toMatchInlineSnapshot(`
      [
        {
          "eventCardUid": "p0-deck-29401952-0",
          "eventCode": 1101,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "flipSummoned",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "deck",
            "position": "faceDown",
            "sequence": 1,
          },
          "eventReason": 0,
          "eventReasonPlayer": 0,
        },
      ]
    `);
    expect(restored.host.messages).toContain("bottomless flip chain starter resolved");
  });

  it("restores Bottomless Trap Hole's special-summon group target and banishes every eligible monster", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const specialStarterCode = "873";
    const triggerStarterCode = "874";
    const responderCode = "875";
    const firstSummonedCode = "876";
    const secondSummonedCode = "877";
    assertBottomlessScript(workspace);
    const cards: DuelCardData[] = [
      bottomlessTrapCard(),
      { code: specialStarterCode, name: "Bottomless Special Summon Starter", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: triggerStarterCode, name: "Bottomless Special Trigger Starter", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: responderCode, name: "Bottomless Special Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: firstSummonedCode, name: "Bottomless First Special Summoned Monster", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1500, defense: 1200 },
      { code: secondSummonedCode, name: "Bottomless Second Special Summoned Monster", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1700, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 463, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [specialStarterCode, triggerStarterCode, responderCode, firstSummonedCode, secondSummonedCode] }, 1: { main: [bottomlessCode] } });
    startDuel(session);

    const specialStarter = session.state.cards.find((card) => card.code === specialStarterCode);
    const triggerStarter = session.state.cards.find((card) => card.code === triggerStarterCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    const firstSummoned = session.state.cards.find((card) => card.code === firstSummonedCode);
    const secondSummoned = session.state.cards.find((card) => card.code === secondSummonedCode);
    const bottomless = session.state.cards.find((card) => card.code === bottomlessCode);
    expect(specialStarter).toBeDefined();
    expect(triggerStarter).toBeDefined();
    expect(responder).toBeDefined();
    expect(firstSummoned).toBeDefined();
    expect(secondSummoned).toBeDefined();
    expect(bottomless).toBeDefined();
    moveDuelCard(session.state, specialStarter!.uid, "hand", 0);
    moveDuelCard(session.state, triggerStarter!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 0);
    moveDuelCard(session.state, firstSummoned!.uid, "hand", 0);
    moveDuelCard(session.state, secondSummoned!.uid, "hand", 0);
    moveDuelCard(session.state, bottomless!.uid, "spellTrapZone", 1);
    bottomless!.position = "faceDown";
    bottomless!.faceUp = false;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${specialStarterCode}.lua`) return specialSummonGroupScript(firstSummonedCode, secondSummonedCode);
        if (name === `c${triggerStarterCode}.lua`) return specialSummonChainStarterScript();
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(bottomlessCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(specialStarterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(triggerStarterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);

    const specialSummonAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === specialStarter!.uid);
    expect(specialSummonAction).toBeDefined();
    applyAndAssert(session, specialSummonAction!);
    resolveChainWithPasses(session);
    expect(host.messages).toContain("bottomless special summon starter resolved 2");
    expect(session.state.cards.find((card) => card.uid === firstSummoned!.uid)).toMatchObject({ location: "monsterZone", faceUp: true, position: "faceUpAttack", summonPlayer: 0 });
    expect(session.state.cards.find((card) => card.uid === secondSummoned!.uid)).toMatchObject({ location: "monsterZone", faceUp: true, position: "faceUpAttack", summonPlayer: 0 });

    const triggerAction = getLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.uid === triggerStarter!.uid);
    expect(triggerAction).toBeDefined();
    applyAndAssert(session, triggerAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 1,
        "chainIndex": 1,
        "effectId": "lua-2-1102",
        "eventCardUid": "p0-deck-876-3",
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
          "sequence": 3,
        },
        "eventReason": 2064,
        "eventReasonCardUid": "p0-deck-873-0",
        "eventReasonEffectId": 1,
        "eventReasonPlayer": 0,
        "eventTriggerTiming": "when",
        "eventUids": [
          "p0-deck-876-3",
          "p0-deck-877-4",
        ],
        "id": "chain-6",
        "player": 0,
        "sourceUid": "p0-deck-874-1",
      }
    `);

    const bottomlessAction = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === bottomless!.uid);
    expect(bottomlessAction).toBeDefined();
    applyAndAssert(session, bottomlessAction!);
    expect(session.state.chain).toHaveLength(2);
    expect(session.state.chain[1]).toMatchInlineSnapshot(`
      {
        "activationLocation": "spellTrapZone",
        "activationSequence": 0,
        "chainIndex": 2,
        "effectId": "lua-6-1102",
        "eventCardUid": "p0-deck-876-3",
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
          "sequence": 3,
        },
        "eventReason": 2064,
        "eventReasonCardUid": "p0-deck-873-0",
        "eventReasonEffectId": 1,
        "eventReasonPlayer": 0,
        "eventTriggerTiming": "when",
        "eventUids": [
          "p0-deck-876-3",
          "p0-deck-877-4",
        ],
        "id": "chain-7",
        "operationInfos": [
          {
            "category": 1,
            "count": 2,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-876-3",
              "p0-deck-877-4",
            ],
          },
          {
            "category": 4,
            "count": 2,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-876-3",
              "p0-deck-877-4",
            ],
          },
        ],
        "player": 1,
        "sourceUid": "p1-deck-29401950-0",
        "targetUids": [
          "p0-deck-876-3",
          "p0-deck-877-4",
        ],
      }
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));

    const pass = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === firstSummoned!.uid)).toMatchObject({ location: "banished" });
    expect(restored.session.state.cards.find((card) => card.uid === secondSummoned!.uid)).toMatchObject({ location: "banished" });
    expect(restored.session.state.cards.find((card) => card.uid === bottomless!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.host.messages).not.toContain("bottomless special summon starter resolved 2");
    expect(restored.host.messages).toContain("bottomless special trigger starter resolved");
    expect(restored.host.messages).not.toContain("bottomless chain responder resolved");
  });
});

function bottomlessTrapCard(): DuelCardData {
  return { code: bottomlessCode, name: "Bottomless Trap Hole", kind: "trap", typeFlags: typeTrap };
}

function assertBottomlessScript(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const script = workspace.readScript(`c${bottomlessCode}.lua`);
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e2:SetCode(EVENT_FLIP_SUMMON_SUCCESS)");
  expect(script).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT,LOCATION_REMOVED)");
}

function chainStarterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_TRIGGER_O)
      e:SetCode(EVENT_SUMMON_SUCCESS)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp) Debug.Message("bottomless chain starter resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>1 end)
      e:SetOperation(function(e,tp) Debug.Message("bottomless chain responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function flipSummonChainStarterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_TRIGGER_O)
      e:SetCode(EVENT_FLIP_SUMMON_SUCCESS)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp) Debug.Message("bottomless flip chain starter resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function specialSummonChainStarterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_TRIGGER_O)
      e:SetCode(EVENT_SPSUMMON_SUCCESS)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp) Debug.Message("bottomless special trigger starter resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function specialSummonGroupScript(firstCode: string, secondCode: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp)
        local first=Duel.SelectMatchingCard(tp,aux.FilterBoolFunction(Card.IsCode,${firstCode}),tp,LOCATION_HAND,0,1,1,nil):GetFirst()
        local second=Duel.SelectMatchingCard(tp,aux.FilterBoolFunction(Card.IsCode,${secondCode}),tp,LOCATION_HAND,0,1,1,nil):GetFirst()
        local ct=0
        if first and second then ct=Duel.SpecialSummon(Group.FromCards(first,second),0,tp,tp,false,false,POS_FACEUP_ATTACK) end
        Debug.Message("bottomless special summon starter resolved " .. ct)
      end)
      c:RegisterEffect(e)
    end
  `;
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function resolveChainWithPasses(session: DuelSession): void {
  let guard = 0;
  while (session.state.chain.length > 0 && guard < 8) {
    guard += 1;
    const player = session.state.waitingFor;
    expect(player).toBeDefined();
    const actions = getLegalActions(session, player!);
    const pass = actions.find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(actions)).toBeDefined();
    applyAndAssert(session, pass!);
  }
  expect(session.state.chain).toHaveLength(0);
}
