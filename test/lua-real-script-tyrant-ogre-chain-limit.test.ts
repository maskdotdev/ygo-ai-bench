import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Gouki The Tyrant Ogre chain-limit restore", () => {
  it("restores the Project Ignis targeted-card handler exclusion callback", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sourceCode = "7782069";
    const targetedResponderCode = "7782070";
    const allowedResponderCode = "7782071";
    const sourceCards = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sourceCode);
    const cards: DuelCardData[] = [
      ...sourceCards,
      { code: targetedResponderCode, name: "Tyrant Ogre Targeted Responder", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: allowedResponderCode, name: "Tyrant Ogre Allowed Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7782069, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [targetedResponderCode, allowedResponderCode], extra: [sourceCode] }, 1: { main: [] } });
    startDuel(session);

    const sourceCard = session.state.cards.find((card) => card.code === sourceCode && card.location === "extraDeck");
    const targetedResponder = session.state.cards.find((card) => card.code === targetedResponderCode && card.location === "deck");
    const allowedResponder = session.state.cards.find((card) => card.code === allowedResponderCode && card.location === "deck");
    expect(sourceCard).toBeDefined();
    expect(targetedResponder).toBeDefined();
    expect(allowedResponder).toBeDefined();
    moveDuelCard(session.state, targetedResponder!.uid, "monsterZone", 0);
    targetedResponder!.faceUp = true;
    moveDuelCard(session.state, sourceCard!.uid, "monsterZone", 0);
    sourceCard!.faceUp = true;
    moveDuelCard(session.state, allowedResponder!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${sourceCode}.lua`) return tyrantOgreScriptWithIgnitionHarness(workspace.readScript(name));
        if (name === `c${targetedResponderCode}.lua`) return chainOnlyQuickScript("tyrant ogre targeted responder resolved", "LOCATION_MZONE");
        if (name === `c${allowedResponderCode}.lua`) return chainOnlyQuickScript("tyrant ogre allowed responder resolved", "LOCATION_HAND");
        return workspace.readScript(name);
      },
    };

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sourceCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(targetedResponderCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(allowedResponderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const sourceAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === sourceCard!.uid);
    expect(sourceAction, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    if (!sourceAction || sourceAction.type !== "activateEffect") throw new Error("Expected Tyrant Ogre source activation action");
    expect(session.state.effects.find((effect) => effect.id === sourceAction.effectId)).toMatchObject({
      description: 0x76beb50,
      label: 1,
      property: 0x10,
    });
    const activated = applyResponse(session, sourceAction);
    expect(activated.ok, activated.error).toBe(true);

    const registryKey = `lua-chain-limit:${sourceCode}:0:link:known:closure:target-cards-not-handler:${encodeURIComponent(targetedResponder!.uid)}`;
    const snapshot = serializeDuel(session);
    expect(snapshot.state.chain[0]?.targetUids).toEqual([targetedResponder!.uid]);
    expect(snapshot.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
    expect(hasActivateEffect(getLegalActions(session, 0), targetedResponder!.uid)).toBe(false);
    expect(hasActivateEffect(getLegalActions(session, 0), allowedResponder!.uid)).toBe(true);

    const restored = restoreDuelWithLuaScripts(snapshot, source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.effects.find((effect) => effect.id === sourceAction.effectId)).toMatchObject({
      description: 0x76beb50,
      label: 1,
      property: 0x10,
    });
    expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(hasActivateEffect(getLuaRestoreLegalActions(restored, 0), targetedResponder!.uid)).toBe(false);
    expect(hasActivateEffect(getLuaRestoreLegalActions(restored, 0), allowedResponder!.uid)).toBe(true);
  });
});

function tyrantOgreScriptWithIgnitionHarness(script: string | undefined): string | undefined {
  if (!script) return undefined;
  return `${script}
    local original_initial_effect = s.initial_effect
    function s.initial_effect(c)
      original_initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetDescription(aux.Stringid(id,0))
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetProperty(EFFECT_FLAG_CARD_TARGET)
      e:SetTarget(s.destg)
      e:SetOperation(s.desop)
      e:SetLabel(1,100)
      c:RegisterEffect(e)
    end
  `;
}

function chainOnlyQuickScript(message: string, range: "LOCATION_HAND" | "LOCATION_MZONE"): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(${range})
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("${message}") end)
      c:RegisterEffect(e)
    end
  `;
}

function hasActivateEffect(actions: ReturnType<typeof getLegalActions>, uid: string): boolean {
  return actions.some((action) => action.type === "activateEffect" && action.uid === uid);
}
