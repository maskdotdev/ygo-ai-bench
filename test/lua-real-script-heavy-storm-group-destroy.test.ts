import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const heavyStormCode = "19613556";
const hasHeavyStormScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${heavyStormCode}.lua`));
const typeSpell = 0x2;
const typeTrap = 0x4;
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasHeavyStormScript)("Lua real script Heavy Storm group destroy", () => {
  it("restores prompt-free both-field Spell/Trap group destruction while excluding its own activation card", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const ownSpellCode = "196135560";
    const ownTrapCode = "196135561";
    const opponentSpellCode = "196135562";
    const opponentTrapCode = "196135563";
    const monsterDecoyCode = "196135564";
    const responderCode = "196135565";
    const script = workspace.readScript(`official/c${heavyStormCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_DESTROY)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("Duel.GetMatchingGroup(s.filter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,c)");
    expect(script).toContain("Duel.Destroy(sg,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === heavyStormCode),
      { code: ownSpellCode, name: "Heavy Storm Own Spell", kind: "spell", typeFlags: typeSpell },
      { code: ownTrapCode, name: "Heavy Storm Own Trap", kind: "trap", typeFlags: typeTrap },
      { code: opponentSpellCode, name: "Heavy Storm Opponent Spell", kind: "spell", typeFlags: typeSpell },
      { code: opponentTrapCode, name: "Heavy Storm Opponent Trap", kind: "trap", typeFlags: typeTrap },
      { code: monsterDecoyCode, name: "Heavy Storm Monster Decoy", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1600, defense: 1200 },
      { code: responderCode, name: "Heavy Storm Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4, attack: 900, defense: 900 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 19613556, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [heavyStormCode, ownSpellCode, ownTrapCode, monsterDecoyCode] }, 1: { main: [opponentSpellCode, opponentTrapCode, responderCode] } });
    startDuel(session);

    const heavyStorm = requireCard(session, heavyStormCode);
    const ownSpell = requireCard(session, ownSpellCode);
    const ownTrap = requireCard(session, ownTrapCode);
    const opponentSpell = requireCard(session, opponentSpellCode);
    const opponentTrap = requireCard(session, opponentTrapCode);
    const monsterDecoy = requireCard(session, monsterDecoyCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, heavyStorm.uid, "hand", 0);
    moveDuelCard(session.state, ownSpell.uid, "spellTrapZone", 0).faceUp = true;
    moveDuelCard(session.state, ownTrap.uid, "spellTrapZone", 0).position = "faceDown";
    moveDuelCard(session.state, opponentSpell.uid, "spellTrapZone", 1).faceUp = true;
    moveDuelCard(session.state, opponentTrap.uid, "spellTrapZone", 1).position = "faceDown";
    moveDuelCard(session.state, monsterDecoy.uid, "monsterZone", 1).faceUp = true;
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(heavyStormCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const action = getLuaRestoreLegalActions(restoredOpen, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === heavyStorm.uid);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, action!);
    const destroyedUids = [ownSpell.uid, ownTrap.uid, opponentSpell.uid, opponentTrap.uid];
    expect(restoredOpen.session.state.chain).toHaveLength(1);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        player: 0,
        sourceUid: heavyStorm.uid,
        effectId: "lua-1-1002",
        activationLocation: "hand",
        activationSequence: 0,
        operationInfos: [{ category: 0x1, targetUids: destroyedUids, count: 4, player: 0, parameter: 0 }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((candidate) => candidate.type === "activateEffect" && candidate.uid === responder.uid)).toBe(true);
    const pass = getLuaRestoreLegalActions(restoredChain, 1).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    applyLuaRestoreAndAssert(restoredChain, pass!);

    expect(restoredChain.session.state.chain).toEqual([]);
    for (const uid of [...destroyedUids, heavyStorm.uid]) {
      expect(restoredChain.session.state.cards.find((card) => card.uid === uid)).toMatchObject({ location: "graveyard" });
    }
    expect(restoredChain.session.state.cards.find((card) => card.uid === monsterDecoy.uid)).toMatchObject({ location: "monsterZone", controller: 1, faceUp: true });
    expect(restoredChain.session.state.cards.find((card) => card.uid === responder.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restoredChain.host.messages).not.toContain("heavy storm responder resolved");
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "destroyed")).toEqual([
      destroyedEvent(ownSpell.uid, ownSpell.uid, heavyStorm.uid, 0, 0),
      destroyedEvent(ownTrap.uid, ownTrap.uid, heavyStorm.uid, 0, 1),
      destroyedEvent(opponentSpell.uid, opponentSpell.uid, heavyStorm.uid, 1, 0),
      destroyedEvent(opponentTrap.uid, opponentTrap.uid, heavyStorm.uid, 1, 1),
      { ...destroyedEvent(ownSpell.uid, ownSpell.uid, heavyStorm.uid, 0, 0), eventUids: destroyedUids },
    ]);
  });
});

function destroyedEvent(eventCardUid: string, uid: string, sourceUid: string, controller: PlayerId, sequence: number) {
  return {
    eventName: "destroyed",
    eventCode: 1029,
    eventCardUid,
    eventPreviousState: { location: "spellTrapZone", controller, sequence, position: "faceDown", faceUp: true },
    eventCurrentState: { location: "graveyard", controller, sequence, position: "faceDown", faceUp: true },
    eventReason: duelReason.effect | duelReason.destroy,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
  };
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("heavy storm responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
