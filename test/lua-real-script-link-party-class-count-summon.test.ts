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
const linkPartyCode = "68957925";
const hasLinkPartyScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${linkPartyCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeLink = 0x4000000;

describe.skipIf(!hasUpstreamScripts || !hasLinkPartyScript)("Lua real script Link Party class-count summon", () => {
  it("restores five original Link attributes into the Deck Special Summon branch", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${linkPartyCode}.lua`);
    expect(script).toBeDefined();
    const scriptText = script!;
    expect(scriptText).toContain("Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsLinkMonster),tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
    expect(scriptText).toContain("local ct=lg:GetClassCount(Card.GetOriginalAttribute)");
    expect(scriptText).toContain("ct==5 and Duel.GetLocationCount(tp,LOCATION_MZONE)>0");
    expect(scriptText).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_DECK)");
    expect(scriptText).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_DECK)");
    expect(scriptText).toContain("local sg=g3:Select(tp,1,1,nil)");
    expect(scriptText).toContain("Duel.SpecialSummon(sg,0,tp,tp,false,false,POS_FACEUP)");

    const summonCode = "689579250";
    const lowAttackDecoyCode = "689579251";
    const responderCode = "689579252";
    const linkCodes = ["689579253", "689579254", "689579255", "689579256", "689579257"];
    const attributes = [0x01, 0x02, 0x04, 0x08, 0x10];
    const cards: DuelCardData[] = [
      { code: linkPartyCode, name: "Link Party", kind: "spell", typeFlags: typeSpell },
      { code: summonCode, name: "Link Party Deck Summon", kind: "monster", typeFlags: typeMonster | typeEffect, level: 7, attack: 2600, defense: 2000 },
      { code: lowAttackDecoyCode, name: "Link Party Low Attack Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2400, defense: 2000 },
      { code: responderCode, name: "Link Party Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      ...linkCodes.map((code, index) => ({
        code,
        name: `Link Party Attribute Link ${index + 1}`,
        kind: "extra" as const,
        typeFlags: typeMonster | typeEffect | typeLink,
        level: 1,
        attack: 1000,
        defense: 0,
        attribute: attributes[index]!,
        linkMarkers: 0x20,
      })),
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 68957925, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [linkPartyCode, summonCode, lowAttackDecoyCode, ...linkCodes.slice(0, 3)] }, 1: { main: [responderCode, ...linkCodes.slice(3)] } });
    startDuel(session);

    const linkParty = requireCard(session, linkPartyCode);
    const summon = requireCard(session, summonCode);
    const lowAttackDecoy = requireCard(session, lowAttackDecoyCode);
    const responder = requireCard(session, responderCode);
    const links = linkCodes.map((code) => requireCard(session, code));
    moveDuelCard(session.state, linkParty.uid, "hand", 0);
    moveDuelCard(session.state, summon.uid, "deck", 0);
    moveDuelCard(session.state, lowAttackDecoy.uid, "deck", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    links.forEach((card, index) => {
      moveDuelCard(session.state, card.uid, "monsterZone", index < 3 ? 0 : 1);
      card.position = "faceUpAttack";
      card.faceUp = true;
    });
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
    expect(host.loadCardScript(Number(linkPartyCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === linkParty.uid);
    expect(activate, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x1 },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 1);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x1 },
    ]);
    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === summon.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: linkParty.uid,
      reasonEffectId: 1,
    });
    expect(restored.session.state.cards.find((card) => card.uid === lowAttackDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: summon.uid,
        eventUids: [summon.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: linkParty.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 3 },
      },
    ]);
    expect(restored.host.messages).not.toContain("link party responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("link party responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const player = session.state.waitingFor ?? session.state.turnPlayer;
  expect(response.legalActions).toEqual(getLegalActions(session, player));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
