import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
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
const typeEffect = 0x20;
const typeLink = 0x4000000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Spright Red release-cost monster negate", () => {
  it("restores its hand summon procedure, Link-2 release cost, yes/no destroy prompt, negation, and suppressed monster operation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sprightRedCode = "75922381";
    const starterCode = "759223810";
    const drawnCode = "759223811";
    const faceupLevel2Code = "759223812";
    const linkReleaseCode = "759223813";
    const script = workspace.readScript(`c${sprightRedCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_PROC)");
    expect(script).toContain("return c:IsFaceup() and (c:IsLevel(2) or c:IsLink(2))");
    expect(script).toContain("return rp==1-tp and re:IsMonsterEffect() and Duel.IsChainDisablable(ev)");
    expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.discostfilter,1,false,nil,c)");
    expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.discostfilter,1,1,false,nil,c)");
    expect(script).toContain("Duel.NegateEffect(ev)");
    expect(script).toContain("e:GetLabel()==0 and Duel.SelectYesNo(tp,aux.Stringid(id,1))");
    expect(script).toContain("Duel.BreakEffect()");
    expect(script).toContain("Duel.Destroy(eg,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sprightRedCode),
      { code: starterCode, name: "Spright Red Suppressed Monster Effect", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4 },
      { code: drawnCode, name: "Spright Red Suppressed Draw", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: faceupLevel2Code, name: "Spright Red Level 2 Summon Gate", kind: "monster", typeFlags: typeMonster | typeEffect, level: 2, attack: 100, defense: 100 },
      { code: linkReleaseCode, name: "Spright Red Link 2 Release", kind: "monster", typeFlags: typeMonster | typeEffect | typeLink, level: 2, attack: 1000, defense: 0 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 75922381, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [starterCode, drawnCode] }, 1: { main: [sprightRedCode, faceupLevel2Code, linkReleaseCode] } });
    startDuel(session);

    const sprightRed = requireCard(session, sprightRedCode);
    const starter = requireCard(session, starterCode);
    const drawn = requireCard(session, drawnCode);
    const faceupLevel2 = requireCard(session, faceupLevel2Code);
    const linkRelease = requireCard(session, linkReleaseCode);
    moveDuelCard(session.state, starter.uid, "monsterZone", 0);
    starter.position = "faceUpAttack";
    starter.faceUp = true;
    moveDuelCard(session.state, sprightRed.uid, "hand", 1);
    moveDuelCard(session.state, faceupLevel2.uid, "monsterZone", 1);
    faceupLevel2.position = "faceUpAttack";
    faceupLevel2.faceUp = true;
    session.state.phase = "main1";
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return monsterDrawScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    for (const code of [sprightRedCode, starterCode]) {
      const loaded = host.loadCardScript(Number(code), source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(2);

    const restoredSummonWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredSummonWindow);
    expectRestoredLegalActions(restoredSummonWindow, 1);
    const specialSummon = getLuaRestoreLegalActions(restoredSummonWindow, 1).find((action) => action.type === "specialSummonProcedure" && action.uid === sprightRed.uid);
    expect(specialSummon, JSON.stringify(getLuaRestoreLegalActions(restoredSummonWindow, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredSummonWindow, specialSummon!);
    expect(restoredSummonWindow.session.state.cards.find((card) => card.uid === sprightRed.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 1,
    });
    expect(restoredSummonWindow.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: sprightRed.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 1,
        eventPreviousState: {
          controller: 1,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 1,
        },
      },
    ]);

    moveDuelCard(restoredSummonWindow.session.state, faceupLevel2.uid, "graveyard", 1);
    moveDuelCard(restoredSummonWindow.session.state, linkRelease.uid, "monsterZone", 1);
    const restoredLinkRelease = requireCard(restoredSummonWindow.session, linkReleaseCode);
    restoredLinkRelease.position = "faceUpAttack";
    restoredLinkRelease.faceUp = true;
    restoredSummonWindow.session.state.waitingFor = 0;
    const starterAction = getLuaRestoreLegalActions(restoredSummonWindow, 0).find((action) => action.type === "activateEffect" && action.uid === starter.uid);
    expect(starterAction, JSON.stringify(getLuaRestoreLegalActions(restoredSummonWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredSummonWindow, starterAction!);
    expect(restoredSummonWindow.session.state.chain).toHaveLength(1);
    expect(restoredSummonWindow.session.state.chain[0]).toEqual({
      activationLocation: "monsterZone",
      activationSequence: 0,
      chainIndex: 1,
      effectId: "lua-1",
      id: "chain-4",
      operationInfos: [{ category: 0x10000, targetUids: [], count: 0, player: 0, parameter: 1 }],
      player: 0,
      sourceUid: starter.uid,
    });

    const restoredOpenChain = restoreDuelWithLuaScripts(serializeDuel(restoredSummonWindow.session), source, reader);
    expectCleanRestore(restoredOpenChain);
    expectRestoredLegalActions(restoredOpenChain, 1);
    const redAction = getLuaRestoreLegalActions(restoredOpenChain, 1).find((action) => action.type === "activateEffect" && action.uid === sprightRed.uid);
    expect(redAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpenChain, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpenChain, redAction!);
    expect(restoredOpenChain.session.state.cards.find((card) => card.uid === linkRelease.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "monsterZone",
      previousController: 1,
      reasonPlayer: 1,
    });
    expect(restoredOpenChain.session.state.eventHistory.filter((event) => event.eventName === "released" && event.eventCardUid === linkRelease.uid)).toEqual([
      {
        eventName: "released",
        eventCode: 1017,
        eventCardUid: linkRelease.uid,
        eventPreviousState: {
          controller: 1,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 1,
        },
        eventReason: duelReason.cost | duelReason.release,
        eventReasonPlayer: 1,
        eventReasonCardUid: sprightRed.uid,
        eventReasonEffectId: 3,
      },
    ]);
    expect(restoredOpenChain.session.state.chain).toHaveLength(0);
    expect(restoredOpenChain.host.promptDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ api: "SelectYesNo", player: 1, returned: true }),
    ]));
    expect(restoredOpenChain.session.state.cards.find((card) => card.uid === starter.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredOpenChain.session.state.cards.find((card) => card.uid === sprightRed.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restoredOpenChain.session.state.cards.find((card) => card.uid === drawn.uid)).toMatchObject({ location: "deck" });
    expect(restoredOpenChain.host.messages).not.toContain("spright red monster resolved");
    expect(restoredOpenChain.session.state.eventHistory.filter((event) => ["destroyed", "chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: starter.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: sprightRed.uid,
        eventReasonEffectId: 3,
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
          sequence: 0,
        },
      },
      {
        eventName: "chainNegated",
        eventCode: 1024,
        eventPlayer: 0,
        eventValue: 1,
        eventReasonPlayer: 0,
        eventChainDepth: 1,
        eventChainLinkId: "chain-4",
        relatedEffectId: 1,
      },
      {
        eventName: "chainDisabled",
        eventCode: 1025,
        eventPlayer: 0,
        eventValue: 1,
        eventReasonPlayer: 0,
        eventChainDepth: 1,
        eventChainLinkId: "chain-4",
        relatedEffectId: 1,
      },
    ]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpenChain.session), source, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, restoredResolved.session.state.waitingFor ?? restoredResolved.session.state.turnPlayer);
    expect(restoredResolved.session.state.chain).toHaveLength(0);
    expect(restoredResolved.session.state.cards.find((card) => card.uid === drawn.uid)).toMatchObject({ location: "deck" });
    expect(restoredResolved.host.messages).not.toContain("spright red monster resolved");
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

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
        Debug.Message("spright red monster resolved")
        Duel.Draw(tp,1,REASON_EFFECT)
      end)
      c:RegisterEffect(e)
    end
  `;
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
