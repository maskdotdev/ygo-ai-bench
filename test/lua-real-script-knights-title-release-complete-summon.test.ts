import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { hasProcedureCompleteStatus, statusProcComplete } from "#duel/procedure-status.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const knightsTitleCode = "87210505";
const hasKnightsTitleScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${knightsTitleCode}.lua`));
const darkMagicianCode = "46986414";
const knightTargetCode = "50725996";
const offCodeTargetCode = "87210506";
const responderCode = "87210507";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const raceSpellcaster = 0x80;
const raceWarrior = 0x1;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasKnightsTitleScript)("Lua real script Knight's Title release complete summon", () => {
  it("restores face-up Dark Magician release cost and procedure-complete Knight Special Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${knightsTitleCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("return c:IsFaceup() and c:IsCode(CARD_DARK_MAGICIAN)");
    expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.costfilter,1,false,nil,nil,ft,tp)");
    expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.costfilter,1,1,false,nil,nil,ft,tp)");
    expect(script).toContain("Duel.Release(g,REASON_COST)");
    expect(script).toContain("return c:IsCode(50725996) and c:IsCanBeSpecialSummoned(e,0,tp,true,true)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_HAND|LOCATION_DECK|LOCATION_GRAVE)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.spfilter),tp,LOCATION_HAND|LOCATION_DECK|LOCATION_GRAVE,0,1,1,nil,e,tp):GetFirst()");
    expect(script).toContain("tc:CompleteProcedure()");

    const cards: DuelCardData[] = [
      { code: knightsTitleCode, name: "Knight's Title", kind: "spell", typeFlags: typeSpell },
      { code: darkMagicianCode, name: "Dark Magician", kind: "monster", typeFlags: typeMonster, race: raceSpellcaster, attribute: attributeDark, level: 7, attack: 2500, defense: 2100 },
      { code: knightTargetCode, name: "Dark Magician Knight", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 7, attack: 2500, defense: 2100 },
      { code: offCodeTargetCode, name: "Knight's Title Off-Code Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 7, attack: 2400, defense: 2000 },
      { code: responderCode, name: "Knight's Title Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 87210505, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [knightsTitleCode, darkMagicianCode, offCodeTargetCode, knightTargetCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const title = requireCard(session, knightsTitleCode);
    const darkMagician = requireCard(session, darkMagicianCode);
    const knight = requireCard(session, knightTargetCode);
    const offCode = requireCard(session, offCodeTargetCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, title.uid, "hand", 0);
    moveDuelCard(session.state, knight.uid, "graveyard", 0);
    moveDuelCard(session.state, offCode.uid, "graveyard", 0);
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
    expect(host.loadCardScript(Number(knightsTitleCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(getLegalActions(session, 0).some((action) => action.type === "activateEffect" && action.uid === title.uid)).toBe(false);

    const movedDarkMagician = moveDuelCard(session.state, darkMagician.uid, "monsterZone", 0);
    movedDarkMagician.position = "faceUpAttack";
    movedDarkMagician.faceUp = true;
    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === title.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);

    expect(session.state.cards.find((card) => card.uid === darkMagician.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.release | duelReason.cost,
      reasonCardUid: title.uid,
      reasonEffectId: 1,
    });
    expect(session.state.chain).toEqual([
      {
        activationLocation: "hand",
        activationSequence: 0,
        chainIndex: 1,
        effectId: "lua-1-1002",
        effectLabel: 1,
        id: "chain-3",
        operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x13 }],
        player: 0,
        sourceUid: title.uid,
      },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 1);
    expect(getLuaRestoreLegalActions(restored, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === title.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === offCode.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === knight.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      sequence: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      customStatusMask: statusProcComplete,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: title.uid,
      reasonEffectId: 1,
    });
    expect(hasProcedureCompleteStatus(restored.session.state.cards.find((card) => card.uid === knight.uid)!)).toBe(true);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "released" && event.eventCardUid === darkMagician.uid)).toEqual([
      {
        eventName: "released",
        eventCode: 1017,
        eventCardUid: darkMagician.uid,
        eventReason: duelReason.release | duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: title.uid,
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
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 2,
        },
      },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === knight.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: knight.uid,
        eventUids: [knight.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: title.uid,
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
    expect(restored.host.messages).not.toContain("knights title responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("knights title responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
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

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player!), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
