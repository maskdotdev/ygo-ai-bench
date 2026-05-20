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
const mahunderCode = "21524779";
const hasMahunderScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${mahunderCode}.lua`));
const summonTargetCode = "21524780";
const sameCodeDecoyCode = "21524779";
const darkThunderCode = "21524781";
const highLevelCode = "21524782";
const responderCode = "21524783";
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceThunder = 0x1000;
const attributeLight = 0x10;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasMahunderScript)("Lua real script Mahunder ignition Normal Summon", () => {
  it("restores CATEGORY_SUMMON ignition selection and Duel.Summon from hand", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${mahunderCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_SUMMON)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
    expect(script).toContain("return c:IsRace(RACE_THUNDER) and c:IsAttribute(ATTRIBUTE_LIGHT) and c:GetLevel()==4");
    expect(script).toContain("and c:GetCode()~=id and c:IsSummonable(true,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SUMMON,nil,1,0,0)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_HAND,0,1,1,nil)");
    expect(script).toContain("Duel.Summon(tp,tc,true,nil)");

    const cards: DuelCardData[] = [
      { code: mahunderCode, name: "Mahunder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceThunder, attribute: attributeLight, level: 4, attack: 1400, defense: 700 },
      { code: summonTargetCode, name: "Mahunder LIGHT Thunder Summon Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceThunder, attribute: attributeLight, level: 4, attack: 1600, defense: 1000 },
      { code: sameCodeDecoyCode, name: "Mahunder Same-Code Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceThunder, attribute: attributeLight, level: 4, attack: 1400, defense: 700 },
      { code: darkThunderCode, name: "Mahunder DARK Thunder Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceThunder, attribute: attributeDark, level: 4, attack: 1500, defense: 1000 },
      { code: highLevelCode, name: "Mahunder High-Level Thunder Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceThunder, attribute: attributeLight, level: 5, attack: 1900, defense: 1000 },
      { code: responderCode, name: "Mahunder Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 21524779, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [mahunderCode, summonTargetCode, sameCodeDecoyCode, darkThunderCode, highLevelCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const mahunder = requireNthCard(session, mahunderCode, 0);
    const sameCodeDecoy = requireNthCard(session, sameCodeDecoyCode, 1);
    const summonTarget = requireCard(session, summonTargetCode);
    const darkThunder = requireCard(session, darkThunderCode);
    const highLevel = requireCard(session, highLevelCode);
    const responder = requireCard(session, responderCode);
    const fieldMahunder = moveDuelCard(session.state, mahunder.uid, "monsterZone", 0);
    fieldMahunder.position = "faceUpAttack";
    fieldMahunder.faceUp = true;
    for (const card of [summonTarget, sameCodeDecoy, darkThunder, highLevel]) moveDuelCard(session.state, card.uid, "hand", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;
    session.state.players[0].normalSummonAvailable = false;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(mahunderCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === mahunder.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        sourceUid: mahunder.uid,
        player: 0,
        effectId: "lua-1",
        activationLocation: "monsterZone",
        activationSequence: 0,
        operationInfos: [{ category: 0x100, targetUids: [], count: 1, player: 0, parameter: 0 }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    const pass = getLuaRestoreLegalActions(restoredChain, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    expect(pass?.windowKind).toBe("chainResponse");
    applyLuaRestoreAndAssert(restoredChain, pass!);

    expect(restoredChain.session.state.chain).toEqual([]);
    expect(restoredChain.host.messages).not.toContain("mahunder responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === summonTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
      summonType: "normal",
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === sameCodeDecoy.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === darkThunder.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === highLevel.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredChain.session.state.activityCounts[0].normalSummon).toBe(1);
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "normalSummoned")).toEqual([
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: summonTarget.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function requireNthCard(session: DuelSession, code: string, index: number) {
  const card = session.state.cards.filter((candidate) => candidate.code === code)[index];
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
      e:SetOperation(function(e,tp) Debug.Message("mahunder responder resolved") end)
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
