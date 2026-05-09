import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, moveDuelCardWithRedirects, sendDuelCardToGraveyard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe("Lua equip lost-target movement", () => {
  it("sends equips to the Graveyard with previous equip target when their target leaves the Monster Zone", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Lost Target Monster", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: "500", name: "Lost Target Equip", kind: "spell", typeFlags: 0x40002 },
    ];
    const session = createDuel({ seed: 291, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "500"] }, 1: { main: [] } });
    startDuel(session);

    const target = findCard(session, "100", "hand");
    const equip = findCard(session, "500", "hand");
    moveDuelCard(session.state, target.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, equip.uid, "spellTrapZone", 0);
    equip.equippedToUid = target.uid;
    equip.position = "faceUpAttack";
    equip.faceUp = true;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c500={}
      function c500.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)
        e:SetCode(EVENT_TO_GRAVE)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          local c=e:GetHandler()
          local ec=c:GetPreviousEquipTarget()
          return c:IsReason(REASON_LOST_TARGET) and ec and ec:IsCode(100) and ec:IsLocation(LOCATION_GRAVE)
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("lost target trigger " .. e:GetHandler():GetPreviousEquipTarget():GetCode() .. "/" .. r)
        end)
        c:RegisterEffect(e)
      end
      `,
      "lost-target-equip-trigger.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    sendDuelCardToGraveyard(session.state, target.uid, 0, duelReason.effect, 0);

    expect(session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({ location: "graveyard" });
    expect(session.state.cards.find((card) => card.uid === equip.uid)).toMatchObject({
      location: "graveyard",
      previousEquippedToUid: target.uid,
      reason: duelReason.lostTarget,
      reasonPlayer: 0,
    });
    expect(session.state.cards.find((card) => card.uid === equip.uid)?.equippedToUid).toBeUndefined();
    expect(session.state.pendingTriggers).toContainEqual(expect.objectContaining({ eventName: "sentToGraveyard", eventCardUid: equip.uid, eventReason: duelReason.lostTarget }));

    const trigger = getLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.uid === equip.uid);
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);
    expect(host.messages).toContain(`lost target trigger 100/${duelReason.lostTarget}`);
  });
});

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script equip lost-target movement", () => {
  it("resolves Gladiator Beast's Battle Archfiend Shield return trigger after its target returns to Deck", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const shieldCode = "8730435";
    const targetCode = "601002";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === shieldCode),
      { code: targetCode, name: "Gladiator Lost Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1600, defense: 1200, setcodes: [0x19] },
    ];
    const session = createDuel({ seed: 292, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: [shieldCode, targetCode] }, 1: { main: [] } });
    startDuel(session);

    const shield = findCard(session, shieldCode, "hand");
    const target = findCard(session, targetCode, "hand");
    moveDuelCard(session.state, target.uid, "monsterZone", 0).position = "faceUpAttack";

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(shieldCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);

    moveDuelCard(session.state, shield.uid, "spellTrapZone", 0);
    shield.equippedToUid = target.uid;
    shield.position = "faceUpAttack";
    shield.faceUp = true;

    moveDuelCardWithRedirects(session.state, target.uid, "deck", 0, duelReason.effect, 0);

    expect(session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({ location: "deck" });
    expect(session.state.cards.find((card) => card.uid === shield.uid)).toMatchObject({
      location: "graveyard",
      previousEquippedToUid: target.uid,
      reason: duelReason.lostTarget,
    });

    const trigger = getLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.uid === shield.uid);
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);

    expect(session.state.cards.find((card) => card.uid === shield.uid)).toMatchObject({ location: "hand" });
    expect(session.state.eventHistory).toEqual(expect.arrayContaining([expect.objectContaining({ eventName: "confirmed", eventCardUid: shield.uid })]));
  });
});

function findCard(session: DuelSession, code: string, location: DuelCardInstance["location"]): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && candidate.location === location);
  expect(card).toBeTruthy();
  return card!;
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
