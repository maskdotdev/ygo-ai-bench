import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const gergonneCode = "59490397";
const tindangleLinkCode = "594903970";
const linkedMonsterCode = "594903971";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const setTindangle = 0x10b;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Gergonne's End equip linked destroy burn", () => {
  it("restores remain-field equip into linked-group destruction and equipped target attack damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${gergonneCode}.lua`);
    expectScriptShape(script);
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === gergonneCode),
      { code: tindangleLinkCode, name: "Gergonne Tindangle Link Target", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, setcodes: [setTindangle], level: 1, attack: 2500, defense: 0, linkMarkers: 0x20 },
      { code: linkedMonsterCode, name: "Gergonne Linked Monster", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 59490397, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [gergonneCode, linkedMonsterCode], extra: [tindangleLinkCode] }, 1: { main: [] } });
    startDuel(session);

    const gergonne = requireCard(session, gergonneCode);
    const tindangle = requireCard(session, tindangleLinkCode);
    const linked = requireCard(session, linkedMonsterCode);
    moveDuelCard(session.state, gergonne.uid, "spellTrapZone", 0).position = "faceDown";
    gergonne.faceUp = false;
    moveFaceUpAttack(session, tindangle, 0, 0);
    moveFaceUpAttack(session, linked, 0, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(gergonneCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(host.messages).not.toContain("missing equip relation");

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const equipAction = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === gergonne.uid);
    expect(equipAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, equipAction!);
    expect(restoredOpen.session.state.chain).toHaveLength(0);

    const restoredEquipped = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredEquipped);
    expectRestoredLegalActions(restoredEquipped, 0);
    expect(restoredEquipped.session.state.cards.find((card) => card.uid === gergonne.uid)).toMatchObject({
      location: "spellTrapZone",
      equippedToUid: tindangle.uid,
      cardTargetUids: [tindangle.uid],
      faceUp: true,
    });
    expect(restoredEquipped.session.state.effects.filter((effect) => effect.sourceUid === gergonne.uid && (effect.code === 41 || effect.code === 42)).map((effect) => effect.luaTypeFlags)).toEqual([4, 4]);

    const destroyAction = getLuaRestoreLegalActions(restoredEquipped, 0).find((action) => action.type === "activateEffect" && action.uid === gergonne.uid);
    expect(destroyAction, JSON.stringify(getLuaRestoreLegalActions(restoredEquipped, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEquipped, destroyAction!);
    expect(restoredEquipped.session.state.chain).toHaveLength(0);

    const restoredDestroyed = restoreDuelWithLuaScripts(serializeDuel(restoredEquipped.session), workspace, reader);
    expectCleanRestore(restoredDestroyed);
    expect(restoredDestroyed.session.state.cards.find((card) => card.uid === tindangle.uid)).toMatchObject({ location: "monsterZone" });
    expect(restoredDestroyed.session.state.cards.find((card) => card.uid === linked.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: gergonne.uid,
      reasonEffectId: 2,
    });
    expect(restoredDestroyed.session.state.cards.find((card) => card.uid === gergonne.uid)).toMatchObject({
      location: "graveyard",
      previousEquippedToUid: tindangle.uid,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: gergonne.uid,
      reasonEffectId: 2,
    });
    expect(restoredDestroyed.session.state.players[1].lifePoints).toBe(5500);
    expect(restoredDestroyed.session.state.eventHistory.filter((event) => ["equipped", "destroyed", "damageDealt"].includes(event.eventName))).toEqual([
      {
        eventName: "equipped",
        eventCode: 1121,
        eventCardUid: gergonne.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: gergonne.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: linked.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: gergonne.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: gergonne.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: gergonne.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 1 },
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: linked.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: gergonne.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        eventUids: [linked.uid, gergonne.uid],
      },
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 2500,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: gergonne.uid,
        eventReasonEffectId: 2,
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Gergonne's End");
  expect(script).toContain("e1:SetCategory(CATEGORY_EQUIP)");
  expect(script).toContain("e1:SetCode(EFFECT_REMAIN_FIELD)");
  expect(script).toContain("e2:SetCode(EVENT_CHAIN_DISABLED)");
  expect(script).toContain("Duel.Equip(tp,c,tc)");
  expect(script).toContain("e4:SetValue(aux.tgoval)");
  expect(script).toContain("return tc and tc:GetLinkedGroupCount()==tc:GetLink()");
  expect(script).toContain("local lg=tc:GetLinkedGroup()");
  expect(script).toContain("Duel.Destroy(lg,REASON_EFFECT)");
  expect(script).toContain("Duel.Damage(1-tp,atk,REASON_EFFECT)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.position = "faceUpAttack";
  moved.faceUp = true;
  return moved;
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
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    expectRestoredLegalActions(restored, player);
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
