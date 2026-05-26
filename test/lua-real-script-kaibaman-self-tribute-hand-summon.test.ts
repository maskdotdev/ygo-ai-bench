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
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Kaibaman self-tribute hand summon", () => {
  it("restores self-tribute zone freeing and hand Special Summon selection", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const kaibamanCode = "34627841";
    const blueEyesCode = "89631139";
    const handDecoyCode = "34627842";
    const blockerCodes = ["34627843", "34627844", "34627845", "34627846"];
    const responderCode = "34627847";
    const kaibamanScript = workspace.readScript(`c${kaibamanCode}.lua`);
    expect(kaibamanScript).toContain("e1:SetCost(Cost.SelfTribute)");
    expect(kaibamanScript).toContain("if e:GetHandler():GetSequence()<5 then ft=ft+1 end");
    expect(kaibamanScript).toContain("Duel.IsExistingMatchingCard(s.filter,tp,LOCATION_HAND,0,1,nil,e,tp)");
    expect(kaibamanScript).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_HAND)");
    expect(kaibamanScript).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === kaibamanCode || card.code === blueEyesCode),
      { code: handDecoyCode, name: "Kaibaman Hand Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 8, attack: 2500, defense: 2000 },
      ...blockerCodes.map((code, index) => ({ code, name: `Kaibaman Zone Blocker ${index + 1}`, kind: "monster" as const, typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 })),
      { code: responderCode, name: "Kaibaman Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 34627841, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [kaibamanCode, blueEyesCode, handDecoyCode, ...blockerCodes] },
      1: { main: [responderCode] },
    });
    startDuel(session);

    const kaibaman = requireCard(session, kaibamanCode);
    const blueEyes = requireCard(session, blueEyesCode);
    const handDecoy = requireCard(session, handDecoyCode);
    const blockers = blockerCodes.map((code) => requireCard(session, code));
    const responder = requireCard(session, responderCode);
    blockers.forEach((blocker, sequence) => {
      const moved = moveDuelCard(session.state, blocker.uid, "monsterZone", 0);
      moved.sequence = sequence;
      moved.faceUp = true;
      moved.position = "faceUpAttack";
    });
    const movedKaibaman = moveDuelCard(session.state, kaibaman.uid, "monsterZone", 0);
    movedKaibaman.sequence = 4;
    movedKaibaman.faceUp = true;
    movedKaibaman.position = "faceUpAttack";
    moveDuelCard(session.state, blueEyes.uid, "hand", 0);
    moveDuelCard(session.state, handDecoy.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(kaibamanCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === kaibaman.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);

    expect(session.state.cards.find((card) => card.uid === kaibaman.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.release | duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: kaibaman.uid,
    });
    expect(session.state.cards.find((card) => card.uid === blueEyes.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(session.state.chain[0]).toEqual({
      activationLocation: "monsterZone",
      activationSequence: 4,
      chainIndex: 1,
      effectId: "lua-1",
      id: "chain-3",
      operationInfos: [{ category: 0x200, count: 1, parameter: 0x2, player: 0, targetUids: [] }],
      player: 0,
      sourceUid: kaibaman.uid,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 1);
    expect(restored.session.state.chain[0]).toEqual(session.state.chain[0]);
    expect(getLuaRestoreLegalActions(restored, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);

    passChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === kaibaman.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === handDecoy.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === blueEyes.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      sequence: 4,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: kaibaman.uid,
      reasonEffectId: 1,
    });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "released" && event.eventCardUid === kaibaman.uid)).toEqual([
      {
        eventName: "released",
        eventCode: 1017,
        eventCardUid: kaibaman.uid,
        eventReason: duelReason.release | duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: kaibaman.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 4,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === blueEyes.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: blueEyes.uid,
        eventUids: [blueEyes.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: kaibaman.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 4,
        },
      },
    ]);
    expect(host.messages).not.toContain("kaibaman responder resolved");
    expect(restored.host.messages).not.toContain("kaibaman responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("kaibaman responder resolved") end)
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

function passChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
  }
}
