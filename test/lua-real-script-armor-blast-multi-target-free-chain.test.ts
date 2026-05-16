import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const setInzektor = 0x56;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Armor Blast multi-target free chain", () => {
  it("restores Armor Blast's merged Inzektor and opponent targets, then destroys them", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const armorBlastCode = "79155167";
    const responderCode = "902";
    const inzektorCode = "903";
    const opponentMonsterCode = "904";
    const opponentSpellCode = "905";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === armorBlastCode),
      { code: responderCode, name: "Armor Blast Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: inzektorCode, name: "Armor Blast Inzektor", kind: "monster", typeFlags: 0x1, setcodes: [setInzektor], level: 4, attack: 1000, defense: 1000 },
      { code: opponentMonsterCode, name: "Armor Blast Opponent Monster", kind: "monster", typeFlags: 0x1, level: 4, attack: 1600, defense: 1200 },
      { code: opponentSpellCode, name: "Armor Blast Opponent Spell", kind: "spell", typeFlags: 0x2 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 791, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [responderCode, opponentMonsterCode, opponentSpellCode] }, 1: { main: [armorBlastCode, inzektorCode] } });
    startDuel(session);

    const responder = session.state.cards.find((card) => card.code === responderCode);
    const inzektor = session.state.cards.find((card) => card.code === inzektorCode);
    const opponentMonster = session.state.cards.find((card) => card.code === opponentMonsterCode);
    const opponentSpell = session.state.cards.find((card) => card.code === opponentSpellCode);
    const armorBlast = session.state.cards.find((card) => card.code === armorBlastCode);
    expect(responder).toBeDefined();
    expect(inzektor).toBeDefined();
    expect(opponentMonster).toBeDefined();
    expect(opponentSpell).toBeDefined();
    expect(armorBlast).toBeDefined();
    moveDuelCard(session.state, responder!.uid, "hand", 0);
    moveDuelCard(session.state, inzektor!.uid, "monsterZone", 1);
    inzektor!.position = "faceUpAttack";
    inzektor!.faceUp = true;
    moveDuelCard(session.state, opponentMonster!.uid, "monsterZone", 0);
    opponentMonster!.position = "faceUpAttack";
    opponentMonster!.faceUp = true;
    moveDuelCard(session.state, opponentSpell!.uid, "spellTrapZone", 0);
    opponentSpell!.position = "faceUpAttack";
    opponentSpell!.faceUp = true;
    moveDuelCard(session.state, armorBlast!.uid, "spellTrapZone", 1);
    armorBlast!.position = "faceDown";
    armorBlast!.faceUp = false;
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(armorBlastCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const armorBlastAction = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === armorBlast!.uid);
    expect(armorBlastAction).toBeDefined();
    applyAndAssert(session, armorBlastAction!);
    expect(session.state.chain).toHaveLength(1);
    const targetUids = [inzektor!.uid, opponentMonster!.uid, opponentSpell!.uid];
    expect(session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "spellTrapZone",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-2-1002",
        "id": "chain-2",
        "operationInfos": [
          {
            "category": 1,
            "count": 3,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p1-deck-903-1",
              "p0-deck-904-1",
              "p0-deck-905-2",
            ],
          },
        ],
        "player": 1,
        "sourceUid": "p1-deck-79155167-0",
        "targetUids": [
          "p1-deck-903-1",
          "p0-deck-904-1",
          "p0-deck-905-2",
        ],
      }
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.chain).toHaveLength(1);
    expect(restored.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "spellTrapZone",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-2-1002",
        "id": "chain-2",
        "operationInfos": [
          {
            "category": 1,
            "count": 3,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p1-deck-903-1",
              "p0-deck-904-1",
              "p0-deck-905-2",
            ],
          },
        ],
        "player": 1,
        "sourceUid": "p1-deck-79155167-0",
        "targetUids": [
          "p1-deck-903-1",
          "p0-deck-904-1",
          "p0-deck-905-2",
        ],
      }
    `);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x1, targetUids, count: 3, player: 0, parameter: 0 },
    ]);

    const pass = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === inzektor!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === opponentMonster!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === opponentSpell!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === armorBlast!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === opponentMonster!.uid)).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: opponentMonster!.uid,
        eventPreviousState: {
          location: "monsterZone",
          controller: 0,
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventCurrentState: {
          location: "graveyard",
          controller: 0,
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: armorBlast!.uid,
        eventReasonEffectId: 2,
      },
    ]);
    expect(restored.host.messages).not.toContain("armor blast chain responder resolved");
  });
});

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("armor blast chain responder resolved") end)
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
