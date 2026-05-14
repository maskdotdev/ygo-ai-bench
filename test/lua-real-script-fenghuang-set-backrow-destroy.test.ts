import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Fenghuang set backrow destroy", () => {
  it("restores its Spirit summon trigger and destroys only opponent set Spell/Trap cards", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const fenghuangCode = "50866755";
    const ownBackrowCode = "50866756";
    const tributeCode = "50866761";
    const opponentSetTrapCode = "50866757";
    const opponentSetSpellCode = "50866758";
    const opponentFaceupSpellCode = "50866759";
    const opponentSetMonsterCode = "50866760";
    const responderCode = "50866762";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === fenghuangCode),
      { code: ownBackrowCode, name: "Fenghuang Ally Backrow", kind: "trap", typeFlags: 0x4 },
      { code: tributeCode, name: "Fenghuang Tribute", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: opponentSetTrapCode, name: "Fenghuang Opponent Set Trap", kind: "trap", typeFlags: 0x4 },
      { code: opponentSetSpellCode, name: "Fenghuang Opponent Set Spell", kind: "spell", typeFlags: 0x2 },
      { code: opponentFaceupSpellCode, name: "Fenghuang Opponent Face-Up Spell", kind: "spell", typeFlags: 0x2 },
      { code: opponentSetMonsterCode, name: "Fenghuang Opponent Set Monster", kind: "monster", typeFlags: 0x1, level: 4, attack: 1200, defense: 1600 },
      { code: responderCode, name: "Fenghuang Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 508, startingHandSize: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [fenghuangCode, ownBackrowCode, tributeCode] },
      1: { main: [opponentSetTrapCode, opponentSetSpellCode, opponentFaceupSpellCode, opponentSetMonsterCode, responderCode] },
    });
    startDuel(session);

    const fenghuang = session.state.cards.find((card) => card.code === fenghuangCode);
    const ownBackrow = session.state.cards.find((card) => card.code === ownBackrowCode);
    const tribute = session.state.cards.find((card) => card.code === tributeCode);
    const opponentSetTrap = session.state.cards.find((card) => card.code === opponentSetTrapCode);
    const opponentSetSpell = session.state.cards.find((card) => card.code === opponentSetSpellCode);
    const opponentFaceupSpell = session.state.cards.find((card) => card.code === opponentFaceupSpellCode);
    const opponentSetMonster = session.state.cards.find((card) => card.code === opponentSetMonsterCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(fenghuang).toBeDefined();
    expect(ownBackrow).toBeDefined();
    expect(tribute).toBeDefined();
    expect(opponentSetTrap).toBeDefined();
    expect(opponentSetSpell).toBeDefined();
    expect(opponentFaceupSpell).toBeDefined();
    expect(opponentSetMonster).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, fenghuang!.uid, "hand", 0);
    moveDuelCard(session.state, ownBackrow!.uid, "spellTrapZone", 0);
    ownBackrow!.position = "faceDown";
    ownBackrow!.faceUp = false;
    moveDuelCard(session.state, tribute!.uid, "monsterZone", 0);
    tribute!.position = "faceUpAttack";
    tribute!.faceUp = true;
    moveDuelCard(session.state, opponentSetTrap!.uid, "spellTrapZone", 1);
    opponentSetTrap!.position = "faceDown";
    opponentSetTrap!.faceUp = false;
    moveDuelCard(session.state, opponentSetSpell!.uid, "spellTrapZone", 1);
    opponentSetSpell!.position = "faceDown";
    opponentSetSpell!.faceUp = false;
    moveDuelCard(session.state, opponentFaceupSpell!.uid, "spellTrapZone", 1);
    opponentFaceupSpell!.position = "faceUpAttack";
    opponentFaceupSpell!.faceUp = true;
    moveDuelCard(session.state, opponentSetMonster!.uid, "monsterZone", 1);
    opponentSetMonster!.position = "faceDownDefense";
    opponentSetMonster!.faceUp = false;
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
    expect(host.loadCardScript(Number(fenghuangCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredSummonWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredSummonWindow.restoreComplete, restoredSummonWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSummonWindow.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredSummonWindow, 0)).toEqual(getGroupedDuelLegalActions(restoredSummonWindow.session, 0));
    const summon = getLuaRestoreLegalActions(restoredSummonWindow, 0).find((action) => action.type === "tributeSummon" && action.uid === fenghuang!.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummonWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonWindow, summon!);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredSummonWindow.session), source, reader);
    expect(restoredTriggerWindow.restoreComplete, restoredTriggerWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTriggerWindow.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredTriggerWindow, 0)).toEqual(getGroupedDuelLegalActions(restoredTriggerWindow.session, 0));
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === fenghuang!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTriggerWindow, trigger!);
    expect(restoredTriggerWindow.session.state.chain).toHaveLength(1);
    expect(restoredTriggerWindow.session.state.chain[0]).toMatchObject({
      sourceUid: fenghuang!.uid,
      operationInfos: [{ category: 0x1, count: 2, player: 0, parameter: 0 }],
    });
    expect(sortedUids(restoredTriggerWindow.session.state.chain[0]!.operationInfos?.[0]?.targetUids ?? [])).toEqual(sortedUids([opponentSetTrap!.uid, opponentSetSpell!.uid]));

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expect(restoredChain.session.state.chain).toHaveLength(1);
    expect(sortedUids(restoredChain.session.state.chain[0]!.operationInfos?.[0]?.targetUids ?? [])).toEqual(sortedUids([opponentSetTrap!.uid, opponentSetSpell!.uid]));
    const pass = getLuaRestoreLegalActions(restoredChain, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restoredChain, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restoredChain.session.state.cards.find((card) => card.uid === fenghuang!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restoredChain.session.state.cards.find((card) => card.uid === ownBackrow!.uid)).toMatchObject({ location: "spellTrapZone" });
    expect(restoredChain.session.state.cards.find((card) => card.uid === opponentSetTrap!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredChain.session.state.cards.find((card) => card.uid === opponentSetSpell!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredChain.session.state.cards.find((card) => card.uid === opponentFaceupSpell!.uid)).toMatchObject({ location: "spellTrapZone" });
    expect(restoredChain.session.state.cards.find((card) => card.uid === opponentSetMonster!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restoredChain.session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "destroyed", eventCode: 1029, eventCardUid: opponentSetTrap!.uid }),
        expect.objectContaining({ eventName: "destroyed", eventCode: 1029, eventCardUid: opponentSetSpell!.uid }),
      ]),
    );
    expect(restoredChain.host.messages).not.toContain("fenghuang responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("fenghuang responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function sortedUids(uids: string[]): string[] {
  return [...uids].sort();
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
