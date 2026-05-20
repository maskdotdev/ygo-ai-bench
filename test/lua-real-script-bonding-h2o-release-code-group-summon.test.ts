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
const bondingCode = "45898858";
const hasBondingScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${bondingCode}.lua`));
const oxygeddonCode = "58071123";
const hydrogeddonCode = "22587018";
const waterDragonCode = "85066822";
const offCodeDecoyCode = "45898859";
const responderCode = "45898860";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const raceDinosaur = 0x10000;
const attributeWater = 0x2;
const attributeFire = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasBondingScript)("Lua real script Bonding H2O release code-group summon", () => {
  it("restores three-monster Card.IsCode release cost and Special Summons Water Dragon with procedure complete", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${bondingCode}.lua`);
    expect(script).toContain("Duel.CheckReleaseGroupCost(tp,Card.IsCode,3,nil,s.spcheck,nil,22587018,58071123)");
    expect(script).toContain("Duel.SelectReleaseGroupCost(tp,Card.IsCode,3,3,nil,s.spcheck,nil,22587018,58071123)");
    expect(script).toContain("aux.ReleaseCheckMMZ(sg,tp)");
    expect(script).toContain("return c:IsCode(58071123) and sg:IsExists(Card.IsCode,2,c,22587018)");
    expect(script).toContain("Duel.Release(sg,REASON_COST)");
    expect(script).toContain("return c:IsCode(85066822) and c:IsCanBeSpecialSummoned(e,0,tp,true,true)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_HAND|LOCATION_DECK|LOCATION_GRAVE)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.spfilter),tp,LOCATION_HAND|LOCATION_DECK|LOCATION_GRAVE,0,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,true,true,POS_FACEUP)");
    expect(script).toContain("g:GetFirst():CompleteProcedure()");

    const cards: DuelCardData[] = [
      { code: bondingCode, name: "Bonding - H2O", kind: "spell", typeFlags: typeSpell },
      { code: oxygeddonCode, name: "Oxygeddon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDinosaur, attribute: attributeFire, level: 4, attack: 1800, defense: 800 },
      { code: hydrogeddonCode, name: "Hydrogeddon A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDinosaur, attribute: attributeWater, level: 4, attack: 1600, defense: 1000 },
      { code: hydrogeddonCode, name: "Hydrogeddon B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDinosaur, attribute: attributeWater, level: 4, attack: 1600, defense: 1000 },
      { code: waterDragonCode, name: "Water Dragon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDinosaur, attribute: attributeWater, level: 8, attack: 2800, defense: 2600 },
      { code: offCodeDecoyCode, name: "Bonding Off-Code Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDinosaur, attribute: attributeWater, level: 4, attack: 1500, defense: 1000 },
      { code: responderCode, name: "Bonding Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDinosaur, attribute: attributeWater, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 45898858, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [bondingCode, oxygeddonCode, hydrogeddonCode, hydrogeddonCode, offCodeDecoyCode, waterDragonCode] },
      1: { main: [responderCode] },
    });
    startDuel(session);

    const bonding = requireNthCard(session, bondingCode, 0);
    const oxygeddon = requireNthCard(session, oxygeddonCode, 0);
    const hydroA = requireNthCard(session, hydrogeddonCode, 0);
    const hydroB = requireNthCard(session, hydrogeddonCode, 1);
    const waterDragon = requireNthCard(session, waterDragonCode, 0);
    const offCodeDecoy = requireNthCard(session, offCodeDecoyCode, 0);
    const responder = requireNthCard(session, responderCode, 0);
    moveDuelCard(session.state, bonding.uid, "hand", 0);
    moveDuelCard(session.state, offCodeDecoy.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, waterDragon.uid, "graveyard", 0);
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
    expect(host.loadCardScript(Number(bondingCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(getLegalActions(session, 0).some((action) => action.type === "activateEffect" && action.uid === bonding.uid)).toBe(false);

    moveDuelCard(session.state, oxygeddon.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, hydroA.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, hydroB.uid, "monsterZone", 0).position = "faceUpAttack";
    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === bonding.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);

    for (const released of [oxygeddon, hydroA, hydroB]) {
      expect(session.state.cards.find((card) => card.uid === released.uid)).toMatchObject({
        location: "graveyard",
        reason: duelReason.release | duelReason.cost,
        reasonCardUid: bonding.uid,
        reasonEffectId: 1,
      });
    }
    expect(session.state.cards.find((card) => card.uid === offCodeDecoy.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(session.state.chain).toEqual([
      {
        activationLocation: "hand",
        activationSequence: 0,
        chainIndex: 1,
        effectId: "lua-1-1002",
        effectLabel: 100,
        id: "chain-5",
        operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x13 }],
        player: 0,
        sourceUid: bonding.uid,
      },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 1);
    expect(getLuaRestoreLegalActions(restored, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === bonding.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === offCodeDecoy.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === waterDragon.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      sequence: 1,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      customStatusMask: statusProcComplete,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: bonding.uid,
      reasonEffectId: 1,
    });
    expect(hasProcedureCompleteStatus(restored.session.state.cards.find((card) => card.uid === waterDragon.uid)!)).toBe(true);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "released" && [oxygeddon.uid, hydroA.uid, hydroB.uid].includes(event.eventCardUid ?? ""))).toEqual([
      releaseEvent(oxygeddon.uid, bonding.uid, 1, 1),
      releaseEvent(hydroA.uid, bonding.uid, 2, 2),
      releaseEvent(hydroB.uid, bonding.uid, 3, 3),
      releaseEvent(oxygeddon.uid, bonding.uid, 1, 1, [oxygeddon.uid, hydroA.uid, hydroB.uid]),
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === waterDragon.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: waterDragon.uid,
        eventUids: [waterDragon.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: bonding.uid,
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
          sequence: 1,
        },
      },
    ]);
    expect(restored.host.messages).not.toContain("bonding responder resolved");
  });
});

function releaseEvent(cardUid: string, sourceUid: string, previousSequence: number, graveSequence: number, eventUids?: string[]) {
  return {
    eventName: "released",
    eventCode: 1017,
    eventCardUid: cardUid,
    eventReason: duelReason.release | duelReason.cost,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
    eventPreviousState: {
      controller: 0,
      faceUp: true,
      location: "monsterZone",
      position: "faceUpAttack",
      sequence: previousSequence,
    },
    eventCurrentState: {
      controller: 0,
      faceUp: true,
      location: "graveyard",
      position: "faceUpAttack",
      sequence: graveSequence,
    },
    ...(eventUids === undefined ? {} : { eventUids }),
  };
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
      e:SetOperation(function(e,tp) Debug.Message("bonding responder resolved") end)
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
