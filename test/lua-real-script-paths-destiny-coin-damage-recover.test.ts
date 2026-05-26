import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const pathsCode = "50470982";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasPathsScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${pathsCode}.lua`));
const typeSpell = 0x2;
const categoryCoin = 0x1000000;

describe.skipIf(!hasUpstreamScripts || !hasPathsScript)("Lua real script The Paths of Destiny coin damage recover", () => {
  it("restores both-player TossCoin resolution into damage and recovery events", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${pathsCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 50470982, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [pathsCode] }, 1: { main: [] } });
    startDuel(session);

    const paths = requireCard(session, pathsCode);
    const setSpell = moveDuelCard(session.state, paths.uid, "spellTrapZone", 0);
    setSpell.sequence = 0;
    setSpell.faceUp = false;
    setSpell.position = "faceDown";
    session.state.players[0].lifePoints = 5000;
    session.state.players[1].lifePoints = 5000;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(pathsCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === paths.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
    }))).toEqual([
      { category: categoryCoin, code: 1002, countLimit: undefined, event: "ignition" },
    ]);

    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === paths.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestored(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toEqual([]);

    expect(restoredOpen.session.state.lastCoinResults.every((result) => result === 0 || result === 1)).toBe(true);
    const selfRecovered = restoredOpen.session.state.players[0].lifePoints === 7000;
    const opponentRecovered = restoredOpen.session.state.players[1].lifePoints === 7000;
    expect([3000, 7000]).toContain(restoredOpen.session.state.players[0].lifePoints);
    expect([3000, 7000]).toContain(restoredOpen.session.state.players[1].lifePoints);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === paths.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["coinTossed", "damageDealt", "recoveredLifePoints"].includes(event.eventName))).toEqual([
      {
        eventName: "coinTossed",
        eventCode: 1151,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: paths.uid,
        eventReasonEffectId: 1,
      },
      lpEvent(selfRecovered ? "recoveredLifePoints" : "damageDealt", 0, paths.uid),
      {
        eventName: "coinTossed",
        eventCode: 1151,
        eventPlayer: 1,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: paths.uid,
        eventReasonEffectId: 1,
      },
      lpEvent(opponentRecovered ? "recoveredLifePoints" : "damageDealt", 1, paths.uid),
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--The Paths of Destiny");
  expect(script).toContain("e1:SetCategory(CATEGORY_COIN)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COIN,nil,0,PLAYER_ALL,2)");
  expect(script).toContain("local res=Duel.TossCoin(tp,1)");
  expect(script).toContain("Duel.Recover(tp,2000,REASON_EFFECT)");
  expect(script).toContain("Duel.Damage(tp,2000,REASON_EFFECT)");
  expect(script).toContain("res=Duel.TossCoin(1-tp,1)");
  expect(script).toContain("Duel.Recover(1-tp,2000,REASON_EFFECT)");
  expect(script).toContain("Duel.Damage(1-tp,2000,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: pathsCode, name: "The Paths of Destiny", kind: "spell", typeFlags: typeSpell },
  ];
}

function requireCard(session: { state: { cards: DuelCardInstance[] } }, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function lpEvent(eventName: "damageDealt" | "recoveredLifePoints", player: PlayerId, sourceUid: string) {
  return {
    eventName,
    eventCode: eventName === "damageDealt" ? 1111 : 1112,
    eventPlayer: player,
    eventValue: 2000,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
  };
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

function applyRestored(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
