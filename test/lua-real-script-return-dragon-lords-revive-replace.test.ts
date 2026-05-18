import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelResponse, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const raceDragon = 0x2000;
const raceWarrior = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Return of the Dragon Lords revive and destroy replacement", () => {
  it("restores its Dragon Graveyard revive and Graveyard destroy replacement banish", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const returnCode = "6853254";
    const dragonTargetCode = "6853255";
    const lowLevelDragonDecoyCode = "6853256";
    const offRaceDecoyCode = "6853257";
    const responderCode = "6853258";
    const script = workspace.readScript(`c${returnCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("return c:IsRace(RACE_DRAGON) and (c:GetLevel()==7 or c:GetLevel()==8) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");
    expect(script).toContain("e2:SetCode(EFFECT_DESTROY_REPLACE)");
    expect(script).toContain("return Duel.SelectEffectYesNo(tp,e:GetHandler(),96)");
    expect(script).toContain("Duel.Remove(e:GetHandler(),POS_FACEUP,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === returnCode),
      { code: dragonTargetCode, name: "Return Dragon Lords Level 8 Dragon Target", kind: "monster", typeFlags: typeMonster, race: raceDragon, level: 8, attack: 2500, defense: 2000 },
      { code: lowLevelDragonDecoyCode, name: "Return Dragon Lords Level 6 Dragon Decoy", kind: "monster", typeFlags: typeMonster, race: raceDragon, level: 6, attack: 1900, defense: 1600 },
      { code: offRaceDecoyCode, name: "Return Dragon Lords Level 8 Warrior Decoy", kind: "monster", typeFlags: typeMonster, race: raceWarrior, level: 8, attack: 2100, defense: 1800 },
      { code: responderCode, name: "Return Dragon Lords Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 6853254, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [returnCode, dragonTargetCode, lowLevelDragonDecoyCode, offRaceDecoyCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const returnSpell = requireCard(session, returnCode);
    const dragonTarget = requireCard(session, dragonTargetCode);
    const lowLevelDragonDecoy = requireCard(session, lowLevelDragonDecoyCode);
    const offRaceDecoy = requireCard(session, offRaceDecoyCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, returnSpell.uid, "hand", 0);
    moveDuelCard(session.state, dragonTarget.uid, "graveyard", 0);
    moveDuelCard(session.state, lowLevelDragonDecoy.uid, "graveyard", 0);
    moveDuelCard(session.state, offRaceDecoy.uid, "graveyard", 0);
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
    expect(host.loadCardScript(Number(returnCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredActivation);
    expectRestoredLegalActions(restoredActivation, 0);
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === returnSpell.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, activation!);
    expect(restoredActivation.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-1-1002",
        sourceUid: returnSpell.uid,
        player: 0,
        activationLocation: "hand",
        activationSequence: 0,
        targetUids: [dragonTarget.uid],
        operationInfos: [{ category: 0x200, targetUids: [dragonTarget.uid], count: 1, player: 0, parameter: 0 }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.session.state.cards.find((card) => card.uid === returnSpell.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === dragonTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
      summonType: "special",
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === lowLevelDragonDecoy.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === offRaceDecoy.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChain.host.messages).not.toContain("return dragon lords responder resolved");
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === dragonTarget.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: dragonTarget.uid,
        eventUids: [dragonTarget.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: returnSpell.uid,
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

    const restoredReplacement = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredReplacement);
    expectRestoredLegalActions(restoredReplacement, 0);
    destroyDuelCard(restoredReplacement.session.state, dragonTarget.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(restoredReplacement.host.promptDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ api: "SelectEffectYesNo", player: 0, description: 96, returned: true }),
    ]));
    expect(restoredReplacement.session.state.cards.find((card) => card.uid === dragonTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
    });
    expect(restoredReplacement.session.state.cards.find((card) => card.uid === returnSpell.uid)).toMatchObject({
      location: "banished",
      previousLocation: "graveyard",
      reason: duelReason.effect,
      faceUp: true,
    });
    expect(restoredReplacement.session.state.log).toContainEqual(expect.objectContaining({ action: "destroyReplace", card: dragonTarget.name }));

    const restoredAfterReplacement = restoreDuelWithLuaScripts(serializeDuel(restoredReplacement.session), source, reader);
    expectCleanRestore(restoredAfterReplacement);
    expectRestoredLegalActions(restoredAfterReplacement, 0);
    const secondDestroy = destroyDuelCard(restoredAfterReplacement.session.state, dragonTarget.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(secondDestroy).toMatchObject({ uid: dragonTarget.uid, location: "graveyard", reason: duelReason.effect | duelReason.destroy });
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
      e:SetOperation(function(e,tp) Debug.Message("return dragon lords responder resolved") end)
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
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
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
