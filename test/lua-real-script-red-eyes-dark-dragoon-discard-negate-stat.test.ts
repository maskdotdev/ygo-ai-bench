import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const dragoonCode = "37818794";
const starterCode = "378187940";
const discardCode = "378187941";
const typeMonster = 0x1;
const typeSpell = 0x2;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Red-Eyes Dark Dragoon discard negate stat", () => {
  it("restores discard-cost activation negation, source destruction, suppressed Spell, and Dragoon attack gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${dragoonCode}.lua`);
    expectScriptShape(script);
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === dragoonCode),
      { code: starterCode, name: "Red-Eyes Dark Dragoon Destroy Starter", kind: "spell", typeFlags: typeSpell },
      { code: discardCode, name: "Red-Eyes Dark Dragoon Discard Cost", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 37818794, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [dragoonCode, discardCode] }, 1: { main: [starterCode] } });
    startDuel(session);

    const dragoon = requireCard(session, dragoonCode);
    const discard = requireCard(session, discardCode);
    const starter = requireCard(session, starterCode);
    moveDuelCard(session.state, dragoon.uid, "monsterZone", 0).position = "faceUpAttack";
    dragoon.faceUp = true;
    moveDuelCard(session.state, discard.uid, "hand", 0);
    moveDuelCard(session.state, starter.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return destroyStarterScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    for (const code of [dragoonCode, starterCode]) {
      const loaded = host.loadCardScript(Number(code), source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(2);

    const starterAction = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === starter.uid);
    expect(starterAction, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, starterAction!);
    expect(session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-7-1002",
        sourceUid: starter.uid,
        player: 1,
        activationLocation: "hand",
        activationSequence: 0,
        operationInfos: [{ category: 0x1, targetUids: [starter.uid], count: 1, player: 0, parameter: 0 }],
      },
    ]);

    const restoredOpenChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpenChain);
    expectRestoredLegalActions(restoredOpenChain, 0);
    const dragoonAction = getLuaRestoreLegalActions(restoredOpenChain, 0).find((action) => action.type === "activateEffect" && action.uid === dragoon.uid);
    expect(dragoonAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpenChain, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpenChain, dragoonAction!);

    expect(restoredOpenChain.host.messages).not.toContain("dragoon starter resolved");
    expect(restoredOpenChain.session.state.chain).toHaveLength(0);
    expect(restoredOpenChain.session.state.cards.find((card) => card.uid === discard.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: dragoon.uid,
      reasonEffectId: 6,
    });
    expect(restoredOpenChain.session.state.cards.find((card) => card.uid === starter.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: dragoon.uid,
      reasonEffectId: 6,
    });
    const attackGainEffects = restoredOpenChain.session.state.effects
      .filter((effect) => effect.sourceUid === dragoon.uid && effect.code === 100)
      .map((effect) => ({
        code: effect.code,
        event: effect.event,
        id: effect.id,
        luaTypeFlags: effect.luaTypeFlags,
        range: effect.range,
        registryKey: effect.registryKey,
        sourceUid: effect.sourceUid,
        value: effect.value,
      }));
    expect(attackGainEffects).toEqual([
      {
        code: 100,
        event: "continuous",
        id: "lua-8-100",
        luaTypeFlags: 1,
        range: ["monsterZone"],
        registryKey: `lua:${dragoonCode}:lua-8-100`,
        sourceUid: dragoon.uid,
        value: 1000,
      },
    ]);
    expect(restoredOpenChain.session.state.eventHistory.filter((event) => ["discarded", "destroyed", "chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([
      {
        eventName: "discarded",
        eventCode: 1018,
        eventCardUid: discard.uid,
        eventReason: duelReason.cost | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: dragoon.uid,
        eventReasonEffectId: 6,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: starter.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: dragoon.uid,
        eventReasonEffectId: 6,
        eventPreviousState: { controller: 1, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "chainNegated",
        eventCode: 1024,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 7,
      },
      {
        eventName: "chainDisabled",
        eventCode: 1025,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 7,
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Red-Eyes Dark Dragoon");
  expect(script).toContain("Fusion.AddProcMix(c,true,true,CARD_DARK_MAGICIAN,{CARD_REDEYES_B_DRAGON,s.ffilter})");
  expect(script).toContain("e4:SetCategory(CATEGORY_NEGATE+CATEGORY_DESTROY)");
  expect(script).toContain("e4:SetProperty(EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DAMAGE_CAL)");
  expect(script).toContain("Duel.IsChainNegatable(ev)");
  expect(script).toContain("Duel.IsExistingMatchingCard(Card.IsDiscardable,tp,LOCATION_HAND,0,1,nil)");
  expect(script).toContain("Duel.DiscardHand(tp,Card.IsDiscardable,1,1,REASON_COST|REASON_DISCARD)");
  expect(script).toContain("Duel.NegateActivation(ev)");
  expect(script).toContain("Duel.Destroy(eg,REASON_EFFECT)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(1000)");
}

function destroyStarterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DESTROY)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return true end
        Duel.SetOperationInfo(0,CATEGORY_DESTROY,Group.FromCards(e:GetHandler()),1,0,0)
      end)
      e:SetOperation(function(e,tp)
        Debug.Message("dragoon starter resolved")
        Duel.Destroy(e:GetHandler(),REASON_EFFECT)
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

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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
