import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import {
  createDuel,
  getGroupedDuelLegalActions,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  serializeDuel,
  startDuel,
} from "#duel/core.js";
import { currentAttack } from "#duel/card-stats.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import {
  applyLuaRestoreResponse,
  getLuaRestoreLegalActionGroups,
  getLuaRestoreLegalActions,
  restoreDuelWithLuaScripts,
} from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const racePyro = 0x80;
const attributeFire = 0x4;
const setLaval = 0x39;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Laval Blaster announce number", () => {
  it("restores dynamic AnnounceNumber deck-discard cost into its ATK boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const lavalBlasterCode = "11834972";
    const graveLavalCode = "91834972";
    const discardedCodes = ["91834973", "91834974", "91834975", "91834976", "91834977"];
    const responderCode = "91834978";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === lavalBlasterCode),
      lavalCard(graveLavalCode, "Laval Grave Witness"),
      ...discardedCodes.map((code, index) => lavalCard(code, `Laval Blaster Discard ${index + 1}`)),
      { code: responderCode, name: "Laval Blaster Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 118, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [lavalBlasterCode, graveLavalCode, ...discardedCodes] }, 1: { main: [responderCode] } });
    startDuel(session);

    const lavalBlaster = session.state.cards.find((card) => card.code === lavalBlasterCode);
    const graveLaval = session.state.cards.find((card) => card.code === graveLavalCode);
    const discarded = discardedCodes.map((code) => session.state.cards.find((card) => card.code === code));
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(lavalBlaster).toBeDefined();
    expect(graveLaval).toBeDefined();
    expect(discarded.every(Boolean)).toBe(true);
    expect(responder).toBeDefined();
    moveDuelCard(session.state, lavalBlaster!.uid, "hand", 0);
    moveDuelCard(session.state, graveLaval!.uid, "graveyard", 0);
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
    expect(host.loadCardScript(Number(lavalBlasterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredSummonWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredSummonWindow.restoreComplete, restoredSummonWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSummonWindow.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredSummonWindow, 0)).toEqual(
      getGroupedDuelLegalActions(restoredSummonWindow.session, 0),
    );
    expect(getLuaRestoreLegalActionGroups(restoredSummonWindow, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restoredSummonWindow, 0),
    );
    expect(getLuaRestoreLegalActions(restoredSummonWindow, 0)).toEqual(getDuelLegalActions(restoredSummonWindow.session, 0));
    const summon = getLuaRestoreLegalActions(restoredSummonWindow, 0).find((action) => action.type === "normalSummon" && action.uid === lavalBlaster!.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummonWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonWindow, summon!);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredSummonWindow.session), source, reader);
    expect(restoredTriggerWindow.restoreComplete, restoredTriggerWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTriggerWindow.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredTriggerWindow, 0)).toEqual(getGroupedDuelLegalActions(restoredTriggerWindow.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredTriggerWindow, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restoredTriggerWindow, 0),
    );
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === lavalBlaster!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTriggerWindow, trigger!);
    expect(restoredTriggerWindow.session.state.chain).toHaveLength(1);
    expect(discarded.map((card) => restoredTriggerWindow.session.state.cards.find((candidate) => candidate.uid === card!.uid)?.location)).toEqual([
      "graveyard",
      "graveyard",
      "graveyard",
      "graveyard",
      "graveyard",
    ]);

    const restoredChainWindow = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
    expect(restoredChainWindow.restoreComplete, restoredChainWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChainWindow.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredChainWindow, 1)).toEqual(getGroupedDuelLegalActions(restoredChainWindow.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredChainWindow, 1).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restoredChainWindow, 1),
    );
    const pass = getLuaRestoreLegalActions(restoredChainWindow, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restoredChainWindow, 1), null, 2)).toBeDefined();
    const resolved = applyLuaRestoreResponse(restoredChainWindow, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    const restoredBlaster = restoredChainWindow.session.state.cards.find((card) => card.uid === lavalBlaster!.uid);
    expect(restoredBlaster).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(currentAttack(restoredBlaster, restoredChainWindow.session.state)).toBe((lavalBlaster!.data.attack ?? 0) + 1000);
    expect(restoredChainWindow.host.messages).not.toContain("laval blaster responder resolved");
  });
});

function lavalCard(code: string, name: string): DuelCardData {
  return { code, name, kind: "monster", typeFlags: typeMonster | typeEffect, race: racePyro, attribute: attributeFire, level: 4, attack: 1000, defense: 200, setcodes: [setLaval] };
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
      e:SetOperation(function(e,tp) Debug.Message("laval blaster responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
}
