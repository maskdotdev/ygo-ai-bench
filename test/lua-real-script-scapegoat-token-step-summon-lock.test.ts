import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelResponse, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const scapegoatCode = "73915051";
const hasScapegoatScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${scapegoatCode}.lua`));
const sheepTokenCodes = ["73915052", "73915053", "73915054", "73915055"];
const responderCode = "73915060";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeQuickplay = 0x10000;
const typesToken = 0x4011;
const raceBeast = 0x4000;
const attributeEarth = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasScapegoatScript)("Lua real script Scapegoat token step summon lock", () => {
  it("restores staged Token Special Summons and same-turn summon oath locks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${scapegoatCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_TOKEN)");
    expect(script).toContain("Duel.GetActivityCount(tp,ACTIVITY_SUMMON)==0");
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)");
    expect(script).toContain("e2:SetCode(EFFECT_CANNOT_SUMMON)");
    expect(script).toContain("e3:SetCode(EFFECT_CANNOT_FLIP_SUMMON)");
    expect(script).toContain("Duel.IsPlayerCanSpecialSummonMonster(tp,id+1,0,TYPES_TOKEN,0,0,1,RACE_BEAST,ATTRIBUTE_EARTH)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOKEN,nil,4,0,0)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,4,tp,0)");
    expect(script).toContain("local token=Duel.CreateToken(tp,id+i)");
    expect(script).toContain("Duel.SpecialSummonStep(token,0,tp,tp,false,false,POS_FACEUP_DEFENSE)");
    expect(script).toContain("e1:SetCode(EFFECT_UNRELEASABLE_SUM)");
    expect(script).toContain("Duel.SpecialSummonComplete()");

    const cards: DuelCardData[] = [
      { code: scapegoatCode, name: "Scapegoat", kind: "spell", typeFlags: typeSpell | typeQuickplay },
      ...sheepTokenCodes.map((code) => ({ code, name: "Sheep Token", kind: "monster" as const, typeFlags: typesToken, race: raceBeast, attribute: attributeEarth, level: 1, attack: 0, defense: 0 })),
      { code: responderCode, name: "Scapegoat Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 73915051, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [scapegoatCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const scapegoat = requireCard(session, scapegoatCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, scapegoat.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(scapegoatCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === scapegoat.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);
    expect(session.state.effects.filter((effect) => effect.sourceUid === scapegoat.uid && [20, 21, 22].includes(effect.code ?? -1))).toEqual([
      expect.objectContaining({ code: 22, targetRange: [1, 0] }),
      expect.objectContaining({ code: 20, targetRange: [1, 0] }),
      expect.objectContaining({ code: 21, targetRange: [1, 0] }),
    ]);
    expect(session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-1-1002",
        sourceUid: scapegoat.uid,
        player: 0,
        activationLocation: "hand",
        activationSequence: 0,
        operationInfos: [
          { category: 0x400, targetUids: [], count: 4, player: 0, parameter: 0 },
          { category: 0x200, targetUids: [], count: 4, player: 0, parameter: 0 },
        ],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("scapegoat responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === scapegoat.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.rule,
    });
    const tokens = restoredChain.session.state.cards.filter((card) => sheepTokenCodes.includes(card.code));
    expect(tokens).toHaveLength(4);
    expect(tokens.map((token) => ({
      location: token.location,
      controller: token.controller,
      owner: token.owner,
      faceUp: token.faceUp,
      position: token.position,
      typeFlags: token.data.typeFlags,
      race: token.data.race,
      attribute: token.data.attribute,
      reason: token.reason,
      reasonCardUid: token.reasonCardUid,
      reasonEffectId: token.reasonEffectId,
    }))).toEqual([
      { location: "monsterZone", controller: 0, owner: 0, faceUp: true, position: "faceUpDefense", typeFlags: typesToken, race: raceBeast, attribute: attributeEarth, reason: duelReason.summon | duelReason.specialSummon, reasonCardUid: scapegoat.uid, reasonEffectId: 1 },
      { location: "monsterZone", controller: 0, owner: 0, faceUp: true, position: "faceUpDefense", typeFlags: typesToken, race: raceBeast, attribute: attributeEarth, reason: duelReason.summon | duelReason.specialSummon, reasonCardUid: scapegoat.uid, reasonEffectId: 1 },
      { location: "monsterZone", controller: 0, owner: 0, faceUp: true, position: "faceUpDefense", typeFlags: typesToken, race: raceBeast, attribute: attributeEarth, reason: duelReason.summon | duelReason.specialSummon, reasonCardUid: scapegoat.uid, reasonEffectId: 1 },
      { location: "monsterZone", controller: 0, owner: 0, faceUp: true, position: "faceUpDefense", typeFlags: typesToken, race: raceBeast, attribute: attributeEarth, reason: duelReason.summon | duelReason.specialSummon, reasonCardUid: scapegoat.uid, reasonEffectId: 1 },
    ]);
    expect(restoredChain.session.state.effects.filter((effect) => tokens.some((token) => token.uid === effect.sourceUid) && effect.code === 43)).toHaveLength(4);
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && tokens.some((token) => token.uid === event.eventCardUid))).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: tokens[0]!.uid,
        eventUids: tokens.map((token) => token.uid),
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: scapegoat.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 0 },
      },
    ]);
  });
});

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
      e:SetOperation(function(e,tp) Debug.Message("scapegoat responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
