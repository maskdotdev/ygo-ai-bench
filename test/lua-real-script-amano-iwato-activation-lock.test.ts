import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeSpirit = 0x200;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Amano-Iwato activation lock", () => {
  it("restores its field lock that blocks non-Spirit monster effects but allows Spirit effects", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const amanoCode = "32181268";
    const starterSpellCode = "32181269";
    const blockedMonsterCode = "32181270";
    const allowedSpiritCode = "32181271";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === amanoCode),
      { code: starterSpellCode, name: "Amano-Iwato Spell Starter", kind: "spell", typeFlags: typeSpell },
      { code: blockedMonsterCode, name: "Amano-Iwato Blocked Monster", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4 },
      { code: allowedSpiritCode, name: "Amano-Iwato Allowed Spirit", kind: "monster", typeFlags: typeMonster | typeEffect | typeSpirit, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 321, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [amanoCode, starterSpellCode] }, 1: { main: [blockedMonsterCode, allowedSpiritCode] } });
    startDuel(session);

    const amano = session.state.cards.find((card) => card.code === amanoCode);
    const starterSpell = session.state.cards.find((card) => card.code === starterSpellCode);
    const blockedMonster = session.state.cards.find((card) => card.code === blockedMonsterCode);
    const allowedSpirit = session.state.cards.find((card) => card.code === allowedSpiritCode);
    expect(amano).toBeDefined();
    expect(starterSpell).toBeDefined();
    expect(blockedMonster).toBeDefined();
    expect(allowedSpirit).toBeDefined();
    moveDuelCard(session.state, amano!.uid, "hand", 0);
    moveDuelCard(session.state, starterSpell!.uid, "hand", 0);
    moveDuelCard(session.state, blockedMonster!.uid, "hand", 1);
    moveDuelCard(session.state, allowedSpirit!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${starterSpellCode}.lua`) return starterSpellScript();
        if (name === `c${blockedMonsterCode}.lua`) return responderScript("blocked monster resolved");
        if (name === `c${allowedSpiritCode}.lua`) return responderScript("allowed Spirit resolved");
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(amanoCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterSpellCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(blockedMonsterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(allowedSpiritCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThanOrEqual(4);

    const restoredSummonWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredSummonWindow.restoreComplete, restoredSummonWindow.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActionGroups(restoredSummonWindow, 0)).toEqual(getGroupedDuelLegalActions(restoredSummonWindow.session, 0));
    const summon = getLuaRestoreLegalActions(restoredSummonWindow, 0).find((action) => action.type === "normalSummon" && action.uid === amano!.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummonWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonWindow, summon!);

    const restoredOpenWindow = restoreDuelWithLuaScripts(serializeDuel(restoredSummonWindow.session), source, reader);
    expect(restoredOpenWindow.restoreComplete, restoredOpenWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredOpenWindow.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceUid: amano!.uid,
          event: "continuous",
          code: 6,
          luaValueDescriptor: "cannot-activate:non-spirit-monster-effect",
        }),
      ]),
    );
    expect(getLuaRestoreLegalActions(restoredOpenWindow, 0)).toEqual(getDuelLegalActions(restoredOpenWindow.session, 0));
    const starter = getLuaRestoreLegalActions(restoredOpenWindow, 0).find((action) => action.type === "activateEffect" && action.uid === starterSpell!.uid);
    expect(starter, JSON.stringify(getLuaRestoreLegalActions(restoredOpenWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpenWindow, starter!);

    const restoredResponseWindow = restoreDuelWithLuaScripts(serializeDuel(restoredOpenWindow.session), source, reader);
    expect(restoredResponseWindow.restoreComplete, restoredResponseWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredResponseWindow.session.state.chain).toHaveLength(1);
    expect(getLuaRestoreLegalActionGroups(restoredResponseWindow, 1)).toEqual(getGroupedDuelLegalActions(restoredResponseWindow.session, 1));
    const responseActions = getLuaRestoreLegalActions(restoredResponseWindow, 1);
    expect(responseActions.some((action) => action.type === "activateEffect" && action.uid === blockedMonster!.uid)).toBe(false);
    const allowed = responseActions.find((action) => action.type === "activateEffect" && action.uid === allowedSpirit!.uid);
    expect(allowed, JSON.stringify(responseActions, null, 2)).toBeDefined();
    const blockedEffect = restoredResponseWindow.session.state.effects.find((effect) => effect.sourceUid === blockedMonster!.uid && effect.event === "quick");
    expect(blockedEffect).toBeDefined();
    const blocked = applyLuaRestoreResponse(restoredResponseWindow, {
      type: "activateEffect",
      player: 1,
      uid: blockedMonster!.uid,
      effectId: blockedEffect!.id,
      label: "Blocked monster response",
    });
    expect(blocked.ok).toBe(false);

    applyRestoredActionAndAssert(restoredResponseWindow, allowed!);
    const restoredTwoLinkWindow = restoreDuelWithLuaScripts(serializeDuel(restoredResponseWindow.session), source, reader);
    expect(restoredTwoLinkWindow.restoreComplete, restoredTwoLinkWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTwoLinkWindow.session.state.chain).toHaveLength(2);
    const pass = getLuaRestoreLegalActions(restoredTwoLinkWindow, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restoredTwoLinkWindow, 1), null, 2)).toBeDefined();
    const resolved = applyLuaRestoreResponse(restoredTwoLinkWindow, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restoredTwoLinkWindow.host.messages).toContain("allowed Spirit resolved");
    expect(restoredTwoLinkWindow.host.messages).toContain("Amano starter resolved");
    expect(restoredTwoLinkWindow.host.messages).not.toContain("blocked monster resolved");
  });
});

function starterSpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(function(e,tp) Debug.Message("Amano starter resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function responderScript(message: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("${message}") end)
      c:RegisterEffect(e)
    end
  `;
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  }
}
