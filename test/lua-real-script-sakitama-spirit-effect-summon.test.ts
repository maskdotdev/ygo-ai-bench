import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpirit = 0x200;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Sakitama Spirit effect summon", () => {
  it("restores its hand ignition effect and resolves an immediate Spirit Normal Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sakitamaCode = "67972302";
    const spiritTargetCode = "94972302";
    const invalidMonsterCode = "94972303";
    const responderCode = "94972304";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sakitamaCode),
      { code: spiritTargetCode, name: "Sakitama Spirit Target", kind: "monster", typeFlags: typeMonster | typeEffect | typeSpirit, level: 4 },
      { code: invalidMonsterCode, name: "Sakitama Invalid Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4 },
      { code: responderCode, name: "Sakitama Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 679, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sakitamaCode, spiritTargetCode, invalidMonsterCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const sakitama = session.state.cards.find((card) => card.code === sakitamaCode && card.location === "deck");
    const spiritTarget = session.state.cards.find((card) => card.code === spiritTargetCode);
    const invalidMonster = session.state.cards.find((card) => card.code === invalidMonsterCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(sakitama).toBeDefined();
    expect(spiritTarget).toBeDefined();
    expect(invalidMonster).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, sakitama!.uid, "hand", 0);
    moveDuelCard(session.state, spiritTarget!.uid, "hand", 0);
    moveDuelCard(session.state, invalidMonster!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sakitamaCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpenWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredOpenWindow.restoreComplete, restoredOpenWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredOpenWindow.missingRegistryKeys).toEqual([]);
    expect(restoredOpenWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredOpenWindow, 0);
    expect(getLuaRestoreLegalActions(restoredOpenWindow, 0)).toEqual(getDuelLegalActions(restoredOpenWindow.session, 0));
    const effect = getLuaRestoreLegalActions(restoredOpenWindow, 0).find((action) => action.type === "activateEffect" && action.uid === sakitama!.uid);
    expect(effect, JSON.stringify(getLuaRestoreLegalActions(restoredOpenWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpenWindow, effect!);
    expect(restoredOpenWindow.session.state.chain).toHaveLength(1);
    expect(restoredOpenWindow.session.state.chain[0]).toMatchObject({
      sourceUid: sakitama!.uid,
      operationInfos: [{ category: 0x100, targetUids: [], count: 1, player: 0, parameter: 0x2 }],
    });
    expect(restoredOpenWindow.host.messages).toContain(`confirmed 1: ${sakitamaCode}`);

    const restoredChainWindow = restoreDuelWithLuaScripts(serializeDuel(restoredOpenWindow.session), source, reader);
    expect(restoredChainWindow.restoreComplete, restoredChainWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChainWindow.missingRegistryKeys).toEqual([]);
    expect(restoredChainWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredChainWindow, 1);
    expect(getLuaRestoreLegalActions(restoredChainWindow, 1)).toEqual(getDuelLegalActions(restoredChainWindow.session, 1));
    const pass = getLuaRestoreLegalActions(restoredChainWindow, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restoredChainWindow, 1), null, 2)).toBeDefined();
    const resolved = applyLuaRestoreResponse(restoredChainWindow, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === spiritTarget!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "normal",
    });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === invalidMonster!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === sakitama!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredChainWindow.host.messages).not.toContain("sakitama responder resolved");
  });

  it("restores its release trigger and returns a Spirit monster from Graveyard to hand", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sakitamaCode = "67972302";
    const graveSpiritCode = "94972305";
    const releaseStarterCode = "94972306";
    const responderCode = "94972307";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sakitamaCode),
      { code: graveSpiritCode, name: "Sakitama Grave Spirit", kind: "monster", typeFlags: typeMonster | typeEffect | typeSpirit, level: 4 },
      { code: releaseStarterCode, name: "Sakitama Release Starter", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: responderCode, name: "Sakitama Release Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 680, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sakitamaCode, graveSpiritCode, releaseStarterCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const sakitama = session.state.cards.find((card) => card.code === sakitamaCode && card.location === "deck");
    const graveSpirit = session.state.cards.find((card) => card.code === graveSpiritCode);
    const starter = session.state.cards.find((card) => card.code === releaseStarterCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(sakitama).toBeDefined();
    expect(graveSpirit).toBeDefined();
    expect(starter).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, sakitama!.uid, "monsterZone", 0);
    moveDuelCard(session.state, graveSpirit!.uid, "graveyard", 0);
    moveDuelCard(session.state, starter!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    sakitama!.faceUp = true;
    sakitama!.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${releaseStarterCode}.lua`) return releaseStarterScript(sakitamaCode);
        if (name === `c${responderCode}.lua`) return releaseResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sakitamaCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(releaseStarterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const restoredOpenWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredOpenWindow.restoreComplete, restoredOpenWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredOpenWindow.missingRegistryKeys).toEqual([]);
    expect(restoredOpenWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredOpenWindow, 0);
    expect(getLuaRestoreLegalActions(restoredOpenWindow, 0)).toEqual(getDuelLegalActions(restoredOpenWindow.session, 0));
    const releaseEffect = getLuaRestoreLegalActions(restoredOpenWindow, 0).find((action) => action.type === "activateEffect" && action.uid === starter!.uid);
    expect(releaseEffect, JSON.stringify(getLuaRestoreLegalActions(restoredOpenWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpenWindow, releaseEffect!);

    const restoredReleaseChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpenWindow.session), source, reader);
    expect(restoredReleaseChain.restoreComplete, restoredReleaseChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredReleaseChain.missingRegistryKeys).toEqual([]);
    expect(restoredReleaseChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredReleaseChain, 1);
    expect(getLuaRestoreLegalActions(restoredReleaseChain, 1)).toEqual(getDuelLegalActions(restoredReleaseChain.session, 1));
    const releasePass = getLuaRestoreLegalActions(restoredReleaseChain, 1).find((action) => action.type === "passChain");
    expect(releasePass, JSON.stringify(getLuaRestoreLegalActions(restoredReleaseChain, 1), null, 2)).toBeDefined();
    const releaseResolved = applyLuaRestoreResponse(restoredReleaseChain, releasePass!);
    expect(releaseResolved.ok, releaseResolved.error).toBe(true);
    expect(restoredReleaseChain.session.state.cards.find((card) => card.uid === sakitama!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredReleaseChain.session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "released", eventCode: 1017, eventCardUid: sakitama!.uid })]),
    );

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredReleaseChain.session), source, reader);
    expect(restoredTriggerWindow.restoreComplete, restoredTriggerWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTriggerWindow.missingRegistryKeys).toEqual([]);
    expect(restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    expect(getLuaRestoreLegalActions(restoredTriggerWindow, 0)).toEqual(getDuelLegalActions(restoredTriggerWindow.session, 0));
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === sakitama!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTriggerWindow, trigger!);
    expect(restoredTriggerWindow.session.state.chain).toHaveLength(1);
    expect(restoredTriggerWindow.session.state.chain[0]).toMatchObject({
      sourceUid: sakitama!.uid,
      eventName: "released",
      eventCardUid: sakitama!.uid,
      targetUids: [graveSpirit!.uid],
      operationInfos: [{ category: 0x8, targetUids: [graveSpirit!.uid], count: 1, player: 0, parameter: 0 }],
    });

    const restoredTriggerChain = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
    expect(restoredTriggerChain.restoreComplete, restoredTriggerChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTriggerChain.missingRegistryKeys).toEqual([]);
    expect(restoredTriggerChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTriggerChain, 1);
    expect(getLuaRestoreLegalActions(restoredTriggerChain, 1)).toEqual(getDuelLegalActions(restoredTriggerChain.session, 1));
    const triggerPass = getLuaRestoreLegalActions(restoredTriggerChain, 1).find((action) => action.type === "passChain");
    expect(triggerPass, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerChain, 1), null, 2)).toBeDefined();
    const triggerResolved = applyLuaRestoreResponse(restoredTriggerChain, triggerPass!);
    expect(triggerResolved.ok, triggerResolved.error).toBe(true);

    expect(restoredTriggerChain.session.state.cards.find((card) => card.uid === graveSpirit!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredTriggerChain.host.messages).not.toContain("sakitama release responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("sakitama responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function releaseStarterScript(sakitamaCode: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp)
        local g=Duel.SelectMatchingCard(tp,aux.FilterBoolFunction(Card.IsCode,${sakitamaCode}),tp,LOCATION_MZONE,0,1,1,nil)
        Duel.Release(g,REASON_EFFECT)
      end)
      c:RegisterEffect(e)
    end
  `;
}

function releaseResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("sakitama release responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(
    getLuaRestoreLegalActions(restored, player),
  );
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
}
