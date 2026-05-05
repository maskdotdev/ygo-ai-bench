import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, registerEffect, restoreDuel, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua deck and field helpers", () => {
  it("lets Lua scripts inspect, confirm, and move deck-top groups", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Deck A", kind: "monster" },
      { code: "200", name: "Deck B", kind: "monster" },
      { code: "300", name: "Deck C", kind: "monster" },
      { code: "400", name: "Deck D", kind: "monster" },
    ];
    const session = createDuel({ seed: 11, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400"] },
      1: { main: ["100"] },
    });
    startDuel(session);
    const expectedDeck = session.state.cards
      .filter((card) => card.controller === 0 && card.location === "deck")
      .sort((a, b) => a.sequence - b.sequence)
      .map((card) => card.code);
    const expectedTop = expectedDeck.slice(0, 2);
    const expectedBottom = expectedDeck.slice(-2);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Duel.DisableShuffleCheck()
      local top = Duel.GetDecktopGroup(0, 2)
      local bottom = Duel.GetDeckbottomGroup(0, 2)
      Debug.Message("top count " .. top:GetCount())
      Debug.Message("bottom count " .. bottom:GetCount())
      local first = top:GetNext()
      local second = top:GetNext()
      local first_bottom = bottom:GetNext()
      local second_bottom = bottom:GetNext()
      Debug.Message("first top " .. first:GetCode())
      Debug.Message("second top " .. second:GetCode())
      Debug.Message("first bottom " .. first_bottom:GetCode())
      Debug.Message("second bottom " .. second_bottom:GetCode())
      Duel.SortDecktop(0, 0, 2)
      Debug.Message("sort top operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Duel.SortDeckbottom(0, 0, 2)
      Debug.Message("sort bottom operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Duel.ConfirmCards(1, top)
      Duel.ConfirmDecktop(0, 3)
      Debug.Message("sent top " .. Duel.SendtoHand(top, 0, REASON_EFFECT))
      Duel.ShuffleDeck(0)
      `,
      "deck-top.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("top count 2");
    expect(host.messages).toContain("bottom count 2");
    expect(host.messages).toContain(`first top ${expectedTop[0]}`);
    expect(host.messages).toContain(`second top ${expectedTop[1]}`);
    expect(host.messages).toContain(`first bottom ${expectedBottom[0]}`);
    expect(host.messages).toContain(`second bottom ${expectedBottom[1]}`);
    expect(host.messages).toContain(`sort top operated 2/${expectedTop[0]}`);
    expect(host.messages).toContain(`sort bottom operated 2/${expectedDeck[expectedDeck.length - 2]}`);
    expect(host.messages).toContain(`confirmed 1: ${expectedTop.join(",")}`);
    expect(host.messages).toContain(`confirmed decktop 0: ${expectedDeck.slice(0, 3).join(",")}`);
    expect(host.messages).toContain("sent top 2");
    expect(session.state.shuffleCheckDisabled).toBe(true);
    expect(restoreDuel(serializeDuel(session), createCardReader(cards)).state.shuffleCheckDisabled).toBe(true);
    expect(session.state.cards.filter((card) => card.controller === 0 && card.location === "hand" && expectedTop.includes(card.code))).toHaveLength(2);
  });

  it("queues Lua confirm triggers with confirmed card payloads", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Confirmed A", kind: "monster" },
      { code: "200", name: "Confirmed B", kind: "monster" },
      { code: "300", name: "Confirm Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 164, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300"] }, 1: { main: [] } });
    startDuel(session);
    const watcher = session.state.cards.find((card) => card.code === "300");
    expect(watcher).toBeTruthy();
    moveDuelCard(session.state, watcher!.uid, "hand", 0);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_CONFIRM)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev)
          Debug.Message("confirm resolved " .. ep .. "/" .. ev .. "/" .. eg:GetFirst():GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "lua-confirm-trigger.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const result = host.loadScript(
      `
      local top = Duel.GetDecktopGroup(0, 2)
      Duel.ConfirmCards(1, top)
      Debug.Message("confirm trigger requested")
      `,
      "lua-confirm-trigger-action.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("confirm trigger requested");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["confirmed"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1211, eventPlayer: 1, eventValue: 2 });
    expect(session.state.eventHistory.at(-1)).toMatchObject({ eventName: "confirmed", eventCode: 1211, eventPlayer: 1, eventValue: 2 });

    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeTruthy();
    expect(applyResponse(session, trigger!).ok).toBe(true);
    expect(host.messages).toContain("confirm resolved 1/2/100");
  });

  it("queues Lua to-hand confirm triggers for revealed hand cards", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Searched Card", kind: "monster" },
      { code: "200", name: "To Hand Confirm Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 165, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: [] } });
    startDuel(session);
    const watcher = session.state.cards.find((card) => card.code === "200");
    expect(watcher).toBeTruthy();
    moveDuelCard(session.state, watcher!.uid, "hand", 0);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_TOHAND_CONFIRM)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev)
          Debug.Message("tohand confirm resolved " .. ep .. "/" .. ev .. "/" .. eg:GetFirst():GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "lua-tohand-confirm-trigger.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const result = host.loadScript(
      `
      local top = Duel.GetDecktopGroup(0, 1)
      Duel.SendtoHand(top, 0, REASON_EFFECT)
      Duel.ConfirmCards(1, top)
      Debug.Message("tohand confirm requested")
      `,
      "lua-tohand-confirm-trigger-action.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("tohand confirm requested");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["sentToHandConfirmed"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1212, eventPlayer: 1, eventValue: 1 });
    expect(session.state.eventHistory.at(-1)).toMatchObject({ eventName: "sentToHandConfirmed", eventCode: 1212, eventPlayer: 1, eventValue: 1 });

    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeTruthy();
    expect(applyResponse(session, trigger!).ok).toBe(true);
    expect(host.messages).toContain("tohand confirm resolved 1/1/100");
  });

  it("applies restored Lua confirm triggers through restore responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Confirmed A", kind: "monster" },
      { code: "200", name: "Restore Confirmed B", kind: "monster" },
      { code: "300", name: "Restore Confirm Watcher", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name !== "c300.lua") return undefined;
        return `
        c300={}
        function c300.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_TRIGGER_O)
          e:SetCode(EVENT_CONFIRM)
          e:SetRange(LOCATION_HAND)
          e:SetOperation(function(e,tp,eg,ep,ev)
            Debug.Message("restored confirm " .. ep .. "/" .. ev .. "/" .. eg:GetFirst():GetCode())
          end)
          c:RegisterEffect(e)
        end
        `;
      },
    };
    const session = createDuel({ seed: 168, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300"] }, 1: { main: [] } });
    startDuel(session);
    const watcher = session.state.cards.find((card) => card.code === "300");
    expect(watcher).toBeTruthy();
    moveDuelCard(session.state, watcher!.uid, "hand", 0);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const result = host.loadScript(
      `
      local top = Duel.GetDecktopGroup(0, 2)
      Duel.ConfirmCards(1, top)
      `,
      "restore-confirm-trigger-action.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["confirmed"]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["confirmed"]);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1211, eventPlayer: 1, eventValue: 2 });
    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeTruthy();
    const triggerResult = applyLuaRestoreResponse(restored, trigger!);
    expect(triggerResult.ok).toBe(true);
    expect(triggerResult.legalActions).toEqual(getDuelLegalActions(restored.session, triggerResult.state.waitingFor!));
    expect(triggerResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, triggerResult.state.waitingFor!));
    expect(restored.host.messages).toContain("restored confirm 1/2/100");
  });

  it("applies restored Lua to-hand confirm triggers through restore responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Searched Card", kind: "monster" },
      { code: "200", name: "Restore To Hand Confirm Watcher", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name !== "c200.lua") return undefined;
        return `
        c200={}
        function c200.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_TRIGGER_O)
          e:SetCode(EVENT_TOHAND_CONFIRM)
          e:SetRange(LOCATION_HAND)
          e:SetOperation(function(e,tp,eg,ep,ev)
            Debug.Message("restored tohand confirm " .. ep .. "/" .. ev .. "/" .. eg:GetFirst():GetCode())
          end)
          c:RegisterEffect(e)
        end
        `;
      },
    };
    const session = createDuel({ seed: 169, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: [] } });
    startDuel(session);
    const watcher = session.state.cards.find((card) => card.code === "200");
    expect(watcher).toBeTruthy();
    moveDuelCard(session.state, watcher!.uid, "hand", 0);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const result = host.loadScript(
      `
      local top = Duel.GetDecktopGroup(0, 1)
      Duel.SendtoHand(top, 0, REASON_EFFECT)
      Duel.ConfirmCards(1, top)
      `,
      "restore-tohand-confirm-trigger-action.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["sentToHandConfirmed"]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["sentToHandConfirmed"]);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1212, eventPlayer: 1, eventValue: 1 });
    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeTruthy();
    const triggerResult = applyLuaRestoreResponse(restored, trigger!);
    expect(triggerResult.ok).toBe(true);
    expect(triggerResult.legalActions).toEqual(getDuelLegalActions(restored.session, triggerResult.state.waitingFor!));
    expect(triggerResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, triggerResult.state.waitingFor!));
    expect(restored.host.messages).toContain("restored tohand confirm 1/1/100");
  });

  it("lets Lua scripts shuffle a player's hand", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Hand A", kind: "monster" },
      { code: "200", name: "Hand B", kind: "monster" },
      { code: "300", name: "Hand C", kind: "monster" },
      { code: "400", name: "Hand D", kind: "monster" },
    ];
    const session = createDuel({ seed: 12, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400"] },
      1: { main: [] },
    });
    startDuel(session);
    const before = handCodes(session, 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Duel.ShuffleHand(0)
      Debug.Message("hand shuffled")
      `,
      "shuffle-hand.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("hand shuffled");
    const after = handCodes(session, 0);
    expect([...after].sort()).toEqual([...before].sort());
    expect(after).not.toEqual(before);
  });

  it("lets Lua scripts goat-confirm hand and deck cards", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Goat Hand A", kind: "monster" },
      { code: "200", name: "Goat Hand B", kind: "monster" },
      { code: "300", name: "Goat Deck A", kind: "monster" },
      { code: "400", name: "Goat Deck B", kind: "monster" },
    ];
    const session = createDuel({ seed: 13, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400"] },
      1: { main: [] },
    });
    startDuel(session);
    const beforeHand = handCodes(session, 0);
    const beforeDeck = deckCodes(session, 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Duel.GoatConfirm(0, LOCATION_HAND + LOCATION_DECK)
      Debug.Message("goat confirm done")
      `,
      "goat-confirm.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain(`confirmed 0: ${beforeDeck.join(",")}`);
    expect(host.messages).toContain(`confirmed 1: ${beforeHand.join(",")}`);
    expect(host.messages).toContain("goat confirm done");
    expect([...handCodes(session, 0)].sort()).toEqual([...beforeHand].sort());
    expect([...deckCodes(session, 0)].sort()).toEqual([...beforeDeck].sort());
  });

  it("lets Lua scripts shuffle a player's extra deck", () => {
    const cards: DuelCardData[] = [
      { code: "900", name: "Extra A", kind: "extra" },
      { code: "910", name: "Extra B", kind: "extra" },
      { code: "920", name: "Extra C", kind: "extra" },
      { code: "930", name: "Extra D", kind: "extra" },
      { code: "940", name: "Extra E", kind: "extra" },
    ];
    const session = createDuel({ seed: 93, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: [], extra: ["900", "910", "920", "930", "940"] },
      1: { main: [] },
    });
    startDuel(session);
    const before = extraCodes(session, 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Duel.ShuffleExtra(0)
      Debug.Message("extra shuffled")
      `,
      "shuffle-extra.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("extra shuffled");
    const after = extraCodes(session, 0);
    expect([...after].sort()).toEqual([...before].sort());
    expect(after).not.toEqual(before);
  });

  it("lets Lua scripts confirm and read the extra deck top group", () => {
    const cards: DuelCardData[] = [
      { code: "900", name: "Extra Top A", kind: "extra" },
      { code: "910", name: "Extra Top B", kind: "extra" },
      { code: "920", name: "Extra Top C", kind: "extra" },
    ];
    const session = createDuel({ seed: 94, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: [], extra: ["900", "910", "920"] },
      1: { main: [] },
    });
    startDuel(session);
    const expectedTop = extraCodes(session, 0).slice(0, 2);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Duel.ConfirmExtratop(0,2)
      local g=Duel.GetExtraTopGroup(0,2)
      Debug.Message("extra top group " .. g:GetCount() .. "/" .. g:GetFirst():GetCode())
      `,
      "confirm-extra-top.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain(`confirmed extratop 0: ${expectedTop.join(",")}`);
    expect(host.messages).toContain(`extra top group 2/${expectedTop[0]}`);
  });

  it("lets Lua scripts create and summon tokens", () => {
    const cards: DuelCardData[] = [{ code: "123456", name: "Generated Token", kind: "monster", attack: 500, defense: 500 }];
    const session = createDuel({ seed: 13, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: [] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local token = Duel.CreateToken(0, 123456)
      Debug.Message("token code " .. token:GetCode())
      Debug.Message("token attack " .. token:GetAttack())
      Debug.Message("token hand " .. tostring(token:IsLocation(LOCATION_HAND)) .. "/" .. tostring(token:IsDestination(LOCATION_HAND)) .. "/" .. tostring(token:IsDestination(LOCATION_MZONE)))
      Debug.Message("token summon " .. Duel.SpecialSummon(token, 0, 0, 0, false, false, POS_FACEUP_ATTACK))
      Debug.Message("token mzone destination " .. tostring(token:IsDestination(LOCATION_MZONE)))
      Debug.Message("token faceup " .. tostring(token:IsFaceup()))
      `,
      "create-token.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("token code 123456");
    expect(host.messages).toContain("token attack 500");
    expect(host.messages).toContain("token hand true/true/false");
    expect(host.messages).toContain("token summon 1");
    expect(host.messages).toContain("token mzone destination true");
    expect(host.messages).toContain("token faceup true");
    expect(session.state.cards.find((card) => card.code === "123456")).toMatchObject({ location: "monsterZone", controller: 0, summonType: "special" });
  });

  it("keeps token creation from mutating ended duels", () => {
    const cards: DuelCardData[] = [{ code: "123456", name: "Generated Token", kind: "monster", attack: 500, defense: 500 }];
    const session = createDuel({ seed: 158, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: [] },
      1: { main: [] },
    });
    startDuel(session);
    const beforeCount = session.state.cards.length;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Duel.Win(0, WIN_REASON_EXODIA)
      local token = Duel.CreateToken(0, 123456)
      Debug.Message("token nil " .. tostring(token == nil))
      `,
      "ended-token-noop.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["token nil true"]);
    expect(session.state.status).toBe("ended");
    expect(session.state.cards).toHaveLength(beforeCount);
  });

  it("lets Lua scripts query leave-field destinations", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Leaving Monster", kind: "monster", typeFlags: 0x21 },
      { code: "200", name: "Hand Card", kind: "monster", typeFlags: 0x21 },
      { code: "300", name: "Destination Spell", kind: "spell", typeFlags: 0x2 },
      { code: "400", name: "Leaving To Spell Zone", kind: "monster", typeFlags: 0x21 },
    ];
    const session = createDuel({ seed: 181, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400"] },
      1: { main: [] },
    });
    startDuel(session);
    const leaving = session.state.cards.find((card) => card.code === "100")!;
    moveDuelCard(session.state, leaving.uid, "monsterZone", 0);
    moveDuelCard(session.state, leaving.uid, "graveyard", 0);
    const spell = session.state.cards.find((card) => card.code === "300")!;
    moveDuelCard(session.state, spell.uid, "spellTrapZone", 0);
    const leavingToSpellZone = session.state.cards.find((card) => card.code === "400")!;
    moveDuelCard(session.state, leavingToSpellZone.uid, "monsterZone", 0);
    moveDuelCard(session.state, leavingToSpellZone.uid, "spellTrapZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local leaving=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      local hand=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local spell=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_STZONE, 0, 1, 1, nil):GetFirst()
      local field_to_spell=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_STZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("destination " .. leaving:GetDestination() .. "/" .. tostring(leaving:IsDestination(LOCATION_GRAVE)) .. "/" .. tostring(leaving:IsDestination(LOCATION_HAND,LOCATION_GRAVE)) .. "/" .. tostring(leaving:IsDestination({LOCATION_HAND,LOCATION_GRAVE})) .. "/" .. tostring(leaving:IsDestination(LOCATION_HAND)))
      Debug.Message("leave field dest " .. leaving:GetLeaveFieldDest() .. "/" .. tostring(leaving:IsLeaveFieldDest(LOCATION_GRAVE)) .. "/" .. tostring(leaving:IsLeaveFieldDest(LOCATION_HAND,LOCATION_GRAVE)) .. "/" .. tostring(leaving:IsLeaveFieldDest({LOCATION_HAND,LOCATION_GRAVE})) .. "/" .. tostring(leaving:IsLeaveFieldDest(LOCATION_HAND)))
      Debug.Message("symbolic destination " .. tostring(spell:IsDestination(LOCATION_SZONE)) .. "/" .. tostring(spell:IsDestination(LOCATION_STZONE)) .. "/" .. tostring(spell:IsDestination(LOCATION_MZONE)))
      Debug.Message("symbolic leave field dest " .. field_to_spell:GetLeaveFieldDest() .. "/" .. tostring(field_to_spell:IsLeaveFieldDest(LOCATION_SZONE)) .. "/" .. tostring(field_to_spell:IsLeaveFieldDest(LOCATION_STZONE)) .. "/" .. tostring(field_to_spell:IsLeaveFieldDest(LOCATION_MZONE)))
      Debug.Message("hand destination " .. hand:GetDestination())
      Debug.Message("hand leave field dest " .. hand:GetLeaveFieldDest() .. "/" .. tostring(hand:IsLeaveFieldDest(LOCATION_HAND)))
      `,
      "leave-field-destination.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("destination 16/true/true/true/false");
    expect(host.messages).toContain("leave field dest 16/true/true/true/false");
    expect(host.messages).toContain("symbolic destination true/true/false");
    expect(host.messages).toContain("symbolic leave field dest 8/true/true/false");
    expect(host.messages).toContain("hand destination 0");
    expect(host.messages).toContain("hand leave field dest 0/false");
  });

  it("matches symbolic field and Pendulum previous locations", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Previous Field Spell", kind: "spell", typeFlags: 0x80002 },
      { code: "200", name: "Previous Pendulum Scale", kind: "monster", typeFlags: 0x1000001, leftScale: 1, rightScale: 1 },
      { code: "300", name: "Previous Spell Zone Card", kind: "spell" },
      { code: "400", name: "Previous Main Monster", kind: "monster" },
      { code: "500", name: "Previous Extra Monster", kind: "monster" },
    ];
    const session = createDuel({ seed: 252, startingHandSize: 5, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400", "500"] },
      1: { main: [] },
    });
    startDuel(session);

    const field = session.state.cards.find((card) => card.code === "100")!;
    const pendulum = session.state.cards.find((card) => card.code === "200")!;
    const spell = session.state.cards.find((card) => card.code === "300")!;
    const mainMonster = session.state.cards.find((card) => card.code === "400")!;
    const extraMonster = session.state.cards.find((card) => card.code === "500")!;
    moveDuelCard(session.state, field.uid, "spellTrapZone", 0).sequence = 4;
    moveDuelCard(session.state, field.uid, "graveyard", 0);
    moveDuelCard(session.state, pendulum.uid, "spellTrapZone", 0).sequence = 0;
    moveDuelCard(session.state, pendulum.uid, "graveyard", 0);
    moveDuelCard(session.state, spell.uid, "spellTrapZone", 0).sequence = 2;
    moveDuelCard(session.state, spell.uid, "graveyard", 0);
    moveDuelCard(session.state, mainMonster.uid, "monsterZone", 0).sequence = 2;
    moveDuelCard(session.state, mainMonster.uid, "graveyard", 0);
    moveDuelCard(session.state, extraMonster.uid, "monsterZone", 0).sequence = 5;
    moveDuelCard(session.state, extraMonster.uid, "graveyard", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local field=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      local pendulum=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      local spell=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      local main_monster=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      local extra_monster=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      Debug.Message("previous field zone " .. field:GetPreviousLocation() .. "/" .. tostring(field:IsPreviousLocation(LOCATION_SZONE)) .. "/" .. tostring(field:IsPreviousLocation(LOCATION_FZONE)) .. "/" .. tostring(field:IsPreviousLocation(LOCATION_STZONE)) .. "/" .. tostring(field:IsPreviousLocation(LOCATION_PZONE)))
      Debug.Message("previous pendulum zone " .. pendulum:GetPreviousLocation() .. "/" .. tostring(pendulum:IsPreviousLocation(LOCATION_SZONE)) .. "/" .. tostring(pendulum:IsPreviousLocation(LOCATION_PZONE)) .. "/" .. tostring(pendulum:IsPreviousLocation(LOCATION_STZONE)) .. "/" .. tostring(pendulum:IsPreviousLocation(LOCATION_FZONE)))
      Debug.Message("previous spell zone " .. spell:GetPreviousLocation() .. "/" .. tostring(spell:IsPreviousLocation(LOCATION_SZONE)) .. "/" .. tostring(spell:IsPreviousLocation(LOCATION_STZONE)) .. "/" .. tostring(spell:IsPreviousLocation(LOCATION_FZONE)) .. "/" .. tostring(spell:IsPreviousLocation(LOCATION_PZONE)))
      Debug.Message("previous main monster zone " .. main_monster:GetPreviousLocation() .. "/" .. tostring(main_monster:IsPreviousLocation(LOCATION_MZONE)) .. "/" .. tostring(main_monster:IsPreviousLocation(LOCATION_MMZONE)) .. "/" .. tostring(main_monster:IsPreviousLocation(LOCATION_EMZONE)))
      Debug.Message("previous extra monster zone " .. extra_monster:GetPreviousLocation() .. "/" .. tostring(extra_monster:IsPreviousLocation(LOCATION_MZONE)) .. "/" .. tostring(extra_monster:IsPreviousLocation(LOCATION_EMZONE)) .. "/" .. tostring(extra_monster:IsPreviousLocation(LOCATION_MMZONE)))
      `,
      "symbolic-previous-locations.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("previous field zone 8/true/true/false/false");
    expect(host.messages).toContain("previous pendulum zone 8/true/true/false/false");
    expect(host.messages).toContain("previous spell zone 8/true/true/false/false");
    expect(host.messages).toContain("previous main monster zone 4/true/true/false");
    expect(host.messages).toContain("previous extra monster zone 4/true/true/false");
  });

  it("matches symbolic field and Pendulum destinations", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Destination Field Spell", kind: "spell", typeFlags: 0x80002 },
      { code: "200", name: "Destination Pendulum Scale", kind: "monster", typeFlags: 0x1000001, leftScale: 1, rightScale: 1 },
      { code: "300", name: "Destination Spell Zone Card", kind: "spell" },
      { code: "400", name: "Leave Field Spell", kind: "spell", typeFlags: 0x80002 },
      { code: "500", name: "Leave Pendulum Scale", kind: "monster", typeFlags: 0x1000001, leftScale: 1, rightScale: 1 },
      { code: "600", name: "Destination Main Monster", kind: "monster" },
      { code: "700", name: "Destination Extra Monster", kind: "monster" },
      { code: "800", name: "Leave To Main Monster", kind: "monster" },
      { code: "900", name: "Leave To Extra Monster", kind: "monster" },
    ];
    const session = createDuel({ seed: 254, startingHandSize: 9, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400", "500", "600", "700", "800", "900"] },
      1: { main: [] },
    });
    startDuel(session);

    const field = session.state.cards.find((card) => card.code === "100")!;
    const pendulum = session.state.cards.find((card) => card.code === "200")!;
    const spell = session.state.cards.find((card) => card.code === "300")!;
    const leaveField = session.state.cards.find((card) => card.code === "400")!;
    const leavePendulum = session.state.cards.find((card) => card.code === "500")!;
    const mainMonster = session.state.cards.find((card) => card.code === "600")!;
    const extraMonster = session.state.cards.find((card) => card.code === "700")!;
    const leaveMainMonster = session.state.cards.find((card) => card.code === "800")!;
    const leaveExtraMonster = session.state.cards.find((card) => card.code === "900")!;
    moveDuelCard(session.state, field.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, pendulum.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, spell.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, leaveField.uid, "monsterZone", 0);
    moveDuelCard(session.state, leaveField.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, leavePendulum.uid, "monsterZone", 0);
    moveDuelCard(session.state, leavePendulum.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, mainMonster.uid, "monsterZone", 0);
    moveDuelCard(session.state, extraMonster.uid, "monsterZone", 0);
    moveDuelCard(session.state, leaveMainMonster.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, leaveMainMonster.uid, "monsterZone", 0);
    moveDuelCard(session.state, leaveExtraMonster.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, leaveExtraMonster.uid, "monsterZone", 0);
    field.sequence = 4;
    pendulum.sequence = 0;
    spell.sequence = 2;
    leaveField.sequence = 4;
    leavePendulum.sequence = 1;
    mainMonster.sequence = 2;
    extraMonster.sequence = 5;
    leaveMainMonster.sequence = 3;
    leaveExtraMonster.sequence = 6;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local field=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_FZONE, 0, 1, 1, nil):GetFirst()
      local pendulum=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_PZONE, 0, 1, 1, nil):GetFirst()
      local spell=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_STZONE, 0, 1, 1, nil):GetFirst()
      local leave_field=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_FZONE, 0, 1, 1, nil):GetFirst()
      local leave_pendulum=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_PZONE, 0, 1, 1, nil):GetFirst()
      local main_monster=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 600), 0, LOCATION_MMZONE, 0, 1, 1, nil):GetFirst()
      local extra_monster=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 700), 0, LOCATION_EMZONE, 0, 1, 1, nil):GetFirst()
      local leave_main_monster=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 800), 0, LOCATION_MMZONE, 0, 1, 1, nil):GetFirst()
      local leave_extra_monster=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, LOCATION_EMZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("destination field zone " .. field:GetDestination() .. "/" .. tostring(field:IsDestination(LOCATION_SZONE)) .. "/" .. tostring(field:IsDestination(LOCATION_FZONE)) .. "/" .. tostring(field:IsDestination(LOCATION_STZONE)) .. "/" .. tostring(field:IsDestination(LOCATION_PZONE)))
      Debug.Message("destination pendulum zone " .. pendulum:GetDestination() .. "/" .. tostring(pendulum:IsDestination(LOCATION_SZONE)) .. "/" .. tostring(pendulum:IsDestination(LOCATION_PZONE)) .. "/" .. tostring(pendulum:IsDestination(LOCATION_STZONE)) .. "/" .. tostring(pendulum:IsDestination(LOCATION_FZONE)))
      Debug.Message("destination spell zone " .. spell:GetDestination() .. "/" .. tostring(spell:IsDestination(LOCATION_SZONE)) .. "/" .. tostring(spell:IsDestination(LOCATION_STZONE)) .. "/" .. tostring(spell:IsDestination(LOCATION_FZONE)) .. "/" .. tostring(spell:IsDestination(LOCATION_PZONE)))
      Debug.Message("destination main monster zone " .. main_monster:GetDestination() .. "/" .. tostring(main_monster:IsDestination(LOCATION_MZONE)) .. "/" .. tostring(main_monster:IsDestination(LOCATION_MMZONE)) .. "/" .. tostring(main_monster:IsDestination(LOCATION_EMZONE)))
      Debug.Message("destination extra monster zone " .. extra_monster:GetDestination() .. "/" .. tostring(extra_monster:IsDestination(LOCATION_MZONE)) .. "/" .. tostring(extra_monster:IsDestination(LOCATION_EMZONE)) .. "/" .. tostring(extra_monster:IsDestination(LOCATION_MMZONE)))
      Debug.Message("leave field zone " .. leave_field:GetLeaveFieldDest() .. "/" .. tostring(leave_field:IsLeaveFieldDest(LOCATION_SZONE)) .. "/" .. tostring(leave_field:IsLeaveFieldDest(LOCATION_FZONE)) .. "/" .. tostring(leave_field:IsLeaveFieldDest(LOCATION_STZONE)) .. "/" .. tostring(leave_field:IsLeaveFieldDest(LOCATION_PZONE)))
      Debug.Message("leave pendulum zone " .. leave_pendulum:GetLeaveFieldDest() .. "/" .. tostring(leave_pendulum:IsLeaveFieldDest(LOCATION_SZONE)) .. "/" .. tostring(leave_pendulum:IsLeaveFieldDest(LOCATION_PZONE)) .. "/" .. tostring(leave_pendulum:IsLeaveFieldDest(LOCATION_STZONE)) .. "/" .. tostring(leave_pendulum:IsLeaveFieldDest(LOCATION_FZONE)))
      Debug.Message("leave main monster zone " .. leave_main_monster:GetLeaveFieldDest() .. "/" .. tostring(leave_main_monster:IsLeaveFieldDest(LOCATION_MZONE)) .. "/" .. tostring(leave_main_monster:IsLeaveFieldDest(LOCATION_MMZONE)) .. "/" .. tostring(leave_main_monster:IsLeaveFieldDest(LOCATION_EMZONE)))
      Debug.Message("leave extra monster zone " .. leave_extra_monster:GetLeaveFieldDest() .. "/" .. tostring(leave_extra_monster:IsLeaveFieldDest(LOCATION_MZONE)) .. "/" .. tostring(leave_extra_monster:IsLeaveFieldDest(LOCATION_EMZONE)) .. "/" .. tostring(leave_extra_monster:IsLeaveFieldDest(LOCATION_MMZONE)))
      `,
      "symbolic-destinations.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("destination field zone 0/true/true/false/false");
    expect(host.messages).toContain("destination pendulum zone 0/true/true/false/false");
    expect(host.messages).toContain("destination spell zone 0/true/true/false/false");
    expect(host.messages).toContain("destination main monster zone 0/true/true/false");
    expect(host.messages).toContain("destination extra monster zone 0/true/true/false");
    expect(host.messages).toContain("leave field zone 8/true/true/false/false");
    expect(host.messages).toContain("leave pendulum zone 8/true/true/false/false");
    expect(host.messages).toContain("leave main monster zone 4/true/true/false");
    expect(host.messages).toContain("leave extra monster zone 4/true/true/false");
  });

  it("lets Lua scripts draw and search deck cards", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Draw A", kind: "monster" },
      { code: "200", name: "Draw B", kind: "monster" },
      { code: "300", name: "Search Target", kind: "monster" },
      { code: "400", name: "Draw C", kind: "monster" },
    ];
    const session = createDuel({ seed: 12, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400"] },
      1: { main: ["100"] },
    });
    startDuel(session);
    const deckOrder = session.state.cards.filter((card) => card.controller === 0 && card.location === "deck").sort((a, b) => a.sequence - b.sequence);
    const drawnCodes = deckOrder.slice(0, 2).map((card) => card.code);
    const searchCode = deckOrder.slice(2).find((card) => card.code === "300")?.code ?? deckOrder[2]!.code;
    const discardedCode = deckOrder.slice(2).find((card) => card.code !== searchCode)!.code;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("can draw two " .. tostring(Duel.IsPlayerCanDraw(0, 2)))
      Debug.Message("can draw five " .. tostring(Duel.IsPlayerCanDraw(0, 5)))
      Debug.Message("drawn " .. Duel.Draw(0, 2, REASON_EFFECT))
      Debug.Message("draw operated " .. Duel.GetOperatedGroup():GetCount())
      local searched = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, ${searchCode}), 0, LOCATION_DECK, 0, 1, 1, nil)
      local searched_card = searched:GetFirst()
      Debug.Message("can grave searched " .. tostring(Duel.IsPlayerCanSendtoGrave(0, searched_card)))
      Debug.Message("can hand searched " .. tostring(Duel.IsPlayerCanSendtoHand(0, searched_card)))
      Debug.Message("can deck searched " .. tostring(Duel.IsPlayerCanSendtoDeck(0, searched_card)))
      Debug.Message("can remove searched " .. tostring(Duel.IsPlayerCanRemove(0, searched_card)))
      Debug.Message("can extra searched " .. tostring(Duel.IsPlayerCanSendtoExtra(0, searched_card)))
      Debug.Message("can special summon " .. tostring(Duel.IsPlayerCanSpecialSummon(0, 0, POS_FACEUP_ATTACK, 0)))
      Debug.Message("searched " .. Duel.SendtoHand(searched, 0, REASON_EFFECT))
      Debug.Message("search operated " .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("can discard one " .. tostring(Duel.IsPlayerCanDiscardDeck(0, 1)))
      Debug.Message("can discard two " .. tostring(Duel.IsPlayerCanDiscardDeck(0, 2)))
      Debug.Message("can discard cost one " .. tostring(Duel.IsPlayerCanDiscardDeckAsCost(0, 1)))
      Debug.Message("can discard cost two " .. tostring(Duel.IsPlayerCanDiscardDeckAsCost(0, 2)))
      Debug.Message("discarded " .. Duel.DiscardDeck(0, 2, REASON_EFFECT))
      Debug.Message("discard operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("can hand discard three " .. tostring(Duel.IsPlayerCanDiscardHand(0, 3)))
      Debug.Message("can hand discard four " .. tostring(Duel.IsPlayerCanDiscardHand(0, 4)))
      Debug.Message("hand discarded " .. Duel.DiscardHand(0, aux.FilterBoolFunction(Card.IsCode, ${drawnCodes[0]}), 1, 1, REASON_EFFECT))
      Debug.Message("hand discard operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      `,
      "draw-search.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("can draw two true");
    expect(host.messages).toContain("can draw five false");
    expect(host.messages).toContain("drawn 2");
    expect(host.messages).toContain("draw operated 2");
    expect(host.messages).toContain("can grave searched true");
    expect(host.messages).toContain("can hand searched true");
    expect(host.messages).toContain("can deck searched false");
    expect(host.messages).toContain("can remove searched true");
    expect(host.messages).toContain("can extra searched false");
    expect(host.messages).toContain("can special summon true");
    expect(host.messages).toContain("searched 1");
    expect(host.messages).toContain(`search operated ${searchCode}`);
    expect(host.messages).toContain("can discard one true");
    expect(host.messages).toContain("can discard two false");
    expect(host.messages).toContain("can discard cost one true");
    expect(host.messages).toContain("can discard cost two false");
    expect(host.messages).toContain("discarded 1");
    expect(host.messages).toContain(`discard operated 1/${discardedCode}`);
    expect(host.messages).toContain("can hand discard three true");
    expect(host.messages).toContain("can hand discard four false");
    expect(host.messages).toContain("hand discarded 1");
    expect(host.messages).toContain(`hand discard operated 1/${drawnCodes[0]}`);
    expect(session.state.cards.filter((card) => card.controller === 0 && card.location === "hand" && drawnCodes.includes(card.code))).toHaveLength(1);
    expect(session.state.cards.find((card) => card.controller === 0 && card.code === drawnCodes[0])?.location).toBe("graveyard");
    expect(session.state.cards.find((card) => card.controller === 0 && card.code === searchCode)?.location).toBe("hand");
    expect(session.state.cards.find((card) => card.controller === 0 && card.code === discardedCode)?.location).toBe("graveyard");
  });

  it("lets Lua scripts query turn draw counts", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Draw Count Card", kind: "monster" }];
    const session = createDuel({ seed: 71, startingHandSize: 0, drawPerTurn: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("draw count self " .. Duel.GetDrawCount(0))
      Debug.Message("draw count opponent " .. Duel.GetDrawCount(1))
      Debug.Message("draw count default " .. Duel.GetDrawCount())
      `,
      "draw-count.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("draw count self 2");
    expect(host.messages).toContain("draw count opponent 2");
    expect(host.messages).toContain("draw count default 2");
  });

  it("lets Lua scripts query active field spell environments", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Field Environment", kind: "spell", typeFlags: 0x80002 },
      { code: "200", name: "Normal Spell", kind: "spell", typeFlags: 0x2 },
    ];
    const session = createDuel({ seed: 73, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const field = session.state.cards.find((card) => card.code === "100");
    const spell = session.state.cards.find((card) => card.code === "200");
    expect(field).toBeDefined();
    expect(spell).toBeDefined();
    moveDuelCard(session.state, field!.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, spell!.uid, "spellTrapZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("environment field " .. tostring(Duel.IsEnvironment(100)))
      Debug.Message("environment player " .. tostring(Duel.IsEnvironment(100, 0)))
      Debug.Message("environment fzone " .. tostring(Duel.IsEnvironment(100, PLAYER_ALL, LOCATION_FZONE)))
      Debug.Message("environment normal spell " .. tostring(Duel.IsEnvironment(200)))
      Debug.Message("environment missing " .. tostring(Duel.IsEnvironment(300)))
      Debug.Message("environment code " .. Duel.GetEnvironment(0, LOCATION_FZONE))
      `,
      "field-environment.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("environment field true");
    expect(host.messages).toContain("environment player true");
    expect(host.messages).toContain("environment fzone true");
    expect(host.messages).toContain("environment normal spell false");
    expect(host.messages).toContain("environment missing false");
    expect(host.messages).toContain("environment code 100");
  });

  it("lets Lua scripts activate and replace field spells", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Old Field", kind: "spell", typeFlags: 0x80002 },
      { code: "200", name: "New Field", kind: "spell", typeFlags: 0x80002 },
      { code: "300", name: "Normal Spell", kind: "spell", typeFlags: 0x2 },
    ];
    const session = createDuel({ seed: 74, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const oldField = session.state.cards.find((card) => card.code === "100");
    expect(oldField).toBeDefined();
    moveDuelCard(session.state, oldField!.uid, "spellTrapZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local field=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local normal=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("activate normal field " .. tostring(Duel.ActivateFieldSpell(normal,nil,0)))
      Debug.Message("activate field spell " .. tostring(Duel.ActivateFieldSpell(field,nil,0)))
      Debug.Message("activate operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("activate environment " .. tostring(Duel.IsEnvironment(200, 0, LOCATION_FZONE)))
      `,
      "activate-field-spell.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("activate normal field false");
    expect(host.messages).toContain("activate field spell true");
    expect(host.messages).toContain("activate operated 1/200");
    expect(host.messages).toContain("activate environment true");
    expect(session.state.cards.find((card) => card.code === "100")).toMatchObject({ location: "graveyard" });
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "spellTrapZone", faceUp: true });
    expect(session.state.cards.find((card) => card.code === "300")).toMatchObject({ location: "hand" });
  });

});

function handCodes(session: ReturnType<typeof createDuel>, player: 0 | 1): string[] {
  return session.state.cards
    .filter((card) => card.controller === player && card.location === "hand")
    .sort((a, b) => a.sequence - b.sequence)
    .map((card) => card.code);
}

function deckCodes(session: ReturnType<typeof createDuel>, player: 0 | 1): string[] {
  return session.state.cards
    .filter((card) => card.controller === player && card.location === "deck")
    .sort((a, b) => a.sequence - b.sequence)
    .map((card) => card.code);
}

function extraCodes(session: ReturnType<typeof createDuel>, player: 0 | 1): string[] {
  return session.state.cards
    .filter((card) => card.controller === player && card.location === "extraDeck")
    .sort((a, b) => a.sequence - b.sequence)
    .map((card) => card.code);
}
