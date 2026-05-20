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
const finalBattleCode = "74640994";
const hasFinalBattleScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${finalBattleCode}.lua`));
const setSubterror = 0xed;
const typeMonster = 0x1;
const typeTrap = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasFinalBattleScript)("Lua real script Subterror Final Battle reset event", () => {
  it("restores SelectEffect flip-up branch, trap self-reset, and raised EVENT_SSET", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const subterrorCode = "746409941";
    const responderCode = "746409942";
    const watcherCode = "746409943";
    const script = workspace.readScript(`official/c${finalBattleCode}.lua`);
    expect(script).toContain("local op=Duel.SelectEffect(tp,");
    expect(script).toContain("Duel.SelectPosition(tp,tc,POS_FACEUP_ATTACK+POS_FACEUP_DEFENSE)");
    expect(script).toContain("Duel.ChangePosition(tc,pos)");
    expect(script).toContain("c:CancelToGrave()");
    expect(script).toContain("Duel.ChangePosition(c,POS_FACEDOWN)");
    expect(script).toContain("Duel.RaiseEvent(c,EVENT_SSET,e,REASON_EFFECT,tp,tp,0)");

    const cards: DuelCardData[] = [
      { code: finalBattleCode, name: "Subterror Final Battle", kind: "trap", typeFlags: typeTrap },
      { code: subterrorCode, name: "Subterror Hidden Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1500, defense: 1800, setcodes: [setSubterror] },
      { code: responderCode, name: "Subterror Final Battle Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: watcherCode, name: "Subterror Final Battle SSet Watcher", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 74640994, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [finalBattleCode, subterrorCode, watcherCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const finalBattle = session.state.cards.find((card) => card.code === finalBattleCode);
    const subterror = session.state.cards.find((card) => card.code === subterrorCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    const watcher = session.state.cards.find((card) => card.code === watcherCode);
    expect(finalBattle).toBeDefined();
    expect(subterror).toBeDefined();
    expect(responder).toBeDefined();
    expect(watcher).toBeDefined();
    moveDuelCard(session.state, finalBattle!.uid, "spellTrapZone", 0);
    finalBattle!.position = "faceDown";
    finalBattle!.faceUp = false;
    finalBattle!.turnId = 0;
    moveDuelCard(session.state, subterror!.uid, "monsterZone", 0);
    subterror!.position = "faceDownDefense";
    subterror!.faceUp = false;
    moveDuelCard(session.state, watcher!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        if (name === `c${watcherCode}.lua`) return ssetWatcherScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(finalBattleCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(watcherCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === finalBattle!.uid);
    expect(activate, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]?.operationInfos).toEqual([{ category: 0x1000, count: 1, parameter: 0x5, player: 0, targetUids: [] }]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([{ category: 0x1000, count: 1, parameter: 0x5, player: 0, targetUids: [] }]);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === subterror!.uid)).toMatchObject({ location: "monsterZone", position: "faceUpAttack", faceUp: true });
    expect(restored.session.state.cards.find((card) => card.uid === finalBattle!.uid)).toMatchObject({
      location: "spellTrapZone",
      position: "faceDown",
      faceUp: false,
    });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "positionChanged" || event.eventName === "spellTrapSet")).toEqual([
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: subterror!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: finalBattle!.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "monsterZone", position: "faceDownDefense", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "spellTrapSet",
        eventCode: 1107,
        eventCardUid: finalBattle!.uid,
        eventPlayer: 0,
        eventValue: 0,
        eventUids: [finalBattle!.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: finalBattle!.uid,
        eventReasonEffectId: 1,
        relatedEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "spellTrapZone", position: "faceDown", sequence: 0 },
      },
    ]);
    const watcherTrigger = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateTrigger" && action.uid === watcher!.uid);
    expect(watcherTrigger, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    expect(watcherTrigger).toMatchObject({
      type: "activateTrigger",
      player: 0,
      triggerBucket: "turnMandatory",
      uid: watcher!.uid,
    });
    expect(restored.host.messages).not.toContain("subterror final battle responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("subterror final battle responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function ssetWatcherScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_F)
      e:SetCode(EVENT_SSET)
      e:SetRange(LOCATION_MZONE)
      e:SetOperation(function(e,tp) Debug.Message("subterror final battle sset watcher resolved") end)
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
}
