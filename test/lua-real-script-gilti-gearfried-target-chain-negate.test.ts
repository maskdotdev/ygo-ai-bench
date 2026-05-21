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
const giltiGearfriedCode = "49161188";
const starterCode = "491611880";
const destroyTargetCode = "491611881";
const typeMonster = 0x1;
const typeSpell = 0x2;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Gilti-Gearfried target chain negate", () => {
  it("restores targeted chain response negation and selected card destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${giltiGearfriedCode}.lua`);
    expect(script).toContain("e4:SetCode(EVENT_CHAINING)");
    expect(script).toContain("e4:SetRange(LOCATION_MZONE)");
    expect(script).toContain("if not re:IsHasProperty(EFFECT_FLAG_CARD_TARGET) then return end");
    expect(script).toContain("local loc,tg=Duel.GetChainInfo(ev,CHAININFO_TRIGGERING_LOCATION,CHAININFO_TARGET_CARDS)");
    expect(script).toContain("return Duel.IsChainDisablable(ev) and loc~=LOCATION_DECK");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DISABLE,eg,1,0,0)");
    expect(script).toContain("Duel.NegateEffect(ev)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,nil,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil)");
    expect(script).toContain("Duel.Destroy(g,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === giltiGearfriedCode),
      { code: starterCode, name: "Gilti-Gearfried Targeting Starter", kind: "spell", typeFlags: typeSpell },
      { code: destroyTargetCode, name: "Gilti-Gearfried Destruction Choice", kind: "monster", typeFlags: typeMonster, level: 4, attack: 900, defense: 900 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 49161188, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [giltiGearfriedCode, destroyTargetCode] }, 1: { main: [starterCode] } });
    startDuel(session);

    const giltiGearfried = requireCard(session, giltiGearfriedCode);
    const starter = requireCard(session, starterCode);
    const destroyTarget = requireCard(session, destroyTargetCode);
    moveFaceUpAttack(session, destroyTarget, 0).sequence = 0;
    moveFaceUpAttack(session, giltiGearfried, 0).sequence = 4;
    moveDuelCard(session.state, starter.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return targetingStarterScript(giltiGearfriedCode);
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(giltiGearfriedCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredStarterOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredStarterOpen);
    expectRestoredLegalActions(restoredStarterOpen, 1);
    const starterAction = getLuaRestoreLegalActions(restoredStarterOpen, 1).find((action) => action.type === "activateEffect" && action.uid === starter.uid);
    expect(starterAction, JSON.stringify(getLuaRestoreLegalActions(restoredStarterOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStarterOpen, starterAction!);
    expect(restoredStarterOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-6-1002",
        sourceUid: starter.uid,
        player: 1,
        activationLocation: "hand",
        activationSequence: 0,
        operationInfos: [{ category: 0x1, targetUids: [giltiGearfried.uid], count: 1, player: 0, parameter: 0x4 }],
        targetUids: [giltiGearfried.uid],
      },
    ]);

    const restoredChainResponse = restoreDuelWithLuaScripts(serializeDuel(restoredStarterOpen.session), source, reader);
    expectCleanRestore(restoredChainResponse);
    expectRestoredLegalActions(restoredChainResponse, 0);
    const negate = getLuaRestoreLegalActions(restoredChainResponse, 0).find((action) => action.type === "activateEffect" && action.uid === giltiGearfried.uid);
    expect(negate, JSON.stringify(getLuaRestoreLegalActions(restoredChainResponse, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredChainResponse, negate!);
    passRestoredChain(restoredChainResponse);
    expect(restoredChainResponse.session.state.chain).toHaveLength(0);

    expect(restoredChainResponse.session.state.cards.find((card) => card.uid === destroyTarget.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: giltiGearfried.uid,
      reasonEffectId: 5,
    });
    expect(restoredChainResponse.session.state.cards.find((card) => card.uid === giltiGearfried.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
    });
    expect(restoredChainResponse.session.state.cards.find((card) => card.uid === starter.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
    });
    expect(restoredChainResponse.host.messages).not.toContain("gilti gearfried targeting starter resolved");
    expect(restoredChainResponse.session.state.eventHistory.filter((event) => ["becameTarget", "chainNegated", "chainDisabled", "destroyed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventChainLinkId: event.eventChainLinkId,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      {
        eventName: "becameTarget",
        eventCardUid: giltiGearfried.uid,
        eventReason: 0,
        eventReasonPlayer: 1,
        eventReasonCardUid: undefined,
        eventReasonEffectId: undefined,
        eventChainLinkId: "chain-2",
        relatedEffectId: 6,
      },
      {
        eventName: "destroyed",
        eventCardUid: destroyTarget.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: giltiGearfried.uid,
        eventReasonEffectId: 5,
        eventChainLinkId: undefined,
        relatedEffectId: undefined,
      },
      {
        eventName: "chainNegated",
        eventCardUid: undefined,
        eventReason: undefined,
        eventReasonPlayer: 1,
        eventReasonCardUid: undefined,
        eventReasonEffectId: undefined,
        eventChainLinkId: "chain-2",
        relatedEffectId: 6,
      },
      {
        eventName: "chainDisabled",
        eventCardUid: undefined,
        eventReason: undefined,
        eventReasonPlayer: 1,
        eventReasonCardUid: undefined,
        eventReasonEffectId: undefined,
        eventChainLinkId: "chain-2",
        relatedEffectId: 6,
      },
    ]);
  });
});

function targetingStarterScript(targetCode: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DESTROY)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetProperty(EFFECT_FLAG_CARD_TARGET)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
        if chkc then return chkc:IsOnField() and chkc:IsCode(${targetCode}) end
        if chk==0 then return Duel.IsExistingTarget(Card.IsCode,tp,0,LOCATION_MZONE,1,nil,${targetCode}) end
        local g=Duel.SelectTarget(tp,Card.IsCode,tp,0,LOCATION_MZONE,1,1,nil,${targetCode})
        Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,1-tp,LOCATION_MZONE)
      end)
      e:SetOperation(function(e,tp)
        local tc=Duel.GetFirstTarget()
        if tc and tc:IsRelateToEffect(e) then
          Debug.Message("gilti gearfried targeting starter resolved")
          Duel.Destroy(tc,REASON_EFFECT)
        end
      end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.position = "faceUpAttack";
  moved.faceUp = true;
  return moved;
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
