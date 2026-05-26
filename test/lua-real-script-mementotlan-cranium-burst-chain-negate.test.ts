import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const setMemento = 0x19a;
const tecuhtlicaCode = "23288411";

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Mementotlan Cranium Burst chain negate", () => {
  it("restores must-attack field effects and once-per-chain monster negation into Tecuhtlica stat loss", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const craniumCode = "79600447";
    const opponentMonsterCode = "796004470";
    const drawCode = "796004471";
    const script = workspace.readScript(`c${craniumCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_MUST_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_MUST_ATTACK_MONSTER)");
    expect(script).toContain("Duel.GetChainInfo(ev,CHAININFO_TRIGGERING_LOCATION)");
    expect(script).toContain("return re:IsMonsterEffect() and (loc&LOCATION_MZONE)~=0 and ep==1-tp and Duel.IsChainDisablable(ev)");
    expect(script).toContain("not Duel.HasFlagEffect(tp,id)");
    expect(script).toContain("Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsCode,CARD_MEMENTOAL_TECUHTLICA),tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("Duel.RegisterFlagEffect(tp,id,RESET_CHAIN,EFFECT_FLAG_OATH,1)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DISABLE,eg,1,0,0)");
    expect(script).toContain("tc:UpdateAttack(-1000,RESET_EVENT|RESETS_STANDARD,c)");
    expect(script).toContain("tc:UpdateDefense(-1000,RESET_EVENT|RESETS_STANDARD,c)");
    expect(script).toContain("Duel.NegateEffect(ev)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === craniumCode),
      { code: tecuhtlicaCode, name: "Mementoal Tecuhtlica Stat Gate", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setMemento], level: 11, attack: 5000, defense: 5000 },
      { code: opponentMonsterCode, name: "Cranium Burst Opponent Monster Effect", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1200, defense: 1000 },
      { code: drawCode, name: "Cranium Burst Suppressed Draw", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 79600447, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [craniumCode, tecuhtlicaCode] }, 1: { main: [opponentMonsterCode, drawCode] } });
    startDuel(session);

    const cranium = requireCard(session, craniumCode);
    const tecuhtlica = requireCard(session, tecuhtlicaCode);
    const opponentMonster = requireCard(session, opponentMonsterCode);
    const drawCard = requireCard(session, drawCode);
    moveDuelCard(session.state, cranium.uid, "spellTrapZone", 0).faceUp = true;
    moveDuelCard(session.state, tecuhtlica.uid, "monsterZone", 0);
    tecuhtlica.faceUp = true;
    tecuhtlica.position = "faceUpAttack";
    moveDuelCard(session.state, opponentMonster.uid, "monsterZone", 1);
    opponentMonster.faceUp = true;
    opponentMonster.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${opponentMonsterCode}.lua`) return monsterDrawScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(craniumCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(opponentMonsterCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 1);
    expect(restoredOpen.session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 191 && effect.sourceUid === cranium.uid)).toBeDefined();
    expect(restoredOpen.session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 344 && effect.sourceUid === cranium.uid)).toBeDefined();
    const starter = getLuaRestoreLegalActions(restoredOpen, 1).find((action) => action.type === "activateEffect" && action.uid === opponentMonster.uid);
    expect(starter, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, starter!);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        sourceUid: opponentMonster.uid,
        player: 1,
        effectId: "lua-5",
        activationLocation: "monsterZone",
        activationSequence: 0,
        operationInfos: [{ category: 0x10000, targetUids: [], count: 0, player: 1, parameter: 1 }],
      },
    ]);

    const restoredResponse = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredResponse);
    expectRestoredLegalActions(restoredResponse, 0);
    const craniumAction = getLuaRestoreLegalActions(restoredResponse, 0).find((action) => action.type === "activateEffect" && action.uid === cranium.uid);
    expect(craniumAction, JSON.stringify(getLuaRestoreLegalActions(restoredResponse, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredResponse, craniumAction!);
    expect(restoredResponse.session.state.chain).toEqual([]);
    expect(currentAttack(restoredResponse.session.state.cards.find((card) => card.uid === tecuhtlica.uid), restoredResponse.session.state)).toBe(4000);
    expect(currentDefense(restoredResponse.session.state.cards.find((card) => card.uid === tecuhtlica.uid), restoredResponse.session.state)).toBe(4000);
    expect(restoredResponse.session.state.cards.find((card) => card.uid === drawCard.uid)).toMatchObject({ location: "deck", controller: 1 });
    expect(restoredResponse.host.messages).not.toContain("cranium burst monster resolved");
    expect(restoredResponse.session.state.eventHistory.filter((event) => ["becameTarget", "chainNegated", "chainDisabled", "cardsDrawn"].includes(event.eventName))).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 2,
        eventCardUid: tecuhtlica.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventChainDepth: 2,
        eventChainLinkId: "chain-3",
        relatedEffectId: 4,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
      {
        eventName: "chainNegated",
        eventCode: 1024,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 5,
      },
      {
        eventName: "chainDisabled",
        eventCode: 1025,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 5,
      },
    ]);
  });
});

function monsterDrawScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DRAW)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return true end
        Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)
      end)
      e:SetOperation(function(e,tp)
        Debug.Message("cranium burst monster resolved")
        Duel.Draw(tp,1,REASON_EFFECT)
      end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const player = response.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
