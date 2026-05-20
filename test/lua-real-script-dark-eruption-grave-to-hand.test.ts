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
const darkEruptionCode = "674561";
const hasDarkEruptionScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${darkEruptionCode}.lua`));
const darkLowAttackCode = "674562";
const darkHighAttackCode = "674563";
const lightLowAttackCode = "674564";
const responderCode = "674565";
const typeMonster = 0x1;
const typeSpell = 0x2;
const attributeDark = 0x20;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasDarkEruptionScript)("Lua real script Dark Eruption grave to hand", () => {
  it("restores targeted low-ATK DARK Graveyard monster return through GetFirstTarget", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${darkEruptionCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("return c:IsAttackBelow(1500) and c:IsAttribute(ATTRIBUTE_DARK) and c:IsAbleToHand()");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,g,1,0,0)");
    expect(script).toContain("local tc=Duel.GetFirstTarget()");
    expect(script).toContain("tc:IsRelateToEffect(e)");
    expect(script).toContain("Duel.SendtoHand(tc,nil,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      { code: darkEruptionCode, name: "Dark Eruption", kind: "spell", typeFlags: typeSpell },
      { code: darkLowAttackCode, name: "Dark Eruption DARK Target", kind: "monster", typeFlags: typeMonster, attribute: attributeDark, level: 4, attack: 1500, defense: 1000 },
      { code: darkHighAttackCode, name: "Dark Eruption High ATK Decoy", kind: "monster", typeFlags: typeMonster, attribute: attributeDark, level: 4, attack: 1600, defense: 1000 },
      { code: lightLowAttackCode, name: "Dark Eruption LIGHT Decoy", kind: "monster", typeFlags: typeMonster, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Dark Eruption Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 674561, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [darkEruptionCode, darkLowAttackCode, darkHighAttackCode, lightLowAttackCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const darkEruption = requireCard(session, darkEruptionCode);
    const darkLowAttack = requireCard(session, darkLowAttackCode);
    const darkHighAttack = requireCard(session, darkHighAttackCode);
    const lightLowAttack = requireCard(session, lightLowAttackCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, darkEruption.uid, "hand", 0);
    moveDuelCard(session.state, darkLowAttack.uid, "graveyard", 0).faceUp = true;
    moveDuelCard(session.state, darkHighAttack.uid, "graveyard", 0).faceUp = true;
    moveDuelCard(session.state, lightLowAttack.uid, "graveyard", 0).faceUp = true;
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(darkEruptionCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const action = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === darkEruption.uid);
    expect(action, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, action!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x8, targetUids: [darkLowAttack.uid], count: 1, player: 0, parameter: 0 },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 1);
    expect(restored.session.state.chain).toHaveLength(1);
    expect(restored.session.state.chain[0]?.targetUids).toEqual([darkLowAttack.uid]);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x8, targetUids: [darkLowAttack.uid], count: 1, player: 0, parameter: 0 },
    ]);
    const pass = getLuaRestoreLegalActions(restored, 1).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);

    expect(restored.session.state.cards.find((card) => card.uid === darkEruption.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === darkLowAttack.uid)).toMatchObject({ location: "hand", controller: 0, reason: duelReason.effect });
    expect(restored.session.state.cards.find((card) => card.uid === darkHighAttack.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === lightLowAttack.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "sentToHand")).toEqual([
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: darkLowAttack.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: darkEruption.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);
    expect(restored.host.messages).not.toContain("dark eruption responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("dark eruption responder resolved") end)
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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}
