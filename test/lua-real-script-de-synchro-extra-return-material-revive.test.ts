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
const hasDeSynchroScript = fs.existsSync(path.join(upstreamRoot, "script", "official", "c32441317.lua"));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeSynchro = 0x2000;
const raceWarrior = 0x1;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasDeSynchroScript)("Lua real script De-Synchro Extra return material revive", () => {
  it("restores targeted Synchro return, SelectYesNo prompt, and material Special Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const deSynchroCode = "32441317";
    const synchroCode = "32441318";
    const tunerCode = "32441319";
    const nonTunerCode = "32441320";
    const fusionDecoyCode = "32441321";
    const responderCode = "32441322";
    const script = workspace.readScript(`c${deSynchroCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_TODECK+CATEGORY_SPECIAL_SUMMON)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("return c:IsFaceup() and c:IsType(TYPE_SYNCHRO) and c:IsAbleToExtra()");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TODECK,g,1,0,0)");
    expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_GRAVE)");
    expect(script).toContain("local mg=tc:GetMaterial()");
    expect(script).toContain("c:GetReason()&(REASON_SYNCHRO|REASON_MATERIAL))==(REASON_SYNCHRO|REASON_MATERIAL) and c:GetReasonCard()==sync");
    expect(script).toContain("Duel.SendtoDeck(tc,nil,SEQ_DECKTOP,REASON_EFFECT)");
    expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,0))");
    expect(script).toContain("Duel.BreakEffect()");
    expect(script).toContain("Duel.SpecialSummon(mg,0,tp,tp,false,false,POS_FACEUP)");

    const cards: DuelCardData[] = [
      { code: deSynchroCode, name: "De-Synchro", kind: "spell", typeFlags: typeSpell },
      { code: synchroCode, name: "De-Synchro Synchro Target", kind: "extra", typeFlags: typeMonster | typeSynchro, race: raceWarrior, attribute: attributeDark, level: 6, attack: 2400, defense: 1800 },
      { code: tunerCode, name: "De-Synchro Tuner Material", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeDark, level: 2, attack: 800, defense: 600 },
      { code: nonTunerCode, name: "De-Synchro Non-Tuner Material", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1600, defense: 1200 },
      { code: fusionDecoyCode, name: "De-Synchro Non-Synchro Decoy", kind: "extra", typeFlags: typeMonster, race: raceWarrior, attribute: attributeDark, level: 6, attack: 2300, defense: 1700 },
      { code: responderCode, name: "De-Synchro Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 32441317, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [deSynchroCode, tunerCode, nonTunerCode], extra: [synchroCode, fusionDecoyCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const deSynchro = requireCard(session, deSynchroCode);
    const synchro = requireCard(session, synchroCode);
    const tuner = requireCard(session, tunerCode);
    const nonTuner = requireCard(session, nonTunerCode);
    const fusionDecoy = requireCard(session, fusionDecoyCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, deSynchro.uid, "hand", 0);
    const movedSynchro = moveDuelCard(session.state, synchro.uid, "monsterZone", 0);
    movedSynchro.position = "faceUpAttack";
    movedSynchro.summonType = "synchro";
    movedSynchro.summonMaterialUids = [tuner.uid, nonTuner.uid];
    for (const material of [tuner, nonTuner]) {
      const moved = moveDuelCard(session.state, material.uid, "graveyard", 0);
      moved.reason = duelReason.synchro | duelReason.material;
      moved.reasonPlayer = 0;
      moved.reasonCardUid = synchro.uid;
      moved.faceUp = true;
    }
    moveDuelCard(session.state, fusionDecoy.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.turn = 2;
    session.state.turnPlayer = 0;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(deSynchroCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === deSynchro.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toEqual({
      activationLocation: "hand",
      activationSequence: 0,
      chainIndex: 1,
      effectId: "lua-1-1002",
      id: "chain-2",
      operationInfos: [
        { category: 0x10, targetUids: [synchro.uid], count: 1, player: 0, parameter: 0 },
      ],
      possibleOperationInfos: [
        { category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x10 },
      ],
      player: 0,
      sourceUid: deSynchro.uid,
      targetUids: [synchro.uid],
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored, 1);
    expect(getLuaRestoreLegalActions(restored, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);

    passChain(restored);

    expect(restored.session.state.chain).toHaveLength(0);
    expect(restored.host.promptDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ api: "SelectYesNo", player: 0, returned: true }),
    ]));
    expect(restored.session.state.cards.find((card) => card.uid === deSynchro.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === synchro.uid)).toMatchObject({ location: "extraDeck", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === tuner.uid)).toMatchObject({ location: "monsterZone", controller: 0, summonType: "special" });
    expect(restored.session.state.cards.find((card) => card.uid === nonTuner.uid)).toMatchObject({ location: "monsterZone", controller: 0, summonType: "special" });
    expect(restored.session.state.cards.find((card) => card.uid === fusionDecoy.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restored.host.messages).not.toContain("de-synchro responder resolved");
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "sentToDeck" && event.eventCardUid === synchro.uid)).toEqual([
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: synchro.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: deSynchro.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: false,
          location: "extraDeck",
          position: "faceDown",
          sequence: 0,
        },
      },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid !== undefined && [tuner.uid, nonTuner.uid].includes(event.eventCardUid))).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: tuner.uid,
        eventUids: [tuner.uid, nonTuner.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: deSynchro.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
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
      e:SetOperation(function(e,tp) Debug.Message("de-synchro responder resolved") end)
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
  return response;
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function passChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player!), null, 2)).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
  }
}
