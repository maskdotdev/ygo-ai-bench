import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const albverdichCode = "28290705";
const materialCode = "282907050";
const earthAllyCode = "282907051";
const darkOwnCode = "282907052";
const darkOpponentCode = "282907053";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasAlbverdichScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${albverdichCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const attributeEarth = 0x1;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasAlbverdichScript)("Lua real script Fairy King Albverdich detach group stat", () => {
  it("restores Xyz detach cost and Card.IsAttributeExcept group ATK/DEF loss", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${albverdichCode}.lua`);
    expect(script).toContain("Xyz.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsAttribute,ATTRIBUTE_EARTH),4,2)");
    expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1,1,nil))");
    expect(script).toContain("aux.FaceupFilter(Card.IsAttributeExcept,ATTRIBUTE_EARTH)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD)");

    const cards: DuelCardData[] = [
      { code: albverdichCode, name: "Fairy King Albverdich", kind: "extra", typeFlags: typeMonster | typeXyz, level: 4, attack: 2300, defense: 1400, attribute: attributeEarth },
      { code: materialCode, name: "Albverdich Overlay Material", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 800, defense: 800, attribute: attributeEarth },
      { code: earthAllyCode, name: "Albverdich EARTH Ally", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1600, defense: 1200, attribute: attributeEarth },
      { code: darkOwnCode, name: "Albverdich DARK Ally", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1700, defense: 1500, attribute: attributeDark },
      { code: darkOpponentCode, name: "Albverdich DARK Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1900, defense: 1300, attribute: attributeDark },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 28290705, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialCode, earthAllyCode, darkOwnCode], extra: [albverdichCode] }, 1: { main: [darkOpponentCode] } });
    startDuel(session);

    const albverdich = requireCard(session, albverdichCode);
    const material = requireCard(session, materialCode);
    const earthAlly = requireCard(session, earthAllyCode);
    const darkOwn = requireCard(session, darkOwnCode);
    const darkOpponent = requireCard(session, darkOpponentCode);
    moveFaceUpAttack(session, albverdich, 0);
    moveDuelCard(session.state, material.uid, "overlay", 0);
    albverdich.overlayUids.push(material.uid);
    moveFaceUpAttack(session, earthAlly, 0);
    moveFaceUpAttack(session, darkOwn, 0);
    moveFaceUpAttack(session, darkOpponent, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(albverdichCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const restoredAlbverdich = requireCard(restored.session, albverdichCode);
    const activate = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === restoredAlbverdich.uid);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activate!);

    expect(restored.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: albverdich.uid,
      reasonEffectId: 2,
    });
    expect(restored.session.state.cards.find((card) => card.uid === albverdich.uid)?.overlayUids).toEqual([]);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === earthAlly.uid)!, restored.session.state)).toBe(1600);
    expect(currentDefense(restored.session.state.cards.find((card) => card.uid === earthAlly.uid)!, restored.session.state)).toBe(1200);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === darkOwn.uid)!, restored.session.state)).toBe(1200);
    expect(currentDefense(restored.session.state.cards.find((card) => card.uid === darkOwn.uid)!, restored.session.state)).toBe(1000);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === darkOpponent.uid)!, restored.session.state)).toBe(1400);
    expect(currentDefense(restored.session.state.cards.find((card) => card.uid === darkOpponent.uid)!, restored.session.state)).toBe(800);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restored.session.state.effects.filter((effect) => [darkOwn.uid, darkOpponent.uid].includes(effect.sourceUid) && [100, 104].includes(effect.code ?? -1)).map((effect) => ({
      sourceUid: effect.sourceUid,
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { sourceUid: darkOwn.uid, code: 100, reset: { flags: 33427456 }, value: -500 },
      { sourceUid: darkOwn.uid, code: 104, reset: { flags: 33427456 }, value: -500 },
      { sourceUid: darkOpponent.uid, code: 100, reset: { flags: 33427456 }, value: -500 },
      { sourceUid: darkOpponent.uid, code: 104, reset: { flags: 33427456 }, value: -500 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "detachedMaterial" && event.eventCardUid === material.uid)).toEqual([
      {
        eventName: "detachedMaterial",
        eventCode: 1202,
        eventCardUid: material.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: albverdich.uid,
        eventReasonEffectId: 2,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "overlay",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 0,
        },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: ReturnType<typeof requireCard>, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
