import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpirit = 0x200;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Rasetsu Spirit cost return", () => {
  it("restores its reveal cost, temporary Special Summon lock, and targeted monster return", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const rasetsuCode = "43378076";
    const revealSpiritCode = "43378077";
    const attackTargetCode = "43378078";
    const defenseTargetCode = "43378079";
    const responderCode = "43378080";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === rasetsuCode),
      { code: revealSpiritCode, name: "Rasetsu Reveal Spirit", kind: "monster", typeFlags: typeMonster | typeEffect | typeSpirit, level: 4, attack: 1000, defense: 1000 },
      { code: attackTargetCode, name: "Rasetsu Attack Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1800, defense: 1200 },
      { code: defenseTargetCode, name: "Rasetsu Defense Non-Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1800 },
      { code: responderCode, name: "Rasetsu Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 433, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [rasetsuCode, revealSpiritCode] }, 1: { main: [attackTargetCode, defenseTargetCode, responderCode] } });
    startDuel(session);

    const rasetsu = session.state.cards.find((card) => card.code === rasetsuCode);
    const revealSpirit = session.state.cards.find((card) => card.code === revealSpiritCode);
    const attackTarget = session.state.cards.find((card) => card.code === attackTargetCode);
    const defenseTarget = session.state.cards.find((card) => card.code === defenseTargetCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(rasetsu).toBeDefined();
    expect(revealSpirit).toBeDefined();
    expect(attackTarget).toBeDefined();
    expect(defenseTarget).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, rasetsu!.uid, "hand", 0);
    moveDuelCard(session.state, revealSpirit!.uid, "hand", 0);
    moveDuelCard(session.state, attackTarget!.uid, "monsterZone", 1);
    attackTarget!.position = "faceUpAttack";
    attackTarget!.faceUp = true;
    moveDuelCard(session.state, defenseTarget!.uid, "monsterZone", 1);
    defenseTarget!.position = "faceUpDefense";
    defenseTarget!.faceUp = true;
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(rasetsuCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredSummonWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredSummonWindow.restoreComplete, restoredSummonWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSummonWindow.missingRegistryKeys).toEqual([]);
    expect(restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredSummonWindow, 0);
    expect(getLuaRestoreLegalActions(restoredSummonWindow, 0)).toEqual(getDuelLegalActions(restoredSummonWindow.session, 0));
    const summon = getLuaRestoreLegalActions(restoredSummonWindow, 0).find((action) => action.type === "normalSummon" && action.uid === rasetsu!.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummonWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonWindow, summon!);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredSummonWindow.session), source, reader);
    expect(restoredTriggerWindow.restoreComplete, restoredTriggerWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTriggerWindow.missingRegistryKeys).toEqual([]);
    expect(restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    expect(getLuaRestoreLegalActions(restoredTriggerWindow, 0)).toEqual(getDuelLegalActions(restoredTriggerWindow.session, 0));
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === rasetsu!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTriggerWindow, trigger!);
    expect(restoredTriggerWindow.host.messages).toContain(`confirmed 1: ${revealSpiritCode}`);
    expect(restoredTriggerWindow.session.state.chain).toHaveLength(1);
    expect(restoredTriggerWindow.session.state.chain[0]).toMatchObject({
      sourceUid: rasetsu!.uid,
      eventName: "normalSummoned",
      eventCardUid: rasetsu!.uid,
      operationInfos: [{ category: 0x8, targetUids: [attackTarget!.uid], count: 1, player: 0, parameter: 0 }],
    });

    const restoredChainWindow = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
    expect(restoredChainWindow.restoreComplete, restoredChainWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChainWindow.missingRegistryKeys).toEqual([]);
    expect(restoredChainWindow.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredChainWindow, 1)).toEqual(getGroupedDuelLegalActions(restoredChainWindow.session, 1));
    const lockCheck = restoredChainWindow.host.loadScript(
      `
      Debug.Message("rasetsu can special " .. tostring(Duel.IsPlayerCanSpecialSummon(0)))
      `,
      "rasetsu-special-lock-check.lua",
    );
    expect(lockCheck.ok, lockCheck.error).toBe(true);
    expect(restoredChainWindow.host.messages).toContain("rasetsu can special false");
    const pass = getLuaRestoreLegalActions(restoredChainWindow, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restoredChainWindow, 1), null, 2)).toBeDefined();
    const resolved = applyLuaRestoreResponse(restoredChainWindow, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === attackTarget!.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === defenseTarget!.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === revealSpirit!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredChainWindow.session.state.eventHistory.filter((event) => ["confirmed", "sentToHand"].includes(event.eventName))).toEqual([
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventPlayer: 1,
        eventCardUid: revealSpirit!.uid,
        eventValue: 1,
        eventUids: [revealSpirit!.uid],
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 1,
        },
      },
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: attackTarget!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: rasetsu!.uid,
        eventReasonEffectId: 7,
        eventPreviousState: {
          controller: 1,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: false,
          location: "hand",
          position: "faceUpAttack",
          sequence: 1,
        },
      },
    ]);
    expect(restoredChainWindow.host.messages).not.toContain("rasetsu responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("rasetsu responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}
