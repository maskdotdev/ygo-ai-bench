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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script House of Adhesive Tape flip summon", () => {
  it("restores its Flip Summon success trap activation in the chain-response window", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const trapCode = "15083728";
    const starterCode = "15083730";
    const flipTargetCode = "15083729";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === trapCode),
      { code: starterCode, name: "House Tape Flip Chain Starter", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: flipTargetCode, name: "House Tape Flip Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 500 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 150, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [trapCode] }, 1: { main: [flipTargetCode, starterCode] } });
    startDuel(session);

    const trap = requireCard(session, trapCode);
    const starter = requireCard(session, starterCode);
    const flipTarget = requireCard(session, flipTargetCode);
    moveDuelCard(session.state, trap.uid, "spellTrapZone", 0).position = "faceDown";
    trap.faceUp = false;
    moveDuelCard(session.state, starter.uid, "hand", 1);
    moveDuelCard(session.state, flipTarget.uid, "monsterZone", 1).position = "faceDownDefense";
    flipTarget.faceUp = false;
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return chainStarterScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(trapCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const flip = getLegalActions(session, 1).find((action) => action.type === "flipSummon" && action.uid === flipTarget.uid);
    expect(flip, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, flip!);
    expect(session.state.pendingTriggers).toEqual([expect.objectContaining({ eventName: "flipSummoned", eventCardUid: flipTarget.uid })]);

    const starterAction = getLegalActions(session, 1).find((action) => action.type === "activateTrigger" && action.uid === starter.uid);
    expect(starterAction).toBeDefined();
    applyAndAssert(session, starterAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchObject({ sourceUid: starter.uid, eventName: "flipSummoned", eventCardUid: flipTarget.uid });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));

    const trapAction = getLuaRestoreLegalActions(restored, 0).find(
      (action): action is Extract<DuelAction, { type: "activateEffect" }> => action.type === "activateEffect" && action.uid === trap.uid,
    );
    expect(trapAction, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    expect(trapAction?.type).toBe("activateEffect");
    expect(trapAction?.uid).toBe(trap.uid);
    expect(trapAction?.effectId).toContain("-1101");
    expect(trapAction?.windowKind).toBe("chainResponse");
    const activated = applyLuaRestoreResponse(restored, trapAction!);
    expect(activated.ok, activated.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === flipTarget.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === trap.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.eventHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventName: "flipSummoned", eventCardUid: flipTarget.uid }),
    ]));
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === flipTarget.uid)).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: flipTarget.uid,
        eventPreviousState: {
          location: "monsterZone",
          controller: 1,
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventCurrentState: {
          location: "graveyard",
          controller: 1,
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: trap.uid,
        eventReasonEffectId: 2,
      },
    ]);
    expect(restored.host.messages).toContain("house tape flip chain starter resolved");
  });
});

function chainStarterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_TRIGGER_O)
      e:SetCode(EVENT_FLIP_SUMMON_SUCCESS)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp) Debug.Message("house tape flip chain starter resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
