import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const mirrorCode = "53341729";
const lightMonsterCode = "533417290";
const darkMonsterCode = "533417291";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasMirrorScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${mirrorCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const attributeLight = 0x10;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasMirrorScript)("Lua real script Light-Imprisoning Mirror chain activating negate", () => {
  it("restores EVENT_CHAIN_ACTIVATING continuous negation of a LIGHT monster effect from field", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${mirrorCode}.lua`);
    expect(script).toContain("e2:SetCode(EVENT_CHAIN_ACTIVATING)");
    expect(script).toContain("Duel.GetChainInfo(ev,CHAININFO_TRIGGERING_LOCATION)");
    expect(script).toContain("re:IsMonsterEffect() and (loc==LOCATION_MZONE or loc==LOCATION_GRAVE)");
    expect(script).toContain("re:GetHandler():IsAttribute(ATTRIBUTE_LIGHT)");
    expect(script).toContain("Duel.NegateEffect(ev)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === mirrorCode),
      { code: lightMonsterCode, name: "Mirror LIGHT Monster Effect", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeLight, level: 4, attack: 1600, defense: 1200 },
      { code: darkMonsterCode, name: "Mirror DARK Monster Effect", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeDark, level: 4, attack: 1600, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 53341729, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [mirrorCode, lightMonsterCode, darkMonsterCode] }, 1: { main: [] } });
    startDuel(session);

    const mirror = requireCard(session.state.cards, mirrorCode);
    const lightMonster = requireCard(session.state.cards, lightMonsterCode);
    const darkMonster = requireCard(session.state.cards, darkMonsterCode);
    const faceupMirror = moveDuelCard(session.state, mirror.uid, "spellTrapZone", 0);
    faceupMirror.faceUp = true;
    faceupMirror.position = "faceUpAttack";
    moveDuelCard(session.state, lightMonster.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, darkMonster.uid, "monsterZone", 0).position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${lightMonsterCode}.lua`) return monsterIgnitionScript("light mirror source resolved");
        if (name === `c${darkMonsterCode}.lua`) return monsterIgnitionScript("dark mirror source resolved");
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(mirrorCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(lightMonsterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(darkMonsterCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const lightActivation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === lightMonster.uid);
    expect(lightActivation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, lightActivation!);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("light mirror source resolved");
    expect(restoredChain.session.state.eventHistory.filter((event) => ["chainActivating", "chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([
      {
        eventName: "chainActivating",
        eventCode: 1021,
        eventCardUid: lightMonster.uid,
        eventPlayer: 0,
        eventReason: 0,
        eventReasonPlayer: 0,
        relatedEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "chainNegated",
        eventCode: 1024,
        eventPlayer: 0,
        eventValue: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        eventReasonPlayer: 0,
        relatedEffectId: 3,
      },
      {
        eventName: "chainDisabled",
        eventCode: 1025,
        eventPlayer: 0,
        eventValue: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        eventReasonPlayer: 0,
        relatedEffectId: 3,
      },
    ]);

    const restoredAfterNegate = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredAfterNegate);
    expectRestoredLegalActions(restoredAfterNegate, 0);
    const darkActivation = getLuaRestoreLegalActions(restoredAfterNegate, 0).find((action) => action.type === "activateEffect" && action.uid === darkMonster.uid);
    expect(darkActivation, JSON.stringify(getLuaRestoreLegalActions(restoredAfterNegate, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAfterNegate, darkActivation!);
    resolveRestoredChain(restoredAfterNegate);
    expect(restoredAfterNegate.host.messages).toContain("dark mirror source resolved");
  });
});

function monsterIgnitionScript(message: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetOperation(function(e,tp) Debug.Message("${message}") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(cards: DuelCardInstance[], code: string): DuelCardInstance {
  const card = cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
