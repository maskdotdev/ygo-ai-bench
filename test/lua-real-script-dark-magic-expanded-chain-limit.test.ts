import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const darkMagicianCode = "46986414";
const darkMagicianGirlCode = "38033121";

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Dark Magic Expanded chain-limit restore", () => {
  it("restores its temporary EVENT_CHAINING watcher before the controller chains a Spell", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sourceCode = "111280";
    const targetCode = "111281";
    const ownSpellCode = "111282";
    const ownQuickCode = "111283";
    const opponentQuickCode = "111284";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [sourceCode, darkMagicianCode, darkMagicianGirlCode].includes(card.code)),
      { code: targetCode, name: "Dark Magic Expanded Target", kind: "monster", typeFlags: 0x21, race: 0x2, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
      { code: ownSpellCode, name: "Dark Magic Expanded Followup Spell", kind: "spell", typeFlags: 0x2 },
      { code: ownQuickCode, name: "Dark Magic Expanded Controller Quick", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: opponentQuickCode, name: "Dark Magic Expanded Opponent Quick", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 111280, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sourceCode, darkMagicianCode, darkMagicianGirlCode, targetCode, ownSpellCode, ownQuickCode] }, 1: { main: [opponentQuickCode] } });
    startDuel(session);

    const sourceCard = requireCard(session, sourceCode);
    const darkMagician = requireCard(session, darkMagicianCode);
    const darkMagicianGirl = requireCard(session, darkMagicianGirlCode);
    const target = requireCard(session, targetCode);
    const ownSpell = requireCard(session, ownSpellCode);
    const ownQuick = requireCard(session, ownQuickCode);
    const opponentQuick = requireCard(session, opponentQuickCode);
    moveDuelCard(session.state, sourceCard.uid, "hand", 0);
    moveDuelCard(session.state, darkMagician.uid, "graveyard", 0);
    moveDuelCard(session.state, darkMagicianGirl.uid, "graveyard", 0);
    moveDuelCard(session.state, target.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, ownSpell.uid, "hand", 0);
    moveDuelCard(session.state, ownQuick.uid, "hand", 0);
    moveDuelCard(session.state, opponentQuick.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${ownSpellCode}.lua`) return chainableSpellScript("controller spell resolved");
        if (name === `c${ownQuickCode}.lua`) return chainOnlyMonsterScript("controller quick resolved");
        if (name === `c${opponentQuickCode}.lua`) return chainOnlyMonsterScript("opponent quick resolved");
        return workspace.readScript(name);
      },
    };

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sourceCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(ownSpellCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(ownQuickCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(opponentQuickCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);

    const expandedAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === sourceCard.uid);
    expect(expandedAction, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    expect(applyResponse(session, expandedAction!).ok).toBe(true);
    passChain(session, 1);
    passChain(session, 0);
    expect(host.messages).not.toContain("controller spell resolved");
    expect(serializeDuel(session).state.effects.some((effect) => effect.registryKey?.startsWith(`lua:${sourceCode}:`) && effect.registryKey.endsWith("-1027"))).toBe(true);

    const restoredWatcher = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredWatcher.restoreComplete, restoredWatcher.incompleteReasons.join("; ")).toBe(true);
    expect(restoredWatcher.missingRegistryKeys).toEqual([]);
    expect(restoredWatcher.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredWatcher, 0)).toEqual(getGroupedDuelLegalActions(restoredWatcher.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredWatcher, 1)).toEqual(getGroupedDuelLegalActions(restoredWatcher.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredWatcher, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredWatcher, 0));
    expect(getLuaRestoreLegalActionGroups(restoredWatcher, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredWatcher, 1));

    const spellAction = getLuaRestoreLegalActions(restoredWatcher, 0).find((action) => action.type === "activateEffect" && action.uid === ownSpell.uid);
    expect(spellAction, JSON.stringify(getLuaRestoreLegalActions(restoredWatcher, 0), null, 2)).toBeDefined();
    const spellChained = applyLuaRestoreResponse(restoredWatcher, spellAction!);
    expect(spellChained.ok, spellChained.error).toBe(true);

    const registryKey = `lua-chain-limit:${sourceCode}:0:link:known:closure:response-matches-chain-player`;
    expect(restoredWatcher.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
    expect(getLuaRestoreLegalActions(restoredWatcher, 1)).toEqual([]);
    expect(hasActivateEffect(getLuaRestoreLegalActions(restoredWatcher, 0), ownQuick.uid)).toBe(true);

    const response = getLuaRestoreLegalActions(restoredWatcher, 0).find((action) => action.type === "activateEffect" && action.uid === ownQuick.uid);
    expect(response).toBeDefined();
    const chained = applyLuaRestoreResponse(restoredWatcher, response!);
    expect(chained.ok, chained.error).toBe(true);
    expect(restoredWatcher.session.state.chain).toEqual(expect.arrayContaining([expect.objectContaining({ sourceUid: ownQuick.uid })]));
  });
});

function passChain(session: DuelSession, player: 0 | 1): void {
  const pass = getLegalActions(session, player).find((action) => action.type === "passChain");
  expect(pass).toBeDefined();
  expect(applyResponse(session, pass!).ok).toBe(true);
}

function chainableSpellScript(message: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(function(e,tp) Debug.Message("${message}") end)
      c:RegisterEffect(e)
    end
  `;
}

function chainOnlyMonsterScript(message: string): string {
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

function hasActivateEffect(actions: ReturnType<typeof getLegalActions>, uid: string): boolean {
  return actions.some((action) => action.type === "activateEffect" && action.uid === uid);
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
