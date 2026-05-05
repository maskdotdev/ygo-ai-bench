import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, registerEffect, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards, findPublicCard } from "./full-duel-engine-fixtures.js";

describe("duel snapshot card and effect shape validation", () => {
  it("rejects malformed card snapshots before restore", () => {
    const session = createDuel({ seed: 157, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badOwner = serializeDuel(session);
    const badOverlay = serializeDuel(session);
    badOwner.state.cards[0] = { ...badOwner.state.cards[0]!, owner: 2 as 0 };
    badOverlay.state.cards[0] = { ...badOverlay.state.cards[0]!, overlayUids: ["mat", 7 as unknown as string] };

    expect(() => restoreDuel(badOwner, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.owner must be a player id");
    expect(() => restoreDuel(badOverlay, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.overlayUids.1 must be a string");
  });

  it("rejects malformed card data snapshots before restore", () => {
    const session = createDuel({ seed: 158, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badKind = serializeDuel(session);
    const badSynchro = serializeDuel(session);
    badKind.state.cards[0] = { ...badKind.state.cards[0]!, data: { ...badKind.state.cards[0]!.data, kind: "token" as "monster" } };
    badSynchro.state.cards[0] = { ...badSynchro.state.cards[0]!, data: { ...badSynchro.state.cards[0]!.data, synchroMaterials: { tuner: "100", nonTuners: [7 as unknown as string] } } };

    expect(() => restoreDuel(badKind, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.data.kind must be a card kind");
    expect(() => restoreDuel(badSynchro, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.data.synchroMaterials.nonTuners.0 must be a string");
  });

  it("rejects malformed unique card state snapshots before restore", () => {
    const session = createDuel({ seed: 161, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badUnique = serializeDuel(session);
    badUnique.state.cards[0] = { ...badUnique.state.cards[0]!, uniqueOnField: { self: true, opponent: "no" as unknown as boolean, code: 100, locationMask: 0x04 } };

    expect(() => restoreDuel(badUnique, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.uniqueOnField.opponent must be a boolean");
  });

  it("rejects duplicate card uid snapshots before restore", () => {
    const session = createDuel({ seed: 162, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const duplicateUid = serializeDuel(session);
    duplicateUid.state.cards[1] = { ...duplicateUid.state.cards[1]!, uid: duplicateUid.state.cards[0]!.uid };

    expect(() => restoreDuel(duplicateUid, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.1.uid must be unique");
  });

  it("rejects broken overlay references before restore", () => {
    const session = createDuel({ seed: 163, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const missingOverlay = serializeDuel(session);
    const wrongLocation = serializeDuel(session);
    missingOverlay.state.cards[0] = { ...missingOverlay.state.cards[0]!, overlayUids: ["missing-material"] };
    wrongLocation.state.cards[0] = { ...wrongLocation.state.cards[0]!, overlayUids: [wrongLocation.state.cards[1]!.uid] };

    expect(() => restoreDuel(missingOverlay, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.overlayUids.0 must reference a card");
    expect(() => restoreDuel(wrongLocation, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.overlayUids.0 must reference an overlay card");
  });

  it("rejects broken card state references before restore", () => {
    const session = createDuel({ seed: 166, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badEquippedTo = serializeDuel(session);
    const badMaterial = serializeDuel(session);
    badEquippedTo.state.cards[0] = { ...badEquippedTo.state.cards[0]!, equippedToUid: "missing" };
    badMaterial.state.cards[0] = { ...badMaterial.state.cards[0]!, summonMaterialUids: [badMaterial.state.cards[1]!.uid, "missing"] };

    expect(() => restoreDuel(badEquippedTo, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.equippedToUid must reference a card");
    expect(() => restoreDuel(badMaterial, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.summonMaterialUids.1 must reference a card");
  });

  it("rejects malformed effect snapshots before restore", () => {
    const session = createDuel({ seed: 159, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const source = findPublicCard(session, 0, "hand", "100");
    expect(source).toBeTruthy();
    registerEffect(session, {
      id: "snapshot-shape-effect",
      registryKey: "snapshot-shape-effect",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      operation() {},
    });
    const badEvent = serializeDuel(session);
    const badRange = serializeDuel(session);
    const badTriggerEvent = serializeDuel(session);
    badEvent.state.effects[0] = { ...badEvent.state.effects[0]!, event: "passive" as "ignition" };
    badRange.state.effects[0] = { ...badRange.state.effects[0]!, range: ["hand", "field" as "hand"] };
    badTriggerEvent.state.effects[0] = { ...badTriggerEvent.state.effects[0]!, triggerEvent: "unknown" as "customEvent" };

    expect(() => restoreDuel(badEvent, createCardReader(cards))).toThrow("Malformed duel snapshot: state.effects.0.event must be an effect event");
    expect(() => restoreDuel(badRange, createCardReader(cards))).toThrow("Malformed duel snapshot: state.effects.0.range.1 must be a card location");
    expect(() => restoreDuel(badTriggerEvent, createCardReader(cards))).toThrow("Malformed duel snapshot: state.effects.0.triggerEvent must be a duel event");
  });

  it("rejects malformed effect reset and tuple snapshots before restore", () => {
    const session = createDuel({ seed: 160, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const source = findPublicCard(session, 0, "hand", "100");
    expect(source).toBeTruthy();
    registerEffect(session, {
      id: "snapshot-shape-reset-effect",
      registryKey: "snapshot-shape-reset-effect",
      sourceUid: source!.uid,
      controller: 0,
      event: "continuous",
      range: ["hand"],
      reset: { flags: 1 },
      targetRange: [1],
      operation() {},
    });
    const badReset = serializeDuel(session);
    const badTuple = serializeDuel(session);
    badReset.state.effects[0] = { ...badReset.state.effects[0]!, reset: { flags: "reset" as unknown as number } };
    badTuple.state.effects[0] = { ...badTuple.state.effects[0]!, targetRange: [1, 2, 3] as unknown as [number, number] };

    expect(() => restoreDuel(badReset, createCardReader(cards))).toThrow("Malformed duel snapshot: state.effects.0.reset.flags must be a number");
    expect(() => restoreDuel(badTuple, createCardReader(cards))).toThrow("Malformed duel snapshot: state.effects.0.targetRange must contain one or two numbers");
  });
});
