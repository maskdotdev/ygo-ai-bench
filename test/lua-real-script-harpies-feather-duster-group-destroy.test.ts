import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeTrap = 0x4;
const typeQuickPlay = 0x10000;

describe.skipIf(!hasUpstreamScripts)("Lua real script Harpie's Feather Duster group destroy", () => {
  it("restores Harpie's Feather Duster opponent Spell/Trap group destroy", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const dusterCode = "18144506";
    const opponentSpellCode = "18144507";
    const opponentTrapCode = "18144508";
    const opponentMonsterCode = "18144509";
    const selfSpellCode = "18144510";
    const responderCode = "18144511";
    const script = workspace.readScript(`c${dusterCode}.lua`);
    expect(script).toContain("Duel.GetMatchingGroup(s.filter,tp,0,LOCATION_ONFIELD,c)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,sg,#sg,0,0)");
    expect(script).toContain("Duel.Destroy(sg,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      { code: dusterCode, name: "Harpie's Feather Duster", kind: "spell", typeFlags: typeSpell },
      { code: opponentSpellCode, name: "Duster Opponent Spell", kind: "spell", typeFlags: typeSpell },
      { code: opponentTrapCode, name: "Duster Opponent Trap", kind: "trap", typeFlags: typeTrap },
      { code: opponentMonsterCode, name: "Duster Opponent Monster", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1600, defense: 1000 },
      { code: selfSpellCode, name: "Duster Self Spell", kind: "spell", typeFlags: typeSpell },
      { code: responderCode, name: "Duster Chain Responder", kind: "spell", typeFlags: typeSpell | typeQuickPlay },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 18144506, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [dusterCode, selfSpellCode] }, 1: { main: [opponentSpellCode, opponentTrapCode, opponentMonsterCode, responderCode] } });
    startDuel(session);

    const duster = requireCard(session, dusterCode);
    const opponentSpell = requireCard(session, opponentSpellCode);
    const opponentTrap = requireCard(session, opponentTrapCode);
    const opponentMonster = requireCard(session, opponentMonsterCode);
    const selfSpell = requireCard(session, selfSpellCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, duster.uid, "hand", 0);
    moveDuelCard(session.state, selfSpell.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, opponentSpell.uid, "spellTrapZone", 1);
    moveDuelCard(session.state, opponentTrap.uid, "spellTrapZone", 1);
    const movedMonster = moveDuelCard(session.state, opponentMonster.uid, "monsterZone", 1);
    movedMonster.faceUp = true;
    movedMonster.position = "faceUpAttack";
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
    expect(host.loadCardScript(Number(dusterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === duster.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x1, targetUids: [opponentSpell.uid, opponentTrap.uid], count: 2, player: 0, parameter: 0 },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 1);
    expect(getLuaRestoreLegalActions(restored, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    passChain(restored);

    expect(restored.session.state.chain).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === duster.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === opponentSpell.uid)).toMatchObject({ location: "graveyard", controller: 1, reason: duelReason.effect | duelReason.destroy });
    expect(restored.session.state.cards.find((card) => card.uid === opponentTrap.uid)).toMatchObject({ location: "graveyard", controller: 1, reason: duelReason.effect | duelReason.destroy });
    expect(restored.session.state.cards.find((card) => card.uid === opponentMonster.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restored.session.state.cards.find((card) => card.uid === selfSpell.uid)).toMatchObject({ location: "spellTrapZone", controller: 0 });
    expect(sortedUids([opponentTrap!.uid, opponentSpell!.uid])).toEqual(sortedUids([opponentSpell.uid, opponentTrap.uid]));
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "destroyed")).toEqual([
      destroyedEvent(opponentSpell.uid, duster.uid, 1, 0),
      destroyedEvent(opponentTrap.uid, duster.uid, 1, 1),
      { ...destroyedEvent(opponentSpell.uid, duster.uid, 1, 0), eventUids: [opponentSpell.uid, opponentTrap.uid] },
    ]);
    expect(host.messages).not.toContain("harpies feather duster responder resolved");
    expect(restored.host.messages).not.toContain("harpies feather duster responder resolved");
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function sortedUids(uids: string[]): string[] {
  return [...uids].sort();
}

function destroyedEvent(uid: string, sourceUid: string, controller: PlayerId, sequence: number) {
  return {
    eventName: "destroyed",
    eventCode: 1029,
    eventCardUid: uid,
    eventPreviousState: { location: "spellTrapZone", controller, sequence, position: "faceDown", faceUp: true },
    eventCurrentState: { location: "graveyard", controller, sequence, position: "faceDown", faceUp: true },
    eventReason: duelReason.effect | duelReason.destroy,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
  };
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
      e:SetOperation(function(e,tp) Debug.Message("harpies feather duster responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
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

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function passChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    if (restored.session.state.waitingFor !== undefined) {
      expect(resolved.legalActions).toEqual(getLuaRestoreLegalActions(restored, restored.session.state.waitingFor));
      expect(resolved.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, restored.session.state.waitingFor));
      expect(resolved.legalActionGroups.flatMap((group) => group.actions)).toEqual(resolved.legalActions);
    }
  }
}
