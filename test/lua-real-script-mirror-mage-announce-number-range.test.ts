import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { currentLevel } from "#duel/card-stats.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
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
const iceBarrierTokenCode = "44308318";

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Mirror Mage AnnounceNumberRange", () => {
  it("restores announced token count into token summons and level update", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const mirrorMageCode = "9396662";
    const releaserCode = "9396663";
    const blockerCode = "9396664";
    const responderCode = "9396665";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === mirrorMageCode),
      { code: iceBarrierTokenCode, name: "Ice Barrier Token", kind: "monster", typeFlags: 0x4000_0001, level: 1, race: 0x40, attribute: 0x2 },
      { code: releaserCode, name: "Mirror Mage Effect Cost", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      { code: blockerCode, name: "Mirror Mage Normal Zone Blocker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Mirror Mage Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 939, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [mirrorMageCode, releaserCode, blockerCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const mirrorMage = requireCard(session, mirrorMageCode);
    const releaser = requireCard(session, releaserCode);
    const blocker = requireCard(session, blockerCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, mirrorMage.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, releaser.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, blocker.uid, "monsterZone", 0).position = "faceUpAttack";
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
    expect(host.loadCardScript(Number(mirrorMageCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const ignition = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === mirrorMage.uid);
    expect(ignition, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, ignition!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.cards.find((card) => card.uid === releaser.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(currentLevel(session.state.cards.find((card) => card.uid === mirrorMage.uid), session.state)).toBe(mirrorMage.data.level);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, 1), null, 2)).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.host.promptDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ api: "AnnounceNumberRange", player: 0, options: [1, 2, 3], returned: 1 }),
    ]));
    const restoredMirrorMage = restored.session.state.cards.find((card) => card.uid === mirrorMage.uid);
    expect(restoredMirrorMage).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(currentLevel(restoredMirrorMage, restored.session.state)).toBe((mirrorMage.data.level ?? 0) + 1);
    const tokens = restored.session.state.cards.filter((card) => card.code === iceBarrierTokenCode && card.location === "monsterZone" && card.controller === 0);
    expect(tokens).toHaveLength(1);
    expect(restored.host.messages).not.toContain("mirror mage responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("mirror mage responder resolved") end)
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
